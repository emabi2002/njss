-- =====================================================================
-- NJSS — Phase 2: Quarterly Budget Release Management
-- Tracks released funds per budget allocation / expense code alongside
-- commitments & actual expenditure. Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. RELEASE NUMBER AUTO-GENERATION  (QR-YYYY-00001)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_release_number() RETURNS TRIGGER AS $$
BEGIN
    NEW.release_number := 'QR-' || NEW.financial_year || '-' ||
        LPAD((
            SELECT COALESCE(MAX(CAST(SUBSTRING(release_number FROM 9) AS INTEGER)), 0) + 1
            FROM quarterly_releases
            WHERE financial_year = NEW.financial_year
              AND release_number ~ ('^QR-' || NEW.financial_year || '-[0-9]+$')
        )::TEXT, 5, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generate_release_number_trigger ON quarterly_releases;
CREATE TRIGGER generate_release_number_trigger
    BEFORE INSERT ON quarterly_releases
    FOR EACH ROW WHEN (NEW.release_number IS NULL)
    EXECUTE FUNCTION generate_release_number();

-- ---------------------------------------------------------------------
-- 2. AUDIT: quarterly releases (entity_type = 'RELEASE')
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_release_changes() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'RELEASE', 'RELEASE', NEW.id, NEW.release_number,
            NULL, jsonb_build_object('quarter', NEW.quarter, 'amount', NEW.released_amount), NULL, NULL);
    ELSIF TG_OP = 'DELETE' THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'CANCEL', 'RELEASE', OLD.id, OLD.release_number,
            jsonb_build_object('amount', OLD.released_amount), NULL, NULL, NULL);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS release_audit_trigger ON quarterly_releases;
CREATE TRIGGER release_audit_trigger AFTER INSERT OR DELETE ON quarterly_releases
    FOR EACH ROW EXECUTE FUNCTION audit_release_changes();

-- ---------------------------------------------------------------------
-- 3. ENHANCED v_budget_by_code — now includes released_amount
--    (DROP + CREATE because column order changes)
-- ---------------------------------------------------------------------
DROP VIEW IF EXISTS v_budget_by_code;
CREATE VIEW v_budget_by_code AS
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
    COALESCE(SUM((SELECT SUM(qr.released_amount) FROM quarterly_releases qr
                  WHERE qr.budget_allocation_id = ba.id)), 0) AS released_amount,
    COALESCE(SUM((SELECT SUM(c.committed_amount - COALESCE(c.paid_amount,0)) FROM ff3_commitments c
                  WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID'))), 0) AS committed_amount,
    COALESCE(SUM((SELECT SUM(c.paid_amount) FROM ff3_commitments c
                  WHERE c.budget_allocation_id = ba.id)), 0) AS actual_expenditure
FROM budget_allocations ba
LEFT JOIN departments d  ON d.id  = ba.department_id
LEFT JOIN sections s     ON s.id  = ba.section_id
LEFT JOIN cost_centres cc ON cc.id = ba.cost_centre_id
LEFT JOIN expense_code_registry ecr ON ecr.id = ba.expense_code_registry_id
WHERE ba.is_active = true
GROUP BY ba.financial_year, ba.department_id, d.name, ba.section_id, s.name,
         ba.cost_centre_id, cc.code, cc.name, ba.expense_code_registry_id, ecr.full_expense_code;

-- ---------------------------------------------------------------------
-- 4. RELEASES-BY-CODE convenience view (per release line + code)
-- ---------------------------------------------------------------------
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
    d.name  AS department_name,
    cc.code AS cost_centre_code,
    cc.name AS cost_centre_name,
    ecr.full_expense_code
FROM quarterly_releases qr
JOIN budget_allocations ba ON ba.id = qr.budget_allocation_id
LEFT JOIN departments d ON d.id = ba.department_id
LEFT JOIN cost_centres cc ON cc.id = ba.cost_centre_id
LEFT JOIN expense_code_registry ecr ON ecr.id = ba.expense_code_registry_id;

-- ---------------------------------------------------------------------
-- 5. PERMISSION: budget.release for Administrator + Finance Manager
-- ---------------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN SELECT id, name FROM roles WHERE name IN ('Administrator', 'Finance Manager') LOOP
        INSERT INTO role_permissions (role_id, permission, is_allowed)
        VALUES (r.id, 'budget.release', true)
        ON CONFLICT (role_id, permission) DO NOTHING;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 6. INDEX + GRANTS
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_qr_alloc ON quarterly_releases(budget_allocation_id);
CREATE INDEX IF NOT EXISTS idx_qr_fy ON quarterly_releases(financial_year);

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT SELECT ON v_budget_by_code TO anon, authenticated;
GRANT SELECT ON v_releases_by_code TO anon, authenticated;
