-- =============================================================================
-- NJSS 056 — OPERATIONAL BUDGET ACTIVATION & FINANCE MASTER-DATA HARDENING
-- Separates business approval from operational allocation activation.
-- System Administrator prepares/validates; Registrar authorises atomically.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Finance master-data hardening: Posting Code -> Chart of Accounts.
-- -----------------------------------------------------------------------------
ALTER TABLE expense_code_registry
  ADD COLUMN IF NOT EXISTS chart_of_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_expense_code_registry_chart_of_account
  ON expense_code_registry(chart_of_account_id)
  WHERE chart_of_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expense_code_registry_expense_ledger
  ON expense_code_registry(expense_ledger_id)
  WHERE expense_ledger_id IS NOT NULL;

COMMENT ON COLUMN expense_code_registry.chart_of_account_id IS
  'Explicit posting destination used by Task 9 budget activation. No fallback Chart of Accounts account is permitted.';

-- -----------------------------------------------------------------------------
-- 2. Activation header and line snapshots.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_activation_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL UNIQUE REFERENCES divisional_budget_submissions(id) ON DELETE RESTRICT,
  financial_year INTEGER NOT NULL,
  department_id UUID REFERENCES departments(id) ON DELETE RESTRICT,
  budget_division_id UUID REFERENCES budget_divisions(id) ON DELETE RESTRICT,
  approved_line_count INTEGER NOT NULL DEFAULT 0 CHECK (approved_line_count >= 0),
  approved_total NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (approved_total >= 0),
  mapped_line_count INTEGER NOT NULL DEFAULT 0 CHECK (mapped_line_count >= 0),
  unmapped_line_count INTEGER NOT NULL DEFAULT 0 CHECK (unmapped_line_count >= 0),
  activation_total NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (activation_total >= 0),
  variance NUMERIC(15,2) NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL DEFAULT 'DRAFT_MAPPING'
    CHECK (status IN ('DRAFT_MAPPING','VALIDATION_FAILED','READY_FOR_ACTIVATION','ACTIVATED','CANCELLED')),
  prepared_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  prepared_by_email VARCHAR(255),
  prepared_at TIMESTAMPTZ,
  validated_at TIMESTAMPTZ,
  submitted_for_activation_at TIMESTAMPTZ,
  authorised_by UUID REFERENCES users(id) ON DELETE RESTRICT,
  authorised_by_email VARCHAR(255),
  authorised_at TIMESTAMPTZ,
  activated_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  validation_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budget_activation_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  activation_batch_id UUID NOT NULL REFERENCES budget_activation_batches(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL REFERENCES divisional_budget_submissions(id) ON DELETE RESTRICT,
  budget_line_id UUID NOT NULL REFERENCES divisional_budget_lines(id) ON DELETE RESTRICT,
  expense_ledger_id UUID REFERENCES expense_ledger(id) ON DELETE RESTRICT,
  finance_code VARCHAR(60),
  expense_code_registry_id UUID REFERENCES expense_code_registry(id) ON DELETE RESTRICT,
  chart_of_account_id UUID REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  department_id UUID REFERENCES departments(id) ON DELETE RESTRICT,
  section_id UUID REFERENCES sections(id) ON DELETE RESTRICT,
  cost_centre_id UUID REFERENCES cost_centres(id) ON DELETE RESTRICT,
  approved_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  mapped_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  mapping_status VARCHAR(30) NOT NULL DEFAULT 'INVALID'
    CHECK (mapping_status IN ('READY','INVALID')),
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  validation_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_line_updated_at TIMESTAMPTZ,
  source_monthly_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (activation_batch_id, budget_line_id)
);

CREATE INDEX IF NOT EXISTS idx_budget_activation_batches_status
  ON budget_activation_batches(status, financial_year);
CREATE INDEX IF NOT EXISTS idx_budget_activation_batches_submission
  ON budget_activation_batches(submission_id);
CREATE INDEX IF NOT EXISTS idx_budget_activation_lines_batch
  ON budget_activation_lines(activation_batch_id, mapping_status);
CREATE INDEX IF NOT EXISTS idx_budget_activation_lines_source
  ON budget_activation_lines(submission_id, budget_line_id);

COMMENT ON TABLE budget_activation_lines IS
  'Validation snapshot only. Approved values remain authoritative in divisional_budget_lines.';

-- -----------------------------------------------------------------------------
-- 3. RBAC permissions and navigation.
-- -----------------------------------------------------------------------------
INSERT INTO menu_items (
  code, module_code, parent_code, label, href, icon, sort_order,
  required_permissions, is_active
) VALUES (
  'budget.activation', 'budget', 'budget.control', 'Budget Activation',
  '/dashboard/budget/activation', 'Wallet', 34,
  ARRAY['budget.activation.view','budget.activation.prepare','budget.activation.submit','budget.activation.authorize'], true
)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  parent_code = EXCLUDED.parent_code,
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  required_permissions = EXCLUDED.required_permissions,
  is_active = true,
  updated_at = NOW();

INSERT INTO permissions (code, module_code, menu_code, action, label, description, is_active) VALUES
  ('budget.activation.view','budget','budget.activation','view','View budget activation','View approved budget activation and reconciliation',true),
  ('budget.activation.prepare','budget','budget.activation','edit','Prepare budget activation','Prepare and validate Finance mappings',true),
  ('budget.activation.validate','budget','budget.activation','verify','Validate budget activation','Revalidate approved budget Finance mappings',true),
  ('budget.activation.submit','budget','budget.activation','submit','Submit budget activation','Submit a fully reconciled activation for Registrar authorisation',true),
  ('budget.activation.authorize','budget','budget.activation','approve','Authorise budget activation','Authorise atomic operational budget activation',true)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  menu_code = EXCLUDED.menu_code,
  action = EXCLUDED.action,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active = true;

-- System Administrator retains the protected technical role and broad `all`
-- permission, but these explicit permissions make the activation responsibility
-- visible in the permission matrix. Database RPC role checks remain authoritative.
INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.permission, true
FROM roles r
CROSS JOIN LATERAL (
  VALUES
    ('budget.activation.view'),
    ('budget.activation.prepare'),
    ('budget.activation.validate'),
    ('budget.activation.submit')
) AS p(permission)
WHERE r.name = 'System Administrator' AND r.is_active = true
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.permission, true
FROM roles r
CROSS JOIN LATERAL (
  VALUES
    ('budget.activation.view'),
    ('budget.activation.authorize')
) AS p(permission)
WHERE r.name = 'Registrar' AND r.is_active = true
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

-- -----------------------------------------------------------------------------
-- 4. Internal role helper. This deliberately does not treat permission `all`
--    as business authority for activation.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_current_user_has_role(p_role_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    WHERE u.id = fn_current_app_user_id()
      AND u.is_active = true
      AND r.name = p_role_name
      AND r.is_active = true
  );
$$;
REVOKE ALL ON FUNCTION public.njss_current_user_has_role(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.njss_current_user_has_role(TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Business-budget validation is about the approved budget itself. Finance
--    posting/master-data readiness is now a separate Task 9 activation control.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_divisional_budget_submission(p_submission_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_submission divisional_budget_submissions;
  v_line_count INTEGER;
  v_invalid RECORD;
BEGIN
  SELECT * INTO v_submission
  FROM divisional_budget_submissions
  WHERE id = p_submission_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget submission not found';
  END IF;

  IF v_submission.division_id IS NULL OR COALESCE(v_submission.cost_centre, '') = '' THEN
    RAISE EXCEPTION 'Submission must have a valid Division/Cost Centre';
  END IF;

  SELECT COUNT(*) INTO v_line_count
  FROM divisional_budget_lines
  WHERE submission_id = p_submission_id;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'Add at least one budget line before submission';
  END IF;

  SELECT l.line_number,
         CASE
           WHEN l.expense_ledger_id IS NULL THEN 'Finance Code is required'
           WHEN el.id IS NULL OR el.is_active IS DISTINCT FROM true OR el.is_posting IS DISTINCT FROM true THEN 'Finance Code must be an active posting ledger code'
           WHEN COALESCE(trim(l.line_item_description), '') = '' THEN 'Line Item / Activity Description is required'
           WHEN COALESCE(trim(l.business_justification), '') = '' THEN 'Business Justification is required'
           WHEN COALESCE(l.quantity, 0) <= 0 THEN 'Quantity must be greater than zero'
           WHEN l.unit_cost IS NULL OR l.unit_cost < 0 THEN 'Unit Cost must be valid'
           WHEN COALESCE(l.frequency_periods, 0) <= 0 THEN 'Frequency / Periods must be greater than zero'
           WHEN ABS(COALESCE(l.allocation_variance, 0)) > 0.009 THEN 'Monthly allocation must equal Annual Estimate'
           ELSE NULL
         END AS reason
  INTO v_invalid
  FROM divisional_budget_lines l
  LEFT JOIN expense_ledger el ON el.id = l.expense_ledger_id
  WHERE l.submission_id = p_submission_id
    AND (
      l.expense_ledger_id IS NULL OR
      el.id IS NULL OR el.is_active IS DISTINCT FROM true OR el.is_posting IS DISTINCT FROM true OR
      COALESCE(trim(l.line_item_description), '') = '' OR
      COALESCE(trim(l.business_justification), '') = '' OR
      COALESCE(l.quantity, 0) <= 0 OR
      l.unit_cost IS NULL OR l.unit_cost < 0 OR
      COALESCE(l.frequency_periods, 0) <= 0 OR
      ABS(COALESCE(l.allocation_variance, 0)) > 0.009
    )
  ORDER BY l.line_number
  LIMIT 1;

  IF v_invalid.reason IS NOT NULL THEN
    RAISE EXCEPTION 'Row % invalid: %', v_invalid.line_number, v_invalid.reason;
  END IF;

  PERFORM recalc_divisional_budget_submission_totals(p_submission_id);

  SELECT * INTO v_submission
  FROM divisional_budget_submissions
  WHERE id = p_submission_id;

  IF ABS(COALESCE(v_submission.unallocated_variance, 0)) > 0.009 THEN
    RAISE EXCEPTION 'Total submission variance must be zero before submission or approval';
  END IF;

  IF COALESCE(v_submission.budget_ceiling, 0) > 0
     AND COALESCE(v_submission.total_proposed_budget, 0) > COALESCE(v_submission.budget_ceiling, 0) + 0.009 THEN
    RAISE EXCEPTION 'Total proposed budget exceeds configured budget ceiling';
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Legacy direct allocator is retired. It remains as a compatibility stub so
--    old clients receive a safe explicit error rather than an undefined RPC.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_operational_allocations_from_divisional_budget(
  p_submission_id UUID,
  p_user_email TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Direct operational allocation creation is retired. Use Budget Activation dual control.';
END;
$$;

REVOKE ALL ON FUNCTION public.create_operational_allocations_from_divisional_budget(UUID,TEXT) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Approval is business authority only. APPROVE creates/refreshes a draft
--    activation batch but never creates budget_allocations.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transition_divisional_budget_submission(
  p_submission_id UUID,
  p_action TEXT,
  p_comments TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS divisional_budget_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old divisional_budget_submissions;
  v_new_status VARCHAR(40);
  v_out divisional_budget_submissions;
  v_user_id UUID;
BEGIN
  SELECT * INTO v_old
  FROM divisional_budget_submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget submission not found';
  END IF;

  v_user_id := fn_current_app_user_id();
  IF v_user_id IS NULL AND COALESCE(trim(p_user_email), '') <> '' THEN
    SELECT id INTO v_user_id
    FROM users
    WHERE lower(email) = lower(trim(p_user_email)) AND is_active = true
    LIMIT 1;
  END IF;

  IF UPPER(p_action) = 'SUBMIT' AND v_old.status NOT IN ('DRAFT') THEN
    RAISE EXCEPTION 'Only DRAFT budgets can be submitted';
  END IF;
  IF UPPER(p_action) = 'RESUBMIT' AND v_old.status NOT IN ('RETURNED') THEN
    RAISE EXCEPTION 'Only RETURNED budgets can be resubmitted';
  END IF;
  IF UPPER(p_action) = 'RETURN' AND v_old.status NOT IN ('SUBMITTED', 'RESUBMITTED') THEN
    RAISE EXCEPTION 'Only submitted budgets can be returned';
  END IF;
  IF UPPER(p_action) = 'RETURN' AND COALESCE(trim(p_comments), '') = '' THEN
    RAISE EXCEPTION 'Return comments/reason are required';
  END IF;
  IF UPPER(p_action) = 'REVIEW' AND v_old.status NOT IN ('SUBMITTED', 'RESUBMITTED') THEN
    RAISE EXCEPTION 'Only SUBMITTED or RESUBMITTED budgets can be reviewed';
  END IF;
  IF UPPER(p_action) = 'APPROVE' AND v_old.status <> 'REVIEWED' THEN
    RAISE EXCEPTION 'Only REVIEWED budgets can be approved';
  END IF;

  v_new_status := CASE UPPER(p_action)
    WHEN 'SUBMIT' THEN 'SUBMITTED'
    WHEN 'RESUBMIT' THEN 'RESUBMITTED'
    WHEN 'RETURN' THEN 'RETURNED'
    WHEN 'REVIEW' THEN 'REVIEWED'
    WHEN 'APPROVE' THEN 'APPROVED'
    WHEN 'REJECT' THEN 'REJECTED'
    WHEN 'ARCHIVE' THEN 'ARCHIVED'
    ELSE NULL
  END;

  IF v_new_status IS NULL THEN
    RAISE EXCEPTION 'Unsupported budget workflow action: %', p_action;
  END IF;

  IF UPPER(p_action) IN ('SUBMIT','RESUBMIT','APPROVE') THEN
    PERFORM validate_divisional_budget_submission(p_submission_id);
    SELECT * INTO v_old FROM divisional_budget_submissions WHERE id = p_submission_id FOR UPDATE;
  END IF;

  PERFORM set_config('njss.budget_workflow', 'on', true);

  UPDATE divisional_budget_submissions
  SET status = v_new_status,
      validation_status = CASE WHEN ABS(COALESCE(unallocated_variance, 0)) <= 0.009 THEN 'VALID' ELSE 'VARIANCE' END,
      is_locked = v_new_status IN ('SUBMITTED','RESUBMITTED','REVIEWED','APPROVED','ARCHIVED'),
      submitted_by = CASE WHEN UPPER(p_action) IN ('SUBMIT','RESUBMIT') THEN COALESCE(v_user_id, submitted_by) ELSE submitted_by END,
      reviewed_by = CASE WHEN UPPER(p_action) = 'REVIEW' THEN COALESCE(v_user_id, reviewed_by) ELSE reviewed_by END,
      approved_by = CASE WHEN UPPER(p_action) = 'APPROVE' THEN COALESCE(v_user_id, approved_by) ELSE approved_by END,
      rejected_by = CASE WHEN UPPER(p_action) = 'REJECT' THEN COALESCE(v_user_id, rejected_by) ELSE rejected_by END,
      submitted_at = CASE WHEN UPPER(p_action) IN ('SUBMIT','RESUBMIT') THEN NOW() ELSE submitted_at END,
      reviewed_at = CASE WHEN UPPER(p_action) = 'REVIEW' THEN NOW() ELSE reviewed_at END,
      approved_at = CASE WHEN UPPER(p_action) = 'APPROVE' THEN NOW() ELSE approved_at END,
      rejected_at = CASE WHEN UPPER(p_action) = 'REJECT' THEN NOW() ELSE rejected_at END,
      return_reason = CASE WHEN UPPER(p_action) = 'RETURN' THEN p_comments ELSE return_reason END,
      approval_comments = CASE WHEN UPPER(p_action) IN ('REVIEW','APPROVE','REJECT') THEN p_comments ELSE approval_comments END,
      updated_at = NOW()
  WHERE id = p_submission_id
  RETURNING * INTO v_out;

  IF UPPER(p_action) = 'APPROVE' THEN
    INSERT INTO budget_activation_batches (
      submission_id, financial_year, department_id, budget_division_id,
      status, approved_line_count, approved_total, mapped_line_count,
      unmapped_line_count, activation_total, variance, validation_snapshot,
      created_at, updated_at
    )
    SELECT
      s.id,
      s.budget_year,
      s.department_id,
      s.division_id,
      'DRAFT_MAPPING',
      COUNT(l.id),
      COALESCE(SUM(l.annual_estimate),0),
      0,
      COUNT(l.id),
      0,
      COALESCE(SUM(l.annual_estimate),0),
      jsonb_build_object(
        'approval_status', s.status,
        'approved_at', s.approved_at,
        'approved_total', COALESCE(SUM(l.annual_estimate),0),
        'approved_line_count', COUNT(l.id)
      ),
      NOW(),
      NOW()
    FROM divisional_budget_submissions s
    JOIN divisional_budget_lines l ON l.submission_id = s.id
    WHERE s.id = p_submission_id
    GROUP BY s.id, s.budget_year, s.department_id, s.division_id, s.status, s.approved_at
    ON CONFLICT (submission_id) DO UPDATE SET
      financial_year = EXCLUDED.financial_year,
      department_id = EXCLUDED.department_id,
      budget_division_id = EXCLUDED.budget_division_id,
      status = CASE
        WHEN budget_activation_batches.status = 'ACTIVATED' THEN 'ACTIVATED'
        ELSE 'DRAFT_MAPPING'
      END,
      approved_line_count = EXCLUDED.approved_line_count,
      approved_total = EXCLUDED.approved_total,
      mapped_line_count = CASE WHEN budget_activation_batches.status = 'ACTIVATED' THEN budget_activation_batches.mapped_line_count ELSE 0 END,
      unmapped_line_count = CASE WHEN budget_activation_batches.status = 'ACTIVATED' THEN budget_activation_batches.unmapped_line_count ELSE EXCLUDED.unmapped_line_count END,
      activation_total = CASE WHEN budget_activation_batches.status = 'ACTIVATED' THEN budget_activation_batches.activation_total ELSE 0 END,
      variance = CASE WHEN budget_activation_batches.status = 'ACTIVATED' THEN budget_activation_batches.variance ELSE EXCLUDED.approved_total END,
      validation_snapshot = CASE WHEN budget_activation_batches.status = 'ACTIVATED' THEN budget_activation_batches.validation_snapshot ELSE EXCLUDED.validation_snapshot END,
      updated_at = NOW();
  END IF;

  INSERT INTO budget_workflow_history (
    submission_id, from_status, to_status, action, comments, changed_by, changed_by_email
  ) VALUES (
    p_submission_id, v_old.status, v_new_status, UPPER(p_action), p_comments, v_user_id, p_user_email
  );

  PERFORM log_audit_event(
    v_user_id, p_user_email, COALESCE(p_user_email, 'System'),
    'BUDGET_' || UPPER(p_action), 'BUDGET_SUBMISSION', p_submission_id, v_out.submission_number,
    jsonb_build_object('status', v_old.status),
    jsonb_build_object('status', v_new_status),
    jsonb_build_object('old_status', v_old.status, 'new_status', v_new_status, 'activation_required', UPPER(p_action) = 'APPROVE'),
    NULL
  );

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_divisional_budget_submission(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_divisional_budget_submission(UUID,TEXT,TEXT,TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Existing APPROVED submissions receive DRAFT_MAPPING headers only. This is
--    not activation and creates no operational allocations.
-- -----------------------------------------------------------------------------
INSERT INTO budget_activation_batches (
  submission_id, financial_year, department_id, budget_division_id,
  approved_line_count, approved_total, mapped_line_count, unmapped_line_count,
  activation_total, variance, status, validation_snapshot
)
SELECT
  s.id,
  s.budget_year,
  s.department_id,
  s.division_id,
  COUNT(l.id),
  COALESCE(SUM(l.annual_estimate),0),
  0,
  COUNT(l.id),
  0,
  COALESCE(SUM(l.annual_estimate),0),
  'DRAFT_MAPPING',
  jsonb_build_object(
    'source', 'migration_056_existing_approved_submission',
    'approved_at', s.approved_at,
    'approved_line_count', COUNT(l.id),
    'approved_total', COALESCE(SUM(l.annual_estimate),0)
  )
FROM divisional_budget_submissions s
JOIN divisional_budget_lines l ON l.submission_id = s.id
WHERE s.status = 'APPROVED'
GROUP BY s.id, s.budget_year, s.department_id, s.division_id, s.approved_at
ON CONFLICT (submission_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 9. System Administrator preparation/revalidation.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_prepare_budget_activation(
  p_activation_batch_id UUID,
  p_user_email TEXT DEFAULT NULL
)
RETURNS budget_activation_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch budget_activation_batches;
  v_out budget_activation_batches;
  v_user_id UUID := fn_current_app_user_id();
  v_user_name TEXT;
  v_approved_count INTEGER := 0;
  v_ready_count INTEGER := 0;
  v_invalid_count INTEGER := 0;
  v_approved_total NUMERIC(15,2) := 0;
  v_activation_total NUMERIC(15,2) := 0;
BEGIN
  IF v_user_id IS NULL OR NOT public.njss_current_user_has_role('System Administrator') THEN
    RAISE EXCEPTION 'Only a System Administrator may prepare operational budget activation.';
  END IF;

  SELECT COALESCE(full_name, email), email
  INTO v_user_name, p_user_email
  FROM users
  WHERE id = v_user_id;

  SELECT * INTO v_batch
  FROM budget_activation_batches
  WHERE id = p_activation_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget activation batch not found.';
  END IF;
  IF v_batch.status = 'ACTIVATED' THEN
    RAISE EXCEPTION 'Activated budgets are immutable and cannot be prepared again.';
  END IF;
  IF v_batch.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Cancelled activation batches cannot be prepared.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM divisional_budget_submissions s
    WHERE s.id = v_batch.submission_id AND s.status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Only an APPROVED budget can be prepared for activation.';
  END IF;

  DELETE FROM budget_activation_lines
  WHERE activation_batch_id = p_activation_batch_id;

  INSERT INTO budget_activation_lines (
    activation_batch_id, submission_id, budget_line_id,
    expense_ledger_id, finance_code, expense_code_registry_id,
    chart_of_account_id, department_id, section_id, cost_centre_id,
    approved_amount, mapped_amount, mapping_status, validation_errors,
    validation_snapshot, source_line_updated_at, source_monthly_updated_at,
    created_at, updated_at
  )
  SELECT
    v_batch.id,
    s.id,
    l.id,
    l.expense_ledger_id,
    el.finance_code,
    ecr.id,
    ecr.chart_of_account_id,
    ecr.department_id,
    ecr.section_id,
    ecr.cost_centre_id,
    COALESCE(l.annual_estimate,0),
    CASE WHEN
      el.id IS NOT NULL
      AND el.is_active = true
      AND el.is_posting = true
      AND el.expense_code_registry_id IS NOT NULL
      AND ecr.id = el.expense_code_registry_id
      AND ecr.is_active = true
      AND ecr.expense_ledger_id = el.id
      AND (SELECT COUNT(*) FROM expense_code_registry ecr2 WHERE ecr2.expense_ledger_id = el.id AND ecr2.is_active = true) = 1
      AND coa.id IS NOT NULL
      AND coa.is_active = true
      AND dep.id IS NOT NULL
      AND dep.is_active = true
      AND cc.id IS NOT NULL
      AND cc.is_active = true
      AND cc.department_id = dep.id
      AND (ecr.section_id IS NULL OR sec.id IS NOT NULL)
      AND (ecr.section_id IS NULL OR cc.section_id IS NULL OR cc.section_id = ecr.section_id)
      AND (bd.cost_centre_code IS NULL OR trim(bd.cost_centre_code) = '' OR cc.code = bd.cost_centre_code)
      AND ABS(COALESCE(l.allocation_variance,0)) <= 0.009
      AND ABS(COALESCE(l.monthly_allocation_total,0) - COALESCE(l.annual_estimate,0)) <= 0.009
      AND NOT EXISTS (
        SELECT 1 FROM budget_allocations ba
        WHERE ba.source_budget_line_id = l.id AND ba.is_active = true
      )
    THEN COALESCE(l.annual_estimate,0) ELSE 0 END,
    CASE WHEN
      el.id IS NOT NULL
      AND el.is_active = true
      AND el.is_posting = true
      AND el.expense_code_registry_id IS NOT NULL
      AND ecr.id = el.expense_code_registry_id
      AND ecr.is_active = true
      AND ecr.expense_ledger_id = el.id
      AND (SELECT COUNT(*) FROM expense_code_registry ecr2 WHERE ecr2.expense_ledger_id = el.id AND ecr2.is_active = true) = 1
      AND coa.id IS NOT NULL
      AND coa.is_active = true
      AND dep.id IS NOT NULL
      AND dep.is_active = true
      AND cc.id IS NOT NULL
      AND cc.is_active = true
      AND cc.department_id = dep.id
      AND (ecr.section_id IS NULL OR sec.id IS NOT NULL)
      AND (ecr.section_id IS NULL OR cc.section_id IS NULL OR cc.section_id = ecr.section_id)
      AND (bd.cost_centre_code IS NULL OR trim(bd.cost_centre_code) = '' OR cc.code = bd.cost_centre_code)
      AND ABS(COALESCE(l.allocation_variance,0)) <= 0.009
      AND ABS(COALESCE(l.monthly_allocation_total,0) - COALESCE(l.annual_estimate,0)) <= 0.009
      AND NOT EXISTS (
        SELECT 1 FROM budget_allocations ba
        WHERE ba.source_budget_line_id = l.id AND ba.is_active = true
      )
    THEN 'READY' ELSE 'INVALID' END,
    to_jsonb(array_remove(ARRAY[
      CASE WHEN l.expense_ledger_id IS NULL THEN 'Finance Code is required.' END,
      CASE WHEN el.id IS NULL THEN 'Finance Code does not exist.' END,
      CASE WHEN el.id IS NOT NULL AND (el.is_active IS DISTINCT FROM true OR el.is_posting IS DISTINCT FROM true) THEN 'Finance Code must be an active posting ledger code.' END,
      CASE WHEN el.id IS NOT NULL AND el.expense_code_registry_id IS NULL THEN 'Finance Code is not mapped to an active Posting Code.' END,
      CASE WHEN el.expense_code_registry_id IS NOT NULL AND ecr.id IS NULL THEN 'Finance Code Posting Code mapping does not exist.' END,
      CASE WHEN ecr.id IS NOT NULL AND ecr.is_active IS DISTINCT FROM true THEN 'Finance Code is not mapped to an active Posting Code.' END,
      CASE WHEN ecr.id IS NOT NULL AND ecr.expense_ledger_id IS DISTINCT FROM el.id THEN 'Posting Code is not linked back to the selected Finance Code.' END,
      CASE WHEN el.id IS NOT NULL AND (SELECT COUNT(*) FROM expense_code_registry ecr2 WHERE ecr2.expense_ledger_id = el.id AND ecr2.is_active = true) <> 1 THEN 'Finance Code must resolve to exactly one active Posting Code.' END,
      CASE WHEN ecr.id IS NOT NULL AND ecr.chart_of_account_id IS NULL THEN 'Posting Code has no active Chart of Accounts mapping.' END,
      CASE WHEN ecr.chart_of_account_id IS NOT NULL AND (coa.id IS NULL OR coa.is_active IS DISTINCT FROM true) THEN 'Posting Code has no active Chart of Accounts mapping.' END,
      CASE WHEN ecr.department_id IS NULL OR dep.id IS NULL OR dep.is_active IS DISTINCT FROM true THEN 'Department relationship is missing or inactive.' END,
      CASE WHEN ecr.cost_centre_id IS NULL OR cc.id IS NULL OR cc.is_active IS DISTINCT FROM true THEN 'Cost Centre relationship is missing or inactive.' END,
      CASE WHEN cc.id IS NOT NULL AND dep.id IS NOT NULL AND cc.department_id IS DISTINCT FROM dep.id THEN 'Cost Centre does not belong to the mapped Department.' END,
      CASE WHEN ecr.section_id IS NOT NULL AND sec.id IS NULL THEN 'Section relationship is missing or inactive.' END,
      CASE WHEN ecr.section_id IS NOT NULL AND cc.section_id IS NOT NULL AND cc.section_id IS DISTINCT FROM ecr.section_id THEN 'Cost Centre does not belong to the mapped Section.' END,
      CASE WHEN bd.cost_centre_code IS NOT NULL AND trim(bd.cost_centre_code) <> '' AND cc.id IS NOT NULL AND cc.code IS DISTINCT FROM bd.cost_centre_code THEN 'Mapped Cost Centre does not match the approved budget division.' END,
      CASE WHEN ABS(COALESCE(l.allocation_variance,0)) > 0.009 OR ABS(COALESCE(l.monthly_allocation_total,0) - COALESCE(l.annual_estimate,0)) > 0.009 THEN 'Monthly allocation must equal Annual Estimate.' END,
      CASE WHEN EXISTS (SELECT 1 FROM budget_allocations ba WHERE ba.source_budget_line_id = l.id AND ba.is_active = true) THEN 'Operational allocation already exists for source budget line.' END
    ]::TEXT[], NULL)),
    jsonb_build_object(
      'line_number', l.line_number,
      'budget_line_number', l.budget_line_number,
      'finance_code', el.finance_code,
      'posting_code', ecr.full_expense_code,
      'chart_of_account_id', ecr.chart_of_account_id,
      'approved_amount', COALESCE(l.annual_estimate,0),
      'monthly_total', COALESCE(l.monthly_allocation_total,0),
      'line_updated_at', l.updated_at,
      'monthly_updated_at', monthly.max_updated_at
    ),
    l.updated_at,
    monthly.max_updated_at,
    NOW(),
    NOW()
  FROM divisional_budget_submissions s
  JOIN budget_divisions bd ON bd.id = s.division_id
  JOIN divisional_budget_lines l ON l.submission_id = s.id
  LEFT JOIN expense_ledger el ON el.id = l.expense_ledger_id
  LEFT JOIN expense_code_registry ecr ON ecr.id = el.expense_code_registry_id
  LEFT JOIN chart_of_accounts coa ON coa.id = ecr.chart_of_account_id
  LEFT JOIN departments dep ON dep.id = ecr.department_id
  LEFT JOIN sections sec ON sec.id = ecr.section_id AND sec.is_active = true
  LEFT JOIN cost_centres cc ON cc.id = ecr.cost_centre_id
  LEFT JOIN LATERAL (
    SELECT MAX(bma.updated_at) AS max_updated_at
    FROM budget_monthly_allocations bma
    WHERE bma.budget_line_id = l.id
  ) monthly ON true
  WHERE s.id = v_batch.submission_id
  ORDER BY l.line_number;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE mapping_status = 'READY'),
    COUNT(*) FILTER (WHERE mapping_status <> 'READY'),
    COALESCE(SUM(approved_amount),0),
    COALESCE(SUM(mapped_amount),0)
  INTO
    v_approved_count,
    v_ready_count,
    v_invalid_count,
    v_approved_total,
    v_activation_total
  FROM budget_activation_lines
  WHERE activation_batch_id = p_activation_batch_id;

  UPDATE budget_activation_batches
  SET approved_line_count = v_approved_count,
      approved_total = v_approved_total,
      mapped_line_count = v_ready_count,
      unmapped_line_count = v_invalid_count,
      activation_total = v_activation_total,
      variance = v_approved_total - v_activation_total,
      status = CASE WHEN v_invalid_count = 0 AND v_approved_count > 0 THEN 'DRAFT_MAPPING' ELSE 'VALIDATION_FAILED' END,
      prepared_by = v_user_id,
      prepared_by_email = p_user_email,
      prepared_at = COALESCE(prepared_at, NOW()),
      validated_at = NOW(),
      submitted_for_activation_at = NULL,
      validation_snapshot = jsonb_build_object(
        'approved_line_count', v_approved_count,
        'mapped_line_count', v_ready_count,
        'unmapped_line_count', v_invalid_count,
        'approved_total', v_approved_total,
        'activation_total', v_activation_total,
        'variance', v_approved_total - v_activation_total,
        'validated_at', NOW()
      ),
      updated_at = NOW()
  WHERE id = p_activation_batch_id
  RETURNING * INTO v_out;

  PERFORM log_audit_event(
    v_user_id, p_user_email, COALESCE(v_user_name, p_user_email, 'System Administrator'),
    CASE WHEN v_invalid_count = 0 THEN 'BUDGET_ACTIVATION_VALIDATED' ELSE 'BUDGET_ACTIVATION_VALIDATION_FAILED' END,
    'BUDGET_ACTIVATION', p_activation_batch_id, v_out.submission_id::TEXT,
    NULL,
    jsonb_build_object('status', v_out.status),
    jsonb_build_object(
      'approved_line_count', v_approved_count,
      'mapped_line_count', v_ready_count,
      'unmapped_line_count', v_invalid_count,
      'approved_total', v_approved_total,
      'activation_total', v_activation_total,
      'variance', v_approved_total - v_activation_total
    ),
    NULL
  );

  RETURN v_out;
END;
$$;

-- -----------------------------------------------------------------------------
-- 10. System Administrator submits only a completely reconciled batch.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_submit_budget_activation(
  p_activation_batch_id UUID,
  p_user_email TEXT DEFAULT NULL
)
RETURNS budget_activation_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch budget_activation_batches;
  v_out budget_activation_batches;
  v_user_id UUID := fn_current_app_user_id();
  v_user_name TEXT;
BEGIN
  IF v_user_id IS NULL OR NOT public.njss_current_user_has_role('System Administrator') THEN
    RAISE EXCEPTION 'Only a System Administrator may submit operational budget activation.';
  END IF;

  SELECT COALESCE(full_name, email), email
  INTO v_user_name, p_user_email
  FROM users WHERE id = v_user_id;

  -- Revalidate immediately before submission.
  PERFORM public.njss_prepare_budget_activation(p_activation_batch_id, p_user_email);

  SELECT * INTO v_batch
  FROM budget_activation_batches
  WHERE id = p_activation_batch_id
  FOR UPDATE;

  IF v_batch.status <> 'DRAFT_MAPPING' THEN
    RAISE EXCEPTION 'Activation cannot be submitted until every Finance mapping is valid.';
  END IF;
  IF v_batch.approved_line_count <= 0
     OR v_batch.mapped_line_count <> v_batch.approved_line_count
     OR v_batch.unmapped_line_count <> 0
     OR ABS(v_batch.variance) > 0.009
     OR ABS(v_batch.approved_total - v_batch.activation_total) > 0.009 THEN
    RAISE EXCEPTION 'Activation totals or line counts do not reconcile to the approved budget.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM divisional_budget_submissions s
    WHERE s.id = v_batch.submission_id AND s.status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Approved budget changed after activation preparation.';
  END IF;

  UPDATE budget_activation_batches
  SET status = 'READY_FOR_ACTIVATION',
      submitted_for_activation_at = NOW(),
      updated_at = NOW()
  WHERE id = p_activation_batch_id
  RETURNING * INTO v_out;

  INSERT INTO notifications (
    user_id, notification_type, title, message, reference_type, reference_id,
    is_read, is_email_sent, priority
  )
  SELECT
    u.id,
    'BUDGET_ACTIVATION_READY',
    'Approved budget ready for activation',
    'A fully validated approved budget is ready for Registrar authorisation.',
    'BUDGET_ACTIVATION',
    p_activation_batch_id::TEXT,
    false,
    false,
    'HIGH'
  FROM users u
  JOIN user_roles ur ON ur.user_id = u.id
  JOIN roles r ON r.id = ur.role_id AND r.name = 'Registrar' AND r.is_active = true
  WHERE u.is_active = true
    AND NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = u.id
        AND n.notification_type = 'BUDGET_ACTIVATION_READY'
        AND n.reference_type = 'BUDGET_ACTIVATION'
        AND n.reference_id = p_activation_batch_id::TEXT
    );

  PERFORM log_audit_event(
    v_user_id, p_user_email, COALESCE(v_user_name, p_user_email, 'System Administrator'),
    'BUDGET_ACTIVATION_SUBMITTED', 'BUDGET_ACTIVATION', p_activation_batch_id, v_out.submission_id::TEXT,
    jsonb_build_object('status', 'DRAFT_MAPPING'),
    jsonb_build_object('status', 'READY_FOR_ACTIVATION'),
    jsonb_build_object(
      'approved_line_count', v_out.approved_line_count,
      'mapped_line_count', v_out.mapped_line_count,
      'approved_total', v_out.approved_total,
      'activation_total', v_out.activation_total,
      'variance', v_out.variance,
      'preparer', v_out.prepared_by_email
    ),
    NULL
  );

  RETURN v_out;
END;
$$;

-- -----------------------------------------------------------------------------
-- 11. Registrar-only atomic activation. Critical source/master data is checked
--     again inside the same transaction immediately before inserts.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_activate_approved_budget(
  p_activation_batch_id UUID,
  p_user_email TEXT DEFAULT NULL
)
RETURNS budget_activation_batches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_batch budget_activation_batches;
  v_out budget_activation_batches;
  v_user_id UUID := fn_current_app_user_id();
  v_user_name TEXT;
  v_source_count INTEGER := 0;
  v_snapshot_count INTEGER := 0;
  v_invalid_count INTEGER := 0;
  v_inserted_count INTEGER := 0;
  v_source_total NUMERIC(15,2) := 0;
  v_snapshot_total NUMERIC(15,2) := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Only a Registrar may authorise activation.';
  END IF;

  IF public.njss_current_user_has_role('System Administrator') THEN
    RAISE EXCEPTION 'System Administrator cannot authorise operational budget activation.';
  END IF;

  IF NOT public.njss_current_user_has_role('Registrar') THEN
    RAISE EXCEPTION 'Only a Registrar may authorise activation.';
  END IF;

  SELECT COALESCE(full_name, email), email
  INTO v_user_name, p_user_email
  FROM users WHERE id = v_user_id;

  SELECT * INTO v_batch
  FROM budget_activation_batches
  WHERE id = p_activation_batch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget activation batch not found.';
  END IF;
  IF v_batch.status = 'ACTIVATED' THEN
    RAISE EXCEPTION 'Approved budget has already been activated.';
  END IF;
  IF v_batch.status <> 'READY_FOR_ACTIVATION' THEN
    RAISE EXCEPTION 'Only a READY_FOR_ACTIVATION batch can be activated.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM divisional_budget_submissions s
    WHERE s.id = v_batch.submission_id AND s.status = 'APPROVED'
  ) THEN
    RAISE EXCEPTION 'Approved budget changed after activation preparation.';
  END IF;
  IF v_batch.prepared_by IS NULL OR NOT EXISTS (
    SELECT 1
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    WHERE u.id = v_batch.prepared_by
      AND u.is_active = true
      AND r.name = 'System Administrator'
      AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'Activation preparer must be an active System Administrator.';
  END IF;

  SELECT COUNT(*), COALESCE(SUM(l.annual_estimate),0)
  INTO v_source_count, v_source_total
  FROM divisional_budget_lines l
  WHERE l.submission_id = v_batch.submission_id;

  SELECT COUNT(*), COALESCE(SUM(al.approved_amount),0)
  INTO v_snapshot_count, v_snapshot_total
  FROM budget_activation_lines al
  WHERE al.activation_batch_id = p_activation_batch_id;

  IF v_source_count = 0
     OR v_source_count <> v_batch.approved_line_count
     OR v_snapshot_count <> v_batch.approved_line_count
     OR ABS(v_source_total - v_batch.approved_total) > 0.009
     OR ABS(v_snapshot_total - v_batch.approved_total) > 0.009
     OR v_batch.mapped_line_count <> v_batch.approved_line_count
     OR v_batch.unmapped_line_count <> 0
     OR ABS(v_batch.activation_total - v_batch.approved_total) > 0.009
     OR ABS(v_batch.variance) > 0.009 THEN
    RAISE EXCEPTION 'Activation total does not reconcile to approved total.';
  END IF;

  SELECT COUNT(*) INTO v_invalid_count
  FROM divisional_budget_lines l
  LEFT JOIN budget_activation_lines al
    ON al.activation_batch_id = p_activation_batch_id
   AND al.budget_line_id = l.id
  LEFT JOIN expense_ledger el ON el.id = l.expense_ledger_id
  LEFT JOIN expense_code_registry ecr ON ecr.id = el.expense_code_registry_id
  LEFT JOIN chart_of_accounts coa ON coa.id = ecr.chart_of_account_id
  LEFT JOIN departments dep ON dep.id = ecr.department_id
  LEFT JOIN sections sec ON sec.id = ecr.section_id AND sec.is_active = true
  LEFT JOIN cost_centres cc ON cc.id = ecr.cost_centre_id
  LEFT JOIN LATERAL (
    SELECT MAX(bma.updated_at) AS max_updated_at
    FROM budget_monthly_allocations bma
    WHERE bma.budget_line_id = l.id
  ) monthly ON true
  WHERE l.submission_id = v_batch.submission_id
    AND (
      al.id IS NULL
      OR al.mapping_status <> 'READY'
      OR al.expense_ledger_id IS DISTINCT FROM l.expense_ledger_id
      OR al.expense_code_registry_id IS DISTINCT FROM ecr.id
      OR al.chart_of_account_id IS DISTINCT FROM coa.id
      OR al.department_id IS DISTINCT FROM ecr.department_id
      OR al.section_id IS DISTINCT FROM ecr.section_id
      OR al.cost_centre_id IS DISTINCT FROM ecr.cost_centre_id
      OR ABS(COALESCE(al.approved_amount,0) - COALESCE(l.annual_estimate,0)) > 0.009
      OR al.source_line_updated_at IS DISTINCT FROM l.updated_at
      OR al.source_monthly_updated_at IS DISTINCT FROM monthly.max_updated_at
      OR el.id IS NULL OR el.is_active IS DISTINCT FROM true OR el.is_posting IS DISTINCT FROM true
      OR ecr.id IS NULL OR ecr.is_active IS DISTINCT FROM true OR ecr.expense_ledger_id IS DISTINCT FROM el.id
      OR (SELECT COUNT(*) FROM expense_code_registry ecr2 WHERE ecr2.expense_ledger_id = el.id AND ecr2.is_active = true) <> 1
      OR coa.id IS NULL OR coa.is_active IS DISTINCT FROM true
      OR dep.id IS NULL OR dep.is_active IS DISTINCT FROM true
      OR cc.id IS NULL OR cc.is_active IS DISTINCT FROM true OR cc.department_id IS DISTINCT FROM dep.id
      OR (ecr.section_id IS NOT NULL AND sec.id IS NULL)
      OR (ecr.section_id IS NOT NULL AND cc.section_id IS NOT NULL AND cc.section_id IS DISTINCT FROM ecr.section_id)
      OR ABS(COALESCE(l.allocation_variance,0)) > 0.009
      OR ABS(COALESCE(l.monthly_allocation_total,0) - COALESCE(l.annual_estimate,0)) > 0.009
      OR EXISTS (
        SELECT 1 FROM budget_allocations ba
        WHERE ba.source_budget_line_id = l.id AND ba.is_active = true
      )
    );

  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Approved budget or Finance mapping changed after activation preparation. Revalidate before activation.';
  END IF;

  INSERT INTO budget_allocations (
    financial_year,
    department_id,
    section_id,
    cost_centre_id,
    project_id,
    funding_source_id,
    account_id,
    expense_code_registry_id,
    source_budget_submission_id,
    source_budget_line_id,
    budget_division_id,
    source_module,
    annual_plan_line_id,
    original_budget,
    supplemental_budget,
    monthly_cashflow,
    q1_planned,
    q2_planned,
    q3_planned,
    q4_planned,
    is_active,
    created_by,
    updated_at
  )
  SELECT
    s.budget_year,
    al.department_id,
    al.section_id,
    al.cost_centre_id,
    NULL,
    l.funding_source_id,
    al.chart_of_account_id,
    al.expense_code_registry_id,
    s.id,
    l.id,
    s.division_id,
    'EXCEL_BUDGET',
    NULL,
    l.annual_estimate,
    0,
    jsonb_build_object(
      'january', COALESCE(m.january,0),
      'february', COALESCE(m.february,0),
      'march', COALESCE(m.march,0),
      'april', COALESCE(m.april,0),
      'may', COALESCE(m.may,0),
      'june', COALESCE(m.june,0),
      'july', COALESCE(m.july,0),
      'august', COALESCE(m.august,0),
      'september', COALESCE(m.september,0),
      'october', COALESCE(m.october,0),
      'november', COALESCE(m.november,0),
      'december', COALESCE(m.december,0)
    ),
    COALESCE(m.january,0) + COALESCE(m.february,0) + COALESCE(m.march,0),
    COALESCE(m.april,0) + COALESCE(m.may,0) + COALESCE(m.june,0),
    COALESCE(m.july,0) + COALESCE(m.august,0) + COALESCE(m.september,0),
    COALESCE(m.october,0) + COALESCE(m.november,0) + COALESCE(m.december,0),
    true,
    v_user_id,
    NOW()
  FROM budget_activation_lines al
  JOIN divisional_budget_lines l ON l.id = al.budget_line_id
  JOIN divisional_budget_submissions s ON s.id = l.submission_id
  LEFT JOIN LATERAL (
    SELECT
      SUM(amount) FILTER (WHERE month_number = 1) AS january,
      SUM(amount) FILTER (WHERE month_number = 2) AS february,
      SUM(amount) FILTER (WHERE month_number = 3) AS march,
      SUM(amount) FILTER (WHERE month_number = 4) AS april,
      SUM(amount) FILTER (WHERE month_number = 5) AS may,
      SUM(amount) FILTER (WHERE month_number = 6) AS june,
      SUM(amount) FILTER (WHERE month_number = 7) AS july,
      SUM(amount) FILTER (WHERE month_number = 8) AS august,
      SUM(amount) FILTER (WHERE month_number = 9) AS september,
      SUM(amount) FILTER (WHERE month_number = 10) AS october,
      SUM(amount) FILTER (WHERE month_number = 11) AS november,
      SUM(amount) FILTER (WHERE month_number = 12) AS december
    FROM budget_monthly_allocations bma
    WHERE bma.budget_line_id = l.id
  ) m ON true
  WHERE al.activation_batch_id = p_activation_batch_id
    AND al.mapping_status = 'READY';

  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  IF v_inserted_count <> v_batch.approved_line_count THEN
    RAISE EXCEPTION 'Atomic activation failed: expected % allocations but created %.', v_batch.approved_line_count, v_inserted_count;
  END IF;

  UPDATE budget_activation_batches
  SET status = 'ACTIVATED',
      authorised_by = v_user_id,
      authorised_by_email = p_user_email,
      authorised_at = NOW(),
      activated_at = NOW(),
      activation_total = approved_total,
      variance = 0,
      validation_snapshot = validation_snapshot || jsonb_build_object(
        'authorised_by', p_user_email,
        'authorised_at', NOW(),
        'activated_line_count', v_inserted_count,
        'activated_total', approved_total
      ),
      updated_at = NOW()
  WHERE id = p_activation_batch_id
  RETURNING * INTO v_out;

  PERFORM log_audit_event(
    v_user_id, p_user_email, COALESCE(v_user_name, p_user_email, 'Registrar'),
    'BUDGET_ACTIVATED', 'BUDGET_ACTIVATION', p_activation_batch_id, v_out.submission_id::TEXT,
    jsonb_build_object('status', 'READY_FOR_ACTIVATION'),
    jsonb_build_object('status', 'ACTIVATED'),
    jsonb_build_object(
      'approved_line_count', v_out.approved_line_count,
      'activated_line_count', v_inserted_count,
      'approved_total', v_out.approved_total,
      'activation_total', v_out.activation_total,
      'variance', v_out.variance,
      'preparer', v_out.prepared_by_email,
      'registrar_authoriser', v_out.authorised_by_email
    ),
    NULL
  );

  -- Notify the recorded preparer after successful activation.
  IF v_out.prepared_by IS NOT NULL THEN
    INSERT INTO notifications (
      user_id, notification_type, title, message, reference_type, reference_id,
      is_read, is_email_sent, priority
    )
    SELECT
      v_out.prepared_by,
      'BUDGET_ACTIVATED',
      'Approved budget activated',
      'Registrar authorisation is complete and the approved budget is now operational for FF3/FF4 and revision controls.',
      'BUDGET_ACTIVATION',
      p_activation_batch_id::TEXT,
      false,
      false,
      'HIGH'
    WHERE NOT EXISTS (
      SELECT 1 FROM notifications n
      WHERE n.user_id = v_out.prepared_by
        AND n.notification_type = 'BUDGET_ACTIVATED'
        AND n.reference_type = 'BUDGET_ACTIVATION'
        AND n.reference_id = p_activation_batch_id::TEXT
    );
  END IF;

  RETURN v_out;
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. Read-only work queue for the UI.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_budget_activation_queue
WITH (security_invoker = true)
AS
SELECT
  bab.*,
  s.submission_number,
  s.status AS submission_status,
  s.approved_at,
  bd.code AS division_code,
  bd.name AS division_name,
  d.code AS department_code,
  d.name AS department_name,
  prep.full_name AS prepared_by_name,
  auth.full_name AS authorised_by_name
FROM budget_activation_batches bab
JOIN divisional_budget_submissions s ON s.id = bab.submission_id
LEFT JOIN budget_divisions bd ON bd.id = bab.budget_division_id
LEFT JOIN departments d ON d.id = bab.department_id
LEFT JOIN users prep ON prep.id = bab.prepared_by
LEFT JOIN users auth ON auth.id = bab.authorised_by;

-- -----------------------------------------------------------------------------
-- 13. RLS: authenticated users may read only when they are one of the two
--     controlled activation roles. All mutation is through secured RPCs.
-- -----------------------------------------------------------------------------
ALTER TABLE budget_activation_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_activation_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budget_activation_batches_select_controlled_roles ON budget_activation_batches;
CREATE POLICY budget_activation_batches_select_controlled_roles
ON budget_activation_batches
FOR SELECT TO authenticated
USING (
  public.njss_current_user_has_role('System Administrator')
  OR public.njss_current_user_has_role('Registrar')
);

DROP POLICY IF EXISTS budget_activation_lines_select_controlled_roles ON budget_activation_lines;
CREATE POLICY budget_activation_lines_select_controlled_roles
ON budget_activation_lines
FOR SELECT TO authenticated
USING (
  public.njss_current_user_has_role('System Administrator')
  OR public.njss_current_user_has_role('Registrar')
);

REVOKE INSERT, UPDATE, DELETE ON budget_activation_batches FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON budget_activation_lines FROM authenticated;
GRANT SELECT ON budget_activation_batches, budget_activation_lines TO authenticated;
GRANT SELECT ON public.v_budget_activation_queue TO authenticated;

REVOKE ALL ON FUNCTION public.njss_prepare_budget_activation(UUID,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.njss_submit_budget_activation(UUID,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.njss_activate_approved_budget(UUID,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_prepare_budget_activation(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.njss_submit_budget_activation(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.njss_activate_approved_budget(UUID,TEXT) TO authenticated;

COMMIT;
