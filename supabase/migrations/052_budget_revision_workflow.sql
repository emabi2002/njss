-- =============================================================================
-- NJSS 052 — BUDGET REVISION / REFORECAST WORKFLOW
-- Revision creation, financial-position validation and atomic approval.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Revision position view used by the UI and reporting layer.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_budget_revision_position
WITH (security_invoker = true) AS
SELECT
  br.id AS revision_id,
  br.revision_number,
  br.revision_type,
  br.status AS revision_status,
  br.parent_submission_id,
  br.revision_submission_id,
  br.budget_year,
  br.division_id,
  brl.id AS revision_line_id,
  brl.revision_budget_line_id,
  brl.source_budget_line_id,
  brl.source_budget_allocation_id,
  brl.original_budget,
  brl.current_revised_budget,
  COALESCE(vap.actual_expenditure, 0)::NUMERIC(15,2) AS actual_expenditure,
  COALESCE(vap.outstanding_commitment, 0)::NUMERIC(15,2) AS outstanding_commitment,
  (COALESCE(vap.actual_expenditure, 0) + COALESCE(vap.outstanding_commitment, 0))::NUMERIC(15,2) AS protected_minimum,
  rl.annual_estimate::NUMERIC(15,2) AS proposed_revised_budget,
  (rl.annual_estimate - brl.current_revised_budget)::NUMERIC(15,2) AS adjustment_amount,
  (rl.annual_estimate - COALESCE(vap.actual_expenditure, 0) - COALESCE(vap.outstanding_commitment, 0))::NUMERIC(15,2) AS available_after_revision,
  COALESCE(pm.actual_monthly, '{}'::jsonb) AS actual_monthly,
  COALESCE(cp.closed_month_numbers, ARRAY[]::INTEGER[]) AS closed_month_numbers
FROM budget_revision_lines brl
JOIN budget_revisions br ON br.id = brl.budget_revision_id
JOIN divisional_budget_lines rl ON rl.id = brl.revision_budget_line_id
LEFT JOIN v_authoritative_budget_position vap
  ON vap.budget_allocation_id = brl.source_budget_allocation_id
LEFT JOIN LATERAL (
  SELECT jsonb_object_agg(month_number::TEXT, amount ORDER BY month_number) AS actual_monthly
  FROM (
    SELECT EXTRACT(MONTH FROM pt.transaction_date)::INTEGER AS month_number,
           SUM(pt.amount)::NUMERIC(15,2) AS amount
    FROM payment_transactions pt
    WHERE pt.budget_allocation_id = brl.source_budget_allocation_id
      AND COALESCE(pt.status, 'POSTED') <> 'REVERSED'
    GROUP BY EXTRACT(MONTH FROM pt.transaction_date)::INTEGER
  ) x
) pm ON true
LEFT JOIN LATERAL (
  SELECT ARRAY_AGG(m ORDER BY m) AS closed_month_numbers
  FROM generate_series(1, 12) m
  WHERE EXISTS (
    SELECT 1
    FROM divisional_budget_submissions rs
    JOIN budget_periods bp ON bp.budget_cycle_id = rs.cycle_id
    WHERE rs.id = br.revision_submission_id
      AND bp.is_active IS DISTINCT FROM false
      AND bp.is_open = false
      AND (
        (UPPER(COALESCE(bp.period_type, '')) = 'MONTH' AND bp.period_number = m)
        OR (UPPER(COALESCE(bp.period_type, '')) = 'QUARTER' AND bp.period_number = CEIL(m / 3.0)::INTEGER)
        OR UPPER(COALESCE(bp.period_type, '')) IN ('YEAR','ANNUAL')
      )
  )
) cp ON true;

GRANT SELECT ON v_budget_revision_position TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Revision-draft integrity: copied baseline lines retain posting identity.
--    New target lines remain deletable while DRAFT/RETURNED.
-- -----------------------------------------------------------------------------
ALTER TABLE budget_revision_lines
  DROP CONSTRAINT IF EXISTS budget_revision_lines_revision_budget_line_id_fkey;
ALTER TABLE budget_revision_lines
  ADD CONSTRAINT budget_revision_lines_revision_budget_line_id_fkey
  FOREIGN KEY (revision_budget_line_id) REFERENCES divisional_budget_lines(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION njss_guard_budget_revision_line_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_source_line_id UUID;
BEGIN
  SELECT brl.source_budget_line_id
  INTO v_source_line_id
  FROM budget_revision_lines brl
  JOIN budget_revisions br ON br.id = brl.budget_revision_id
  WHERE brl.revision_budget_line_id = OLD.id
    AND br.status IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','REVIEWED')
  LIMIT 1;

  IF v_source_line_id IS NULL THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Copied baseline revision lines cannot be deleted; reduce the proposed amount instead.';
  END IF;

  IF NEW.expense_ledger_id IS DISTINCT FROM OLD.expense_ledger_id
     OR NEW.funding_source_id IS DISTINCT FROM OLD.funding_source_id
     OR NEW.submission_id IS DISTINCT FROM OLD.submission_id THEN
    RAISE EXCEPTION 'A copied baseline line cannot change finance code, funding source or submission identity. Create a new target line for virement/reclassification.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_budget_revision_line_identity ON divisional_budget_lines;
CREATE TRIGGER trg_budget_revision_line_identity
  BEFORE UPDATE OR DELETE ON divisional_budget_lines
  FOR EACH ROW EXECUTE FUNCTION njss_guard_budget_revision_line_identity();

-- -----------------------------------------------------------------------------
-- 3. Internal financial validation and snapshot helper.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION njss_validate_budget_revision(
  p_revision_id UUID,
  p_snapshot_stage TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_revision budget_revisions;
  v_submission divisional_budget_submissions;
  v_line RECORD;
  v_net NUMERIC(15,2) := 0;
  v_bad RECORD;
  v_authority funding_authorities;
  v_authority_used NUMERIC(15,2) := 0;
  v_positive_increase NUMERIC(15,2) := 0;
  v_funding_source_count INTEGER := 0;
BEGIN
  IF UPPER(COALESCE(p_snapshot_stage, '')) NOT IN ('SUBMISSION','APPROVAL') THEN
    RAISE EXCEPTION 'Unsupported budget revision snapshot stage.';
  END IF;

  SELECT * INTO v_revision FROM budget_revisions WHERE id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget revision not found.'; END IF;

  SELECT * INTO v_submission
  FROM divisional_budget_submissions
  WHERE id = v_revision.revision_submission_id
  FOR UPDATE;

  -- Ensure every revision-submission line has metadata. New target lines start at zero.
  INSERT INTO budget_revision_lines (
    budget_revision_id, source_budget_allocation_id, source_budget_line_id,
    revision_budget_line_id, original_budget, current_revised_budget,
    proposed_revised_budget, adjustment_amount
  )
  SELECT v_revision.id, NULL, NULL, l.id, 0, 0, l.annual_estimate, l.annual_estimate
  FROM divisional_budget_lines l
  WHERE l.submission_id = v_revision.revision_submission_id
    AND NOT EXISTS (
      SELECT 1 FROM budget_revision_lines brl
      WHERE brl.budget_revision_id = v_revision.id
        AND brl.revision_budget_line_id = l.id
    );

  PERFORM recalc_divisional_budget_submission_totals(v_revision.revision_submission_id);

  SELECT l.line_number,
         CASE
           WHEN l.expense_ledger_id IS NULL THEN 'Finance Code is required'
           WHEN el.id IS NULL OR el.is_active IS DISTINCT FROM true OR el.is_posting IS DISTINCT FROM true THEN 'Finance Code must be an active posting ledger code'
           WHEN COALESCE(TRIM(l.line_item_description), '') = '' THEN 'Line Item / Activity Description is required'
           WHEN COALESCE(TRIM(l.business_justification), '') = '' THEN 'Business Justification is required'
           WHEN COALESCE(l.quantity, 0) <= 0 THEN 'Quantity must be greater than zero'
           WHEN l.unit_cost IS NULL OR l.unit_cost < 0 THEN 'Unit Cost must be valid'
           WHEN COALESCE(l.frequency_periods, 0) <= 0 THEN 'Frequency / Periods must be greater than zero'
           WHEN ABS(COALESCE(l.allocation_variance, 0)) > 0.009 THEN 'Monthly allocation must equal Annual Estimate'
           ELSE NULL
         END AS reason
  INTO v_bad
  FROM divisional_budget_lines l
  LEFT JOIN expense_ledger el ON el.id = l.expense_ledger_id
  WHERE l.submission_id = v_revision.revision_submission_id
    AND (
      l.expense_ledger_id IS NULL OR el.id IS NULL OR el.is_active IS DISTINCT FROM true OR el.is_posting IS DISTINCT FROM true OR
      COALESCE(TRIM(l.line_item_description), '') = '' OR COALESCE(TRIM(l.business_justification), '') = '' OR
      COALESCE(l.quantity, 0) <= 0 OR l.unit_cost IS NULL OR l.unit_cost < 0 OR COALESCE(l.frequency_periods, 0) <= 0 OR
      ABS(COALESCE(l.allocation_variance, 0)) > 0.009
    )
  ORDER BY l.line_number
  LIMIT 1;

  IF v_bad.reason IS NOT NULL THEN
    RAISE EXCEPTION 'Revision row % invalid: %', v_bad.line_number, v_bad.reason;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM divisional_budget_lines WHERE submission_id = v_revision.revision_submission_id) THEN
    RAISE EXCEPTION 'A budget revision must contain at least one line.';
  END IF;

  IF ABS(COALESCE((SELECT unallocated_variance FROM divisional_budget_submissions WHERE id = v_revision.revision_submission_id), 0)) > 0.009 THEN
    RAISE EXCEPTION 'Revision monthly allocations must equal proposed annual amounts.';
  END IF;

  -- Closed periods and months with posted actual expenditure cannot be rephased.
  SELECT rl.line_number,
         rma.month_number
  INTO v_bad
  FROM budget_revision_lines brl
  JOIN divisional_budget_lines rl ON rl.id = brl.revision_budget_line_id
  JOIN budget_monthly_allocations rma ON rma.budget_line_id = rl.id
  JOIN budget_monthly_allocations sma
    ON sma.budget_line_id = brl.source_budget_line_id
   AND sma.month_number = rma.month_number
  WHERE brl.budget_revision_id = v_revision.id
    AND brl.source_budget_line_id IS NOT NULL
    AND ABS(COALESCE(rma.amount,0) - COALESCE(sma.amount,0)) > 0.009
    AND (
      EXISTS (
        SELECT 1
        FROM budget_periods bp
        WHERE bp.budget_cycle_id = v_submission.cycle_id
          AND bp.is_active IS DISTINCT FROM false
          AND bp.is_open = false
          AND (
            (UPPER(COALESCE(bp.period_type,'')) = 'MONTH' AND bp.period_number = rma.month_number)
            OR (UPPER(COALESCE(bp.period_type,'')) = 'QUARTER' AND bp.period_number = CEIL(rma.month_number / 3.0)::INTEGER)
            OR UPPER(COALESCE(bp.period_type,'')) IN ('YEAR','ANNUAL')
          )
      )
      OR EXISTS (
        SELECT 1
        FROM payment_transactions pt
        WHERE pt.budget_allocation_id = brl.source_budget_allocation_id
          AND EXTRACT(MONTH FROM pt.transaction_date)::INTEGER = rma.month_number
          AND COALESCE(pt.status,'POSTED') <> 'REVERSED'
          AND COALESCE(pt.amount,0) <> 0
      )
    )
  LIMIT 1;

  IF v_bad.month_number IS NOT NULL THEN
    RAISE EXCEPTION 'Revision row % month % cannot be changed because the period is closed or has actual expenditure.', v_bad.line_number, v_bad.month_number;
  END IF;

  -- Reject stale budget baselines; actuals/commitments may move, but authorised budget must not.
  SELECT rl.line_number, ba.revised_budget, brl.current_revised_budget
  INTO v_bad
  FROM budget_revision_lines brl
  JOIN divisional_budget_lines rl ON rl.id = brl.revision_budget_line_id
  JOIN budget_allocations ba ON ba.id = brl.source_budget_allocation_id
  WHERE brl.budget_revision_id = v_revision.id
    AND ABS(COALESCE(ba.revised_budget,0) - COALESCE(brl.current_revised_budget,0)) > 0.009
  LIMIT 1;

  IF v_bad.line_number IS NOT NULL THEN
    RAISE EXCEPTION 'Budget financial position changed for revision row %. Refresh the revision from the current approved budget.', v_bad.line_number;
  END IF;

  -- Proposed amounts are the revision-line annual estimates; snapshots are server-derived.
  FOR v_line IN
    SELECT brl.id AS revision_line_id,
           brl.source_budget_allocation_id,
           brl.current_revised_budget,
           rl.line_number,
           rl.annual_estimate AS proposed,
           COALESCE((
             SELECT SUM(COALESCE(c.paid_amount,0))
             FROM ff3_commitments c
             WHERE c.budget_allocation_id = brl.source_budget_allocation_id
               AND COALESCE(c.status,'ACTIVE') <> 'CANCELLED'
           ),0)::NUMERIC(15,2) AS actual,
           COALESCE((
             SELECT SUM(GREATEST(COALESCE(c.outstanding_amount,
                                           COALESCE(c.current_committed_amount,c.committed_amount) - COALESCE(c.paid_amount,0)),0))
             FROM ff3_commitments c
             WHERE c.budget_allocation_id = brl.source_budget_allocation_id
               AND COALESCE(c.status,'ACTIVE') IN ('ACTIVE','PARTIALLY_PAID')
           ),0)::NUMERIC(15,2) AS outstanding
    FROM budget_revision_lines brl
    JOIN divisional_budget_lines rl ON rl.id = brl.revision_budget_line_id
    WHERE brl.budget_revision_id = v_revision.id
    ORDER BY rl.line_number
  LOOP
    IF COALESCE(v_line.proposed,0) + 0.009 < COALESCE(v_line.actual,0) + COALESCE(v_line.outstanding,0) THEN
      RAISE EXCEPTION 'Revision not allowed. Row % has % already spent or committed (protected minimum).',
        v_line.line_number,
        ROUND(COALESCE(v_line.actual,0) + COALESCE(v_line.outstanding,0),2);
    END IF;

    UPDATE budget_revision_lines
    SET proposed_revised_budget = COALESCE(v_line.proposed,0),
        adjustment_amount = COALESCE(v_line.proposed,0) - COALESCE(v_line.current_revised_budget,0),
        actual_expenditure_at_submission = CASE WHEN UPPER(p_snapshot_stage) = 'SUBMISSION' THEN v_line.actual ELSE actual_expenditure_at_submission END,
        outstanding_commitment_at_submission = CASE WHEN UPPER(p_snapshot_stage) = 'SUBMISSION' THEN v_line.outstanding ELSE outstanding_commitment_at_submission END,
        protected_minimum_at_submission = CASE WHEN UPPER(p_snapshot_stage) = 'SUBMISSION' THEN v_line.actual + v_line.outstanding ELSE protected_minimum_at_submission END,
        actual_expenditure_at_approval = CASE WHEN UPPER(p_snapshot_stage) = 'APPROVAL' THEN v_line.actual ELSE actual_expenditure_at_approval END,
        outstanding_commitment_at_approval = CASE WHEN UPPER(p_snapshot_stage) = 'APPROVAL' THEN v_line.outstanding ELSE outstanding_commitment_at_approval END,
        protected_minimum_at_approval = CASE WHEN UPPER(p_snapshot_stage) = 'APPROVAL' THEN v_line.actual + v_line.outstanding ELSE protected_minimum_at_approval END,
        updated_at = NOW()
    WHERE id = v_line.revision_line_id;
  END LOOP;

  SELECT COALESCE(SUM(adjustment_amount),0)::NUMERIC(15,2),
         COALESCE(SUM(GREATEST(adjustment_amount,0)),0)::NUMERIC(15,2)
  INTO v_net, v_positive_increase
  FROM budget_revision_lines
  WHERE budget_revision_id = v_revision.id;

  IF v_revision.revision_type IN ('VIREMENT','RECLASSIFICATION') AND ABS(v_net) > 0.009 THEN
    RAISE EXCEPTION 'A % virement must balance: total decreases must equal total increases.', LOWER(v_revision.revision_type);
  END IF;

  IF v_revision.revision_type = 'REDUCTION' AND v_net > 0.009 THEN
    RAISE EXCEPTION 'A reduction revision cannot increase the total authorised budget.';
  END IF;

  IF v_revision.revision_type IN ('VIREMENT','RECLASSIFICATION') THEN
    SELECT COUNT(DISTINCT COALESCE(rl.funding_source_id, ba.funding_source_id))
    INTO v_funding_source_count
    FROM budget_revision_lines brl
    JOIN divisional_budget_lines rl ON rl.id = brl.revision_budget_line_id
    LEFT JOIN budget_allocations ba ON ba.id = brl.source_budget_allocation_id
    WHERE brl.budget_revision_id = v_revision.id
      AND ABS(brl.adjustment_amount) > 0.009
      AND COALESCE(rl.funding_source_id, ba.funding_source_id) IS NOT NULL;

    IF v_funding_source_count > 1 THEN
      RAISE EXCEPTION 'Virement/reclassification cannot cross incompatible funding sources.';
    END IF;
  END IF;

  IF v_revision.revision_type = 'SUPPLEMENTARY' THEN
    IF COALESCE(TRIM(v_revision.authority_reference),'') = '' THEN
      RAISE EXCEPTION 'Supplementary authority reference is required.';
    END IF;
    IF v_net <= 0.009 THEN
      RAISE EXCEPTION 'A supplementary revision must produce a positive net increase.';
    END IF;

    SELECT * INTO v_authority
    FROM funding_authorities fa
    WHERE fa.authority_number = v_revision.authority_reference
      AND fa.financial_year = v_revision.budget_year
      AND fa.status = 'APPROVED'
    ORDER BY fa.approved_at DESC NULLS LAST, fa.created_at DESC
    LIMIT 1;

    IF v_authority.id IS NULL THEN
      RAISE EXCEPTION 'Supplementary authority % is not an approved authority for budget year %.', v_revision.authority_reference, v_revision.budget_year;
    END IF;

    SELECT COALESCE(SUM(fal.allocated_amount),0)::NUMERIC(15,2)
    INTO v_authority_used
    FROM funding_allocations fal
    WHERE fal.funding_authority_id = v_authority.id
      AND fal.status = 'APPROVED';

    IF v_positive_increase > COALESCE(v_authority.approved_amount,0) - v_authority_used + 0.009 THEN
      RAISE EXCEPTION 'Supplementary authority has insufficient unallocated value for this revision.';
    END IF;

    SELECT rl.line_number
    INTO v_bad
    FROM budget_revision_lines brl
    JOIN divisional_budget_lines rl ON rl.id = brl.revision_budget_line_id
    LEFT JOIN budget_allocations ba ON ba.id = brl.source_budget_allocation_id
    LEFT JOIN expense_ledger el ON el.id = rl.expense_ledger_id
    LEFT JOIN budget_divisions d ON d.id = v_revision.division_id
    LEFT JOIN cost_centres cc ON cc.code = d.cost_centre_code OR cc.name = d.cost_centre_name
    WHERE brl.budget_revision_id = v_revision.id
      AND brl.adjustment_amount > 0.009
      AND (
        (v_authority.funding_source_id IS NOT NULL AND COALESCE(rl.funding_source_id,ba.funding_source_id) IS DISTINCT FROM v_authority.funding_source_id)
        OR (v_authority.restricted_department_id IS NOT NULL AND d.department_id IS DISTINCT FROM v_authority.restricted_department_id)
        OR (v_authority.restricted_section_id IS NOT NULL AND d.section_id IS DISTINCT FROM v_authority.restricted_section_id)
        OR (v_authority.restricted_cost_centre_id IS NOT NULL AND COALESCE(ba.cost_centre_id,cc.id) IS DISTINCT FROM v_authority.restricted_cost_centre_id)
        OR (v_authority.restricted_expense_code_registry_id IS NOT NULL AND COALESCE(ba.expense_code_registry_id,el.expense_code_registry_id) IS DISTINCT FROM v_authority.restricted_expense_code_registry_id)
      )
    LIMIT 1;

    IF v_bad.line_number IS NOT NULL THEN
      RAISE EXCEPTION 'Supplementary authority restrictions do not permit revision row %.', v_bad.line_number;
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION njss_validate_budget_revision(UUID, TEXT) FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- 4. Create a new revision version from the current approved submission.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION njss_create_budget_revision(
  p_parent_submission_id UUID,
  p_revision_type TEXT,
  p_reason TEXT,
  p_authority_reference TEXT DEFAULT NULL,
  p_effective_date DATE DEFAULT CURRENT_DATE,
  p_supporting_reference TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parent divisional_budget_submissions;
  v_division budget_divisions;
  v_user_id UUID := fn_current_app_user_id();
  v_submission_id UUID;
  v_revision_id UUID;
  v_revision_number TEXT;
  v_next_version INTEGER;
  v_source RECORD;
  v_new_line_id UUID;
  v_source_allocation budget_allocations;
BEGIN
  IF NOT (COALESCE(fn_current_user_has_permission('budget.revision.create'), false)
          OR COALESCE(fn_current_user_has_permission('all'), false)) THEN
    RAISE EXCEPTION 'Permission denied: budget.revision.create is required.';
  END IF;

  SELECT * INTO v_parent
  FROM divisional_budget_submissions
  WHERE id = p_parent_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Approved parent budget submission not found.'; END IF;
  IF v_parent.status <> 'APPROVED' OR v_parent.is_locked IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A budget revision can only be created from an approved and locked budget version.';
  END IF;
  IF v_parent.superseded_by_id IS NOT NULL THEN
    RAISE EXCEPTION 'This approved version is historical/superseded and cannot start another revision.';
  END IF;

  SELECT * INTO v_division FROM budget_divisions WHERE id = v_parent.division_id;
  IF NOT fn_current_user_data_scope_allows(v_division.department_id, v_division.section_id, v_user_id, NULL, NULL) THEN
    RAISE EXCEPTION 'Budget revision is outside the current user data scope.';
  END IF;

  IF UPPER(COALESCE(p_revision_type,'')) NOT IN ('VIREMENT','SUPPLEMENTARY','REDUCTION','RECLASSIFICATION','REFORECAST') THEN
    RAISE EXCEPTION 'Unsupported budget revision type.';
  END IF;
  IF COALESCE(TRIM(p_reason),'') = '' THEN
    RAISE EXCEPTION 'Budget revision reason/justification is required.';
  END IF;
  IF UPPER(p_revision_type) = 'SUPPLEMENTARY' AND COALESCE(TRIM(p_authority_reference),'') = '' THEN
    RAISE EXCEPTION 'Supplementary authority reference is required.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM budget_revisions
    WHERE parent_submission_id = v_parent.id
      AND status IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','REVIEWED')
  ) THEN
    RAISE EXCEPTION 'An active revision already exists for this approved budget version.';
  END IF;

  SELECT COALESCE(MAX(version),0) + 1 INTO v_next_version
  FROM divisional_budget_submissions
  WHERE cycle_id = v_parent.cycle_id
    AND division_id = v_parent.division_id;

  INSERT INTO divisional_budget_submissions (
    cycle_id, budget_year, department_id, division_id, cost_centre,
    version, parent_submission_id, superseded_by_id,
    budget_ceiling, ceiling_exception_approved, ceiling_exception_reference,
    prepared_by, prepared_by_email, date_prepared,
    status, validation_status, validation_messages,
    line_count, total_proposed_budget, total_monthly_allocation, unallocated_variance,
    is_locked, notes
  ) VALUES (
    v_parent.cycle_id, v_parent.budget_year, v_parent.department_id, v_parent.division_id, v_parent.cost_centre,
    v_next_version, v_parent.id, NULL,
    v_parent.budget_ceiling, v_parent.ceiling_exception_approved, v_parent.ceiling_exception_reference,
    p_user_email, p_user_email, CURRENT_DATE,
    'DRAFT', 'PENDING', '[]'::jsonb,
    0, 0, 0, 0,
    false, 'Budget revision created from approved submission ' || COALESCE(v_parent.submission_number, v_parent.id::TEXT)
  ) RETURNING id INTO v_submission_id;

  PERFORM pg_advisory_xact_lock(hashtext('njss-budget-revision-' || v_parent.budget_year::TEXT));
  SELECT 'REV-' || v_parent.budget_year || '-' || LPAD((COALESCE(MAX(NULLIF(SPLIT_PART(revision_number,'-',3),'')::INTEGER),0) + 1)::TEXT,5,'0')
  INTO v_revision_number
  FROM budget_revisions
  WHERE budget_year = v_parent.budget_year
    AND revision_number ~ ('^REV-' || v_parent.budget_year || '-[0-9]+$');

  INSERT INTO budget_revisions (
    revision_number, parent_submission_id, revision_submission_id,
    budget_year, division_id, revision_type, reason,
    authority_reference, effective_date, status,
    requested_by, requested_by_email, supporting_reference
  ) VALUES (
    v_revision_number, v_parent.id, v_submission_id,
    v_parent.budget_year, v_parent.division_id, UPPER(p_revision_type), TRIM(p_reason),
    NULLIF(TRIM(p_authority_reference),''), COALESCE(p_effective_date,CURRENT_DATE), 'DRAFT',
    v_user_id, p_user_email, NULLIF(TRIM(p_supporting_reference),'')
  ) RETURNING id INTO v_revision_id;

  FOR v_source IN
    SELECT * FROM divisional_budget_lines
    WHERE submission_id = v_parent.id
    ORDER BY line_number, id
  LOOP
    INSERT INTO divisional_budget_lines (
      submission_id, line_number, activity_reference, expense_ledger_id,
      line_item_description, business_justification, expected_output,
      location_destination_provider, beneficiary_custodian_officer,
      start_date, end_date, quantity, unit_of_measure, unit_cost,
      frequency_periods, other_costs, priority, funding_source_id,
      procurement_method, responsible_officer, supporting_reference, comments,
      priority_level_id, procurement_method_id, unit_of_measure_id, responsible_officer_id
    ) VALUES (
      v_submission_id, v_source.line_number, v_source.activity_reference, v_source.expense_ledger_id,
      v_source.line_item_description, v_source.business_justification, v_source.expected_output,
      v_source.location_destination_provider, v_source.beneficiary_custodian_officer,
      v_source.start_date, v_source.end_date, v_source.quantity, v_source.unit_of_measure, v_source.unit_cost,
      v_source.frequency_periods, v_source.other_costs, v_source.priority, v_source.funding_source_id,
      v_source.procurement_method, v_source.responsible_officer, v_source.supporting_reference, v_source.comments,
      v_source.priority_level_id, v_source.procurement_method_id, v_source.unit_of_measure_id, v_source.responsible_officer_id
    ) RETURNING id INTO v_new_line_id;

    INSERT INTO budget_monthly_allocations (budget_line_id, month_number, month_name, amount)
    SELECT v_new_line_id, month_number, month_name, amount
    FROM budget_monthly_allocations
    WHERE budget_line_id = v_source.id
    ORDER BY month_number;

    SELECT * INTO v_source_allocation
    FROM budget_allocations
    WHERE source_budget_line_id = v_source.id
      AND is_active = true
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 1;

    INSERT INTO budget_revision_lines (
      budget_revision_id, source_budget_allocation_id, source_budget_line_id,
      revision_budget_line_id, original_budget, current_revised_budget,
      proposed_revised_budget, adjustment_amount
    ) VALUES (
      v_revision_id, v_source_allocation.id, v_source.id,
      v_new_line_id,
      COALESCE(v_source_allocation.original_budget, v_source.annual_estimate, 0),
      COALESCE(v_source_allocation.revised_budget, v_source.annual_estimate, 0),
      COALESCE(v_source_allocation.revised_budget, v_source.annual_estimate, 0),
      0
    );
  END LOOP;

  PERFORM recalc_divisional_budget_submission_totals(v_submission_id);

  PERFORM log_audit_event(
    v_user_id, p_user_email, COALESCE(p_user_email,'System'),
    'BUDGET_REVISION_CREATE', 'BUDGET_REVISION', v_revision_id, v_revision_number,
    jsonb_build_object('parent_submission_id', v_parent.id, 'parent_version', v_parent.version),
    jsonb_build_object('revision_submission_id', v_submission_id, 'version', v_next_version, 'type', UPPER(p_revision_type)),
    jsonb_build_object('reason', p_reason, 'authority_reference', p_authority_reference),
    jsonb_build_object('source_submission_number', v_parent.submission_number)
  );

  RETURN jsonb_build_object(
    'revision_id', v_revision_id,
    'revision_submission_id', v_submission_id,
    'revision_number', v_revision_number,
    'version', v_next_version
  );
END;
$$;

REVOKE ALL ON FUNCTION njss_create_budget_revision(UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION njss_create_budget_revision(UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Controlled revision workflow. Approval intentionally does NOT invoke the
--    initial-budget APPROVE path because that path creates duplicate allocations.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION njss_transition_budget_revision(
  p_revision_id UUID,
  p_action TEXT,
  p_comments TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_revision budget_revisions;
  v_submission divisional_budget_submissions;
  v_parent divisional_budget_submissions;
  v_division budget_divisions;
  v_user_id UUID := fn_current_app_user_id();
  v_action TEXT := UPPER(COALESCE(p_action,''));
  v_permission TEXT;
  v_new_status TEXT;
  v_line RECORD;
  v_allocation budget_allocations;
  v_account_id UUID;
  v_cost_centre_id UUID;
  v_expense_code_id UUID;
  v_monthly JSONB;
  v_q1 NUMERIC(15,2);
  v_q2 NUMERIC(15,2);
  v_q3 NUMERIC(15,2);
  v_q4 NUMERIC(15,2);
  v_before JSONB := '{}'::jsonb;
  v_after JSONB := '{}'::jsonb;
BEGIN
  v_permission := CASE v_action
    WHEN 'SUBMIT' THEN 'budget.revision.submit'
    WHEN 'RESUBMIT' THEN 'budget.revision.submit'
    WHEN 'REVIEW' THEN 'budget.revision.review'
    WHEN 'RETURN' THEN 'budget.revision.return'
    WHEN 'REJECT' THEN 'budget.revision.reject'
    WHEN 'APPROVE' THEN 'budget.revision.approve'
    ELSE NULL
  END;

  IF v_permission IS NULL THEN RAISE EXCEPTION 'Unsupported budget revision action: %', p_action; END IF;
  IF NOT (COALESCE(fn_current_user_has_permission(v_permission), false)
          OR COALESCE(fn_current_user_has_permission('all'), false)) THEN
    RAISE EXCEPTION 'Permission denied: % is required.', v_permission;
  END IF;

  SELECT * INTO v_revision FROM budget_revisions WHERE id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget revision not found.'; END IF;

  SELECT * INTO v_submission
  FROM divisional_budget_submissions
  WHERE id = v_revision.revision_submission_id
  FOR UPDATE;

  SELECT * INTO v_parent
  FROM divisional_budget_submissions
  WHERE id = v_revision.parent_submission_id
  FOR UPDATE;

  SELECT * INTO v_division FROM budget_divisions WHERE id = v_revision.division_id;
  IF NOT fn_current_user_data_scope_allows(v_division.department_id, v_division.section_id, v_revision.requested_by, NULL, NULL) THEN
    RAISE EXCEPTION 'Budget revision is outside the current user data scope.';
  END IF;

  v_new_status := CASE v_action
    WHEN 'SUBMIT' THEN 'SUBMITTED'
    WHEN 'RESUBMIT' THEN 'RESUBMITTED'
    WHEN 'REVIEW' THEN 'REVIEWED'
    WHEN 'RETURN' THEN 'RETURNED'
    WHEN 'REJECT' THEN 'REJECTED'
    WHEN 'APPROVE' THEN 'APPROVED'
  END;

  IF v_action = 'SUBMIT' AND v_revision.status <> 'DRAFT' THEN RAISE EXCEPTION 'Only DRAFT revisions can be submitted.'; END IF;
  IF v_action = 'RESUBMIT' AND v_revision.status <> 'RETURNED' THEN RAISE EXCEPTION 'Only RETURNED revisions can be resubmitted.'; END IF;
  IF v_action IN ('REVIEW','RETURN') AND v_revision.status NOT IN ('SUBMITTED','RESUBMITTED') THEN RAISE EXCEPTION '% requires a submitted revision.', v_action; END IF;
  IF v_action = 'RETURN' AND COALESCE(TRIM(p_comments),'') = '' THEN RAISE EXCEPTION 'Return comments/reason are required.'; END IF;
  IF v_action = 'APPROVE' AND v_revision.status <> 'REVIEWED' THEN RAISE EXCEPTION 'Only REVIEWED revisions can be approved.'; END IF;
  IF v_action = 'REJECT' AND v_revision.status NOT IN ('SUBMITTED','RESUBMITTED','REVIEWED') THEN RAISE EXCEPTION 'Only submitted or reviewed revisions can be rejected.'; END IF;

  IF v_parent.status <> 'APPROVED' OR v_parent.is_locked IS DISTINCT FROM true OR v_parent.superseded_by_id IS NOT NULL THEN
    RAISE EXCEPTION 'The source approved version is historical/superseded or no longer current.';
  END IF;

  IF v_action IN ('SUBMIT','RESUBMIT') THEN
    PERFORM njss_validate_budget_revision(v_revision.id, 'SUBMISSION');
  ELSIF v_action = 'APPROVE' THEN
    -- Lock all existing authoritative allocations before approval-time revalidation.
    PERFORM 1
    FROM budget_allocations ba
    WHERE ba.id IN (
      SELECT source_budget_allocation_id
      FROM budget_revision_lines
      WHERE budget_revision_id = v_revision.id
        AND source_budget_allocation_id IS NOT NULL
    )
    ORDER BY ba.id
    FOR UPDATE;

    PERFORM njss_validate_budget_revision(v_revision.id, 'APPROVAL');

    FOR v_line IN
      SELECT brl.*, rl.expense_ledger_id, rl.funding_source_id,
             rl.line_number, rl.annual_estimate,
             d.department_id, d.section_id, d.cost_centre_code, d.cost_centre_name,
             el.expense_code_registry_id
      FROM budget_revision_lines brl
      JOIN divisional_budget_lines rl ON rl.id = brl.revision_budget_line_id
      JOIN budget_divisions d ON d.id = v_revision.division_id
      JOIN expense_ledger el ON el.id = rl.expense_ledger_id
      WHERE brl.budget_revision_id = v_revision.id
      ORDER BY rl.line_number
    LOOP
      SELECT COALESCE(jsonb_object_agg(k, amount), '{}'::jsonb)
      INTO v_monthly
      FROM (
        SELECT LOWER(month_name) AS k, amount
        FROM budget_monthly_allocations
        WHERE budget_line_id = v_line.revision_budget_line_id
        ORDER BY month_number
      ) m;

      SELECT
        COALESCE(SUM(amount) FILTER (WHERE month_number BETWEEN 1 AND 3),0),
        COALESCE(SUM(amount) FILTER (WHERE month_number BETWEEN 4 AND 6),0),
        COALESCE(SUM(amount) FILTER (WHERE month_number BETWEEN 7 AND 9),0),
        COALESCE(SUM(amount) FILTER (WHERE month_number BETWEEN 10 AND 12),0)
      INTO v_q1, v_q2, v_q3, v_q4
      FROM budget_monthly_allocations
      WHERE budget_line_id = v_line.revision_budget_line_id;

      IF v_line.source_budget_allocation_id IS NOT NULL THEN
        SELECT * INTO v_allocation
        FROM budget_allocations
        WHERE id = v_line.source_budget_allocation_id
        FOR UPDATE;

        v_before := v_before || jsonb_build_object(v_allocation.id::TEXT, jsonb_build_object(
          'original_budget', v_allocation.original_budget,
          'supplemental_budget', v_allocation.supplemental_budget,
          'revision_adjustment', v_allocation.revision_adjustment,
          'revised_budget', v_allocation.revised_budget
        ));

        UPDATE budget_allocations
        SET supplemental_budget = COALESCE(supplemental_budget,0)
              + CASE WHEN v_revision.revision_type = 'SUPPLEMENTARY' THEN v_line.adjustment_amount ELSE 0 END,
            revision_adjustment = COALESCE(revision_adjustment,0)
              + CASE WHEN v_revision.revision_type <> 'SUPPLEMENTARY' THEN v_line.adjustment_amount ELSE 0 END,
            monthly_cashflow = v_monthly,
            q1_planned = v_q1, q2_planned = v_q2, q3_planned = v_q3, q4_planned = v_q4,
            source_budget_submission_id = v_revision.revision_submission_id,
            source_budget_line_id = v_line.revision_budget_line_id,
            updated_at = NOW()
        WHERE id = v_allocation.id
        RETURNING * INTO v_allocation;
      ELSE
        SELECT id INTO v_cost_centre_id
        FROM cost_centres
        WHERE is_active = true
          AND (code = v_line.cost_centre_code OR name = v_line.cost_centre_name)
        ORDER BY CASE WHEN code = v_line.cost_centre_code THEN 0 ELSE 1 END, created_at
        LIMIT 1;

        v_expense_code_id := v_line.expense_code_registry_id;
        SELECT id INTO v_account_id
        FROM chart_of_accounts
        WHERE is_active = true
          AND account_code = (SELECT finance_code FROM expense_ledger WHERE id = v_line.expense_ledger_id)
        LIMIT 1;
        IF v_account_id IS NULL THEN
          SELECT id INTO v_account_id FROM chart_of_accounts WHERE is_active = true ORDER BY account_code LIMIT 1;
        END IF;
        IF v_account_id IS NULL THEN RAISE EXCEPTION 'No active Chart of Accounts record is available for revision target row %.', v_line.line_number; END IF;

        INSERT INTO budget_allocations (
          financial_year, department_id, section_id, cost_centre_id,
          funding_source_id, account_id, expense_code_registry_id,
          source_budget_submission_id, source_budget_line_id, budget_division_id,
          source_module, original_budget, supplemental_budget, revision_adjustment,
          monthly_cashflow, q1_planned, q2_planned, q3_planned, q4_planned,
          is_active, created_by, updated_at
        ) VALUES (
          v_revision.budget_year, v_line.department_id, v_line.section_id, v_cost_centre_id,
          v_line.funding_source_id, v_account_id, v_expense_code_id,
          v_revision.revision_submission_id, v_line.revision_budget_line_id, v_revision.division_id,
          'BUDGET_REVISION', 0,
          CASE WHEN v_revision.revision_type = 'SUPPLEMENTARY' THEN v_line.proposed_revised_budget ELSE 0 END,
          CASE WHEN v_revision.revision_type <> 'SUPPLEMENTARY' THEN v_line.proposed_revised_budget ELSE 0 END,
          v_monthly, v_q1, v_q2, v_q3, v_q4,
          true, v_user_id, NOW()
        ) RETURNING * INTO v_allocation;

        UPDATE budget_revision_lines
        SET source_budget_allocation_id = v_allocation.id
        WHERE id = v_line.id;
      END IF;

      v_after := v_after || jsonb_build_object(v_allocation.id::TEXT, jsonb_build_object(
        'original_budget', v_allocation.original_budget,
        'supplemental_budget', v_allocation.supplemental_budget,
        'revision_adjustment', v_allocation.revision_adjustment,
        'revised_budget', v_allocation.revised_budget
      ));
    END LOOP;
  END IF;

  PERFORM set_config('njss.budget_workflow', 'on', true);

  UPDATE divisional_budget_submissions
  SET status = v_new_status,
      is_locked = v_new_status IN ('SUBMITTED','RESUBMITTED','REVIEWED','APPROVED','ARCHIVED'),
      submitted_at = CASE WHEN v_action IN ('SUBMIT','RESUBMIT') THEN NOW() ELSE submitted_at END,
      submitted_by = CASE WHEN v_action IN ('SUBMIT','RESUBMIT') THEN v_user_id ELSE submitted_by END,
      returned_at = CASE WHEN v_action = 'RETURN' THEN NOW() ELSE returned_at END,
      return_reason = CASE WHEN v_action = 'RETURN' THEN p_comments ELSE return_reason END,
      reviewed_at = CASE WHEN v_action = 'REVIEW' THEN NOW() ELSE reviewed_at END,
      reviewed_by = CASE WHEN v_action = 'REVIEW' THEN p_user_email ELSE reviewed_by END,
      reviewed_by_email = CASE WHEN v_action = 'REVIEW' THEN p_user_email ELSE reviewed_by_email END,
      approved_at = CASE WHEN v_action = 'APPROVE' THEN NOW() ELSE approved_at END,
      approved_by = CASE WHEN v_action = 'APPROVE' THEN p_user_email ELSE approved_by END,
      rejected_at = CASE WHEN v_action = 'REJECT' THEN NOW() ELSE rejected_at END,
      rejected_by = CASE WHEN v_action = 'REJECT' THEN v_user_id ELSE rejected_by END,
      approval_comments = CASE WHEN v_action IN ('REVIEW','APPROVE','REJECT') THEN p_comments ELSE approval_comments END,
      updated_at = NOW()
  WHERE id = v_revision.revision_submission_id;

  UPDATE budget_revisions
  SET status = v_new_status,
      approved_by = CASE WHEN v_action = 'APPROVE' THEN v_user_id ELSE approved_by END,
      approved_at = CASE WHEN v_action = 'APPROVE' THEN NOW() ELSE approved_at END,
      updated_at = NOW()
  WHERE id = v_revision.id;

  IF v_action = 'APPROVE' THEN
    UPDATE divisional_budget_submissions
    SET superseded_by_id = v_revision.revision_submission_id,
        updated_at = NOW()
    WHERE id = v_revision.parent_submission_id;
  END IF;

  INSERT INTO budget_workflow_history (
    submission_id, from_status, to_status, action, comments, changed_by, changed_by_email
  ) VALUES (
    v_revision.revision_submission_id, v_revision.status, v_new_status,
    'REVISION_' || v_action, p_comments, v_user_id, p_user_email
  );

  PERFORM log_audit_event(
    v_user_id, p_user_email, COALESCE(p_user_email,'System'),
    'BUDGET_REVISION_' || v_action, 'BUDGET_REVISION', v_revision.id, v_revision.revision_number,
    jsonb_build_object('status', v_revision.status, 'allocations', v_before),
    jsonb_build_object('status', v_new_status, 'allocations', v_after),
    jsonb_build_object(
      'parent_submission_id', v_revision.parent_submission_id,
      'revision_submission_id', v_revision.revision_submission_id,
      'revision_type', v_revision.revision_type,
      'reason', v_revision.reason,
      'authority_reference', v_revision.authority_reference,
      'comments', p_comments
    ),
    jsonb_build_object('approval_revalidated', v_action = 'APPROVE')
  );

  RETURN jsonb_build_object(
    'revision_id', v_revision.id,
    'revision_submission_id', v_revision.revision_submission_id,
    'revision_number', v_revision.revision_number,
    'status', v_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION njss_transition_budget_revision(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION njss_transition_budget_revision(UUID, TEXT, TEXT, TEXT) TO authenticated;
