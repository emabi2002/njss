-- =====================================================
-- NJSS CONTROLLED LOOKUP MASTER DATA
-- Provides table-backed values for active business dropdowns.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS priority_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 100,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS urgency_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 100,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS procurement_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) UNIQUE NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS units_of_measure (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payee_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(40) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_code VARCHAR(60) UNIQUE NOT NULL,
  supplier_name VARCHAR(240) NOT NULL,
  trading_name VARCHAR(240),
  supplier_type VARCHAR(80),
  tin VARCHAR(80),
  company_registration_number VARCHAR(120),
  contact_person VARCHAR(160),
  phone VARCHAR(80),
  email VARCHAR(160),
  address TEXT,
  province_id UUID REFERENCES provinces(id),
  bank_name VARCHAR(160),
  bank_account_name VARCHAR(200),
  bank_account_number VARCHAR(120),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS workflow_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_code VARCHAR(60) NOT NULL,
  status_code VARCHAR(80) NOT NULL,
  display_name VARCHAR(160) NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 100,
  is_terminal BOOLEAN DEFAULT false,
  is_filterable BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  badge_style TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(module_code, status_code)
);

CREATE TABLE IF NOT EXISTS budget_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_cycle_id UUID REFERENCES budget_cycles(id) ON DELETE CASCADE,
  period_type VARCHAR(40) DEFAULT 'QUARTER',
  period_number INTEGER NOT NULL,
  period_code VARCHAR(40) NOT NULL,
  period_name VARCHAR(120) NOT NULL,
  start_date DATE,
  end_date DATE,
  is_open BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(budget_cycle_id, period_type, period_number)
);

CREATE TABLE IF NOT EXISTS rbac_data_scope_types (
  code VARCHAR(60) PRIMARY KEY,
  label VARCHAR(140) NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 100,
  is_system BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(80) UNIQUE NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_code VARCHAR(120) UNIQUE NOT NULL,
  report_name VARCHAR(180) NOT NULL,
  description TEXT,
  category_id UUID REFERENCES report_categories(id),
  handler_key VARCHAR(120) NOT NULL,
  sort_order INTEGER DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  allowed_export_formats TEXT[] DEFAULT ARRAY['pdf','excel','csv','print'],
  required_permission VARCHAR(120) DEFAULT 'reports.view',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE budget_divisions ADD COLUMN IF NOT EXISTS cost_centre_id UUID REFERENCES cost_centres(id);
ALTER TABLE divisional_budget_lines
  ADD COLUMN IF NOT EXISTS priority_level_id UUID REFERENCES priority_levels(id),
  ADD COLUMN IF NOT EXISTS procurement_method_id UUID REFERENCES procurement_methods(id),
  ADD COLUMN IF NOT EXISTS unit_of_measure_id UUID REFERENCES units_of_measure(id),
  ADD COLUMN IF NOT EXISTS responsible_officer_id UUID REFERENCES users(id);
ALTER TABLE ff3_headers
  ADD COLUMN IF NOT EXISTS urgency_level_id UUID REFERENCES urgency_levels(id),
  ADD COLUMN IF NOT EXISTS procurement_method_id UUID REFERENCES procurement_methods(id);
ALTER TABLE ff3_items ADD COLUMN IF NOT EXISTS unit_of_measure_id UUID REFERENCES units_of_measure(id);
ALTER TABLE ff3_quotations
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS attachment_url TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT;
ALTER TABLE ff4_headers
  ADD COLUMN IF NOT EXISTS payee_type_id UUID REFERENCES payee_types(id),
  ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES payment_methods(id),
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id),
  ADD COLUMN IF NOT EXISTS payee_user_id UUID REFERENCES users(id);

INSERT INTO priority_levels (code, name, description, sort_order, is_default) VALUES
  ('LOW','Low','Low priority budget line',10,false),
  ('MEDIUM','Medium','Normal priority budget line',20,true),
  ('HIGH','High','High priority budget line',30,false),
  ('CRITICAL','Critical','Critical priority budget line',40,false)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, sort_order=EXCLUDED.sort_order, is_active=true;

INSERT INTO urgency_levels (code, name, description, sort_order, is_default) VALUES
  ('LOW','Low','Low urgency requisition',10,false),
  ('MEDIUM','Medium','Normal urgency requisition',20,true),
  ('HIGH','High','High urgency requisition',30,false),
  ('URGENT','Urgent','Urgent requisition',40,false)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, sort_order=EXCLUDED.sort_order, is_active=true;

INSERT INTO procurement_methods (code, name, description, sort_order) VALUES
  ('QUOTATION','Quotation','Competitive quotation procurement',10),
  ('TENDER','Tender','Formal tender procurement',20),
  ('DIRECT','Direct Purchase','Direct purchase procurement',30)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, sort_order=EXCLUDED.sort_order, is_active=true;

INSERT INTO units_of_measure (code, name, sort_order) VALUES
  ('EACH','Each',10),('UNIT','Unit',20),('LOT','Lot',30),('MONTH','Month',40),
  ('DAY','Day',50),('HOUR','Hour',60),('KM','Kilometre',70),('LITRE','Litre',80),
  ('KG','Kilogram',90),('PACKAGE','Package',100),('SERVICE','Service',110),('TRIP','Trip',120)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, sort_order=EXCLUDED.sort_order, is_active=true;

INSERT INTO payee_types (code, name, description, sort_order) VALUES
  ('SUPPLIER','Supplier','Registered supplier payee',10),
  ('CONTRACTOR','Contractor','Contractor payee',20),
  ('EMPLOYEE','Employee','Employee/user payee',30),
  ('OTHER','Other','Other approved payee',40)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, sort_order=EXCLUDED.sort_order, is_active=true;

INSERT INTO payment_methods (code, name, description, sort_order) VALUES
  ('EFT','Electronic Funds Transfer (EFT)','Electronic funds transfer',10),
  ('CHEQUE','Cheque','Cheque payment',20),
  ('DIRECT_DEPOSIT','Direct Deposit','Direct deposit payment',30),
  ('CASH','Cash','Cash payment',40)
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, sort_order=EXCLUDED.sort_order, is_active=true;

INSERT INTO workflow_statuses (module_code, status_code, display_name, sort_order, is_terminal, badge_style) VALUES
  ('FF3','DRAFT','Draft',10,false,'bg-slate-100 text-slate-700'),
  ('FF3','SUBMITTED','Submitted',20,false,'bg-amber-100 text-amber-800'),
  ('FF3','ENDORSED_SUPERVISOR','Endorsed by Supervisor',30,false,'bg-blue-100 text-blue-700'),
  ('FF3','ENDORSED_SECTION_HEAD','Endorsed by Section Head',40,false,'bg-blue-100 text-blue-700'),
  ('FF3','APPROVED','Approved',50,true,'bg-green-100 text-green-700'),
  ('FF3','REJECTED','Rejected',60,true,'bg-red-100 text-red-700'),
  ('FF3','EXPIRED','Expired',70,true,'bg-slate-200 text-slate-700'),
  ('FF4','DRAFT','Draft',10,false,'bg-slate-100 text-slate-700'),
  ('FF4','SUBMITTED','Submitted',20,false,'bg-amber-100 text-amber-800'),
  ('FF4','VERIFIED','Verified',30,false,'bg-blue-100 text-blue-700'),
  ('FF4','APPROVED','Approved',40,false,'bg-green-100 text-green-700'),
  ('FF4','PROCESSED','Processed',50,false,'bg-purple-100 text-purple-700'),
  ('FF4','PAID','Paid',60,false,'bg-green-600 text-white'),
  ('FF4','RECONCILED','Reconciled',70,true,'bg-teal-100 text-teal-700'),
  ('FF4','CANCELLED','Cancelled',80,true,'bg-red-100 text-red-700'),
  ('BUDGET_SUBMISSION','DRAFT','Draft',10,false,'bg-slate-100 text-slate-700'),
  ('BUDGET_SUBMISSION','SUBMITTED','Submitted',20,false,'bg-amber-100 text-amber-800'),
  ('BUDGET_SUBMISSION','RETURNED','Returned',30,false,'bg-orange-100 text-orange-800'),
  ('BUDGET_SUBMISSION','RESUBMITTED','Resubmitted',40,false,'bg-amber-100 text-amber-800'),
  ('BUDGET_SUBMISSION','REVIEWED','Reviewed',50,false,'bg-blue-100 text-blue-700'),
  ('BUDGET_SUBMISSION','APPROVED','Approved',60,true,'bg-green-100 text-green-700'),
  ('BUDGET_SUBMISSION','REJECTED','Rejected',70,true,'bg-red-100 text-red-700'),
  ('BUDGET_SUBMISSION','ARCHIVED','Archived',80,true,'bg-slate-200 text-slate-700')
ON CONFLICT (module_code, status_code) DO UPDATE SET display_name=EXCLUDED.display_name, sort_order=EXCLUDED.sort_order, is_terminal=EXCLUDED.is_terminal, badge_style=EXCLUDED.badge_style, is_active=true;

INSERT INTO rbac_data_scope_types (code, label, description, sort_order) VALUES
  ('OWN_RECORDS','Own Records','Only records created by or assigned to the user',10),
  ('OWN_DIVISION','Own Division','Records in the user''s assigned division',20),
  ('OWN_BRANCH','Own Branch','Records in the user''s assigned branch',30),
  ('OWN_PROVINCE','Own Province','Records in the user''s province',40),
  ('DEPARTMENT_WIDE','Department-wide','All records in the user''s department',50),
  ('SYSTEM_WIDE','System-wide','All records across NJSS',60)
ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description, sort_order=EXCLUDED.sort_order, is_active=true;

UPDATE budget_divisions bd SET cost_centre_id = cc.id FROM cost_centres cc WHERE bd.cost_centre_id IS NULL AND (cc.code = bd.cost_centre_code OR cc.name = bd.cost_centre_name);

-- Live NJSS budget-hardening triggers prevent edits to locked approved submissions
-- unless this session flag is set by an authorised workflow/migration path.
SELECT set_config('njss.budget_workflow', 'on', true);

UPDATE divisional_budget_lines l SET priority_level_id = p.id FROM priority_levels p WHERE l.priority_level_id IS NULL AND UPPER(l.priority) = p.code;
UPDATE divisional_budget_lines l SET procurement_method_id = p.id FROM procurement_methods p WHERE l.procurement_method_id IS NULL AND UPPER(l.procurement_method) = p.code;
UPDATE divisional_budget_lines l SET unit_of_measure_id = u.id FROM units_of_measure u WHERE l.unit_of_measure_id IS NULL AND UPPER(l.unit_of_measure) IN (u.code, UPPER(u.name));
UPDATE divisional_budget_lines l SET responsible_officer_id = u.id FROM users u WHERE l.responsible_officer_id IS NULL AND (LOWER(l.responsible_officer) = LOWER(u.full_name) OR LOWER(l.responsible_officer) = LOWER(u.email));
UPDATE ff3_headers h SET urgency_level_id = u.id FROM urgency_levels u WHERE h.urgency_level_id IS NULL AND UPPER(h.urgency_level) = u.code;
UPDATE ff3_headers h SET procurement_method_id = p.id FROM procurement_methods p WHERE h.procurement_method_id IS NULL AND UPPER(h.procurement_method) = p.code;
UPDATE ff3_items i SET unit_of_measure_id = u.id FROM units_of_measure u WHERE i.unit_of_measure_id IS NULL AND UPPER(i.unit_of_measure) IN (u.code, UPPER(u.name));
UPDATE ff4_headers h SET payee_type_id = p.id FROM payee_types p WHERE h.payee_type_id IS NULL AND UPPER(h.payee_type) = p.code;
UPDATE ff4_headers h SET payment_method_id = p.id FROM payment_methods p WHERE h.payment_method_id IS NULL AND UPPER(h.payment_method) = p.code;

CREATE OR REPLACE VIEW v_audit_entity_types AS SELECT DISTINCT entity_type AS code, INITCAP(REPLACE(entity_type, '_', ' ')) AS name FROM audit_logs WHERE entity_type IS NOT NULL ORDER BY entity_type;
CREATE OR REPLACE VIEW v_audit_actions AS SELECT DISTINCT action AS code, INITCAP(REPLACE(action, '_', ' ')) AS name FROM audit_logs WHERE action IS NOT NULL ORDER BY action;

GRANT SELECT ON priority_levels, urgency_levels, procurement_methods, units_of_measure, payee_types, payment_methods, suppliers, workflow_statuses, budget_periods, rbac_data_scope_types, report_categories, report_definitions TO anon, authenticated;
GRANT SELECT ON v_audit_entity_types, v_audit_actions TO anon, authenticated;
GRANT INSERT, UPDATE ON priority_levels, urgency_levels, procurement_methods, units_of_measure, payee_types, payment_methods, suppliers TO authenticated;
