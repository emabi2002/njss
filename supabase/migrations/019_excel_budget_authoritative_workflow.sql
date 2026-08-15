-- =====================================================
-- NJSS EXCEL BUDGET AUTHORITATIVE WORKFLOW
-- Makes Budget Preparation the single source for approved allocations while
-- preserving historical annual plans as read-only data.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Retire legacy Annual Plan menu/workflow from active navigation/RBAC.
-- ---------------------------------------------------------------------
UPDATE menu_items
SET is_active = false, updated_at = NOW()
WHERE code = 'budget.plans';

UPDATE permissions
SET is_active = false
WHERE code IN (
  'plans.create', 'plans.submit', 'plans.review', 'plans.approve',
  'plans.authorize', 'plans.confirm', 'budget.confirm'
);

UPDATE menu_items
SET label = 'Budget Control', sort_order = 20, updated_at = NOW()
WHERE code = 'budget.control';

UPDATE menu_items
SET label = 'Budget Preparation', sort_order = 10, updated_at = NOW()
WHERE code = 'budget.template';

UPDATE menu_items
SET label = 'Ledger Items', sort_order = 30, updated_at = NOW()
WHERE code = 'system.master';

UPDATE menu_items
SET label = 'Budget Reports', module_code = 'budget', sort_order = 40, updated_at = NOW()
WHERE code = 'reports.library';

-- Align permission names with the Excel-template workflow.
INSERT INTO permissions (code, module_code, menu_code, action, label, description, is_active) VALUES
  ('budget.template.view','budget','budget.template','view','View budget preparation','Access the Excel-style Budget Preparation workspace',true),
  ('budget.template.create','budget','budget.template','create','Create budget preparation drafts','Create Excel-style divisional budget drafts',true),
  ('budget.template.edit','budget','budget.template','edit','Edit budget preparation drafts','Edit Excel-style divisional budget drafts',true),
  ('budget.template.submit','budget','budget.template','submit','Submit budget preparation','Submit Excel-style divisional budgets for review',true),
  ('budget.template.review','budget','budget.template','verify','Review budget preparation','Review or return submitted divisional budgets',true),
  ('budget.template.approve','budget','budget.template','approve','Approve budget preparation','Approve reviewed divisional budgets and create operational allocations',true),
  ('budget.consolidate','budget','budget.control','manage','Consolidate approved Excel budgets','Roll up approved divisional budgets by department and finance code',true),
  ('budget.report.view','budget','reports.library','view','View budget reports','View budget control and preparation reports',true),
  ('budget.report.export','budget','reports.library','export','Export budget reports','Export budget reports to PDF, Excel, CSV or print',true)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  menu_code = EXCLUDED.menu_code,
  action = EXCLUDED.action,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active = true;

UPDATE menu_items
SET required_permissions = ARRAY['budget.template.view','budget.template.create','budget.template.edit','budget.template.submit','budget.template.review','budget.template.approve','budget.template']
WHERE code = 'budget.template';

UPDATE menu_items
SET required_permissions = ARRAY['budget.view','budget.module.view']
WHERE code = 'budget.control';

UPDATE menu_items
SET required_permissions = ARRAY['budget.report.view','budget.report.export','reports.view','reports.export']
WHERE code = 'reports.library';

-- Keep existing users working while new permission names are adopted.
INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT rp.role_id, mapped.permission, true
FROM role_permissions rp
CROSS JOIN LATERAL (
  VALUES
    ('budget.template', 'budget.template.view'),
    ('budget.template.submit', 'budget.template.create'),
    ('budget.template.submit', 'budget.template.edit'),
    ('budget.template.submit', 'budget.template.submit'),
    ('budget.template.review', 'budget.template.review'),
    ('budget.template.approve', 'budget.template.approve'),
    ('consolidation.run', 'budget.consolidate'),
    ('reports.view', 'budget.report.view'),
    ('reports.export', 'budget.report.export')
) AS mapped(source_permission, permission)
WHERE rp.permission = mapped.source_permission AND rp.is_allowed = true
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

-- ---------------------------------------------------------------------
-- 2. Canonical finance-code mapping for Excel ledger -> operational code.
-- ---------------------------------------------------------------------
ALTER TABLE expense_ledger
  ADD COLUMN IF NOT EXISTS expense_code_registry_id UUID REFERENCES expense_code_registry(id);

ALTER TABLE expense_code_registry
  ADD COLUMN IF NOT EXISTS expense_ledger_id UUID REFERENCES expense_ledger(id);

-- Preserve source traceability and monthly cash-flow on operational allocations.
ALTER TABLE budget_allocations
  ADD COLUMN IF NOT EXISTS source_budget_submission_id UUID REFERENCES divisional_budget_submissions(id),
  ADD COLUMN IF NOT EXISTS source_budget_line_id UUID REFERENCES divisional_budget_lines(id),
  ADD COLUMN IF NOT EXISTS budget_division_id UUID REFERENCES budget_divisions(id),
  ADD COLUMN IF NOT EXISTS source_module VARCHAR(40) DEFAULT 'ANNUAL_PLAN',
  ADD COLUMN IF NOT EXISTS monthly_cashflow JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS q1_planned DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS q2_planned DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS q3_planned DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS q4_planned DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_allocations_source_budget_line
ON budget_allocations(source_budget_line_id)
WHERE source_budget_line_id IS NOT NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_budget_allocations_source_submission
ON budget_allocations(source_budget_submission_id);

CREATE INDEX IF NOT EXISTS idx_budget_allocations_budget_division
ON budget_allocations(budget_division_id);

-- Ensure ledger-backed operational codes retain the Excel finance code instead of being
-- overwritten by the older hierarchy-only generator.
CREATE OR REPLACE FUNCTION generate_full_expense_code() RETURNS TRIGGER AS $$
DECLARE
    v_dept TEXT; v_cc TEXT; v_cat TEXT; v_item TEXT;
BEGIN
    IF NEW.expense_ledger_id IS NOT NULL
       AND COALESCE(NULLIF(NEW.full_expense_code, ''), 'PENDING') <> 'PENDING' THEN
        NEW.updated_at := NOW();
        RETURN NEW;
    END IF;

    SELECT code INTO v_dept FROM departments WHERE id = NEW.department_id;
    SELECT code INTO v_cc   FROM cost_centres WHERE id = NEW.cost_centre_id;
    SELECT code INTO v_cat  FROM expense_categories WHERE id = NEW.expense_category_id;
    SELECT code INTO v_item FROM expense_items WHERE id = NEW.expense_item_id;
    NEW.full_expense_code :=
        UPPER(COALESCE(v_dept, 'NJSS')) || '-' ||
        UPPER(COALESCE(v_cc,  'GEN'))  || '-' ||
        UPPER(COALESCE(v_cat, 'GEN'))  || '-' ||
        UPPER(COALESCE(v_item,'GEN'));
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure every active posting ledger has one operational code record.
INSERT INTO expense_code_registry (
  financial_year, department_id, section_id, cost_centre_id,
  expense_category_id, expense_item_id, full_expense_code, description,
  is_active, expense_ledger_id
)
SELECT
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  el.finance_code,
  el.standard_description,
  true,
  el.id
FROM expense_ledger el
WHERE el.is_active = true AND el.is_posting = true
ON CONFLICT (full_expense_code) DO UPDATE SET
  description = COALESCE(expense_code_registry.description, EXCLUDED.description),
  is_active = true,
  expense_ledger_id = COALESCE(expense_code_registry.expense_ledger_id, EXCLUDED.expense_ledger_id),
  updated_at = NOW();

UPDATE expense_ledger el
SET expense_code_registry_id = ecr.id
FROM expense_code_registry ecr
WHERE (ecr.expense_ledger_id = el.id OR ecr.full_expense_code = el.finance_code)
  AND el.expense_code_registry_id IS DISTINCT FROM ecr.id;

UPDATE expense_code_registry ecr
SET expense_ledger_id = el.id
FROM expense_ledger el
WHERE ecr.full_expense_code = el.finance_code
  AND ecr.expense_ledger_id IS NULL;

-- ---------------------------------------------------------------------
-- 3. Validation and allocation creation for approved Excel submissions.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_divisional_budget_submission(p_submission_id UUID)
RETURNS VOID AS $$
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
           WHEN el.expense_code_registry_id IS NULL THEN 'Finance Code is not mapped to an operational expense code'
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
      ABS(COALESCE(l.allocation_variance, 0)) > 0.009 OR
      el.expense_code_registry_id IS NULL
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION create_operational_allocations_from_divisional_budget(
  p_submission_id UUID,
  p_user_email TEXT DEFAULT NULL
) RETURNS INTEGER AS $$
DECLARE
  v_created INTEGER := 0;
  v_fallback_account UUID;
BEGIN
  PERFORM validate_divisional_budget_submission(p_submission_id);

  SELECT id INTO v_fallback_account
  FROM chart_of_accounts
  WHERE is_active = true
  ORDER BY account_code
  LIMIT 1;

  IF v_fallback_account IS NULL THEN
    RAISE EXCEPTION 'No active chart of accounts record is available for budget allocation posting';
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
    COALESCE(s.department_id, d.department_id),
    d.section_id,
    cc.id,
    NULL,
    l.funding_source_id,
    v_fallback_account,
    el.expense_code_registry_id,
    s.id,
    l.id,
    d.id,
    'EXCEL_BUDGET',
    NULL,
    l.annual_estimate,
    0,
    jsonb_build_object(
      'january', COALESCE(m.january, 0),
      'february', COALESCE(m.february, 0),
      'march', COALESCE(m.march, 0),
      'april', COALESCE(m.april, 0),
      'may', COALESCE(m.may, 0),
      'june', COALESCE(m.june, 0),
      'july', COALESCE(m.july, 0),
      'august', COALESCE(m.august, 0),
      'september', COALESCE(m.september, 0),
      'october', COALESCE(m.october, 0),
      'november', COALESCE(m.november, 0),
      'december', COALESCE(m.december, 0)
    ),
    COALESCE(m.january, 0) + COALESCE(m.february, 0) + COALESCE(m.march, 0),
    COALESCE(m.april, 0) + COALESCE(m.may, 0) + COALESCE(m.june, 0),
    COALESCE(m.july, 0) + COALESCE(m.august, 0) + COALESCE(m.september, 0),
    COALESCE(m.october, 0) + COALESCE(m.november, 0) + COALESCE(m.december, 0),
    true,
    s.approved_by,
    NOW()
  FROM divisional_budget_lines l
  JOIN divisional_budget_submissions s ON s.id = l.submission_id
  JOIN budget_divisions d ON d.id = s.division_id
  JOIN expense_ledger el ON el.id = l.expense_ledger_id
  LEFT JOIN cost_centres cc ON cc.code = d.cost_centre_code OR cc.name = d.cost_centre_name
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
  WHERE l.submission_id = p_submission_id
  ON CONFLICT (source_budget_line_id) WHERE source_budget_line_id IS NOT NULL AND is_active = true
  DO UPDATE SET
    financial_year = EXCLUDED.financial_year,
    department_id = EXCLUDED.department_id,
    section_id = EXCLUDED.section_id,
    cost_centre_id = EXCLUDED.cost_centre_id,
    funding_source_id = EXCLUDED.funding_source_id,
    expense_code_registry_id = EXCLUDED.expense_code_registry_id,
    budget_division_id = EXCLUDED.budget_division_id,
    source_module = 'EXCEL_BUDGET',
    original_budget = EXCLUDED.original_budget,
    supplemental_budget = 0,
    monthly_cashflow = EXCLUDED.monthly_cashflow,
    q1_planned = EXCLUDED.q1_planned,
    q2_planned = EXCLUDED.q2_planned,
    q3_planned = EXCLUDED.q3_planned,
    q4_planned = EXCLUDED.q4_planned,
    is_active = true,
    updated_at = NOW();

  GET DIAGNOSTICS v_created = ROW_COUNT;

  PERFORM log_audit_event(NULL, p_user_email, COALESCE(p_user_email, 'System'), 'OPERATIONAL_ALLOCATION_CREATED', 'BUDGET_SUBMISSION', p_submission_id, NULL,
    NULL, jsonb_build_object('processed_allocations', v_created), jsonb_build_object('source', 'EXCEL_BUDGET'), NULL);

  RETURN v_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Replace workflow RPC so submit/review/approval rules and allocation creation
-- are enforced server-side.
DROP FUNCTION IF EXISTS transition_divisional_budget_submission(UUID, VARCHAR, TEXT, VARCHAR);
DROP FUNCTION IF EXISTS transition_divisional_budget_submission(UUID, TEXT, TEXT, TEXT);

CREATE FUNCTION transition_divisional_budget_submission(
    p_submission_id UUID,
    p_action TEXT,
    p_comments TEXT DEFAULT NULL,
    p_user_email TEXT DEFAULT NULL
) RETURNS divisional_budget_submissions AS $$
DECLARE
    v_old divisional_budget_submissions;
    v_new_status VARCHAR(40);
    v_out divisional_budget_submissions;
    v_allocation_count INTEGER := 0;
BEGIN
    SELECT * INTO v_old FROM divisional_budget_submissions WHERE id = p_submission_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Budget submission not found';
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

    IF UPPER(p_action) IN ('SUBMIT', 'RESUBMIT', 'APPROVE') THEN
        PERFORM validate_divisional_budget_submission(p_submission_id);
        SELECT * INTO v_old FROM divisional_budget_submissions WHERE id = p_submission_id FOR UPDATE;
    END IF;

    PERFORM set_config('njss.budget_workflow', 'on', true);

    UPDATE divisional_budget_submissions
    SET status = v_new_status,
        validation_status = CASE WHEN ABS(COALESCE(unallocated_variance, 0)) <= 0.009 THEN 'VALID' ELSE 'VARIANCE' END,
        is_locked = v_new_status IN ('SUBMITTED', 'RESUBMITTED', 'REVIEWED', 'APPROVED', 'ARCHIVED'),
        submitted_at = CASE WHEN UPPER(p_action) IN ('SUBMIT', 'RESUBMIT') THEN NOW() ELSE submitted_at END,
        reviewed_at = CASE WHEN UPPER(p_action) = 'REVIEW' THEN NOW() ELSE reviewed_at END,
        approved_at = CASE WHEN UPPER(p_action) = 'APPROVE' THEN NOW() ELSE approved_at END,
        rejected_at = CASE WHEN UPPER(p_action) = 'REJECT' THEN NOW() ELSE rejected_at END,
        return_reason = CASE WHEN UPPER(p_action) = 'RETURN' THEN p_comments ELSE return_reason END,
        approval_comments = CASE WHEN UPPER(p_action) IN ('REVIEW', 'APPROVE', 'REJECT') THEN p_comments ELSE approval_comments END,
        updated_at = NOW()
    WHERE id = p_submission_id
    RETURNING * INTO v_out;

    IF UPPER(p_action) = 'APPROVE' THEN
        v_allocation_count := create_operational_allocations_from_divisional_budget(p_submission_id, p_user_email);
    END IF;

    INSERT INTO budget_workflow_history (submission_id, from_status, to_status, action, comments, changed_by_email)
    VALUES (p_submission_id, v_old.status, v_new_status, UPPER(p_action), p_comments, p_user_email);

    PERFORM log_audit_event(NULL, p_user_email, COALESCE(p_user_email, 'System'), 'BUDGET_' || UPPER(p_action), 'BUDGET_SUBMISSION', p_submission_id, v_out.submission_number,
        jsonb_build_object('status', v_old.status), jsonb_build_object('status', v_new_status),
        jsonb_build_object('old_status', v_old.status, 'new_status', v_new_status, 'operational_allocations', v_allocation_count), NULL);

    RETURN v_out;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION validate_divisional_budget_submission(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_operational_allocations_from_divisional_budget(UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION transition_divisional_budget_submission(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Budget control/reporting views now read approved Excel allocations.
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_budget_by_code CASCADE;
CREATE VIEW v_budget_by_code AS
SELECT
    ba.financial_year,
    ba.department_id,
    d.name AS department_name,
    ba.section_id,
    s.name AS section_name,
    ba.cost_centre_id,
    cc.code AS cost_centre_code,
    cc.name AS cost_centre_name,
    ba.expense_code_registry_id,
    COALESCE(ecr.full_expense_code, el.finance_code) AS full_expense_code,
    el.finance_code,
    el.standard_description AS expense_description,
    ba.budget_division_id,
    bd.code AS division_code,
    bd.name AS division_name,
    SUM(ba.revised_budget) AS revised_budget,
    SUM(COALESCE(ba.q1_planned, 0)) AS q1_planned,
    SUM(COALESCE(ba.q2_planned, 0)) AS q2_planned,
    SUM(COALESCE(ba.q3_planned, 0)) AS q3_planned,
    SUM(COALESCE(ba.q4_planned, 0)) AS q4_planned,
    COALESCE(SUM((SELECT SUM(qr.released_amount) FROM quarterly_releases qr
                  WHERE qr.budget_allocation_id = ba.id)), 0) AS released_amount,
    COALESCE(SUM((SELECT SUM(c.committed_amount - COALESCE(c.paid_amount,0)) FROM ff3_commitments c
                  WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID'))), 0) AS committed_amount,
    COALESCE(SUM((SELECT SUM(c.paid_amount) FROM ff3_commitments c
                  WHERE c.budget_allocation_id = ba.id)), 0) AS actual_expenditure
FROM budget_allocations ba
LEFT JOIN departments d ON d.id = ba.department_id
LEFT JOIN sections s ON s.id = ba.section_id
LEFT JOIN cost_centres cc ON cc.id = ba.cost_centre_id
LEFT JOIN expense_code_registry ecr ON ecr.id = ba.expense_code_registry_id
LEFT JOIN expense_ledger el ON el.id = COALESCE(ecr.expense_ledger_id, (SELECT id FROM expense_ledger WHERE expense_code_registry_id = ecr.id LIMIT 1))
LEFT JOIN budget_divisions bd ON bd.id = ba.budget_division_id
WHERE ba.is_active = true
GROUP BY ba.financial_year, ba.department_id, d.name, ba.section_id, s.name,
         ba.cost_centre_id, cc.code, cc.name, ba.expense_code_registry_id,
         ecr.full_expense_code, el.finance_code, el.standard_description,
         ba.budget_division_id, bd.code, bd.name;

CREATE OR REPLACE VIEW v_releases_by_code AS
SELECT
    qr.id,
    qr.financial_year,
    qr.quarter,
    qr.release_number,
    qr.release_date,
    qr.released_amount,
    ba.id AS budget_allocation_id,
    ba.revised_budget,
    ba.q1_planned,
    ba.q2_planned,
    ba.q3_planned,
    ba.q4_planned,
    d.name AS department_name,
    cc.code AS cost_centre_code,
    cc.name AS cost_centre_name,
    COALESCE(ecr.full_expense_code, el.finance_code) AS full_expense_code,
    bd.name AS division_name
FROM quarterly_releases qr
JOIN budget_allocations ba ON ba.id = qr.budget_allocation_id
LEFT JOIN departments d ON d.id = ba.department_id
LEFT JOIN cost_centres cc ON cc.id = ba.cost_centre_id
LEFT JOIN expense_code_registry ecr ON ecr.id = ba.expense_code_registry_id
LEFT JOIN expense_ledger el ON el.id = COALESCE(ecr.expense_ledger_id, (SELECT id FROM expense_ledger WHERE expense_code_registry_id = ecr.id LIMIT 1))
LEFT JOIN budget_divisions bd ON bd.id = ba.budget_division_id;

DROP VIEW IF EXISTS v_department_consolidated_budget CASCADE;
CREATE VIEW v_department_consolidated_budget AS
SELECT
    s.budget_year,
    s.department_id,
    dep.code AS department_code,
    dep.name AS department_name,
    d.id AS division_id,
    d.code AS division_code,
    d.name AS division_name,
    d.cost_centre_code,
    d.cost_centre_name,
    el.id AS expense_ledger_id,
    el.finance_code,
    el.ledger_number,
    el.standard_description,
    el.budget_class,
    el.expense_category,
    SUM(l.annual_estimate) AS proposed_budget,
    SUM(l.monthly_allocation_total) AS monthly_allocation,
    SUM(l.allocation_variance) AS allocation_variance,
    COUNT(l.id) AS line_count
FROM divisional_budget_submissions s
JOIN budget_divisions d ON d.id = s.division_id
LEFT JOIN departments dep ON dep.id = s.department_id
JOIN divisional_budget_lines l ON l.submission_id = s.id
LEFT JOIN expense_ledger el ON el.id = l.expense_ledger_id
WHERE s.status = 'APPROVED'
GROUP BY s.budget_year, s.department_id, dep.code, dep.name, d.id, d.code, d.name, d.cost_centre_code, d.cost_centre_name,
         el.id, el.finance_code, el.ledger_number, el.standard_description, el.budget_class, el.expense_category;

DROP VIEW IF EXISTS v_department_consolidated_budget_monthly CASCADE;
CREATE VIEW v_department_consolidated_budget_monthly AS
SELECT
    s.budget_year,
    s.department_id,
    dep.code AS department_code,
    dep.name AS department_name,
    d.id AS division_id,
    d.code AS division_code,
    d.name AS division_name,
    el.id AS expense_ledger_id,
    el.finance_code,
    el.ledger_number,
    el.standard_description,
    el.budget_class,
    el.expense_category,
    m.month_number,
    m.month_name,
    SUM(m.amount) AS monthly_amount
FROM budget_monthly_allocations m
JOIN divisional_budget_lines l ON l.id = m.budget_line_id
JOIN divisional_budget_submissions s ON s.id = l.submission_id
JOIN budget_divisions d ON d.id = s.division_id
LEFT JOIN departments dep ON dep.id = s.department_id
LEFT JOIN expense_ledger el ON el.id = l.expense_ledger_id
WHERE s.status = 'APPROVED'
GROUP BY s.budget_year, s.department_id, dep.code, dep.name, d.id, d.code, d.name,
         el.id, el.finance_code, el.ledger_number, el.standard_description, el.budget_class, el.expense_category,
         m.month_number, m.month_name;

GRANT SELECT ON v_budget_by_code TO anon, authenticated;
GRANT SELECT ON v_releases_by_code TO anon, authenticated;
GRANT SELECT ON v_department_consolidated_budget TO anon, authenticated;
GRANT SELECT ON v_department_consolidated_budget_monthly TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Approved Excel budget consolidation roll-up.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION consolidate_approved_excel_budgets(
  p_financial_year INTEGER,
  p_department_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
) RETURNS budget_consolidations AS $$
DECLARE
  v_out budget_consolidations;
BEGIN
  INSERT INTO budget_consolidations (
    financial_year,
    department_id,
    status,
    total_amount,
    section_count,
    plan_count,
    consolidated_by,
    consolidated_at
  )
  SELECT
    p_financial_year,
    p_department_id,
    'CONSOLIDATED',
    COALESCE(SUM(total_proposed_budget), 0),
    COUNT(DISTINCT division_id),
    COUNT(*),
    p_user_id,
    NOW()
  FROM divisional_budget_submissions
  WHERE budget_year = p_financial_year
    AND status = 'APPROVED'
    AND (p_department_id IS NULL OR department_id = p_department_id)
  ON CONFLICT (financial_year, department_id) DO UPDATE SET
    status = EXCLUDED.status,
    total_amount = EXCLUDED.total_amount,
    section_count = EXCLUDED.section_count,
    plan_count = EXCLUDED.plan_count,
    consolidated_by = EXCLUDED.consolidated_by,
    consolidated_at = EXCLUDED.consolidated_at
  RETURNING * INTO v_out;

  PERFORM log_audit_event(p_user_id, NULL, 'System', 'BUDGET_CONSOLIDATED', 'BUDGET_CONSOLIDATION', v_out.id, NULL,
    NULL, to_jsonb(v_out), jsonb_build_object('source', 'APPROVED_EXCEL_DIVISIONAL_BUDGETS'), NULL);

  RETURN v_out;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION consolidate_approved_excel_budgets(INTEGER, UUID, UUID) TO anon, authenticated;
