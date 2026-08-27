-- =============================================================================
-- NJSS 054 — BUDGET REVISION SECURITY / FINANCIAL-CONTROL HARDENING
-- Additive final hardening for migrations 051-053.
--
-- Objectives:
--   * enforce strict organisational scope for revision mutations (no own-record bypass)
--   * enforce Registrar-initiation / Line-Supervisor-preparation / Registrar-disposition workflow
--   * constrain each revision type to its intended accounting meaning
--   * prevent reductions below already-approved funding
--   * require exact operational/master-data lineage for revision target rows
--   * protect revision lines/months from direct table writes outside DRAFT/RETURNED
--   * make the original SECURITY DEFINER implementations internal-only
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Correct revision workflow ownership.
--    Registrar alone initiates a post-approval change. The Line Supervisor for
--    the affected section prepares/adjusts and submits it. Registrar then
--    approves, returns or rejects it. The legacy 051 Line Supervisor create
--    grant is explicitly disabled here because 051 has not been deployed live.
-- -----------------------------------------------------------------------------
INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, x.permission, x.is_allowed
FROM roles r
JOIN (VALUES
  ('Registrar', 'budget.revision.create', true),
  ('Registrar', 'budget.revision.review', true),
  ('Registrar', 'budget.revision.approve', true),
  ('Registrar', 'budget.revision.return', true),
  ('Registrar', 'budget.revision.reject', true),
  ('Registrar', 'budget.revision.edit', false),
  ('Registrar', 'budget.revision.submit', false),
  ('Line Supervisor', 'budget.revision.create', false),
  ('Line Supervisor', 'budget.revision.edit', true),
  ('Line Supervisor', 'budget.revision.submit', true)
) AS x(role_name, permission, is_allowed)
  ON x.role_name = r.name
ON CONFLICT (role_id, permission) DO UPDATE
SET is_allowed = EXCLUDED.is_allowed;

-- -----------------------------------------------------------------------------
-- 1. Reassert one active operational allocation per approved source budget line.
--    Migration 019 created this invariant; Task 7 makes it an explicit revision
--    precondition as well, so missing/ambiguous lineage can never be guessed.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_source_line UUID;
  v_count INTEGER;
BEGIN
  SELECT source_budget_line_id, COUNT(*)::INTEGER
  INTO v_source_line, v_count
  FROM budget_allocations
  WHERE is_active = true
    AND source_budget_line_id IS NOT NULL
  GROUP BY source_budget_line_id
  HAVING COUNT(*) > 1
  ORDER BY source_budget_line_id
  LIMIT 1;

  IF v_source_line IS NOT NULL THEN
    RAISE EXCEPTION 'Budget allocation lineage is ambiguous for source line %: % active allocations exist. Resolve duplicate operational allocations before applying revision hardening.', v_source_line, v_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_allocations_source_budget_line
ON budget_allocations(source_budget_line_id)
WHERE source_budget_line_id IS NOT NULL AND is_active = true;

-- -----------------------------------------------------------------------------
-- 2. Direct-write guard shared by revision lines and monthly allocations.
--    Generic budget.template.edit rights must not become a back door into an
--    approved/reviewed revision. Only a current DRAFT/RETURNED revision with
--    budget.revision.edit (or all) and strict organisational scope is editable.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION njss_assert_budget_revision_editable(p_submission_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := fn_current_app_user_id();
  revision_status TEXT;
  v_division_id UUID;
  v_division budget_divisions%ROWTYPE;
BEGIN
  SELECT br.status, br.division_id
  INTO revision_status, v_division_id
  FROM budget_revisions br
  WHERE br.revision_submission_id = p_submission_id;

  -- Ordinary (non-revision) Budget Preparation rows keep their existing policy.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_division
  FROM budget_divisions
  WHERE id = v_division_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget revision division was not found.';
  END IF;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated NJSS user profile is required.';
  END IF;

  -- Registrar creation clones the approved baseline through the hardened
  -- creation wrapper. Ordinary editing remains Line-Supervisor-only.
  IF COALESCE(current_setting('njss.budget_revision_create', true), '') = 'on' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_user_id
      AND r.name = 'Line Supervisor'
      AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'Only the Line Supervisor can prepare or edit a requested budget revision.';
  END IF;

  IF revision_status NOT IN ('DRAFT','RETURNED') THEN
    RAISE EXCEPTION 'Budget revision lines can only be edited while the revision is DRAFT or RETURNED. Current status: %.', revision_status;
  END IF;

  IF NOT (
    COALESCE(fn_current_user_has_permission('budget.revision.edit'), false)
    OR COALESCE(fn_current_user_has_permission('all'), false)
  ) THEN
    RAISE EXCEPTION 'Permission denied: budget.revision.edit is required to modify revision lines.';
  END IF;

  IF NOT fn_current_user_data_scope_allows(
    v_division.department_id,
    v_division.section_id,
    NULL,
    NULL,
    NULL
  ) THEN
    RAISE EXCEPTION 'Budget revision edit is outside the current user organisational scope.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION njss_assert_budget_revision_editable(UUID) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION njss_guard_budget_revision_line_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_submission_id UUID;
  v_old_is_revision BOOLEAN := false;
  v_new_is_revision BOOLEAN := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1 FROM budget_revisions br
      WHERE br.revision_submission_id = OLD.submission_id
    ) INTO v_old_is_revision;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    SELECT EXISTS (
      SELECT 1 FROM budget_revisions br
      WHERE br.revision_submission_id = NEW.submission_id
    ) INTO v_new_is_revision;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.submission_id IS DISTINCT FROM OLD.submission_id
     AND (v_old_is_revision OR v_new_is_revision) THEN
    RAISE EXCEPTION 'Revision budget lines cannot be moved into or out of a revision submission.';
  END IF;

  v_submission_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.submission_id ELSE NEW.submission_id END;
  PERFORM njss_assert_budget_revision_editable(v_submission_id);

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_budget_revision_line_write_guard ON divisional_budget_lines;
CREATE TRIGGER trg_budget_revision_line_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON divisional_budget_lines
  FOR EACH ROW EXECUTE FUNCTION njss_guard_budget_revision_line_write();
REVOKE ALL ON FUNCTION njss_guard_budget_revision_line_write() FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION njss_guard_budget_revision_monthly_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_line_id UUID;
  v_submission_id UUID;
  v_old_submission_id UUID;
  v_new_submission_id UUID;
  v_old_is_revision BOOLEAN := false;
  v_new_is_revision BOOLEAN := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT l.submission_id INTO v_old_submission_id
    FROM divisional_budget_lines l
    WHERE l.id = OLD.budget_line_id;
    SELECT EXISTS (
      SELECT 1 FROM budget_revisions br
      WHERE br.revision_submission_id = v_old_submission_id
    ) INTO v_old_is_revision;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    SELECT l.submission_id INTO v_new_submission_id
    FROM divisional_budget_lines l
    WHERE l.id = NEW.budget_line_id;
    SELECT EXISTS (
      SELECT 1 FROM budget_revisions br
      WHERE br.revision_submission_id = v_new_submission_id
    ) INTO v_new_is_revision;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.budget_line_id IS DISTINCT FROM OLD.budget_line_id
     AND (v_old_is_revision OR v_new_is_revision) THEN
    RAISE EXCEPTION 'Revision monthly allocations cannot be moved between budget lines.';
  END IF;

  v_line_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.budget_line_id ELSE NEW.budget_line_id END;
  SELECT l.submission_id INTO v_submission_id
  FROM divisional_budget_lines l
  WHERE l.id = v_line_id;

  IF v_submission_id IS NOT NULL THEN
    PERFORM njss_assert_budget_revision_editable(v_submission_id);
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_budget_revision_monthly_write_guard ON budget_monthly_allocations;
CREATE TRIGGER trg_budget_revision_monthly_write_guard
  BEFORE INSERT OR UPDATE OR DELETE ON budget_monthly_allocations
  FOR EACH ROW EXECUTE FUNCTION njss_guard_budget_revision_monthly_write();
REVOKE ALL ON FUNCTION njss_guard_budget_revision_monthly_write() FROM PUBLIC, authenticated;

-- Revision submissions share the ordinary submission table. This guard prevents
-- callers from sending a revision version through transition_divisional_budget_submission
-- (which is the initial-budget path and can create operational allocations).
CREATE OR REPLACE FUNCTION njss_guard_budget_revision_submission_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_submission_id UUID := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  v_revision budget_revisions%ROWTYPE;
  v_division budget_divisions%ROWTYPE;
BEGIN
  SELECT * INTO v_revision
  FROM budget_revisions
  WHERE revision_submission_id = v_submission_id;

  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Only the hardened revision transition wrapper sets this local flag. The
  -- generic budget workflow uses njss.budget_workflow and therefore cannot pass.
  IF COALESCE(current_setting('njss.budget_revision_workflow', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;


  -- Registrar initiation also performs system-controlled header recalculation
  -- while cloning the approved baseline. This bypass is set only after the
  -- hardened creation wrapper confirms the Registrar role.
  IF COALESCE(current_setting('njss.budget_revision_create', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Budget revision submissions cannot be deleted; reject or supersede them through the revision workflow.';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Budget revision status can only be changed through the dedicated budget revision workflow.';
  END IF;

  SELECT * INTO v_division FROM budget_divisions WHERE id = v_revision.division_id;
  IF v_revision.status NOT IN ('DRAFT','RETURNED') THEN
    RAISE EXCEPTION 'Budget revision submission cannot be edited in status %.', v_revision.status;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = fn_current_app_user_id()
      AND r.name = 'Line Supervisor'
      AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'Only the Line Supervisor can prepare or edit a requested budget revision.';
  END IF;
  IF NOT COALESCE(fn_current_user_has_permission('budget.revision.edit'), false) THEN
    RAISE EXCEPTION 'Permission denied: budget.revision.edit is required to modify a revision submission.';
  END IF;
  IF NOT fn_current_user_data_scope_allows(v_division.department_id, v_division.section_id, NULL, NULL, NULL) THEN
    RAISE EXCEPTION 'Budget revision submission edit is outside the current user organisational scope.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_budget_revision_submission_write_guard ON divisional_budget_submissions;
CREATE TRIGGER trg_budget_revision_submission_write_guard
  BEFORE UPDATE OR DELETE ON divisional_budget_submissions
  FOR EACH ROW EXECUTE FUNCTION njss_guard_budget_revision_submission_write();
REVOKE ALL ON FUNCTION njss_guard_budget_revision_submission_write() FROM PUBLIC, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Harden the internal validator without copying the 052 implementation.
--    The base validator still performs row validation, closed/actual-month
--    protection, stale-position detection, snapshot capture, supplementary
--    authority checks, and the existing funding-source compatibility rules.
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.njss_validate_budget_revision(UUID,TEXT)
  RENAME TO njss_validate_budget_revision_base;
REVOKE ALL ON FUNCTION public.njss_validate_budget_revision_base(UUID,TEXT) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.njss_validate_budget_revision(
  p_revision_id UUID,
  p_snapshot_stage TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_revision budget_revisions%ROWTYPE;
  v_net NUMERIC(15,2) := 0;
  v_positive_count INTEGER := 0;
  v_negative_count INTEGER := 0;
  v_nonzero_count INTEGER := 0;
  v_bad_line INTEGER;
  v_funded NUMERIC(15,2);
  v_mapping_count INTEGER;
  v_line RECORD;
BEGIN
  PERFORM public.njss_validate_budget_revision_base(p_revision_id, p_snapshot_stage);

  SELECT * INTO v_revision
  FROM budget_revisions
  WHERE id = p_revision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget revision not found.';
  END IF;

  SELECT
    COALESCE(SUM(adjustment_amount), 0),
    COUNT(*) FILTER (WHERE adjustment_amount > 0.009),
    COUNT(*) FILTER (WHERE adjustment_amount < -0.009),
    COUNT(*) FILTER (WHERE ABS(adjustment_amount) > 0.009)
  INTO v_net, v_positive_count, v_negative_count, v_nonzero_count
  FROM budget_revision_lines
  WHERE budget_revision_id = p_revision_id;

  -- REFORECAST changes remaining monthly phasing only; it cannot change the
  -- annual authorised ceiling. Annual movements use the other revision types.
  IF v_revision.revision_type = 'REFORECAST' AND v_nonzero_count > 0 THEN
    RAISE EXCEPTION 'Reforecast can only change monthly phasing; annual authorised amounts must remain unchanged.';
  END IF;

  -- A REDUCTION is one-way: no compensating increases and no zero-value no-op.
  IF v_revision.revision_type = 'REDUCTION' AND v_positive_count > 0 THEN
    RAISE EXCEPTION 'Reduction revision cannot contain positive adjustments.';
  END IF;
  IF v_revision.revision_type = 'REDUCTION' AND v_net >= -0.009 THEN
    RAISE EXCEPTION 'Reduction revision must reduce the authorised budget.';
  END IF;

  -- Virement/reclassification must be a real balanced movement, not a no-op.
  IF v_revision.revision_type IN ('VIREMENT','RECLASSIFICATION')
     AND (v_positive_count = 0 OR v_negative_count = 0) THEN
    RAISE EXCEPTION 'Virement/reclassification must include both a decrease and an increase.';
  END IF;

  -- Belt-and-braces accounting invariant: only genuine supplementary authority
  -- may expand the overall authorised budget envelope.
  IF v_revision.revision_type <> 'SUPPLEMENTARY' AND v_net > 0.009 THEN
    RAISE EXCEPTION 'Only Supplementary Budget may increase the total authorised budget.';
  END IF;

  -- Funding already approved against a line cannot be stranded above a reduced
  -- budget ceiling. Funding must first be reallocated/reversed through its own
  -- controlled process.
  v_bad_line := NULL;
  FOR v_line IN
    SELECT brl.source_budget_allocation_id,
           brl.proposed_revised_budget,
           rl.line_number
    FROM budget_revision_lines brl
    JOIN divisional_budget_lines rl ON rl.id = brl.revision_budget_line_id
    WHERE brl.budget_revision_id = p_revision_id
      AND brl.source_budget_allocation_id IS NOT NULL
    ORDER BY rl.line_number
  LOOP
    SELECT COALESCE(SUM(fal.allocated_amount), 0)
    INTO v_funded
    FROM funding_allocations fal
    WHERE fal.budget_allocation_id = v_line.source_budget_allocation_id
      AND fal.status = 'APPROVED';

    IF COALESCE(v_line.proposed_revised_budget, 0) + 0.009 < COALESCE(v_funded, 0) THEN
      RAISE EXCEPTION 'Revision row % cannot be reduced below approved funded amount K%. Reallocate or reverse funding first.',
        v_line.line_number, ROUND(COALESCE(v_funded, 0), 2);
    END IF;
  END LOOP;

  -- New target rows must resolve to exact active financial master data before
  -- approval. Migration 052 contains legacy fallbacks for compatibility; these
  -- checks make those fallbacks unreachable for hardened revisions.
  FOR v_line IN
    SELECT brl.id AS revision_line_id,
           rl.line_number,
           rl.expense_ledger_id,
           el.finance_code,
           el.expense_code_registry_id,
           d.cost_centre_id,
           d.cost_centre_code
    FROM budget_revision_lines brl
    JOIN divisional_budget_lines rl ON rl.id = brl.revision_budget_line_id
    JOIN budget_revisions br ON br.id = brl.budget_revision_id
    JOIN budget_divisions d ON d.id = br.division_id
    LEFT JOIN expense_ledger el ON el.id = rl.expense_ledger_id
    WHERE brl.budget_revision_id = p_revision_id
      AND brl.source_budget_allocation_id IS NULL
    ORDER BY rl.line_number
  LOOP
    SELECT COUNT(*)::INTEGER
    INTO v_mapping_count
    FROM expense_code_registry ecr
    WHERE ecr.id = v_line.expense_code_registry_id
      AND ecr.is_active = true
      AND ecr.expense_ledger_id = v_line.expense_ledger_id;
    IF v_mapping_count <> 1 THEN
      RAISE EXCEPTION 'Revision target row % requires an active posting Expense / Posting Code mapping for its Finance Code.', v_line.line_number;
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_mapping_count
    FROM chart_of_accounts coa
    WHERE coa.is_active = true
      AND coa.account_code = v_line.finance_code;
    IF v_mapping_count <> 1 THEN
      RAISE EXCEPTION 'Revision target row % requires an exact active Chart of Accounts mapping for Finance Code %.', v_line.line_number, COALESCE(v_line.finance_code, '-');
    END IF;

    SELECT COUNT(*)::INTEGER
    INTO v_mapping_count
    FROM cost_centres cc
    WHERE cc.is_active = true
      AND (
        (v_line.cost_centre_id IS NOT NULL AND cc.id = v_line.cost_centre_id)
        OR (
          v_line.cost_centre_id IS NULL
          AND v_line.cost_centre_code IS NOT NULL
          AND cc.code = v_line.cost_centre_code
        )
      );
    IF v_mapping_count <> 1 THEN
      RAISE EXCEPTION 'Revision target row % requires an exact active Financial Cost Centre mapping.', v_line.line_number;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.njss_validate_budget_revision(UUID,TEXT) FROM PUBLIC, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Harden creation. The 052 implementation remains the transactional worker,
--    but authenticated callers can only reach it through this strict wrapper.
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.njss_create_budget_revision(UUID,TEXT,TEXT,TEXT,DATE,TEXT,TEXT)
  RENAME TO njss_create_budget_revision_base;
REVOKE ALL ON FUNCTION public.njss_create_budget_revision_base(UUID,TEXT,TEXT,TEXT,DATE,TEXT,TEXT) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.njss_create_budget_revision(
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
  v_user_id UUID := fn_current_app_user_id();
  v_parent divisional_budget_submissions%ROWTYPE;
  v_division budget_divisions%ROWTYPE;
  v_effective_date DATE;
  v_bad_line INTEGER;
  v_allocation_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated NJSS user profile is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_user_id
      AND r.name = 'Registrar'
      AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'Only the Registrar can initiate a budget revision or supplementary budget request.';
  END IF;

  IF NOT COALESCE(fn_current_user_has_permission('budget.revision.create'), false) THEN
    RAISE EXCEPTION 'Permission denied: budget.revision.create is required.';
  END IF;

  SELECT * INTO v_parent
  FROM divisional_budget_submissions
  WHERE id = p_parent_submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved parent budget submission not found.';
  END IF;

  SELECT * INTO v_division
  FROM budget_divisions
  WHERE id = v_parent.division_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget division for the approved parent submission was not found.';
  END IF;

  IF NOT fn_current_user_data_scope_allows(
    v_division.department_id,
    v_division.section_id,
    NULL,
    NULL,
    NULL
  ) THEN
    RAISE EXCEPTION 'Budget revision is outside the current user organisational scope.';
  END IF;

  v_effective_date := COALESCE(p_effective_date, make_date(v_parent.budget_year, 1, 1));
  IF EXTRACT(YEAR FROM v_effective_date)::INTEGER <> v_parent.budget_year THEN
    RAISE EXCEPTION 'Budget revision effective date must fall within budget year %. Requested date: %.', v_parent.budget_year, v_effective_date;
  END IF;

  -- Every approved source line must already have exactly one operational
  -- allocation. Missing lineage is not converted into a new target row.
  v_bad_line := NULL;
  v_allocation_count := NULL;
  SELECT l.line_number, COUNT(ba.id)::INTEGER
  INTO v_bad_line, v_allocation_count
  FROM divisional_budget_lines l
  LEFT JOIN budget_allocations ba
    ON ba.source_budget_line_id = l.id
   AND ba.is_active = true
  WHERE l.submission_id = v_parent.id
  GROUP BY l.id, l.line_number
  HAVING COUNT(ba.id) <> 1
  ORDER BY l.line_number
  LIMIT 1;

  IF v_bad_line IS NOT NULL THEN
    RAISE EXCEPTION 'Approved source row % must have exactly one active operational budget allocation; found %.', v_bad_line, COALESCE(v_allocation_count, 0);
  END IF;

  -- Permit only the trusted cloning/recalculation work performed inside the
  -- base creator. Direct user edits remain protected by the Line Supervisor guard.
  PERFORM set_config('njss.budget_revision_create', 'on', true);

  RETURN public.njss_create_budget_revision_base(
    p_parent_submission_id,
    p_revision_type,
    p_reason,
    p_authority_reference,
    v_effective_date,
    p_supporting_reference,
    p_user_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.njss_create_budget_revision(UUID,TEXT,TEXT,TEXT,DATE,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.njss_create_budget_revision(UUID,TEXT,TEXT,TEXT,DATE,TEXT,TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Harden transitions. Line Supervisor prepares/submits the Registrar-requested
--    change. Registrar alone performs final approve/return/reject disposition.
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.njss_transition_budget_revision(UUID,TEXT,TEXT,TEXT)
  RENAME TO njss_transition_budget_revision_base;
REVOKE ALL ON FUNCTION public.njss_transition_budget_revision_base(UUID,TEXT,TEXT,TEXT) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.njss_transition_budget_revision(
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
  v_user_id UUID := fn_current_app_user_id();
  v_revision budget_revisions%ROWTYPE;
  v_division budget_divisions%ROWTYPE;
  v_action TEXT := UPPER(COALESCE(p_action, ''));
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated NJSS user profile is required.';
  END IF;

  SELECT * INTO v_revision
  FROM budget_revisions
  WHERE id = p_revision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget revision not found.';
  END IF;

  SELECT * INTO v_division
  FROM budget_divisions
  WHERE id = v_revision.division_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget revision division was not found.';
  END IF;

  IF NOT fn_current_user_data_scope_allows(
    v_division.department_id,
    v_division.section_id,
    NULL,
    NULL,
    NULL
  ) THEN
    RAISE EXCEPTION 'Budget revision is outside the current user organisational scope.';
  END IF;

  IF v_action IN ('SUBMIT','RESUBMIT') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = v_user_id
        AND r.name = 'Line Supervisor'
        AND r.is_active = true
    ) THEN
      RAISE EXCEPTION 'Only the Line Supervisor can submit a budget revision requested for their section.';
    END IF;
  ELSIF v_action IN ('APPROVE','RETURN','REJECT') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = v_user_id
        AND r.name = 'Registrar'
        AND r.is_active = true
    ) THEN
      RAISE EXCEPTION 'Only the Registrar can approve, return or reject a budget revision.';
    END IF;
  ELSIF v_action = 'REVIEW' THEN
    RAISE EXCEPTION 'A separate revision review action is not used. The Line Supervisor submits and the Registrar approves, returns or rejects.';
  ELSE
    RAISE EXCEPTION 'Unsupported budget revision action: %', p_action;
  END IF;

  IF v_action='APPROVE' AND v_revision.status NOT IN ('SUBMITTED','RESUBMITTED') THEN
    RAISE EXCEPTION 'Registrar approval requires a budget revision submitted by the Line Supervisor.';
  END IF;

  IF v_action = 'RETURN' AND COALESCE(TRIM(p_comments), '') = '' THEN
    RAISE EXCEPTION 'Return comments/reason are required.';
  END IF;
  IF v_action = 'REJECT' AND COALESCE(TRIM(p_comments), '') = '' THEN
    RAISE EXCEPTION 'Rejection comments/reason are required.';
  END IF;

  -- Distinguish the dedicated revision transition from the initial-budget
  -- workflow. The submission guard rejects status changes without this flag.
  PERFORM set_config('njss.budget_revision_workflow', 'on', true);

  -- The 052 worker expects REVIEWED before APPROVE. Keep that internal state
  -- transition atomic inside the single Registrar Approve action; the UI/API do
  -- not expose a separate Review Revision action.
  IF v_action = 'APPROVE' THEN
    PERFORM public.njss_transition_budget_revision_base(
      p_revision_id,
      'REVIEW',
      'Registrar final approval review',
      p_user_email
    );
    RETURN public.njss_transition_budget_revision_base(
      p_revision_id,
      'APPROVE',
      p_comments,
      p_user_email
    );
  END IF;

  RETURN public.njss_transition_budget_revision_base(
    p_revision_id,
    p_action,
    p_comments,
    p_user_email
  );
END;
$$;

REVOKE ALL ON FUNCTION public.njss_transition_budget_revision(UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.njss_transition_budget_revision(UUID,TEXT,TEXT,TEXT) TO authenticated;

-- Refresh differential-backup tracking after adding hardening objects. The
-- function is defensive so older environments can still parse this migration.
DO $$
BEGIN
  IF to_regprocedure('public.njss_backup_refresh_change_triggers()') IS NOT NULL THEN
    PERFORM public.njss_backup_refresh_change_triggers();
  END IF;
END $$;

COMMIT;
