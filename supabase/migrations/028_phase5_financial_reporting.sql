-- NJSS PHASE 5 — Financial Reporting & Management Monitoring
-- Additive reporting and management-information layer only.
-- Does not alter Phase 1–4 transaction workflows or introduce new transaction engines.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Reporting permissions, navigation, and catalogue metadata
-- -----------------------------------------------------------------------------

INSERT INTO modules (code, name, description, base_path, icon, sort_order, is_active) VALUES
  ('reports', 'Reports', 'Management, finance and audit reporting', '/dashboard/reports', 'BarChart3', 40, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  base_path = EXCLUDED.base_path,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = NOW();

INSERT INTO menu_items (code, module_code, parent_code, label, href, icon, sort_order, required_permissions, is_active) VALUES
  ('reports.library', 'reports', NULL, 'Management Reports', '/dashboard/reports', 'BarChart3', 80, ARRAY['reports.view','reports.export','budget.report.view','budget.report.export'], true)
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
  ('reports.view', 'reports', 'reports.library', 'view', 'View reports', 'View management, financial and monitoring reports', true),
  ('reports.export', 'reports', 'reports.library', 'export', 'Export reports', 'Export reports to PDF, Excel, CSV or print', true),
  ('budget.report.view', 'reports', 'reports.library', 'view', 'View financial reports', 'View authoritative budget, funding, commitment and expenditure reports', true),
  ('budget.report.export', 'reports', 'reports.library', 'export', 'Export financial reports', 'Export authoritative budget, funding, commitment and expenditure reports', true)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  menu_code = EXCLUDED.menu_code,
  action = EXCLUDED.action,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active = true;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.code, true
FROM roles r
JOIN permissions p ON p.code IN ('reports.view','reports.export','budget.report.view','budget.report.export')
WHERE r.name IN ('Budget Officer','Budget Manager','Finance Officer','Finance Manager','Executive Management','Auditor','System Administrator')
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

CREATE TABLE IF NOT EXISTS report_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(120) UNIQUE NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE report_categories
  ADD COLUMN IF NOT EXISTS code VARCHAR(120),
  ADD COLUMN IF NOT EXISTS name VARCHAR(160),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS ux_report_categories_code ON report_categories(code);

CREATE TABLE IF NOT EXISTS report_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_code VARCHAR(160) UNIQUE NOT NULL,
  report_name VARCHAR(200) NOT NULL,
  description TEXT,
  category_id UUID REFERENCES report_categories(id) ON DELETE CASCADE,
  handler_key VARCHAR(160),
  sort_order INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  allowed_export_formats TEXT[] DEFAULT ARRAY['pdf','excel','csv','print'],
  required_permission VARCHAR(120) DEFAULT 'reports.view' REFERENCES permissions(code) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE report_definitions
  ADD COLUMN IF NOT EXISTS report_code VARCHAR(160),
  ADD COLUMN IF NOT EXISTS report_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES report_categories(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS handler_key VARCHAR(160),
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS allowed_export_formats TEXT[] DEFAULT ARRAY['pdf','excel','csv','print'],
  ADD COLUMN IF NOT EXISTS required_permission VARCHAR(120) REFERENCES permissions(code) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS ux_report_definitions_code ON report_definitions(report_code);
CREATE INDEX IF NOT EXISTS idx_report_definitions_category ON report_definitions(category_id, sort_order);

INSERT INTO report_categories (code, name, description, sort_order, is_active) VALUES
  ('management', 'Management Dashboard', 'Executive financial position and operational monitoring', 10, true),
  ('budget', 'Budget Reports', 'Approved budget, budget position and available balance reporting', 20, true),
  ('funding', 'Funding Reports', 'Funding authority, receipts, allocations and releases', 30, true),
  ('commitment', 'FF3 / Commitment Reports', 'FF3 status, pending requisitions and commitment ledger reporting', 40, true),
  ('expenditure', 'FF4 / Expenditure Reports', 'FF4 register, actual expenditure and payment monitoring', 50, true),
  ('supplier', 'Supplier Reports', 'Simple supplier/payee spend and transaction reporting', 60, true),
  ('audit', 'Audit & Compliance', 'User activity and transaction audit trails', 70, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = true,
  updated_at = NOW();

WITH definitions(category_code, report_code, report_name, description, handler_key, sort_order, required_permission) AS (
  VALUES
    ('management','management-financial-summary','Management Financial Summary','Approved Budget → Funding → Release → Pending FF3 → Commitments → Actual → Available','management-financial-summary',10,'budget.report.view'),
    ('management','department-financial-position','Department Financial Position','Authoritative financial position by department','department-financial-position',20,'budget.report.view'),
    ('management','section-financial-position','Section Financial Position','Authoritative financial position by section','section-financial-position',30,'budget.report.view'),
    ('management','cost-centre-financial-position','Cost Centre Financial Position','Authoritative financial position by cost centre','cost-centre-financial-position',40,'budget.report.view'),
    ('management','expense-code-financial-position','Expense Code Financial Position','Authoritative financial position by full expense code','expense-code-financial-position',50,'budget.report.view'),
    ('management','funding-source-financial-position','Funding Source Financial Position','Authoritative financial position by funding source','funding-source-financial-position',60,'budget.report.view'),
    ('management','ff3-ff4-transaction-trace','FF3 to FF4 Transaction Trace','Drill-down trace from FF3 through commitment, FF4 and payment','ff3-ff4-transaction-trace',70,'reports.view'),

    ('budget','budget-position-report','Budget Position','Authoritative budget, funding, release, commitment, actual and available position','budget-position-report',10,'budget.report.view'),
    ('budget','budget-vs-actual','Budget vs Commitment vs Actual','Approved budget compared with outstanding commitments and actual expenditure','budget-vs-actual',20,'budget.report.view'),
    ('budget','available-balance','Available Balance','Available balance by expense code and budget line','available-balance',30,'budget.report.view'),
    ('budget','approved-budget-by-department','Budget by Department','Approved budget by department','approved-budget-by-department',40,'budget.report.view'),
    ('budget','budget-by-section','Budget by Section','Approved budget by section','budget-by-section',50,'budget.report.view'),
    ('budget','budget-by-cost-centre','Budget by Cost Centre','Approved budget by cost centre','budget-by-cost-centre',60,'budget.report.view'),
    ('budget','budget-by-code','Budget by Expense Code','Approved budget by full expense code','budget-by-code',70,'budget.report.view'),
    ('budget','monthly-expenditure','Monthly Expenditure','Actual expenditure by payment month','monthly-expenditure',80,'budget.report.view'),
    ('budget','quarterly-expenditure','Quarterly Expenditure','Actual expenditure by calendar quarter','quarterly-expenditure',90,'budget.report.view'),
    ('budget','quarterly-utilization','Quarterly Utilization Report','Quarterly releases, commitments and actual payment expenditure','quarterly-utilization',100,'budget.report.view'),

    ('funding','funding-authority-register','Funding Authority','Funding authorities with receipts and remaining authority','funding-authority-register',10,'budget.report.view'),
    ('funding','funding-receipt-register','Funding Receipts','Funding receipts with authority balance','funding-receipt-register',20,'budget.report.view'),
    ('funding','funding-allocation-report','Funding Allocation','Funding allocations against approved budget lines','funding-allocation-report',30,'budget.report.view'),
    ('funding','funding-vs-approved-budget','Funding vs Approved Budget','Approved budget compared with funded amount','funding-vs-approved-budget',40,'budget.report.view'),
    ('funding','funding-vs-releases','Funding vs Release','Funded amount compared with released amount','funding-vs-releases',50,'budget.report.view'),
    ('funding','unfunded-budget-report','Unfunded Budget','Approved budget not yet funded','unfunded-budget-report',60,'budget.report.view'),
    ('funding','unreleased-funding-report','Unreleased Funding','Funded amount not yet released','unreleased-funding-report',70,'budget.report.view'),
    ('funding','funding-source-report','Funding Source Report','Authority, receipt and allocation totals by funding source','funding-source-report',80,'budget.report.view'),

    ('commitment','ff3-status','FF3 Status','FF3 requisitions by status','ff3-status',10,'ff3.view'),
    ('commitment','ff3-pending','Pending FF3','FF3 requisitions awaiting action','ff3-pending',20,'ff3.view'),
    ('commitment','commitment-register','Commitment Register','Authoritative commitment ledger register','commitment-register',30,'commitment.view'),
    ('commitment','outstanding-commitments','Outstanding Commitments','Commitments with remaining outstanding balance','outstanding-commitments',40,'commitment.view'),
    ('commitment','partially-paid-commitments','Partially Paid Commitments','Commitments with partial payments','partially-paid-commitments',50,'commitment.view'),
    ('commitment','fully-paid-commitments','Fully Paid Commitments','Commitments fully liquidated by payments','fully-paid-commitments',60,'commitment.view'),
    ('commitment','ff3-workflow-history','FF3 Workflow History','FF3 approval and workflow history','ff3-workflow-history',70,'ff3.view'),

    ('expenditure','ff4-register','FF4 Register','FF4 payment request register','ff4-register',10,'ff4.view'),
    ('expenditure','ff4-status','FF4 Status','FF4 payment requests by status','ff4-status',20,'ff4.view'),
    ('expenditure','actual-expenditure','Actual Expenditure','Actual posted payment expenditure','actual-expenditure',30,'ff4.view'),
    ('expenditure','monthly-expenditure-summary','Monthly Expenditure Summary','Actual expenditure by payment month','monthly-expenditure-summary',40,'ff4.view'),
    ('expenditure','quarterly-expenditure-summary','Quarterly Expenditure Summary','Actual expenditure by payment quarter','quarterly-expenditure-summary',50,'ff4.view'),
    ('expenditure','payment-register','Payment Register','Posted payment transaction register','payment-register',60,'ff4.view'),
    ('expenditure','unreconciled-payments','Unreconciled Payments','Paid transactions awaiting reconciliation','unreconciled-payments',70,'ff4.view'),
    ('expenditure','ff4-reconciliation','FF4 Reconciliation Report','Paid, reconciled and unreconciled payment monitoring','ff4-reconciliation',80,'ff4.view'),
    ('expenditure','ff4-workflow-history','FF4 Workflow History','FF4 approval and workflow history','ff4-workflow-history',90,'ff4.view'),

    ('supplier','supplier-spend-summary','Supplier Spend Summary','Simple supplier/payee spend summary','supplier-spend-summary',10,'supplier.view'),
    ('supplier','supplier-transaction-history','Supplier Transaction History','Supplier/payee FF4 and payment transaction history','supplier-transaction-history',20,'supplier.view'),

    ('audit','audit-trail','Transaction Audit Trail','Complete transaction audit trail','audit-trail',10,'audit.view'),
    ('audit','user-activity','User Activity','User activity summary from audit logs','user-activity',20,'audit.view')
)
INSERT INTO report_definitions (category_id, report_code, report_name, description, handler_key, sort_order, required_permission, allowed_export_formats, is_active)
SELECT c.id, d.report_code, d.report_name, d.description, d.handler_key, d.sort_order, d.required_permission, ARRAY['pdf','excel','csv','print'], true
FROM definitions d
JOIN report_categories c ON c.code = d.category_code
ON CONFLICT (report_code) DO UPDATE SET
  category_id = EXCLUDED.category_id,
  report_name = EXCLUDED.report_name,
  description = EXCLUDED.description,
  handler_key = EXCLUDED.handler_key,
  sort_order = EXCLUDED.sort_order,
  required_permission = EXCLUDED.required_permission,
  allowed_export_formats = EXCLUDED.allowed_export_formats,
  is_active = true,
  updated_at = NOW();

CREATE OR REPLACE VIEW v_report_catalogue
WITH (security_invoker = true) AS
SELECT
  c.code AS category_code,
  c.name AS category_name,
  c.description AS category_description,
  c.sort_order AS category_sort_order,
  d.report_code,
  d.report_name,
  d.description,
  d.handler_key,
  d.sort_order,
  d.allowed_export_formats,
  d.required_permission
FROM report_categories c
JOIN report_definitions d ON d.category_id = c.id
WHERE c.is_active = true
  AND d.is_active = true
  AND (
    d.required_permission IS NULL
    OR fn_current_user_has_permission(d.required_permission)
    OR fn_current_user_has_permission('reports.view')
    OR fn_current_user_has_permission('all')
  );

-- -----------------------------------------------------------------------------
-- 2. Authoritative management and drill-down financial views
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_management_financial_summary
WITH (security_invoker = true) AS
SELECT
  p.financial_year,
  COUNT(DISTINCT p.budget_allocation_id)::INTEGER AS budget_line_count,
  COALESCE(SUM(p.approved_budget), 0)::NUMERIC(15,2) AS approved_budget,
  COALESCE(SUM(p.funded_amount), 0)::NUMERIC(15,2) AS funded_amount,
  COALESCE(SUM(p.released_amount), 0)::NUMERIC(15,2) AS released_amount,
  COALESCE(SUM(p.pending_amount), 0)::NUMERIC(15,2) AS pending_ff3,
  COALESCE(SUM(p.outstanding_commitment), 0)::NUMERIC(15,2) AS outstanding_commitments,
  COALESCE(SUM(p.actual_expenditure), 0)::NUMERIC(15,2) AS actual_expenditure,
  COALESCE(SUM(p.available_amount), 0)::NUMERIC(15,2) AS available_balance,
  COALESCE(SUM(p.unfunded_amount), 0)::NUMERIC(15,2) AS unfunded_budget,
  COALESCE(SUM(p.unreleased_funding), 0)::NUMERIC(15,2) AS unreleased_funding,
  COALESCE(SUM(p.projected_available_after_pending), 0)::NUMERIC(15,2) AS projected_available_after_pending,
  COALESCE((SELECT COUNT(*) FROM ff3_headers h WHERE h.financial_year = p.financial_year AND h.status IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD')), 0)::INTEGER AS ff3_awaiting_action,
  COALESCE((SELECT COUNT(*) FROM ff4_headers f WHERE f.financial_year = p.financial_year AND f.status = 'SUBMITTED'), 0)::INTEGER AS ff4_awaiting_verification,
  COALESCE((SELECT COUNT(*) FROM ff4_headers f WHERE f.financial_year = p.financial_year AND f.status = 'VERIFIED'), 0)::INTEGER AS ff4_awaiting_approval,
  COALESCE((SELECT COUNT(*) FROM ff4_headers f WHERE f.financial_year = p.financial_year AND f.status = 'PROCESSED'), 0)::INTEGER AS ff4_processed_awaiting_payment,
  COALESCE((SELECT COUNT(*) FROM ff4_headers f WHERE f.financial_year = p.financial_year AND f.status = 'PAID'), 0)::INTEGER AS paid_awaiting_reconciliation
FROM v_authoritative_budget_position p
GROUP BY p.financial_year;

CREATE OR REPLACE VIEW v_department_financial_position
WITH (security_invoker = true) AS
SELECT
  financial_year,
  department_id,
  COALESCE(department_name, 'Unassigned') AS department_name,
  COUNT(DISTINCT budget_allocation_id)::INTEGER AS budget_line_count,
  COALESCE(SUM(approved_budget), 0)::NUMERIC(15,2) AS approved_budget,
  COALESCE(SUM(funded_amount), 0)::NUMERIC(15,2) AS funded_amount,
  COALESCE(SUM(released_amount), 0)::NUMERIC(15,2) AS released_amount,
  COALESCE(SUM(pending_amount), 0)::NUMERIC(15,2) AS pending_ff3,
  COALESCE(SUM(outstanding_commitment), 0)::NUMERIC(15,2) AS outstanding_commitments,
  COALESCE(SUM(actual_expenditure), 0)::NUMERIC(15,2) AS actual_expenditure,
  COALESCE(SUM(available_amount), 0)::NUMERIC(15,2) AS available_balance,
  COALESCE(SUM(unfunded_amount), 0)::NUMERIC(15,2) AS unfunded_budget,
  COALESCE(SUM(unreleased_funding), 0)::NUMERIC(15,2) AS unreleased_funding,
  CASE WHEN COALESCE(SUM(released_amount), 0) > 0 THEN ROUND(((COALESCE(SUM(outstanding_commitment), 0) + COALESCE(SUM(actual_expenditure), 0)) / COALESCE(SUM(released_amount), 0)) * 100, 1) ELSE 0 END::NUMERIC(8,1) AS utilisation_pct
FROM v_authoritative_budget_position
GROUP BY financial_year, department_id, COALESCE(department_name, 'Unassigned');

CREATE OR REPLACE VIEW v_section_financial_position
WITH (security_invoker = true) AS
SELECT
  financial_year,
  department_id,
  COALESCE(department_name, 'Unassigned') AS department_name,
  section_id,
  COALESCE(section_name, 'Unassigned') AS section_name,
  COUNT(DISTINCT budget_allocation_id)::INTEGER AS budget_line_count,
  COALESCE(SUM(approved_budget), 0)::NUMERIC(15,2) AS approved_budget,
  COALESCE(SUM(funded_amount), 0)::NUMERIC(15,2) AS funded_amount,
  COALESCE(SUM(released_amount), 0)::NUMERIC(15,2) AS released_amount,
  COALESCE(SUM(pending_amount), 0)::NUMERIC(15,2) AS pending_ff3,
  COALESCE(SUM(outstanding_commitment), 0)::NUMERIC(15,2) AS outstanding_commitments,
  COALESCE(SUM(actual_expenditure), 0)::NUMERIC(15,2) AS actual_expenditure,
  COALESCE(SUM(available_amount), 0)::NUMERIC(15,2) AS available_balance,
  COALESCE(SUM(unfunded_amount), 0)::NUMERIC(15,2) AS unfunded_budget,
  COALESCE(SUM(unreleased_funding), 0)::NUMERIC(15,2) AS unreleased_funding,
  CASE WHEN COALESCE(SUM(released_amount), 0) > 0 THEN ROUND(((COALESCE(SUM(outstanding_commitment), 0) + COALESCE(SUM(actual_expenditure), 0)) / COALESCE(SUM(released_amount), 0)) * 100, 1) ELSE 0 END::NUMERIC(8,1) AS utilisation_pct
FROM v_authoritative_budget_position
GROUP BY financial_year, department_id, COALESCE(department_name, 'Unassigned'), section_id, COALESCE(section_name, 'Unassigned');

CREATE OR REPLACE VIEW v_cost_centre_financial_position
WITH (security_invoker = true) AS
SELECT
  financial_year,
  department_id,
  COALESCE(department_name, 'Unassigned') AS department_name,
  section_id,
  COALESCE(section_name, 'Unassigned') AS section_name,
  cost_centre_id,
  COALESCE(cost_centre_code, '-') AS cost_centre_code,
  COALESCE(cost_centre_name, 'Unassigned') AS cost_centre_name,
  COUNT(DISTINCT budget_allocation_id)::INTEGER AS budget_line_count,
  COALESCE(SUM(approved_budget), 0)::NUMERIC(15,2) AS approved_budget,
  COALESCE(SUM(funded_amount), 0)::NUMERIC(15,2) AS funded_amount,
  COALESCE(SUM(released_amount), 0)::NUMERIC(15,2) AS released_amount,
  COALESCE(SUM(pending_amount), 0)::NUMERIC(15,2) AS pending_ff3,
  COALESCE(SUM(outstanding_commitment), 0)::NUMERIC(15,2) AS outstanding_commitments,
  COALESCE(SUM(actual_expenditure), 0)::NUMERIC(15,2) AS actual_expenditure,
  COALESCE(SUM(available_amount), 0)::NUMERIC(15,2) AS available_balance,
  COALESCE(SUM(unfunded_amount), 0)::NUMERIC(15,2) AS unfunded_budget,
  COALESCE(SUM(unreleased_funding), 0)::NUMERIC(15,2) AS unreleased_funding,
  CASE WHEN COALESCE(SUM(released_amount), 0) > 0 THEN ROUND(((COALESCE(SUM(outstanding_commitment), 0) + COALESCE(SUM(actual_expenditure), 0)) / COALESCE(SUM(released_amount), 0)) * 100, 1) ELSE 0 END::NUMERIC(8,1) AS utilisation_pct
FROM v_authoritative_budget_position
GROUP BY financial_year, department_id, COALESCE(department_name, 'Unassigned'), section_id, COALESCE(section_name, 'Unassigned'), cost_centre_id, COALESCE(cost_centre_code, '-'), COALESCE(cost_centre_name, 'Unassigned');

CREATE OR REPLACE VIEW v_expense_code_financial_position
WITH (security_invoker = true) AS
SELECT
  financial_year,
  department_id,
  COALESCE(department_name, 'Unassigned') AS department_name,
  section_id,
  COALESCE(section_name, 'Unassigned') AS section_name,
  cost_centre_id,
  COALESCE(cost_centre_code, '-') AS cost_centre_code,
  COALESCE(cost_centre_name, 'Unassigned') AS cost_centre_name,
  expense_code_registry_id,
  COALESCE(full_expense_code, '-') AS full_expense_code,
  COUNT(DISTINCT budget_allocation_id)::INTEGER AS budget_line_count,
  COALESCE(SUM(approved_budget), 0)::NUMERIC(15,2) AS approved_budget,
  COALESCE(SUM(funded_amount), 0)::NUMERIC(15,2) AS funded_amount,
  COALESCE(SUM(released_amount), 0)::NUMERIC(15,2) AS released_amount,
  COALESCE(SUM(pending_amount), 0)::NUMERIC(15,2) AS pending_ff3,
  COALESCE(SUM(outstanding_commitment), 0)::NUMERIC(15,2) AS outstanding_commitments,
  COALESCE(SUM(actual_expenditure), 0)::NUMERIC(15,2) AS actual_expenditure,
  COALESCE(SUM(available_amount), 0)::NUMERIC(15,2) AS available_balance,
  COALESCE(SUM(unfunded_amount), 0)::NUMERIC(15,2) AS unfunded_budget,
  COALESCE(SUM(unreleased_funding), 0)::NUMERIC(15,2) AS unreleased_funding,
  CASE WHEN COALESCE(SUM(released_amount), 0) > 0 THEN ROUND(((COALESCE(SUM(outstanding_commitment), 0) + COALESCE(SUM(actual_expenditure), 0)) / COALESCE(SUM(released_amount), 0)) * 100, 1) ELSE 0 END::NUMERIC(8,1) AS utilisation_pct
FROM v_authoritative_budget_position
GROUP BY financial_year, department_id, COALESCE(department_name, 'Unassigned'), section_id, COALESCE(section_name, 'Unassigned'), cost_centre_id, COALESCE(cost_centre_code, '-'), COALESCE(cost_centre_name, 'Unassigned'), expense_code_registry_id, COALESCE(full_expense_code, '-');

CREATE OR REPLACE VIEW v_funding_source_financial_position
WITH (security_invoker = true) AS
SELECT
  financial_year,
  funding_source_id,
  COALESCE(funding_source_code, '-') AS funding_source_code,
  COALESCE(funding_source_name, 'Unassigned') AS funding_source_name,
  COUNT(DISTINCT budget_allocation_id)::INTEGER AS budget_line_count,
  COALESCE(SUM(approved_budget), 0)::NUMERIC(15,2) AS approved_budget,
  COALESCE(SUM(funded_amount), 0)::NUMERIC(15,2) AS funded_amount,
  COALESCE(SUM(released_amount), 0)::NUMERIC(15,2) AS released_amount,
  COALESCE(SUM(pending_amount), 0)::NUMERIC(15,2) AS pending_ff3,
  COALESCE(SUM(outstanding_commitment), 0)::NUMERIC(15,2) AS outstanding_commitments,
  COALESCE(SUM(actual_expenditure), 0)::NUMERIC(15,2) AS actual_expenditure,
  COALESCE(SUM(available_amount), 0)::NUMERIC(15,2) AS available_balance,
  COALESCE(SUM(unfunded_amount), 0)::NUMERIC(15,2) AS unfunded_budget,
  COALESCE(SUM(unreleased_funding), 0)::NUMERIC(15,2) AS unreleased_funding,
  CASE WHEN COALESCE(SUM(released_amount), 0) > 0 THEN ROUND(((COALESCE(SUM(outstanding_commitment), 0) + COALESCE(SUM(actual_expenditure), 0)) / COALESCE(SUM(released_amount), 0)) * 100, 1) ELSE 0 END::NUMERIC(8,1) AS utilisation_pct
FROM v_authoritative_budget_position
GROUP BY financial_year, funding_source_id, COALESCE(funding_source_code, '-'), COALESCE(funding_source_name, 'Unassigned');

-- -----------------------------------------------------------------------------
-- 3. Payment-date expenditure, reconciliation, supplier and trace views
-- -----------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_monthly_expenditure_summary
WITH (security_invoker = true) AS
SELECT
  pt.financial_year,
  EXTRACT(YEAR FROM COALESCE(pt.transaction_date, f.payment_date))::INTEGER AS calendar_year,
  EXTRACT(MONTH FROM COALESCE(pt.transaction_date, f.payment_date))::INTEGER AS month_number,
  TO_CHAR(COALESCE(pt.transaction_date, f.payment_date), 'Mon') AS month_name,
  f.department_id,
  d.name AS department_name,
  f.section_id,
  s.name AS section_name,
  f.cost_centre_id,
  cc.code AS cost_centre_code,
  cc.name AS cost_centre_name,
  f.expense_code_registry_id,
  ecr.full_expense_code,
  f.funding_source_id,
  fs.name AS funding_source_name,
  COUNT(DISTINCT f.id)::INTEGER AS ff4_count,
  COUNT(pt.id)::INTEGER AS payment_count,
  COALESCE(SUM(pt.amount), 0)::NUMERIC(15,2) AS actual_expenditure
FROM payment_transactions pt
JOIN ff4_headers f ON f.id = pt.ff4_header_id
LEFT JOIN departments d ON d.id = f.department_id
LEFT JOIN sections s ON s.id = f.section_id
LEFT JOIN cost_centres cc ON cc.id = f.cost_centre_id
LEFT JOIN expense_code_registry ecr ON ecr.id = f.expense_code_registry_id
LEFT JOIN funding_sources fs ON fs.id = f.funding_source_id
WHERE pt.transaction_type = 'PAYMENT'
  AND COALESCE(pt.status, 'POSTED') <> 'REVERSED'
  AND f.status IN ('PAID','RECONCILED')
  AND COALESCE(pt.transaction_date, f.payment_date) IS NOT NULL
GROUP BY pt.financial_year, EXTRACT(YEAR FROM COALESCE(pt.transaction_date, f.payment_date)), EXTRACT(MONTH FROM COALESCE(pt.transaction_date, f.payment_date)), TO_CHAR(COALESCE(pt.transaction_date, f.payment_date), 'Mon'), f.department_id, d.name, f.section_id, s.name, f.cost_centre_id, cc.code, cc.name, f.expense_code_registry_id, ecr.full_expense_code, f.funding_source_id, fs.name;

CREATE OR REPLACE VIEW v_quarterly_expenditure_summary
WITH (security_invoker = true) AS
SELECT
  financial_year,
  calendar_year,
  CASE
    WHEN month_number BETWEEN 1 AND 3 THEN 1
    WHEN month_number BETWEEN 4 AND 6 THEN 2
    WHEN month_number BETWEEN 7 AND 9 THEN 3
    ELSE 4
  END::INTEGER AS quarter,
  ('Q' || CASE
    WHEN month_number BETWEEN 1 AND 3 THEN 1
    WHEN month_number BETWEEN 4 AND 6 THEN 2
    WHEN month_number BETWEEN 7 AND 9 THEN 3
    ELSE 4
  END)::TEXT AS quarter_label,
  department_id,
  department_name,
  section_id,
  section_name,
  cost_centre_id,
  cost_centre_code,
  cost_centre_name,
  expense_code_registry_id,
  full_expense_code,
  funding_source_id,
  funding_source_name,
  SUM(ff4_count)::INTEGER AS ff4_count,
  SUM(payment_count)::INTEGER AS payment_count,
  SUM(actual_expenditure)::NUMERIC(15,2) AS actual_expenditure
FROM v_monthly_expenditure_summary
GROUP BY financial_year, calendar_year,
  CASE WHEN month_number BETWEEN 1 AND 3 THEN 1 WHEN month_number BETWEEN 4 AND 6 THEN 2 WHEN month_number BETWEEN 7 AND 9 THEN 3 ELSE 4 END,
  department_id, department_name, section_id, section_name, cost_centre_id, cost_centre_code, cost_centre_name, expense_code_registry_id, full_expense_code, funding_source_id, funding_source_name;

CREATE OR REPLACE VIEW v_ff4_reconciliation_summary
WITH (security_invoker = true) AS
SELECT
  pt.id AS payment_transaction_id,
  pt.financial_year,
  pt.transaction_date AS payment_date,
  pt.payment_reference,
  pt.amount::NUMERIC(15,2) AS amount,
  pt.reconciled,
  pt.reconciled_at,
  pt.status AS payment_transaction_status,
  f.id AS ff4_header_id,
  f.ff4_number,
  f.status AS ff4_status,
  f.payment_method,
  f.external_payment_reference,
  f.cheque_number,
  f.payee_type,
  f.payee_name,
  f.supplier_id,
  COALESCE(sup.legal_name, sup.supplier_name, f.payee_name) AS supplier_or_payee,
  c.id AS commitment_id,
  c.commitment_number,
  f.budget_allocation_id,
  f.department_id,
  d.name AS department_name,
  f.section_id,
  sec.name AS section_name,
  CASE
    WHEN COALESCE(pt.status, 'POSTED') = 'REVERSED' THEN 'REVERSED'
    WHEN f.status = 'RECONCILED' OR pt.reconciled = true THEN 'RECONCILED'
    WHEN f.status = 'PAID' THEN 'UNRECONCILED'
    ELSE 'PAID'
  END AS reconciliation_status
FROM payment_transactions pt
JOIN ff4_headers f ON f.id = pt.ff4_header_id
LEFT JOIN ff3_commitments c ON c.id = pt.commitment_id
LEFT JOIN suppliers sup ON sup.id = f.supplier_id
LEFT JOIN departments d ON d.id = f.department_id
LEFT JOIN sections sec ON sec.id = f.section_id
WHERE pt.transaction_type = 'PAYMENT'
  AND COALESCE(pt.status, 'POSTED') <> 'REVERSED'
  AND f.status IN ('PAID','RECONCILED');

CREATE OR REPLACE VIEW v_supplier_spend_summary
WITH (security_invoker = true) AS
SELECT
  f.financial_year,
  f.supplier_id,
  COALESCE(sup.supplier_code, f.supplier_code, '-') AS supplier_code,
  COALESCE(sup.legal_name, sup.supplier_name, f.payee_name) AS supplier_or_payee,
  f.payee_type,
  COUNT(DISTINCT f.id)::INTEGER AS ff4_count,
  COUNT(pt.id)::INTEGER AS payment_count,
  COALESCE(SUM(pt.amount), 0)::NUMERIC(15,2) AS total_spend,
  COALESCE(SUM(CASE WHEN COALESCE(pt.reconciled, false) THEN pt.amount ELSE 0 END), 0)::NUMERIC(15,2) AS reconciled_spend,
  COALESCE(SUM(CASE WHEN COALESCE(pt.reconciled, false) = false THEN pt.amount ELSE 0 END), 0)::NUMERIC(15,2) AS unreconciled_spend,
  MIN(pt.transaction_date) AS first_payment_date,
  MAX(pt.transaction_date) AS last_payment_date
FROM ff4_headers f
JOIN payment_transactions pt ON pt.ff4_header_id = f.id
LEFT JOIN suppliers sup ON sup.id = f.supplier_id
WHERE pt.transaction_type = 'PAYMENT'
  AND COALESCE(pt.status, 'POSTED') <> 'REVERSED'
  AND f.status IN ('PAID','RECONCILED')
GROUP BY f.financial_year, f.supplier_id, COALESCE(sup.supplier_code, f.supplier_code, '-'), COALESCE(sup.legal_name, sup.supplier_name, f.payee_name), f.payee_type;

CREATE OR REPLACE VIEW v_ff3_ff4_transaction_trace
WITH (security_invoker = true) AS
SELECT
  h.financial_year,
  h.id AS ff3_header_id,
  h.ff3_number,
  h.request_date AS ff3_request_date,
  h.status AS ff3_status,
  h.purpose AS ff3_purpose,
  h.total_estimated_amount AS ff3_amount,
  h.department_id,
  d.name AS department_name,
  h.section_id,
  sec.name AS section_name,
  h.cost_centre_id,
  cc.code AS cost_centre_code,
  cc.name AS cost_centre_name,
  h.expense_code_registry_id,
  ecr.full_expense_code,
  h.funding_source_id,
  fs.name AS funding_source_name,
  c.id AS commitment_id,
  c.commitment_number,
  c.status AS commitment_status,
  c.original_committed_amount,
  c.current_committed_amount,
  c.paid_amount AS commitment_paid_amount,
  c.outstanding_amount AS commitment_outstanding_amount,
  f.id AS ff4_header_id,
  f.ff4_number,
  f.status AS ff4_status,
  f.payment_request_date,
  f.payee_type,
  f.payee_name,
  f.supplier_id,
  COALESCE(sup.legal_name, sup.supplier_name, f.payee_name, h.selected_supplier_name) AS supplier_or_payee,
  f.invoice_number,
  f.net_amount AS ff4_net_amount,
  pt.id AS payment_transaction_id,
  pt.transaction_date AS payment_date,
  pt.payment_reference,
  pt.amount AS payment_amount,
  pt.reconciled,
  pt.reconciled_at
FROM ff3_headers h
LEFT JOIN ff3_commitments c ON c.ff3_header_id = h.id
LEFT JOIN ff4_headers f ON f.commitment_id = c.id
LEFT JOIN payment_transactions pt ON pt.ff4_header_id = f.id AND pt.transaction_type = 'PAYMENT' AND COALESCE(pt.status, 'POSTED') <> 'REVERSED'
LEFT JOIN suppliers sup ON sup.id = f.supplier_id
LEFT JOIN departments d ON d.id = h.department_id
LEFT JOIN sections sec ON sec.id = h.section_id
LEFT JOIN cost_centres cc ON cc.id = h.cost_centre_id
LEFT JOIN expense_code_registry ecr ON ecr.id = h.expense_code_registry_id
LEFT JOIN funding_sources fs ON fs.id = h.funding_source_id;

-- -----------------------------------------------------------------------------
-- 4. Reporting performance indexes on existing authoritative sources
-- -----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_budget_allocations_phase5_fy_department ON budget_allocations(financial_year, department_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_budget_allocations_phase5_section ON budget_allocations(financial_year, section_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_budget_allocations_phase5_cost_centre ON budget_allocations(financial_year, cost_centre_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_budget_allocations_phase5_expense_code ON budget_allocations(financial_year, expense_code_registry_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_budget_allocations_phase5_funding_source ON budget_allocations(financial_year, funding_source_id) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_quarterly_releases_phase5_fy_quarter ON quarterly_releases(financial_year, quarter);
CREATE INDEX IF NOT EXISTS idx_ff3_headers_phase5_fy_status ON ff3_headers(financial_year, status);
CREATE INDEX IF NOT EXISTS idx_ff3_headers_phase5_budget_allocation ON ff3_headers(budget_allocation_id, status);
CREATE INDEX IF NOT EXISTS idx_ff3_commitments_phase5_fy_status ON ff3_commitments(financial_year, status);
CREATE INDEX IF NOT EXISTS idx_ff3_commitments_phase5_supplier ON ff3_commitments(financial_year, supplier_id);
CREATE INDEX IF NOT EXISTS idx_ff4_headers_phase5_fy_status ON ff4_headers(financial_year, status);
CREATE INDEX IF NOT EXISTS idx_ff4_headers_phase5_supplier ON ff4_headers(financial_year, supplier_id);
CREATE INDEX IF NOT EXISTS idx_ff4_headers_phase5_payment_date ON ff4_headers(financial_year, payment_date);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_phase5_fy_date ON payment_transactions(financial_year, transaction_date);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_phase5_status ON payment_transactions(status, transaction_type, reconciled);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_phase5_ff4 ON payment_transactions(ff4_header_id, transaction_type, status);

-- -----------------------------------------------------------------------------
-- 5. Grants: report objects are readable by authenticated users only.
-- RLS on underlying secured tables and invoker-security views remains the gate.
-- -----------------------------------------------------------------------------

REVOKE ALL ON TABLE report_categories FROM anon, authenticated;
REVOKE ALL ON TABLE report_definitions FROM anon, authenticated;
GRANT SELECT ON TABLE report_categories, report_definitions TO authenticated;

REVOKE ALL ON TABLE
  v_report_catalogue,
  v_management_financial_summary,
  v_department_financial_position,
  v_section_financial_position,
  v_cost_centre_financial_position,
  v_expense_code_financial_position,
  v_funding_source_financial_position,
  v_supplier_spend_summary,
  v_ff3_ff4_transaction_trace,
  v_monthly_expenditure_summary,
  v_quarterly_expenditure_summary,
  v_ff4_reconciliation_summary
FROM anon;

GRANT SELECT ON TABLE
  v_report_catalogue,
  v_management_financial_summary,
  v_department_financial_position,
  v_section_financial_position,
  v_cost_centre_financial_position,
  v_expense_code_financial_position,
  v_funding_source_financial_position,
  v_supplier_spend_summary,
  v_ff3_ff4_transaction_trace,
  v_monthly_expenditure_summary,
  v_quarterly_expenditure_summary,
  v_ff4_reconciliation_summary
TO authenticated;
