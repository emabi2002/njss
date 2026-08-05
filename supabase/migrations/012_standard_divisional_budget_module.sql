-- NJSS Standard Divisional Budget Module
-- Implements the divisional budget preparation template: finance-code ledger,
-- budget cycles, division submissions, detailed activity lines, monthly
-- allocations, validation totals, workflow history, and consolidation views.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. Standard finance-code ledger used by the template
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ledger_number VARCHAR(40) UNIQUE,
    finance_code VARCHAR(60) UNIQUE NOT NULL,
    standard_description TEXT NOT NULL,
    budget_class VARCHAR(80) DEFAULT 'Operational',
    expense_category VARCHAR(100) DEFAULT 'General',
    is_posting BOOLEAN DEFAULT true,
    parent_ledger_id UUID REFERENCES expense_ledger(id),
    source_description TEXT,
    correction_notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 2. Budget-cycle and division registers
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS budget_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_year INTEGER NOT NULL,
    cycle_type VARCHAR(50) DEFAULT 'ANNUAL',
    name VARCHAR(160) NOT NULL,
    status VARCHAR(40) DEFAULT 'OPEN',
    submission_deadline DATE,
    department_ceiling DECIMAL(15,2) DEFAULT 0,
    instructions TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (budget_year, cycle_type)
);

CREATE TABLE IF NOT EXISTS budget_divisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(40) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    department_id UUID REFERENCES departments(id),
    section_id UUID REFERENCES sections(id),
    cost_centre_code VARCHAR(40),
    cost_centre_name VARCHAR(200),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 3. Divisional budget submission header
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS divisional_budget_submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_number VARCHAR(60) UNIQUE,
    cycle_id UUID REFERENCES budget_cycles(id),
    budget_year INTEGER NOT NULL,
    division_id UUID REFERENCES budget_divisions(id),
    department_id UUID REFERENCES departments(id),
    cost_centre VARCHAR(120),
    submission_reference VARCHAR(120),
    version INTEGER DEFAULT 1,
    budget_ceiling DECIMAL(15,2) DEFAULT 0,
    status VARCHAR(40) DEFAULT 'DRAFT',
    validation_status VARCHAR(40) DEFAULT 'PENDING',
    total_proposed_budget DECIMAL(15,2) DEFAULT 0,
    total_monthly_allocation DECIMAL(15,2) DEFAULT 0,
    unallocated_variance DECIMAL(15,2) DEFAULT 0,
    is_locked BOOLEAN DEFAULT false,
    date_prepared DATE DEFAULT CURRENT_DATE,
    prepared_by UUID REFERENCES users(id),
    submitted_by UUID REFERENCES users(id),
    reviewed_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    rejected_by UUID REFERENCES users(id),
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    return_reason TEXT,
    approval_comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------
-- 4. Activity / line-item template rows
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS divisional_budget_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_line_number VARCHAR(80) UNIQUE,
    submission_id UUID REFERENCES divisional_budget_submissions(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    activity_reference VARCHAR(120),
    expense_ledger_id UUID REFERENCES expense_ledger(id),
    line_item_description TEXT NOT NULL,
    business_justification TEXT NOT NULL,
    expected_output TEXT,
    location_destination_provider TEXT,
    beneficiary_custodian_officer TEXT,
    start_date DATE,
    end_date DATE,
    quantity DECIMAL(12,2) DEFAULT 1,
    unit_of_measure VARCHAR(60),
    unit_cost DECIMAL(15,2) DEFAULT 0,
    frequency_periods INTEGER DEFAULT 1,
    other_costs DECIMAL(15,2) DEFAULT 0,
    annual_estimate DECIMAL(15,2) GENERATED ALWAYS AS (
        (COALESCE(quantity, 0) * COALESCE(unit_cost, 0) * COALESCE(frequency_periods, 0)) + COALESCE(other_costs, 0)
    ) STORED,
    monthly_allocation_total DECIMAL(15,2) DEFAULT 0,
    allocation_variance DECIMAL(15,2) GENERATED ALWAYS AS (
        ((COALESCE(quantity, 0) * COALESCE(unit_cost, 0) * COALESCE(frequency_periods, 0)) + COALESCE(other_costs, 0)) - COALESCE(monthly_allocation_total, 0)
    ) STORED,
    priority VARCHAR(20) DEFAULT 'MEDIUM',
    funding_source_id UUID REFERENCES funding_sources(id),
    procurement_method VARCHAR(80),
    responsible_officer VARCHAR(200),
    supporting_reference VARCHAR(200),
    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (submission_id, line_number)
);

CREATE TABLE IF NOT EXISTS budget_monthly_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_line_id UUID REFERENCES divisional_budget_lines(id) ON DELETE CASCADE,
    month_number INTEGER NOT NULL CHECK (month_number BETWEEN 1 AND 12),
    month_name VARCHAR(20) NOT NULL,
    amount DECIMAL(15,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (budget_line_id, month_number)
);

CREATE TABLE IF NOT EXISTS budget_workflow_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id UUID REFERENCES divisional_budget_submissions(id) ON DELETE CASCADE,
    from_status VARCHAR(40),
    to_status VARCHAR(40) NOT NULL,
    action VARCHAR(40) NOT NULL,
    comments TEXT,
    changed_by UUID REFERENCES users(id),
    changed_by_email VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Upgrade older partial installations of this module in-place.
ALTER TABLE expense_ledger
    ADD COLUMN IF NOT EXISTS ledger_number VARCHAR(40),
    ADD COLUMN IF NOT EXISTS budget_class VARCHAR(80) DEFAULT 'Operational',
    ADD COLUMN IF NOT EXISTS expense_category VARCHAR(100) DEFAULT 'General',
    ADD COLUMN IF NOT EXISTS is_posting BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS parent_ledger_id UUID REFERENCES expense_ledger(id),
    ADD COLUMN IF NOT EXISTS source_description TEXT,
    ADD COLUMN IF NOT EXISTS correction_notes TEXT,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE budget_cycles
    ADD COLUMN IF NOT EXISTS cycle_type VARCHAR(50) DEFAULT 'ANNUAL',
    ADD COLUMN IF NOT EXISTS status VARCHAR(40) DEFAULT 'OPEN',
    ADD COLUMN IF NOT EXISTS submission_deadline DATE,
    ADD COLUMN IF NOT EXISTS department_ceiling DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS instructions TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE budget_divisions
    ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id),
    ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES sections(id),
    ADD COLUMN IF NOT EXISTS cost_centre_code VARCHAR(40),
    ADD COLUMN IF NOT EXISTS cost_centre_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE divisional_budget_submissions
    ADD COLUMN IF NOT EXISTS submission_number VARCHAR(60),
    ADD COLUMN IF NOT EXISTS cycle_id UUID REFERENCES budget_cycles(id),
    ADD COLUMN IF NOT EXISTS budget_year INTEGER,
    ADD COLUMN IF NOT EXISTS division_id UUID REFERENCES budget_divisions(id),
    ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES departments(id),
    ADD COLUMN IF NOT EXISTS cost_centre VARCHAR(120),
    ADD COLUMN IF NOT EXISTS submission_reference VARCHAR(120),
    ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS budget_ceiling DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS status VARCHAR(40) DEFAULT 'DRAFT',
    ADD COLUMN IF NOT EXISTS validation_status VARCHAR(40) DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS total_proposed_budget DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_monthly_allocation DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS unallocated_variance DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS date_prepared DATE DEFAULT CURRENT_DATE,
    ADD COLUMN IF NOT EXISTS prepared_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS return_reason TEXT,
    ADD COLUMN IF NOT EXISTS approval_comments TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE divisional_budget_lines
    ADD COLUMN IF NOT EXISTS budget_line_number VARCHAR(80),
    ADD COLUMN IF NOT EXISTS activity_reference VARCHAR(120),
    ADD COLUMN IF NOT EXISTS expected_output TEXT,
    ADD COLUMN IF NOT EXISTS location_destination_provider TEXT,
    ADD COLUMN IF NOT EXISTS beneficiary_custodian_officer TEXT,
    ADD COLUMN IF NOT EXISTS start_date DATE,
    ADD COLUMN IF NOT EXISTS end_date DATE,
    ADD COLUMN IF NOT EXISTS quantity DECIMAL(12,2) DEFAULT 1,
    ADD COLUMN IF NOT EXISTS unit_of_measure VARCHAR(60),
    ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS frequency_periods INTEGER DEFAULT 1,
    ADD COLUMN IF NOT EXISTS other_costs DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS monthly_allocation_total DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'MEDIUM',
    ADD COLUMN IF NOT EXISTS funding_source_id UUID REFERENCES funding_sources(id),
    ADD COLUMN IF NOT EXISTS procurement_method VARCHAR(80),
    ADD COLUMN IF NOT EXISTS responsible_officer VARCHAR(200),
    ADD COLUMN IF NOT EXISTS supporting_reference VARCHAR(200),
    ADD COLUMN IF NOT EXISTS comments TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'divisional_budget_lines' AND column_name = 'annual_estimate'
    ) THEN
        ALTER TABLE divisional_budget_lines ADD COLUMN annual_estimate DECIMAL(15,2) GENERATED ALWAYS AS (
            (COALESCE(quantity, 0) * COALESCE(unit_cost, 0) * COALESCE(frequency_periods, 0)) + COALESCE(other_costs, 0)
        ) STORED;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'divisional_budget_lines' AND column_name = 'allocation_variance'
    ) THEN
        ALTER TABLE divisional_budget_lines ADD COLUMN allocation_variance DECIMAL(15,2) GENERATED ALWAYS AS (
            ((COALESCE(quantity, 0) * COALESCE(unit_cost, 0) * COALESCE(frequency_periods, 0)) + COALESCE(other_costs, 0)) - COALESCE(monthly_allocation_total, 0)
        ) STORED;
    END IF;
END $$;

ALTER TABLE budget_monthly_allocations
    ADD COLUMN IF NOT EXISTS month_name VARCHAR(20),
    ADD COLUMN IF NOT EXISTS amount DECIMAL(15,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE budget_workflow_history
    ADD COLUMN IF NOT EXISTS from_status VARCHAR(40),
    ADD COLUMN IF NOT EXISTS to_status VARCHAR(40),
    ADD COLUMN IF NOT EXISTS action VARCHAR(40),
    ADD COLUMN IF NOT EXISTS comments TEXT,
    ADD COLUMN IF NOT EXISTS changed_by UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS changed_by_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS ux_expense_ledger_finance_code ON expense_ledger(finance_code);
CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_cycles_year_type ON budget_cycles(budget_year, cycle_type);
CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_divisions_code ON budget_divisions(code);
CREATE UNIQUE INDEX IF NOT EXISTS ux_divisional_budget_submissions_number ON divisional_budget_submissions(submission_number);
CREATE UNIQUE INDEX IF NOT EXISTS ux_divisional_budget_lines_number ON divisional_budget_lines(budget_line_number);
CREATE UNIQUE INDEX IF NOT EXISTS ux_divisional_budget_lines_submission_line ON divisional_budget_lines(submission_id, line_number);
CREATE UNIQUE INDEX IF NOT EXISTS ux_budget_monthly_allocations_line_month ON budget_monthly_allocations(budget_line_id, month_number);

-- ---------------------------------------------------------------------
-- 5. Numbering and recalculation triggers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_divisional_budget_submission_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.submission_number IS NULL THEN
        NEW.submission_number := 'DB-' || NEW.budget_year || '-' ||
            LPAD((
                SELECT COALESCE(MAX(CAST(SUBSTRING(submission_number FROM 9) AS INTEGER)), 0) + 1
                FROM divisional_budget_submissions
                WHERE budget_year = NEW.budget_year
                  AND submission_number ~ ('^DB-' || NEW.budget_year || '-[0-9]+$')
            )::TEXT, 5, '0');
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generate_divisional_budget_submission_number_trigger ON divisional_budget_submissions;
CREATE TRIGGER generate_divisional_budget_submission_number_trigger
    BEFORE INSERT OR UPDATE ON divisional_budget_submissions
    FOR EACH ROW EXECUTE FUNCTION generate_divisional_budget_submission_number();

CREATE OR REPLACE FUNCTION generate_divisional_budget_line_number()
RETURNS TRIGGER AS $$
DECLARE v_year INTEGER;
BEGIN
    IF NEW.budget_line_number IS NULL THEN
        SELECT budget_year INTO v_year FROM divisional_budget_submissions WHERE id = NEW.submission_id;
        NEW.budget_line_number := 'DBL-' || COALESCE(v_year, EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER) || '-' ||
            LPAD((
                SELECT COALESCE(MAX(CAST(SUBSTRING(budget_line_number FROM 10) AS INTEGER)), 0) + 1
                FROM divisional_budget_lines
                WHERE budget_line_number ~ ('^DBL-' || COALESCE(v_year, EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER) || '-[0-9]+$')
            )::TEXT, 6, '0');
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generate_divisional_budget_line_number_trigger ON divisional_budget_lines;
CREATE TRIGGER generate_divisional_budget_line_number_trigger
    BEFORE INSERT OR UPDATE ON divisional_budget_lines
    FOR EACH ROW EXECUTE FUNCTION generate_divisional_budget_line_number();

CREATE OR REPLACE FUNCTION recalc_divisional_budget_submission_totals(p_submission_id UUID)
RETURNS VOID AS $$
DECLARE v_total DECIMAL(15,2); v_monthly DECIMAL(15,2); v_variance DECIMAL(15,2);
BEGIN
    SELECT
        COALESCE(SUM(annual_estimate), 0),
        COALESCE(SUM(monthly_allocation_total), 0),
        COALESCE(SUM(allocation_variance), 0)
    INTO v_total, v_monthly, v_variance
    FROM divisional_budget_lines
    WHERE submission_id = p_submission_id;

    UPDATE divisional_budget_submissions
    SET total_proposed_budget = v_total,
        total_monthly_allocation = v_monthly,
        unallocated_variance = v_variance,
        validation_status = CASE
            WHEN ABS(COALESCE(v_variance, 0)) <= 0.009 THEN 'VALID'
            ELSE 'VARIANCE'
        END,
        updated_at = NOW()
    WHERE id = p_submission_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION recalc_divisional_budget_line_allocations()
RETURNS TRIGGER AS $$
DECLARE v_line_id UUID; v_submission_id UUID;
BEGIN
    v_line_id := COALESCE(NEW.budget_line_id, OLD.budget_line_id);

    UPDATE divisional_budget_lines
    SET monthly_allocation_total = COALESCE((
        SELECT SUM(amount) FROM budget_monthly_allocations WHERE budget_line_id = v_line_id
    ), 0),
    updated_at = NOW()
    WHERE id = v_line_id
    RETURNING submission_id INTO v_submission_id;

    IF v_submission_id IS NOT NULL THEN
        PERFORM recalc_divisional_budget_submission_totals(v_submission_id);
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recalc_line_allocations_trigger ON budget_monthly_allocations;
CREATE TRIGGER recalc_line_allocations_trigger
    AFTER INSERT OR UPDATE OR DELETE ON budget_monthly_allocations
    FOR EACH ROW EXECUTE FUNCTION recalc_divisional_budget_line_allocations();

CREATE OR REPLACE FUNCTION recalc_submission_after_budget_line_change()
RETURNS TRIGGER AS $$
DECLARE v_submission_id UUID;
BEGIN
    v_submission_id := COALESCE(NEW.submission_id, OLD.submission_id);
    IF v_submission_id IS NOT NULL THEN
        PERFORM recalc_divisional_budget_submission_totals(v_submission_id);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recalc_submission_after_budget_line_trigger ON divisional_budget_lines;
CREATE TRIGGER recalc_submission_after_budget_line_trigger
    AFTER INSERT OR UPDATE OR DELETE ON divisional_budget_lines
    FOR EACH ROW EXECUTE FUNCTION recalc_submission_after_budget_line_change();

-- ---------------------------------------------------------------------
-- 6. Workflow transition function
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION transition_divisional_budget_submission(
    p_submission_id UUID,
    p_action VARCHAR,
    p_comments TEXT DEFAULT NULL,
    p_user_email VARCHAR DEFAULT NULL
) RETURNS divisional_budget_submissions AS $$
DECLARE
    v_old divisional_budget_submissions;
    v_new_status VARCHAR(40);
    v_line_count INTEGER;
    v_out divisional_budget_submissions;
BEGIN
    SELECT * INTO v_old FROM divisional_budget_submissions WHERE id = p_submission_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Budget submission not found';
    END IF;

    SELECT COUNT(*) INTO v_line_count FROM divisional_budget_lines WHERE submission_id = p_submission_id;

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

    IF UPPER(p_action) IN ('SUBMIT', 'RESUBMIT') THEN
        IF v_line_count = 0 THEN
            RAISE EXCEPTION 'Add at least one budget line before submission';
        END IF;
        PERFORM recalc_divisional_budget_submission_totals(p_submission_id);
        SELECT * INTO v_old FROM divisional_budget_submissions WHERE id = p_submission_id FOR UPDATE;
        IF ABS(COALESCE(v_old.unallocated_variance, 0)) > 0.009 THEN
            RAISE EXCEPTION 'Monthly allocations must equal annual estimates before submission';
        END IF;
    END IF;

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

    INSERT INTO budget_workflow_history (submission_id, from_status, to_status, action, comments, changed_by_email)
    VALUES (p_submission_id, v_old.status, v_new_status, UPPER(p_action), p_comments, p_user_email);

    PERFORM log_audit_event(NULL, p_user_email, COALESCE(p_user_email, 'System'), UPPER(p_action), 'BUDGET_SUBMISSION', p_submission_id, v_out.submission_number,
        jsonb_build_object('status', v_old.status), jsonb_build_object('status', v_new_status),
        jsonb_build_object('old_status', v_old.status, 'new_status', v_new_status), NULL);

    RETURN v_out;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------
-- 7. Reporting and validation views
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_budget_validation_summary CASCADE;
DROP VIEW IF EXISTS v_department_consolidated_budget CASCADE;
DROP VIEW IF EXISTS v_budget_monthly_cashflow CASCADE;
DROP VIEW IF EXISTS v_budget_template_lines CASCADE;

CREATE VIEW v_budget_template_lines AS
SELECT
    s.id AS submission_id,
    s.submission_number,
    s.budget_year,
    s.status AS submission_status,
    d.code AS division_code,
    d.name AS division_name,
    l.id AS line_id,
    l.line_number,
    l.budget_line_number,
    el.finance_code,
    el.standard_description AS finance_description,
    l.line_item_description,
    l.business_justification,
    l.quantity,
    l.unit_of_measure,
    l.unit_cost,
    l.frequency_periods,
    l.other_costs,
    l.annual_estimate,
    l.monthly_allocation_total,
    l.allocation_variance,
    l.priority
FROM divisional_budget_submissions s
JOIN budget_divisions d ON d.id = s.division_id
LEFT JOIN divisional_budget_lines l ON l.submission_id = s.id
LEFT JOIN expense_ledger el ON el.id = l.expense_ledger_id;

CREATE VIEW v_budget_monthly_cashflow AS
SELECT
    s.budget_year,
    d.code AS division_code,
    d.name AS division_name,
    el.finance_code,
    el.standard_description,
    m.month_number,
    m.month_name,
    SUM(m.amount) AS amount
FROM budget_monthly_allocations m
JOIN divisional_budget_lines l ON l.id = m.budget_line_id
JOIN divisional_budget_submissions s ON s.id = l.submission_id
JOIN budget_divisions d ON d.id = s.division_id
LEFT JOIN expense_ledger el ON el.id = l.expense_ledger_id
GROUP BY s.budget_year, d.code, d.name, el.finance_code, el.standard_description, m.month_number, m.month_name;

CREATE VIEW v_department_consolidated_budget AS
SELECT
    s.budget_year,
    s.department_id,
    dep.code AS department_code,
    dep.name AS department_name,
    d.code AS division_code,
    d.name AS division_name,
    el.finance_code,
    el.standard_description,
    SUM(l.annual_estimate) AS proposed_budget,
    SUM(l.monthly_allocation_total) AS monthly_allocation,
    SUM(l.allocation_variance) AS allocation_variance
FROM divisional_budget_submissions s
JOIN budget_divisions d ON d.id = s.division_id
LEFT JOIN departments dep ON dep.id = s.department_id
JOIN divisional_budget_lines l ON l.submission_id = s.id
LEFT JOIN expense_ledger el ON el.id = l.expense_ledger_id
WHERE s.status IN ('REVIEWED', 'APPROVED')
GROUP BY s.budget_year, s.department_id, dep.code, dep.name, d.code, d.name, el.finance_code, el.standard_description;

CREATE VIEW v_budget_validation_summary AS
SELECT
    s.id,
    s.submission_number,
    s.budget_year,
    d.code AS division_code,
    d.name AS division_name,
    s.status,
    s.validation_status,
    s.budget_ceiling,
    s.total_proposed_budget,
    s.total_monthly_allocation,
    s.unallocated_variance,
    (s.budget_ceiling - s.total_proposed_budget) AS ceiling_variance,
    COUNT(l.id) AS line_count,
    COUNT(l.id) FILTER (WHERE ABS(COALESCE(l.allocation_variance, 0)) > 0.009) AS lines_with_variance
FROM divisional_budget_submissions s
LEFT JOIN budget_divisions d ON d.id = s.division_id
LEFT JOIN divisional_budget_lines l ON l.submission_id = s.id
GROUP BY s.id, d.code, d.name;

-- ---------------------------------------------------------------------
-- 8. Seed standard ledger, cycles and divisions
-- ---------------------------------------------------------------------
INSERT INTO expense_ledger (ledger_number, finance_code, standard_description, budget_class, expense_category, is_posting)
VALUES
    ('01', '5100', 'Personnel emoluments and allowances', 'Operational', 'Personnel', false),
    ('02', '5200', 'Travel and transport', 'Operational', 'Travel', false),
    ('03', '5300', 'Supplies, assets and services', 'Operational', 'Supplies and Services', false),
    ('04', '5400', 'Maintenance and utilities', 'Operational', 'Maintenance', false)
ON CONFLICT (finance_code) DO NOTHING;

INSERT INTO expense_ledger (ledger_number, finance_code, standard_description, budget_class, expense_category, is_posting, parent_ledger_id, source_description)
VALUES
    ('01-01', '5110', 'Salaries and wages', 'Operational', 'Personnel', true, (SELECT id FROM expense_ledger WHERE finance_code = '5100'), 'Payroll-linked permanent and casual staff costs'),
    ('01-02', '5120', 'Domestic allowances', 'Operational', 'Personnel', true, (SELECT id FROM expense_ledger WHERE finance_code = '5100'), 'Approved staff allowances and entitlements'),
    ('02-01', '5210', 'Domestic travel', 'Operational', 'Travel', true, (SELECT id FROM expense_ledger WHERE finance_code = '5200'), 'Official duty travel within Papua New Guinea'),
    ('02-02', '5220', 'International travel', 'Operational', 'Travel', true, (SELECT id FROM expense_ledger WHERE finance_code = '5200'), 'Approved overseas official travel'),
    ('02-03', '5230', 'Vehicle operations and fuel', 'Operational', 'Travel', true, (SELECT id FROM expense_ledger WHERE finance_code = '5200'), 'Fuel, vehicle hire and fleet operations'),
    ('03-01', '5310', 'Office supplies and stationery', 'Operational', 'Supplies and Services', true, (SELECT id FROM expense_ledger WHERE finance_code = '5300'), 'Stationery, printing and consumables'),
    ('03-02', '5320', 'ICT equipment and systems', 'Capital', 'Supplies and Services', true, (SELECT id FROM expense_ledger WHERE finance_code = '5300'), 'Computers, peripherals, systems and licensing'),
    ('03-03', '5330', 'Furniture and fittings', 'Capital', 'Supplies and Services', true, (SELECT id FROM expense_ledger WHERE finance_code = '5300'), 'Office furniture and fittings'),
    ('03-04', '5340', 'Professional and contracted services', 'Operational', 'Supplies and Services', true, (SELECT id FROM expense_ledger WHERE finance_code = '5300'), 'Consultancy, audit, legal and specialist services'),
    ('04-01', '5410', 'Building maintenance', 'Operational', 'Maintenance', true, (SELECT id FROM expense_ledger WHERE finance_code = '5400'), 'Repairs and upkeep of court and office buildings'),
    ('04-02', '5420', 'Equipment maintenance', 'Operational', 'Maintenance', true, (SELECT id FROM expense_ledger WHERE finance_code = '5400'), 'Maintenance of equipment and machinery'),
    ('04-03', '5350', 'Utilities and communications', 'Operational', 'Maintenance', true, (SELECT id FROM expense_ledger WHERE finance_code = '5400'), 'Electricity, water, internet, phone and postage')
ON CONFLICT (finance_code) DO UPDATE SET
    standard_description = EXCLUDED.standard_description,
    budget_class = EXCLUDED.budget_class,
    expense_category = EXCLUDED.expense_category,
    is_posting = EXCLUDED.is_posting,
    parent_ledger_id = EXCLUDED.parent_ledger_id;

INSERT INTO budget_cycles (budget_year, cycle_type, name, status, submission_deadline, department_ceiling, instructions)
VALUES
    (2025, 'ANNUAL', 'FY2025 Divisional Budget Preparation', 'OPEN', '2025-10-31', 0, 'Prepare division activity budgets with monthly cash-flow allocation.'),
    (2026, 'ANNUAL', 'FY2026 Divisional Budget Preparation', 'OPEN', '2026-10-31', 0, 'Prepare division activity budgets with monthly cash-flow allocation.')
ON CONFLICT (budget_year, cycle_type) DO NOTHING;

INSERT INTO budget_divisions (code, name, department_id, section_id, cost_centre_code, cost_centre_name)
SELECT
    COALESCE(cc.code, s.code) AS code,
    s.name AS name,
    s.department_id,
    s.id,
    cc.code,
    COALESCE(cc.name, s.name || ' Cost Centre')
FROM sections s
LEFT JOIN cost_centres cc ON cc.section_id = s.id
WHERE s.is_active = true
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- 9. Permissions, indexes, grants
-- ---------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
    p TEXT;
    perms TEXT[];
BEGIN
    FOR r IN SELECT id, name FROM roles LOOP
        perms := CASE r.name
            WHEN 'System Administrator' THEN ARRAY['budget.template','budget.template.submit','budget.template.review','budget.template.approve']
            WHEN 'Administrator' THEN ARRAY['budget.template','budget.template.review','budget.template.approve']
            WHEN 'Finance Manager' THEN ARRAY['budget.template','budget.template.review','budget.template.approve']
            WHEN 'Department Head' THEN ARRAY['budget.template','budget.template.review']
            WHEN 'Section Manager' THEN ARRAY['budget.template','budget.template.submit']
            WHEN 'Section Head' THEN ARRAY['budget.template','budget.template.submit']
            ELSE ARRAY['budget.template']
        END;
        FOREACH p IN ARRAY perms LOOP
            INSERT INTO role_permissions (role_id, permission, is_allowed)
            VALUES (r.id, p, true)
            ON CONFLICT (role_id, permission) DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_expense_ledger_code ON expense_ledger(finance_code);
CREATE INDEX IF NOT EXISTS idx_budget_cycles_year ON budget_cycles(budget_year);
CREATE INDEX IF NOT EXISTS idx_budget_divisions_department ON budget_divisions(department_id);
CREATE INDEX IF NOT EXISTS idx_divisional_budget_submissions_year ON divisional_budget_submissions(budget_year);
CREATE INDEX IF NOT EXISTS idx_divisional_budget_submissions_status ON divisional_budget_submissions(status);
CREATE INDEX IF NOT EXISTS idx_divisional_budget_lines_submission ON divisional_budget_lines(submission_id);
CREATE INDEX IF NOT EXISTS idx_budget_monthly_allocations_line ON budget_monthly_allocations(budget_line_id);
CREATE INDEX IF NOT EXISTS idx_budget_workflow_history_submission ON budget_workflow_history(submission_id);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'expense_ledger','budget_cycles','budget_divisions','divisional_budget_submissions',
        'divisional_budget_lines','budget_monthly_allocations','budget_workflow_history'
    ] LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT SELECT ON v_budget_template_lines TO anon, authenticated;
GRANT SELECT ON v_budget_monthly_cashflow TO anon, authenticated;
GRANT SELECT ON v_department_consolidated_budget TO anon, authenticated;
GRANT SELECT ON v_budget_validation_summary TO anon, authenticated;
