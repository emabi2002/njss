-- =====================================================================
-- NJSS PHASE 1 REMEDIATION — Funding control reconciliation
-- Source/database/deployment safe patch after 021 may already be applied.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Multi-source budget release attribution and FF3 direct allocation link
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS budget_release_funding_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quarterly_release_id UUID NOT NULL REFERENCES quarterly_releases(id) ON DELETE CASCADE,
  funding_allocation_id UUID NOT NULL REFERENCES funding_allocations(id) ON DELETE RESTRICT,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES users(id),
  UNIQUE (quarterly_release_id, funding_allocation_id)
);

CREATE INDEX IF NOT EXISTS idx_budget_release_funding_lines_release
ON budget_release_funding_lines(quarterly_release_id);

CREATE INDEX IF NOT EXISTS idx_budget_release_funding_lines_allocation
ON budget_release_funding_lines(funding_allocation_id);

ALTER TABLE ff3_headers
  ADD COLUMN IF NOT EXISTS budget_allocation_id UUID REFERENCES budget_allocations(id);

CREATE INDEX IF NOT EXISTS idx_ff3_headers_budget_allocation
ON ff3_headers(budget_allocation_id);

-- Backfill only where the mapping is unique and unambiguous.
WITH candidate_matches AS (
  SELECT
    h.id AS ff3_id,
    ba.id AS budget_allocation_id,
    COUNT(*) OVER (PARTITION BY h.id) AS match_count
  FROM ff3_headers h
  JOIN budget_allocations ba
    ON ba.financial_year = h.financial_year
   AND ba.is_active = true
   AND h.expense_code_registry_id IS NOT NULL
   AND ba.expense_code_registry_id = h.expense_code_registry_id
   AND (h.department_id IS NULL OR ba.department_id IS NOT DISTINCT FROM h.department_id)
   AND (h.section_id IS NULL OR ba.section_id IS NOT DISTINCT FROM h.section_id)
   AND (h.funding_source_id IS NULL OR ba.funding_source_id IS NOT DISTINCT FROM h.funding_source_id)
  WHERE h.budget_allocation_id IS NULL
)
UPDATE ff3_headers h
SET budget_allocation_id = c.budget_allocation_id
FROM candidate_matches c
WHERE h.id = c.ff3_id
  AND c.match_count = 1;

-- Preserve legacy release attribution in the new line table where possible.
INSERT INTO budget_release_funding_lines (quarterly_release_id, funding_allocation_id, amount, created_by)
SELECT qr.id, qr.funding_allocation_id, qr.released_amount, qr.created_by
FROM quarterly_releases qr
WHERE qr.funding_allocation_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM budget_release_funding_lines brfl
    WHERE brfl.quarterly_release_id = qr.id
      AND brfl.funding_allocation_id = qr.funding_allocation_id
  )
ON CONFLICT (quarterly_release_id, funding_allocation_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Maker/checker rules for Phase 1 funding workflows
-- ---------------------------------------------------------------------

INSERT INTO segregation_rules (entity_type, create_action, verify_action, approve_action, allow_same_user, bypass_permission, is_active)
VALUES
  ('FUNDING_AUTHORITY', 'CREATE', 'VERIFY', 'APPROVE', false, 'all', true),
  ('FUNDING_RECEIPT', 'CREATE', 'VERIFY', 'APPROVE', false, 'all', true),
  ('FUNDING_ALLOCATION', 'CREATE', 'VERIFY', 'APPROVE', false, 'all', true)
ON CONFLICT (entity_type, create_action, verify_action, approve_action) DO UPDATE SET
  allow_same_user = EXCLUDED.allow_same_user,
  bypass_permission = EXCLUDED.bypass_permission,
  is_active = true;

-- ---------------------------------------------------------------------
-- 3. Remove allocation auto-approval bypass and enforce separate approval
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS njss_allocate_funding(UUID, UUID, NUMERIC, DATE, TEXT, BOOLEAN, TEXT);

CREATE OR REPLACE FUNCTION njss_allocate_funding(
  p_funding_receipt_id UUID,
  p_budget_allocation_id UUID,
  p_allocated_amount NUMERIC,
  p_allocation_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS funding_allocations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_receipt funding_receipts;
  v_auth funding_authorities;
  v_budget budget_allocations;
  v_row funding_allocations;
  v_actor UUID := fn_current_app_user_id();
  v_receipt_allocated NUMERIC;
  v_receipt_available NUMERIC;
  v_budget_funded NUMERIC;
  v_budget_remaining NUMERIC;
BEGIN
  PERFORM njss_require_permission('funding.allocate');

  IF p_allocated_amount IS NULL OR p_allocated_amount <= 0 THEN
    RAISE EXCEPTION 'Funding allocation amount must be greater than zero. Requested amount: K%', COALESCE(p_allocated_amount, 0);
  END IF;

  SELECT * INTO v_receipt FROM funding_receipts WHERE id = p_funding_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funding receipt not found'; END IF;
  IF v_receipt.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Cannot allocate from receipt %. Only APPROVED receipts are usable. Current status: %.', COALESCE(v_receipt.receipt_number, v_receipt.id::TEXT), v_receipt.status;
  END IF;

  SELECT * INTO v_auth FROM funding_authorities WHERE id = v_receipt.funding_authority_id FOR UPDATE;
  IF NOT FOUND OR v_auth.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Cannot allocate because the linked funding authority is not approved.';
  END IF;

  SELECT * INTO v_budget FROM budget_allocations WHERE id = p_budget_allocation_id AND is_active = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved budget allocation not found'; END IF;

  IF v_budget.financial_year <> v_receipt.financial_year THEN
    RAISE EXCEPTION 'Cannot allocate FY% receipt to FY% budget allocation.', v_receipt.financial_year, v_budget.financial_year;
  END IF;
  IF v_receipt.funding_source_id IS NOT NULL AND v_budget.funding_source_id IS NOT NULL AND v_receipt.funding_source_id <> v_budget.funding_source_id THEN
    RAISE EXCEPTION 'Funding-source mismatch. Receipt source is restricted and does not match this budget allocation funding source.';
  END IF;
  IF v_auth.restricted_project_id IS NOT NULL AND v_budget.project_id IS DISTINCT FROM v_auth.restricted_project_id THEN
    RAISE EXCEPTION 'Restricted funding cannot be allocated to this budget. Authority project restriction does not match.';
  END IF;
  IF v_auth.restricted_department_id IS NOT NULL AND v_budget.department_id IS DISTINCT FROM v_auth.restricted_department_id THEN
    RAISE EXCEPTION 'Restricted funding cannot be allocated to this budget. Authority department restriction does not match.';
  END IF;
  IF v_auth.restricted_section_id IS NOT NULL AND v_budget.section_id IS DISTINCT FROM v_auth.restricted_section_id THEN
    RAISE EXCEPTION 'Restricted funding cannot be allocated to this budget. Authority section restriction does not match.';
  END IF;
  IF v_auth.restricted_cost_centre_id IS NOT NULL AND v_budget.cost_centre_id IS DISTINCT FROM v_auth.restricted_cost_centre_id THEN
    RAISE EXCEPTION 'Restricted funding cannot be allocated to this budget. Authority cost centre restriction does not match.';
  END IF;
  IF v_auth.restricted_expense_code_registry_id IS NOT NULL AND v_budget.expense_code_registry_id IS DISTINCT FROM v_auth.restricted_expense_code_registry_id THEN
    RAISE EXCEPTION 'Restricted funding cannot be allocated to this budget. Authority finance-code restriction does not match.';
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_receipt_allocated
  FROM funding_allocations
  WHERE funding_receipt_id = v_receipt.id AND status = 'APPROVED';
  v_receipt_available := v_receipt.amount_received - v_receipt_allocated;
  IF p_allocated_amount > v_receipt_available + 0.001 THEN
    RAISE EXCEPTION 'Cannot allocate K%. Receipt available balance is K%. Existing approved allocations: K%. Receipt amount: K%.', p_allocated_amount, v_receipt_available, v_receipt_allocated, v_receipt.amount_received;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_budget_funded
  FROM funding_allocations
  WHERE budget_allocation_id = v_budget.id AND status = 'APPROVED';
  v_budget_remaining := v_budget.revised_budget - v_budget_funded;
  IF p_allocated_amount > v_budget_remaining + 0.001 THEN
    RAISE EXCEPTION 'Cannot allocate K%. Budget remaining funding capacity is K%. Approved budget: K%; existing funded amount: K%.', p_allocated_amount, v_budget_remaining, v_budget.revised_budget, v_budget_funded;
  END IF;

  INSERT INTO funding_allocations (
    financial_year, funding_receipt_id, funding_authority_id, funding_source_id,
    budget_allocation_id, department_id, section_id, cost_centre_id, budget_division_id,
    project_id, expense_code_registry_id, allocated_amount, allocation_date, status,
    notes, created_by
  ) VALUES (
    v_budget.financial_year, v_receipt.id, v_auth.id, COALESCE(v_receipt.funding_source_id, v_auth.funding_source_id),
    v_budget.id, v_budget.department_id, v_budget.section_id, v_budget.cost_centre_id,
    CASE WHEN to_jsonb(v_budget) ? 'budget_division_id' THEN (to_jsonb(v_budget)->>'budget_division_id')::UUID ELSE NULL END,
    v_budget.project_id, v_budget.expense_code_registry_id, p_allocated_amount, COALESCE(p_allocation_date, CURRENT_DATE), 'DRAFT',
    p_notes, v_actor
  ) RETURNING * INTO v_row;

  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'FUNDING_ALLOCATION_CREATED', 'FUNDING_ALLOCATION', v_row.id, v_row.allocation_number, NULL, to_jsonb(v_row), jsonb_build_object('amount', v_row.allocated_amount, 'receipt_available_before', v_receipt_available, 'budget_remaining_before', v_budget_remaining, 'approval_required', true), NULL);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION njss_approve_funding_allocation(
  p_allocation_id UUID,
  p_comments TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS funding_allocations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old funding_allocations;
  v_row funding_allocations;
  v_receipt funding_receipts;
  v_budget budget_allocations;
  v_actor UUID := fn_current_app_user_id();
  v_receipt_allocated NUMERIC;
  v_receipt_available NUMERIC;
  v_budget_funded NUMERIC;
  v_budget_remaining NUMERIC;
BEGIN
  PERFORM njss_require_permission('funding.allocation.approve');

  SELECT * INTO v_old FROM funding_allocations WHERE id = p_allocation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funding allocation not found'; END IF;
  IF v_old.status <> 'DRAFT' THEN RAISE EXCEPTION 'Only DRAFT funding allocations can be approved. Current status: %', v_old.status; END IF;

  IF fn_check_segregation_of_duties('FUNDING_ALLOCATION', v_old.created_by, NULL, NULL, v_actor) IS FALSE THEN
    RAISE EXCEPTION 'Segregation of duties prevents the same user from creating and approving this funding allocation.';
  END IF;

  SELECT * INTO v_receipt FROM funding_receipts WHERE id = v_old.funding_receipt_id FOR UPDATE;
  SELECT * INTO v_budget FROM budget_allocations WHERE id = v_old.budget_allocation_id FOR UPDATE;
  IF v_receipt.status <> 'APPROVED' THEN RAISE EXCEPTION 'Cannot approve allocation because receipt % is %.', v_receipt.receipt_number, v_receipt.status; END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_receipt_allocated
  FROM funding_allocations
  WHERE funding_receipt_id = v_receipt.id AND status = 'APPROVED' AND id <> v_old.id;
  v_receipt_available := v_receipt.amount_received - v_receipt_allocated;
  IF v_old.allocated_amount > v_receipt_available + 0.001 THEN
    RAISE EXCEPTION 'Cannot approve allocation K%. Receipt available balance is K%. Existing approved allocations: K%.', v_old.allocated_amount, v_receipt_available, v_receipt_allocated;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_budget_funded
  FROM funding_allocations
  WHERE budget_allocation_id = v_budget.id AND status = 'APPROVED' AND id <> v_old.id;
  v_budget_remaining := v_budget.revised_budget - v_budget_funded;
  IF v_old.allocated_amount > v_budget_remaining + 0.001 THEN
    RAISE EXCEPTION 'Cannot approve allocation K%. Budget remaining funding capacity is K%. Approved budget: K%; existing funded amount: K%.', v_old.allocated_amount, v_budget_remaining, v_budget.revised_budget, v_budget_funded;
  END IF;

  UPDATE funding_allocations
  SET status = 'APPROVED', approved_by = v_actor, approved_at = NOW(), notes = COALESCE(notes, p_comments)
  WHERE id = p_allocation_id
  RETURNING * INTO v_row;

  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'FUNDING_ALLOCATION_APPROVED', 'FUNDING_ALLOCATION', v_row.id, v_row.allocation_number, to_jsonb(v_old), to_jsonb(v_row), jsonb_build_object('amount', v_row.allocated_amount, 'comments', p_comments), NULL);
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------
-- 4. Budget releases must be attributed to one or more funding allocations
-- ---------------------------------------------------------------------

DROP FUNCTION IF EXISTS njss_create_budget_release(UUID, INTEGER, INTEGER, NUMERIC, DATE, UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION njss_create_budget_release(
  p_budget_allocation_id UUID,
  p_financial_year INTEGER,
  p_quarter INTEGER,
  p_released_amount NUMERIC,
  p_release_date DATE DEFAULT NULL,
  p_funding_lines JSONB DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS quarterly_releases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_budget budget_allocations;
  v_row quarterly_releases;
  v_actor UUID := fn_current_app_user_id();
  v_funded NUMERIC;
  v_released NUMERIC;
  v_approved_remaining NUMERIC;
  v_funded_remaining NUMERIC;
  v_max_releasable NUMERIC;
  v_lines_total NUMERIC;
  v_line_count INTEGER;
  v_single_funding_allocation UUID;
  v_bad_line RECORD;
BEGIN
  PERFORM njss_require_permission('budget.release');

  IF p_released_amount IS NULL OR p_released_amount <= 0 THEN
    RAISE EXCEPTION 'Release amount must be greater than zero. Requested amount: K%', COALESCE(p_released_amount, 0);
  END IF;
  IF p_quarter NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'Quarter must be between 1 and 4. Requested quarter: %', p_quarter;
  END IF;
  IF p_funding_lines IS NULL OR jsonb_typeof(p_funding_lines) <> 'array' OR jsonb_array_length(p_funding_lines) = 0 THEN
    RAISE EXCEPTION 'Budget release requires at least one funding attribution line.';
  END IF;

  SELECT * INTO v_budget FROM budget_allocations WHERE id = p_budget_allocation_id AND is_active = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved budget allocation not found'; END IF;
  IF v_budget.financial_year <> p_financial_year THEN RAISE EXCEPTION 'Release FY% does not match budget allocation FY%.', p_financial_year, v_budget.financial_year; END IF;

  SELECT COUNT(*), COALESCE(SUM(amount), 0), MIN(funding_allocation_id)
  INTO v_line_count, v_lines_total, v_single_funding_allocation
  FROM jsonb_to_recordset(p_funding_lines) AS x(funding_allocation_id UUID, amount NUMERIC);

  IF v_line_count = 0 OR ABS(v_lines_total - p_released_amount) > 0.001 THEN
    RAISE EXCEPTION 'Release amount K% must equal funding line total K%.', p_released_amount, COALESCE(v_lines_total, 0);
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_funded
  FROM funding_allocations
  WHERE budget_allocation_id = v_budget.id AND status = 'APPROVED';
  SELECT COALESCE(SUM(released_amount), 0) INTO v_released
  FROM quarterly_releases
  WHERE budget_allocation_id = v_budget.id;

  v_approved_remaining := v_budget.revised_budget - v_released;
  v_funded_remaining := v_funded - v_released;
  v_max_releasable := LEAST(v_approved_remaining, v_funded_remaining);

  IF p_released_amount > v_max_releasable + 0.001 THEN
    IF v_funded_remaining <= v_approved_remaining THEN
      RAISE EXCEPTION 'Release exceeds remaining funded amount. Funded: K%; Previously Released: K%; Maximum Additional Release: K%.', v_funded, v_released, GREATEST(v_max_releasable, 0);
    ELSE
      RAISE EXCEPTION 'Release exceeds remaining approved budget. Approved Budget: K%; Previously Released: K%; Maximum Additional Release: K%.', v_budget.revised_budget, v_released, GREATEST(v_max_releasable, 0);
    END IF;
  END IF;

  SELECT x.funding_allocation_id, x.amount, fa.allocation_number, fa.allocated_amount,
         COALESCE((SELECT SUM(brfl.amount) FROM budget_release_funding_lines brfl WHERE brfl.funding_allocation_id = fa.id), 0) AS already_released
  INTO v_bad_line
  FROM jsonb_to_recordset(p_funding_lines) AS x(funding_allocation_id UUID, amount NUMERIC)
  LEFT JOIN funding_allocations fa ON fa.id = x.funding_allocation_id
  WHERE x.amount IS NULL OR x.amount <= 0
     OR fa.id IS NULL
     OR fa.status <> 'APPROVED'
     OR fa.budget_allocation_id <> v_budget.id
     OR x.amount > (fa.allocated_amount - COALESCE((SELECT SUM(brfl.amount) FROM budget_release_funding_lines brfl WHERE brfl.funding_allocation_id = fa.id), 0)) + 0.001
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Invalid funding release line for allocation %. Requested K%; allocated K%; already released K%.', v_bad_line.funding_allocation_id, COALESCE(v_bad_line.amount, 0), COALESCE(v_bad_line.allocated_amount, 0), COALESCE(v_bad_line.already_released, 0);
  END IF;

  INSERT INTO quarterly_releases (budget_allocation_id, financial_year, quarter, release_date, released_amount, funding_allocation_id, created_by, notes)
  VALUES (v_budget.id, p_financial_year, p_quarter, COALESCE(p_release_date, CURRENT_DATE), p_released_amount, CASE WHEN v_line_count = 1 THEN v_single_funding_allocation ELSE NULL END, v_actor, p_notes)
  RETURNING * INTO v_row;

  INSERT INTO budget_release_funding_lines (quarterly_release_id, funding_allocation_id, amount, created_by)
  SELECT v_row.id, x.funding_allocation_id, x.amount, v_actor
  FROM jsonb_to_recordset(p_funding_lines) AS x(funding_allocation_id UUID, amount NUMERIC);

  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'BUDGET_RELEASE_CREATED', 'QUARTERLY_RELEASE', v_row.id, v_row.release_number, NULL, to_jsonb(v_row), jsonb_build_object('amount', v_row.released_amount, 'funded', v_funded, 'previously_released', v_released, 'maximum_additional_release', v_max_releasable, 'funding_lines', p_funding_lines), NULL);
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. Reporting/control views corrected for release lines and FF3 mapping
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_funding_allocation_register AS
SELECT
  fal.*,
  fr.receipt_number,
  fa.authority_number,
  fs.code AS funding_source_code,
  fs.name AS funding_source_name,
  ba.revised_budget AS approved_budget,
  d.name AS department_name,
  s.name AS section_name,
  cc.code AS cost_centre_code,
  cc.name AS cost_centre_name,
  ecr.full_expense_code,
  (
    COALESCE((SELECT SUM(brfl.amount) FROM budget_release_funding_lines brfl WHERE brfl.funding_allocation_id = fal.id), 0)
    + COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.funding_allocation_id = fal.id AND NOT EXISTS (SELECT 1 FROM budget_release_funding_lines brfl WHERE brfl.quarterly_release_id = qr.id)), 0)
  )::NUMERIC(15,2) AS released_from_allocation,
  (
    fal.allocated_amount
    - (
      COALESCE((SELECT SUM(brfl.amount) FROM budget_release_funding_lines brfl WHERE brfl.funding_allocation_id = fal.id), 0)
      + COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.funding_allocation_id = fal.id AND NOT EXISTS (SELECT 1 FROM budget_release_funding_lines brfl WHERE brfl.quarterly_release_id = qr.id)), 0)
    )
  )::NUMERIC(15,2) AS allocation_unreleased_balance
FROM funding_allocations fal
JOIN funding_receipts fr ON fr.id = fal.funding_receipt_id
LEFT JOIN funding_authorities fa ON fa.id = fal.funding_authority_id
LEFT JOIN funding_sources fs ON fs.id = fal.funding_source_id
JOIN budget_allocations ba ON ba.id = fal.budget_allocation_id
LEFT JOIN departments d ON d.id = ba.department_id
LEFT JOIN sections s ON s.id = ba.section_id
LEFT JOIN cost_centres cc ON cc.id = ba.cost_centre_id
LEFT JOIN expense_code_registry ecr ON ecr.id = ba.expense_code_registry_id;

CREATE OR REPLACE VIEW v_authoritative_budget_position AS
SELECT
  ba.id AS budget_allocation_id,
  ba.financial_year,
  ba.department_id,
  d.name AS department_name,
  ba.section_id,
  s.name AS section_name,
  ba.cost_centre_id,
  cc.code AS cost_centre_code,
  cc.name AS cost_centre_name,
  ba.project_id,
  p.name AS project_name,
  ba.funding_source_id,
  fs.code AS funding_source_code,
  fs.name AS funding_source_name,
  ba.expense_code_registry_id,
  ecr.full_expense_code,
  ba.revised_budget::NUMERIC(15,2) AS approved_budget,
  COALESCE((SELECT SUM(fal.allocated_amount) FROM funding_allocations fal WHERE fal.budget_allocation_id = ba.id AND fal.status = 'APPROVED'), 0)::NUMERIC(15,2) AS funded_amount,
  COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.budget_allocation_id = ba.id), 0)::NUMERIC(15,2) AS released_amount,
  COALESCE((
    SELECT SUM(h.total_estimated_amount)
    FROM ff3_headers h
    WHERE h.financial_year = ba.financial_year
      AND h.status = 'SUBMITTED'
      AND (
        h.budget_allocation_id = ba.id
        OR (
          h.budget_allocation_id IS NULL
          AND h.expense_code_registry_id = ba.expense_code_registry_id
          AND (h.department_id IS NULL OR h.department_id IS NOT DISTINCT FROM ba.department_id)
          AND (h.section_id IS NULL OR h.section_id IS NOT DISTINCT FROM ba.section_id)
          AND (h.funding_source_id IS NULL OR h.funding_source_id IS NOT DISTINCT FROM ba.funding_source_id)
          AND 1 = (
            SELECT COUNT(*)
            FROM budget_allocations bx
            WHERE bx.financial_year = h.financial_year
              AND bx.is_active = true
              AND bx.expense_code_registry_id = h.expense_code_registry_id
              AND (h.department_id IS NULL OR bx.department_id IS NOT DISTINCT FROM h.department_id)
              AND (h.section_id IS NULL OR bx.section_id IS NOT DISTINCT FROM h.section_id)
              AND (h.funding_source_id IS NULL OR bx.funding_source_id IS NOT DISTINCT FROM h.funding_source_id)
          )
        )
      )
  ), 0)::NUMERIC(15,2) AS pending_amount,
  COALESCE((SELECT SUM(c.committed_amount - COALESCE(c.paid_amount,0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID')), 0)::NUMERIC(15,2) AS outstanding_commitment,
  COALESCE((SELECT SUM(COALESCE(c.paid_amount,0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status <> 'CANCELLED'), 0)::NUMERIC(15,2) AS actual_expenditure,
  (COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.budget_allocation_id = ba.id), 0) - COALESCE((SELECT SUM(c.committed_amount - COALESCE(c.paid_amount,0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID')), 0) - COALESCE((SELECT SUM(COALESCE(c.paid_amount,0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status <> 'CANCELLED'), 0))::NUMERIC(15,2) AS available_amount,
  (ba.revised_budget - COALESCE((SELECT SUM(fal.allocated_amount) FROM funding_allocations fal WHERE fal.budget_allocation_id = ba.id AND fal.status = 'APPROVED'), 0))::NUMERIC(15,2) AS unfunded_amount,
  (COALESCE((SELECT SUM(fal.allocated_amount) FROM funding_allocations fal WHERE fal.budget_allocation_id = ba.id AND fal.status = 'APPROVED'), 0) - COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.budget_allocation_id = ba.id), 0))::NUMERIC(15,2) AS unreleased_funding
FROM budget_allocations ba
LEFT JOIN departments d ON d.id = ba.department_id
LEFT JOIN sections s ON s.id = ba.section_id
LEFT JOIN cost_centres cc ON cc.id = ba.cost_centre_id
LEFT JOIN projects p ON p.id = ba.project_id
LEFT JOIN funding_sources fs ON fs.id = ba.funding_source_id
LEFT JOIN expense_code_registry ecr ON ecr.id = ba.expense_code_registry_id
WHERE ba.is_active = true;

DROP VIEW IF EXISTS v_releases_by_code CASCADE;
CREATE VIEW v_releases_by_code AS
SELECT
    qr.id,
    qr.financial_year,
    qr.quarter,
    qr.release_number,
    qr.release_date,
    qr.released_amount,
    ba.id AS budget_allocation_id,
    ba.revised_budget,
    d.name AS department_name,
    cc.code AS cost_centre_code,
    cc.name AS cost_centre_name,
    ecr.full_expense_code,
    jsonb_agg(jsonb_build_object(
      'funding_allocation_id', brfl.funding_allocation_id,
      'amount', brfl.amount,
      'allocation_number', fal.allocation_number,
      'funding_source_code', fs.code,
      'funding_source_name', fs.name
    ) ORDER BY fal.allocation_number) FILTER (WHERE brfl.id IS NOT NULL) AS funding_breakdown
FROM quarterly_releases qr
JOIN budget_allocations ba ON ba.id = qr.budget_allocation_id
LEFT JOIN departments d ON d.id = ba.department_id
LEFT JOIN cost_centres cc ON cc.id = ba.cost_centre_id
LEFT JOIN expense_code_registry ecr ON ecr.id = ba.expense_code_registry_id
LEFT JOIN budget_release_funding_lines brfl ON brfl.quarterly_release_id = qr.id
LEFT JOIN funding_allocations fal ON fal.id = brfl.funding_allocation_id
LEFT JOIN funding_sources fs ON fs.id = fal.funding_source_id
GROUP BY qr.id, qr.financial_year, qr.quarter, qr.release_number, qr.release_date, qr.released_amount, ba.id, ba.revised_budget, d.name, cc.code, cc.name, ecr.full_expense_code;

-- ---------------------------------------------------------------------
-- 6. RBAC/grants/report catalogue repair
-- ---------------------------------------------------------------------

REVOKE ALL ON budget_release_funding_lines FROM anon;
GRANT SELECT ON budget_release_funding_lines TO authenticated;
GRANT SELECT ON v_funding_allocation_register, v_authoritative_budget_position, v_releases_by_code TO authenticated;
REVOKE EXECUTE ON FUNCTION njss_allocate_funding(UUID, UUID, NUMERIC, DATE, TEXT, TEXT) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION njss_create_budget_release(UUID, INTEGER, INTEGER, NUMERIC, DATE, JSONB, TEXT, TEXT) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION njss_allocate_funding(UUID, UUID, NUMERIC, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_approve_funding_allocation(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_create_budget_release(UUID, INTEGER, INTEGER, NUMERIC, DATE, JSONB, TEXT, TEXT) TO authenticated;

DO $$
DECLARE
  v_funding_category_id UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'report_categories')
     AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'report_definitions') THEN
    INSERT INTO report_categories (code, name, description, sort_order, is_active)
    VALUES ('funding', 'Funding Reports', 'Funding authority, receipt, allocation and budget-position reports', 25, true)
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, sort_order = EXCLUDED.sort_order, is_active = true
    RETURNING id INTO v_funding_category_id;

    IF v_funding_category_id IS NULL THEN
      SELECT id INTO v_funding_category_id FROM report_categories WHERE code = 'funding';
    END IF;

    INSERT INTO report_definitions (category_id, report_code, report_name, description, handler_key, sort_order, is_active, required_permission)
    VALUES
      (v_funding_category_id,'funding-authority-register','Funding Authority Register','All funding authorities with receipt and remaining authority balances','v_funding_authority_register',10,true,'budget.report.view'),
      (v_funding_category_id,'funding-receipt-register','Funding Receipt Register','Funding receipts with authority balance and unallocated balance','v_funding_receipt_register',20,true,'budget.report.view'),
      (v_funding_category_id,'funding-allocation-report','Funding Allocation Report','Approved and draft funding allocations against operational budget lines','v_funding_allocation_register',30,true,'budget.report.view'),
      (v_funding_category_id,'funding-source-report','Funding Source Report','Funding totals by source','v_funding_source_report',40,true,'budget.report.view'),
      (v_funding_category_id,'funding-vs-approved-budget','Funding vs Approved Budget','Approved budget compared with actual funded allocations','v_authoritative_budget_position',50,true,'budget.report.view'),
      (v_funding_category_id,'funding-vs-releases','Funding vs Releases','Funded amounts compared with budget releases','v_authoritative_budget_position',60,true,'budget.report.view'),
      (v_funding_category_id,'unfunded-budget-report','Unfunded Budget Report','Approved budget not yet funded','v_authoritative_budget_position',70,true,'budget.report.view'),
      (v_funding_category_id,'unreleased-funding-report','Unreleased Funding Report','Funded amounts not yet released','v_authoritative_budget_position',80,true,'budget.report.view'),
      (v_funding_category_id,'budget-position-report','Budget Position Report','Authoritative budget position by operational allocation','v_authoritative_budget_position',90,true,'budget.report.view')
    ON CONFLICT (report_code) DO UPDATE SET
      category_id = EXCLUDED.category_id,
      report_name = EXCLUDED.report_name,
      description = EXCLUDED.description,
      handler_key = EXCLUDED.handler_key,
      sort_order = EXCLUDED.sort_order,
      required_permission = EXCLUDED.required_permission,
      is_active = true;
  END IF;
END $$;
