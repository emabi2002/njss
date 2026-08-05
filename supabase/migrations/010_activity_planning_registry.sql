-- =====================================================================
-- NJSS — Phase 1: Activity Planning, Code Registry & Budget Consolidation
-- Adds the missing planning/registry layer on top of the existing schema.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. FINANCIAL YEARS (reference)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financial_years (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    year INTEGER UNIQUE NOT NULL,
    name VARCHAR(50),
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT true,
    is_open BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 2. COST CENTRES (assigned to a section / department)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cost_centres (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    department_id UUID REFERENCES departments(id),
    section_id UUID REFERENCES sections(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 3. EXPENSE ITEMS (elementary items under a major category)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    expense_category_id UUID REFERENCES expense_categories(id),
    code VARCHAR(20) NOT NULL,
    name VARCHAR(200) NOT NULL,
    default_unit VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (expense_category_id, code)
);

-- ---------------------------------------------------------------------
-- 4. EXPENSE CODE REGISTRY (full hierarchical code DEPT-CC-CAT-ITEM)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_code_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    financial_year INTEGER,
    department_id UUID REFERENCES departments(id),
    section_id UUID REFERENCES sections(id),
    cost_centre_id UUID REFERENCES cost_centres(id),
    expense_category_id UUID REFERENCES expense_categories(id),
    expense_item_id UUID REFERENCES expense_items(id),
    full_expense_code VARCHAR(120) UNIQUE NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 5. ACTIVITY TEMPLATES (standard activity / purchase descriptions)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS activity_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(200) NOT NULL,
    expense_category_id UUID REFERENCES expense_categories(id),
    default_unit VARCHAR(50),
    default_unit_cost DECIMAL(15,2) DEFAULT 0,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 6. BUDGET CONSOLIDATIONS (department roll-up of approved plans)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_consolidations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    financial_year INTEGER NOT NULL,
    department_id UUID REFERENCES departments(id),
    status VARCHAR(50) DEFAULT 'DRAFT',
    total_amount DECIMAL(15,2) DEFAULT 0,
    section_count INTEGER DEFAULT 0,
    plan_count INTEGER DEFAULT 0,
    consolidated_by UUID REFERENCES users(id),
    consolidated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (financial_year, department_id)
);

-- ---------------------------------------------------------------------
-- 7. EXTEND annual_plan_headers (full workflow + cost centre + totals)
-- ---------------------------------------------------------------------
ALTER TABLE annual_plan_headers
    ADD COLUMN IF NOT EXISTS cost_centre_id UUID REFERENCES cost_centres(id),
    ADD COLUMN IF NOT EXISTS plan_title VARCHAR(200),
    ADD COLUMN IF NOT EXISTS total_planned_budget DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS prepared_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS registrar_authorized_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS budget_confirmed_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS registrar_authorized_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS budget_confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- ---------------------------------------------------------------------
-- 8. EXTEND annual_plan_lines (expense code + quantity x unit cost)
-- ---------------------------------------------------------------------
ALTER TABLE annual_plan_lines
    ADD COLUMN IF NOT EXISTS expense_code_registry_id UUID REFERENCES expense_code_registry(id),
    ADD COLUMN IF NOT EXISTS cost_centre_id UUID REFERENCES cost_centres(id),
    ADD COLUMN IF NOT EXISTS item_description TEXT,
    ADD COLUMN IF NOT EXISTS quantity DECIMAL(12,2) DEFAULT 1,
    ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS remarks TEXT;

-- ---------------------------------------------------------------------
-- 9. EXTEND budget_allocations + ff3_headers with cost centre / code
-- ---------------------------------------------------------------------
ALTER TABLE budget_allocations
    ADD COLUMN IF NOT EXISTS cost_centre_id UUID REFERENCES cost_centres(id),
    ADD COLUMN IF NOT EXISTS expense_code_registry_id UUID REFERENCES expense_code_registry(id);

ALTER TABLE ff3_headers
    ADD COLUMN IF NOT EXISTS cost_centre_id UUID REFERENCES cost_centres(id),
    ADD COLUMN IF NOT EXISTS expense_code_registry_id UUID REFERENCES expense_code_registry(id);

-- ---------------------------------------------------------------------
-- 10. FULL EXPENSE CODE AUTO-GENERATION (DEPT-CC-CAT-ITEM)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_full_expense_code() RETURNS TRIGGER AS $$
DECLARE
    v_dept TEXT; v_cc TEXT; v_cat TEXT; v_item TEXT;
BEGIN
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

DROP TRIGGER IF EXISTS generate_full_expense_code_trigger ON expense_code_registry;
CREATE TRIGGER generate_full_expense_code_trigger
    BEFORE INSERT OR UPDATE ON expense_code_registry
    FOR EACH ROW EXECUTE FUNCTION generate_full_expense_code();

-- ---------------------------------------------------------------------
-- 11. ANNUAL PLAN total recalculation (line total = qty * unit_cost)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalc_annual_plan_total() RETURNS TRIGGER AS $$
DECLARE v_header UUID;
BEGIN
    v_header := COALESCE(NEW.plan_header_id, OLD.plan_header_id);
    UPDATE annual_plan_headers h
    SET total_planned_budget = COALESCE((
        SELECT SUM(COALESCE(l.total_amount, 0)) FROM annual_plan_lines l WHERE l.plan_header_id = v_header
    ), 0)
    WHERE h.id = v_header;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recalc_plan_total_trigger ON annual_plan_lines;
CREATE TRIGGER recalc_plan_total_trigger
    AFTER INSERT OR UPDATE OR DELETE ON annual_plan_lines
    FOR EACH ROW EXECUTE FUNCTION recalc_annual_plan_total();

-- ---------------------------------------------------------------------
-- 12. AUDIT: annual plans + expense code registry
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_annual_plan_changes() RETURNS TRIGGER AS $$
DECLARE v_action VARCHAR(40);
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'CREATE', 'ANNUAL_PLAN', NEW.id, NEW.plan_number,
            NULL, jsonb_build_object('status', NEW.status), NULL, NULL);
    ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        v_action := CASE NEW.status
            WHEN 'SUBMITTED' THEN 'SUBMIT'
            WHEN 'REVIEWED' THEN 'REVIEW'
            WHEN 'APPROVED_BY_DEPARTMENT' THEN 'APPROVE'
            WHEN 'AUTHORIZED_BY_REGISTRAR' THEN 'AUTHORIZE'
            WHEN 'BUDGET_CONFIRMED' THEN 'CONFIRM_BUDGET'
            WHEN 'REJECTED' THEN 'REJECT'
            WHEN 'RETURNED_FOR_CORRECTION' THEN 'RETURN'
            ELSE 'UPDATE' END;
        PERFORM log_audit_event(NULL, NULL, 'System', v_action, 'ANNUAL_PLAN', NEW.id, NEW.plan_number,
            jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status),
            jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status), NULL);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS annual_plan_audit_trigger ON annual_plan_headers;
CREATE TRIGGER annual_plan_audit_trigger AFTER INSERT OR UPDATE ON annual_plan_headers
    FOR EACH ROW EXECUTE FUNCTION audit_annual_plan_changes();

CREATE OR REPLACE FUNCTION audit_expense_code_changes() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'CREATE', 'EXPENSE_CODE', NEW.id, NEW.full_expense_code,
            NULL, jsonb_build_object('code', NEW.full_expense_code), NULL, NULL);
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'UPDATE', 'EXPENSE_CODE', NEW.id, NEW.full_expense_code,
            jsonb_build_object('active', OLD.is_active), jsonb_build_object('active', NEW.is_active), NULL, NULL);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS expense_code_audit_trigger ON expense_code_registry;
CREATE TRIGGER expense_code_audit_trigger AFTER INSERT OR UPDATE ON expense_code_registry
    FOR EACH ROW EXECUTE FUNCTION audit_expense_code_changes();

-- ---------------------------------------------------------------------
-- 13. CONSOLIDATED BUDGET VIEW (by section / cost centre / expense code)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_budget_by_code AS
SELECT
    ba.financial_year,
    ba.department_id,
    d.name  AS department_name,
    ba.section_id,
    s.name  AS section_name,
    ba.cost_centre_id,
    cc.code AS cost_centre_code,
    cc.name AS cost_centre_name,
    ba.expense_code_registry_id,
    ecr.full_expense_code,
    SUM(ba.revised_budget) AS revised_budget,
    COALESCE(SUM((SELECT SUM(c.committed_amount - COALESCE(c.paid_amount,0)) FROM ff3_commitments c
                  WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID'))), 0) AS committed_amount,
    COALESCE(SUM((SELECT SUM(c.paid_amount) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id)), 0) AS actual_expenditure
FROM budget_allocations ba
LEFT JOIN departments d  ON d.id  = ba.department_id
LEFT JOIN sections s     ON s.id  = ba.section_id
LEFT JOIN cost_centres cc ON cc.id = ba.cost_centre_id
LEFT JOIN expense_code_registry ecr ON ecr.id = ba.expense_code_registry_id
WHERE ba.is_active = true
GROUP BY ba.financial_year, ba.department_id, d.name, ba.section_id, s.name,
         ba.cost_centre_id, cc.code, cc.name, ba.expense_code_registry_id, ecr.full_expense_code;

-- ---------------------------------------------------------------------
-- 14. INDEXES
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_cost_centres_section ON cost_centres(section_id);
CREATE INDEX IF NOT EXISTS idx_expense_items_cat ON expense_items(expense_category_id);
CREATE INDEX IF NOT EXISTS idx_ecr_fy ON expense_code_registry(financial_year);
CREATE INDEX IF NOT EXISTS idx_ecr_section ON expense_code_registry(section_id);
CREATE INDEX IF NOT EXISTS idx_aph_status ON annual_plan_headers(status);
CREATE INDEX IF NOT EXISTS idx_aph_fy ON annual_plan_headers(financial_year);

-- ---------------------------------------------------------------------
-- 15. ROLES + PERMISSIONS (add new roles; keep existing)
-- ---------------------------------------------------------------------
INSERT INTO roles (name, description) VALUES
    ('Registrar', 'Authorize annual activity plans and consolidated department budget'),
    ('Administrator', 'Manage master data, codes, templates and confirm approved budget'),
    ('Section Manager', 'Prepare annual activity plans and requisitions for their section'),
    ('Executive Viewer', 'Dashboard and management reports only')
ON CONFLICT (name) DO NOTHING;

-- Grant permissions to roles via role_permissions(role_id, permission)
DO $$
DECLARE r RECORD; p TEXT;
DECLARE perms TEXT[];
BEGIN
    FOR r IN SELECT id, name FROM roles LOOP
        perms := CASE r.name
            WHEN 'System Administrator' THEN ARRAY['all']
            WHEN 'Registrar' THEN ARRAY['dashboard.view','plans.review','plans.authorize','budget.view','reports.view','audit.view']
            WHEN 'Administrator' THEN ARRAY['dashboard.view','masterdata.manage','registry.manage','plans.confirm','budget.view','budget.confirm','consolidation.run','users.manage','reports.view']
            WHEN 'Finance Manager' THEN ARRAY['dashboard.view','ff3.approve','ff4.verify','ff4.process','budget.view','reports.view']
            WHEN 'Department Head' THEN ARRAY['dashboard.view','plans.review','ff3.endorse','ff3.reject','reports.view']
            WHEN 'Section Manager' THEN ARRAY['dashboard.view','plans.create','plans.submit','ff3.create','ff4.create','budget.view']
            WHEN 'Section Head' THEN ARRAY['dashboard.view','plans.create','plans.submit','ff3.endorse']
            WHEN 'Requisition Officer' THEN ARRAY['dashboard.view','ff3.create','ff4.create']
            WHEN 'Approver' THEN ARRAY['dashboard.view','ff3.approve']
            WHEN 'Auditor' THEN ARRAY['dashboard.view','audit.view','reports.view']
            WHEN 'Executive Management' THEN ARRAY['dashboard.view','reports.view']
            WHEN 'Executive Viewer' THEN ARRAY['dashboard.view','reports.view']
            ELSE ARRAY['dashboard.view']
        END;
        FOREACH p IN ARRAY perms LOOP
            INSERT INTO role_permissions (role_id, permission, is_allowed)
            VALUES (r.id, p, true)
            ON CONFLICT (role_id, permission) DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 16. SEED: financial years
-- ---------------------------------------------------------------------
INSERT INTO financial_years (year, name, start_date, end_date, is_active, is_open) VALUES
    (2024, 'FY2024', '2024-01-01', '2024-12-31', false, false),
    (2025, 'FY2025', '2025-01-01', '2025-12-31', true, true),
    (2026, 'FY2026', '2026-01-01', '2026-12-31', true, true)
ON CONFLICT (year) DO NOTHING;

-- ---------------------------------------------------------------------
-- 17. SEED: cost centres (one per existing section)
-- ---------------------------------------------------------------------
INSERT INTO cost_centres (code, name, department_id, section_id)
SELECT s.code, s.name || ' Cost Centre', s.department_id, s.id
FROM sections s
WHERE s.is_active = true
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- 18. SEED: elementary expense items per existing category
-- ---------------------------------------------------------------------
INSERT INTO expense_items (expense_category_id, code, name, default_unit)
SELECT ec.id, v.code, v.name, v.unit
FROM expense_categories ec
CROSS JOIN (VALUES
    ('AIR',  'Airfare',            'trip'),
    ('ROAD', 'Road / Vehicle Hire','day'),
    ('ALLOW','Travel Allowance',   'day'),
    ('ACCOM','Accommodation',      'night'),
    ('STA',  'Stationery',         'unit'),
    ('EQP',  'Equipment',          'unit'),
    ('FUEL', 'Fuel',               'litre'),
    ('TRAIN','Training / Workshop','session'),
    ('COMM', 'Communication',      'month'),
    ('MAINT','Maintenance',        'job')
) AS v(code, name, unit)
ON CONFLICT (expense_category_id, code) DO NOTHING;

-- ---------------------------------------------------------------------
-- 19. SEED: standard activity templates (spec section 10)
-- ---------------------------------------------------------------------
INSERT INTO activity_templates (name, default_unit, default_unit_cost, description)
SELECT v.name, v.unit, 0, v.descr
FROM (VALUES
    ('Travel',                 'trip',    'Officer travel for official duty'),
    ('Accommodation',          'night',   'Accommodation during circuit / travel'),
    ('Stationery',             'unit',    'Office stationery supplies'),
    ('Vehicle hire',           'day',     'Hire of vehicle for operations'),
    ('Fuel',                   'litre',   'Fuel for vehicles / generators'),
    ('Office equipment',       'unit',    'Purchase of office equipment'),
    ('IT equipment',           'unit',    'Purchase of IT equipment'),
    ('Maintenance',            'job',     'Repairs and maintenance'),
    ('Training',               'session', 'Staff training'),
    ('Workshops',              'session', 'Workshops and seminars'),
    ('Utilities',              'month',   'Electricity, water, etc.'),
    ('Communication',          'month',   'Phone, internet, postage'),
    ('Registry operations',    'month',   'Court registry operations'),
    ('Court circuit operations','trip',   'Court circuit operations')
) AS v(name, unit, descr)
WHERE NOT EXISTS (SELECT 1 FROM activity_templates);

-- ---------------------------------------------------------------------
-- 20. ACCESS: disable RLS + grants for the new tables
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'financial_years','cost_centres','expense_items','expense_code_registry',
        'activity_templates','budget_consolidations'
    ] LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
