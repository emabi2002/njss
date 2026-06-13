-- =====================================================================
-- CRMS Seed Data — Court Registry Requisition & Expense Monitoring System
-- Idempotent: safe to re-run.
-- =====================================================================

-- ===================== DEPARTMENTS =====================
INSERT INTO departments (code, name, description) VALUES
('NJSS', 'National Judiciary Staff Services', 'Main administrative body'),
('ADMIN', 'Administration Division', 'General administration and management'),
('HR', 'Human Resources Division', 'Staff management and HR services'),
('FIN', 'Finance Division', 'Financial management and accounting'),
('REG', 'Court Registry', 'Court registry and records management')
ON CONFLICT (code) DO NOTHING;

-- ===================== SECTIONS =====================
INSERT INTO sections (department_id, code, name) VALUES
((SELECT id FROM departments WHERE code = 'ADMIN'), 'EXEC', 'Executive Office'),
((SELECT id FROM departments WHERE code = 'FIN'), 'ACC', 'Accounts Section'),
((SELECT id FROM departments WHERE code = 'FIN'), 'PROC', 'Procurement Section'),
((SELECT id FROM departments WHERE code = 'FIN'), 'PAY', 'Payroll Section'),
((SELECT id FROM departments WHERE code = 'HR'), 'REC', 'Records Management'),
((SELECT id FROM departments WHERE code = 'REG'), 'NCREG', 'National Court Registry'),
((SELECT id FROM departments WHERE code = 'REG'), 'SCREG', 'Supreme Court Registry')
ON CONFLICT (code) DO NOTHING;

-- ===================== PROVINCES =====================
INSERT INTO provinces (code, name, region) VALUES
('NCD', 'National Capital District', 'Southern'),
('CPK', 'Central Province', 'Southern'),
('MBP', 'Morobe', 'Momase'),
('EHP', 'Eastern Highlands', 'Highlands'),
('WHP', 'Western Highlands', 'Highlands'),
('WNB', 'West New Britain', 'Islands'),
('ENB', 'East New Britain', 'Islands'),
('MPL', 'Madang', 'Momase'),
('ESP', 'East Sepik', 'Momase'),
('MIL', 'Milne Bay', 'Southern')
ON CONFLICT (code) DO NOTHING;

-- ===================== PROJECTS =====================
INSERT INTO projects (department_id, code, name, description, start_date, end_date) VALUES
((SELECT id FROM departments WHERE code = 'NJSS'), 'JSS2025', 'Judiciary Staff Support 2025', 'Staff support and development', '2025-01-01', '2025-12-31'),
((SELECT id FROM departments WHERE code = 'REG'), 'COURT2025', 'Court Operations 2025', 'Court operations support', '2025-01-01', '2025-12-31'),
((SELECT id FROM departments WHERE code = 'HR'), 'CAP2025', 'Capacity Building Program', 'Staff training and capacity building', '2025-01-01', '2026-12-31')
ON CONFLICT (code) DO NOTHING;

-- ===================== FUNDING SOURCES =====================
INSERT INTO funding_sources (code, name, source_type) VALUES
('REC-GEN', 'Recurrent General Fund', 'Recurrent'),
('DEV-NTL', 'Development National', 'Development'),
('ADB-GRANT', 'ADB Justice Sector Grant', 'Grant'),
('AUS-AID', 'Australian Aid Program', 'Donor'),
('PNG-GOV', 'PNG Government Allocation', 'Recurrent')
ON CONFLICT (code) DO NOTHING;

-- ===================== CHART OF ACCOUNTS =====================
INSERT INTO chart_of_accounts (account_code, account_name, account_type, is_open_head) VALUES
('5000', 'Operating Expenses', 'Expense', false),
('5100', 'Personnel Costs', 'Expense', false),
('5110', 'Salaries and Wages', 'Expense', false),
('5120', 'Allowances', 'Expense', true),
('5200', 'Travel and Transport', 'Expense', false),
('5210', 'Domestic Travel', 'Expense', false),
('5220', 'International Travel', 'Expense', false),
('5230', 'Vehicle Operations', 'Expense', false),
('5300', 'Supplies and Services', 'Expense', false),
('5310', 'Office Supplies', 'Expense', false),
('5320', 'IT Equipment', 'Expense', false),
('5330', 'Furniture and Fittings', 'Expense', false),
('5340', 'Professional Services', 'Expense', false),
('5350', 'Utilities', 'Expense', false),
('5400', 'Maintenance', 'Expense', false),
('5410', 'Building Maintenance', 'Expense', false),
('5420', 'Equipment Maintenance', 'Expense', false)
ON CONFLICT (account_code) DO NOTHING;

-- ===================== EXPENSE CATEGORIES =====================
INSERT INTO expense_categories (code, name) VALUES
('TRAVEL', 'Travel and Accommodation'),
('SUPPLY', 'Supplies and Equipment'),
('SERVICES', 'Professional Services'),
('MAINTAIN', 'Maintenance and Repairs'),
('UTILITY', 'Utilities'),
('TRAINING', 'Training and Development')
ON CONFLICT (code) DO NOTHING;

-- ===================== ROLES (per CRMS spec) =====================
INSERT INTO roles (name, description, permissions) VALUES
('System Administrator', 'Full system access and configuration', '{"all": true}'),
('Finance Manager', 'Approves FF3, verifies and processes FF4 payments', '{"ff3_approve": true, "ff4_verify": true, "ff4_process": true, "budget_view": true}'),
('Department Head', 'Endorses or rejects requisitions for the department', '{"ff3_endorse": true, "ff3_reject": true}'),
('Section Head', 'Endorses requisitions for the section', '{"ff3_endorse": true}'),
('Approver', 'Final approver for requisitions', '{"ff3_approve": true}'),
('Requisition Officer', 'Creates FF3 and FF4 drafts', '{"ff3_create": true, "ff4_create": true}'),
('Auditor', 'Read-only access to audit logs and reports', '{"audit_view": true, "reports_view": true}'),
('Executive Management', 'Dashboard and reports only', '{"dashboard_view": true, "reports_view": true}')
ON CONFLICT (name) DO NOTHING;

-- ===================== ROLE PERMISSIONS (granular) =====================
INSERT INTO role_permissions (role_id, permission) VALUES
((SELECT id FROM roles WHERE name='System Administrator'), 'all'),
((SELECT id FROM roles WHERE name='Finance Manager'), 'ff3.approve'),
((SELECT id FROM roles WHERE name='Finance Manager'), 'ff4.verify'),
((SELECT id FROM roles WHERE name='Finance Manager'), 'ff4.process'),
((SELECT id FROM roles WHERE name='Finance Manager'), 'budget.view'),
((SELECT id FROM roles WHERE name='Department Head'), 'ff3.endorse'),
((SELECT id FROM roles WHERE name='Department Head'), 'ff3.reject'),
((SELECT id FROM roles WHERE name='Section Head'), 'ff3.endorse'),
((SELECT id FROM roles WHERE name='Approver'), 'ff3.approve'),
((SELECT id FROM roles WHERE name='Requisition Officer'), 'ff3.create'),
((SELECT id FROM roles WHERE name='Requisition Officer'), 'ff4.create'),
((SELECT id FROM roles WHERE name='Auditor'), 'audit.view'),
((SELECT id FROM roles WHERE name='Auditor'), 'reports.view'),
((SELECT id FROM roles WHERE name='Executive Management'), 'dashboard.view'),
((SELECT id FROM roles WHERE name='Executive Management'), 'reports.view')
ON CONFLICT (role_id, permission) DO NOTHING;

-- ===================== DEMO USERS =====================
INSERT INTO users (full_name, email, department_id, position) VALUES
('System Administrator', 'admin@pngjudiciary.gov.pg', (SELECT id FROM departments WHERE code='NJSS'), 'IT Administrator'),
('Mary Finance', 'finance@pngjudiciary.gov.pg', (SELECT id FROM departments WHERE code='FIN'), 'Finance Manager'),
('John Registry', 'registry@pngjudiciary.gov.pg', (SELECT id FROM departments WHERE code='REG'), 'Requisition Officer'),
('Peter Section', 'section@pngjudiciary.gov.pg', (SELECT id FROM departments WHERE code='REG'), 'Section Head')
ON CONFLICT (email) DO NOTHING;

INSERT INTO user_roles (user_id, role_id) VALUES
((SELECT id FROM users WHERE email='admin@pngjudiciary.gov.pg'), (SELECT id FROM roles WHERE name='System Administrator')),
((SELECT id FROM users WHERE email='finance@pngjudiciary.gov.pg'), (SELECT id FROM roles WHERE name='Finance Manager')),
((SELECT id FROM users WHERE email='registry@pngjudiciary.gov.pg'), (SELECT id FROM roles WHERE name='Requisition Officer')),
((SELECT id FROM users WHERE email='section@pngjudiciary.gov.pg'), (SELECT id FROM roles WHERE name='Section Head'))
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ===================== BUDGET ALLOCATIONS (FY 2025) =====================
INSERT INTO budget_allocations (financial_year, department_id, section_id, funding_source_id, account_id, original_budget, supplemental_budget)
SELECT 2025, (SELECT id FROM departments WHERE code='FIN'), (SELECT id FROM sections WHERE code='ACC'),
       (SELECT id FROM funding_sources WHERE code='REC-GEN'), (SELECT id FROM chart_of_accounts WHERE account_code='5210'), 115000.00, 10000.00
WHERE NOT EXISTS (SELECT 1 FROM budget_allocations WHERE financial_year=2025 AND account_id=(SELECT id FROM chart_of_accounts WHERE account_code='5210'));

INSERT INTO budget_allocations (financial_year, department_id, section_id, funding_source_id, account_id, original_budget, supplemental_budget)
SELECT 2025, (SELECT id FROM departments WHERE code='FIN'), (SELECT id FROM sections WHERE code='ACC'),
       (SELECT id FROM funding_sources WHERE code='REC-GEN'), (SELECT id FROM chart_of_accounts WHERE account_code='5340'), 70000.00, 0.00
WHERE NOT EXISTS (SELECT 1 FROM budget_allocations WHERE financial_year=2025 AND account_id=(SELECT id FROM chart_of_accounts WHERE account_code='5340'));

INSERT INTO budget_allocations (financial_year, department_id, section_id, funding_source_id, account_id, original_budget, supplemental_budget)
SELECT 2025, (SELECT id FROM departments WHERE code='FIN'), (SELECT id FROM sections WHERE code='PROC'),
       (SELECT id FROM funding_sources WHERE code='DEV-NTL'), (SELECT id FROM chart_of_accounts WHERE account_code='5320'), 150000.00, 0.00
WHERE NOT EXISTS (SELECT 1 FROM budget_allocations WHERE financial_year=2025 AND account_id=(SELECT id FROM chart_of_accounts WHERE account_code='5320'));

-- ===================== QUARTERLY RELEASES =====================
INSERT INTO quarterly_releases (budget_allocation_id, financial_year, quarter, release_number, release_date, released_amount)
SELECT id, 2025, 1, 'WR-2025-Q1-001', '2025-01-20', 31250.00 FROM budget_allocations WHERE account_id=(SELECT id FROM chart_of_accounts WHERE account_code='5210')
ON CONFLICT DO NOTHING;
INSERT INTO quarterly_releases (budget_allocation_id, financial_year, quarter, release_number, release_date, released_amount)
SELECT id, 2025, 2, 'WR-2025-Q2-001', '2025-04-10', 31250.00 FROM budget_allocations WHERE account_id=(SELECT id FROM chart_of_accounts WHERE account_code='5210')
ON CONFLICT DO NOTHING;
INSERT INTO quarterly_releases (budget_allocation_id, financial_year, quarter, release_number, release_date, released_amount)
SELECT id, 2025, 1, 'WR-2025-Q1-002', '2025-01-20', 17500.00 FROM budget_allocations WHERE account_id=(SELECT id FROM chart_of_accounts WHERE account_code='5340')
ON CONFLICT DO NOTHING;
INSERT INTO quarterly_releases (budget_allocation_id, financial_year, quarter, release_number, release_date, released_amount)
SELECT id, 2025, 1, 'WR-2025-Q1-003', '2025-01-20', 50000.00 FROM budget_allocations WHERE account_id=(SELECT id FROM chart_of_accounts WHERE account_code='5320')
ON CONFLICT DO NOTHING;

-- ===================== SYSTEM SETTINGS =====================
INSERT INTO system_settings (setting_key, setting_value, description) VALUES
('organization', '{"name": "National Judiciary Staff Services", "country": "Papua New Guinea", "currency": "PGK"}', 'Organization profile'),
('current_financial_year', '2025', 'Active financial year'),
('budget_low_threshold_pct', '20', 'Percentage at which a budget-low alert is raised'),
('min_quotations', '3', 'Minimum quotations required to submit an FF3')
ON CONFLICT (setting_key) DO NOTHING;
