-- NJSS Budget Template Grid Audit and Enhanced Consolidation Reports
-- Safe additive migration for the existing divisional budget template module.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Ensure Sheriff Division exists for FY2026 acceptance testing and live use.
INSERT INTO budget_divisions (code, name, cost_centre_code, cost_centre_name, is_active)
VALUES ('SHERIFF', 'Sheriff Division', 'SHERIFF', 'Sheriff Division Cost Centre', true)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    cost_centre_code = COALESCE(budget_divisions.cost_centre_code, EXCLUDED.cost_centre_code),
    cost_centre_name = COALESCE(budget_divisions.cost_centre_name, EXCLUDED.cost_centre_name),
    is_active = true,
    updated_at = NOW();

-- Ensure requested test code 7210 exists as an active posting code while preserving ledger uniqueness.
INSERT INTO expense_ledger (ledger_number, finance_code, standard_description, budget_class, expense_category, is_posting, is_active, source_description)
VALUES ('72-10', '7210', 'Sheriff operations and enforcement travel', 'Operational', 'Court Operations', true, true, 'Standard posting code for Sheriff operational activities')
ON CONFLICT (finance_code) DO UPDATE SET
    ledger_number = COALESCE(expense_ledger.ledger_number, EXCLUDED.ledger_number),
    standard_description = EXCLUDED.standard_description,
    budget_class = EXCLUDED.budget_class,
    expense_category = EXCLUDED.expense_category,
    is_posting = true,
    is_active = true,
    updated_at = NOW();

-- Submission create/update audit.
CREATE OR REPLACE FUNCTION audit_divisional_budget_submission_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'CREATE', 'BUDGET_SUBMISSION', NEW.id, NEW.submission_number,
            NULL, to_jsonb(NEW), jsonb_build_object('status', NEW.status), NULL);
    ELSIF TG_OP = 'UPDATE' AND (
        OLD.status IS DISTINCT FROM NEW.status OR
        OLD.total_proposed_budget IS DISTINCT FROM NEW.total_proposed_budget OR
        OLD.total_monthly_allocation IS DISTINCT FROM NEW.total_monthly_allocation OR
        OLD.unallocated_variance IS DISTINCT FROM NEW.unallocated_variance OR
        OLD.budget_ceiling IS DISTINCT FROM NEW.budget_ceiling
    ) THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'UPDATE', 'BUDGET_SUBMISSION', NEW.id, NEW.submission_number,
            jsonb_build_object('status', OLD.status, 'total', OLD.total_proposed_budget, 'monthly', OLD.total_monthly_allocation, 'variance', OLD.unallocated_variance),
            jsonb_build_object('status', NEW.status, 'total', NEW.total_proposed_budget, 'monthly', NEW.total_monthly_allocation, 'variance', NEW.unallocated_variance),
            jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status), NULL);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS divisional_budget_submission_audit_trigger ON divisional_budget_submissions;
CREATE TRIGGER divisional_budget_submission_audit_trigger
    AFTER INSERT OR UPDATE ON divisional_budget_submissions
    FOR EACH ROW EXECUTE FUNCTION audit_divisional_budget_submission_changes();

-- Budget line create/edit/delete audit.
CREATE OR REPLACE FUNCTION audit_divisional_budget_line_changes()
RETURNS TRIGGER AS $$
DECLARE v_submission_number TEXT;
BEGIN
    SELECT submission_number INTO v_submission_number
    FROM divisional_budget_submissions
    WHERE id = COALESCE(NEW.submission_id, OLD.submission_id);

    IF TG_OP = 'INSERT' THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'CREATE', 'BUDGET_LINE', NEW.id, COALESCE(NEW.budget_line_number, v_submission_number || ':' || NEW.line_number),
            NULL, to_jsonb(NEW), jsonb_build_object('line_number', NEW.line_number, 'annual_estimate', NEW.annual_estimate), NULL);
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'UPDATE', 'BUDGET_LINE', NEW.id, COALESCE(NEW.budget_line_number, v_submission_number || ':' || NEW.line_number),
            to_jsonb(OLD), to_jsonb(NEW), jsonb_build_object('line_number', NEW.line_number), NULL);
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'DELETE', 'BUDGET_LINE', OLD.id, COALESCE(OLD.budget_line_number, v_submission_number || ':' || OLD.line_number),
            to_jsonb(OLD), NULL, jsonb_build_object('line_number', OLD.line_number), NULL);
        RETURN OLD;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS divisional_budget_line_audit_trigger ON divisional_budget_lines;
CREATE TRIGGER divisional_budget_line_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON divisional_budget_lines
    FOR EACH ROW EXECUTE FUNCTION audit_divisional_budget_line_changes();

-- Monthly allocation edit audit.
CREATE OR REPLACE FUNCTION audit_budget_monthly_allocation_changes()
RETURNS TRIGGER AS $$
DECLARE v_line_number TEXT;
BEGIN
    SELECT budget_line_number INTO v_line_number
    FROM divisional_budget_lines
    WHERE id = COALESCE(NEW.budget_line_id, OLD.budget_line_id);

    IF TG_OP = 'INSERT' THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'CREATE', 'BUDGET_MONTHLY_ALLOCATION', NEW.id, v_line_number || ':' || NEW.month_name,
            NULL, to_jsonb(NEW), jsonb_build_object('month', NEW.month_name, 'amount', NEW.amount), NULL);
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' AND OLD.amount IS DISTINCT FROM NEW.amount THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'UPDATE', 'BUDGET_MONTHLY_ALLOCATION', NEW.id, v_line_number || ':' || NEW.month_name,
            jsonb_build_object('amount', OLD.amount), jsonb_build_object('amount', NEW.amount), jsonb_build_object('month', NEW.month_name), NULL);
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'DELETE', 'BUDGET_MONTHLY_ALLOCATION', OLD.id, v_line_number || ':' || OLD.month_name,
            to_jsonb(OLD), NULL, jsonb_build_object('month', OLD.month_name), NULL);
        RETURN OLD;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS budget_monthly_allocation_audit_trigger ON budget_monthly_allocations;
CREATE TRIGGER budget_monthly_allocation_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON budget_monthly_allocations
    FOR EACH ROW EXECUTE FUNCTION audit_budget_monthly_allocation_changes();

-- Enhanced consolidated budget with Division, Finance Code, Expense Category, Budget Class and annual totals.
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
WHERE s.status IN ('REVIEWED', 'APPROVED')
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
WHERE s.status IN ('REVIEWED', 'APPROVED')
GROUP BY s.budget_year, s.department_id, dep.code, dep.name, d.id, d.code, d.name,
         el.id, el.finance_code, el.ledger_number, el.standard_description, el.budget_class, el.expense_category,
         m.month_number, m.month_name;

GRANT SELECT ON v_department_consolidated_budget TO anon, authenticated;
GRANT SELECT ON v_department_consolidated_budget_monthly TO anon, authenticated;
