-- =====================================================================
-- NJSS PHASE 2 — FF3 Approval, Commitment Control and Ledger
-- Available Budget -> FF3 Request -> Approval -> Commitment -> Adjustment / Cancellation / Liquidation
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Additive FF3 and commitment structure hardening
-- ---------------------------------------------------------------------

ALTER TABLE ff3_headers
  ADD COLUMN IF NOT EXISTS budget_allocation_id UUID REFERENCES budget_allocations(id),
  ADD COLUMN IF NOT EXISTS budget_mapping_status VARCHAR(60) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_ff3_headers_budget_allocation_phase2 ON ff3_headers(budget_allocation_id);
CREATE INDEX IF NOT EXISTS idx_ff3_headers_pending_by_allocation ON ff3_headers(budget_allocation_id, status)
WHERE status IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD');

ALTER TABLE ff3_commitments
  ADD COLUMN IF NOT EXISTS original_committed_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS current_committed_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS outstanding_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE ff3_commitments
SET original_committed_amount = COALESCE(original_committed_amount, committed_amount),
    current_committed_amount = COALESCE(current_committed_amount, committed_amount),
    outstanding_amount = COALESCE(outstanding_amount, committed_amount - COALESCE(paid_amount, 0)),
    updated_at = COALESCE(updated_at, created_at, NOW())
WHERE original_committed_amount IS NULL
   OR current_committed_amount IS NULL
   OR outstanding_amount IS NULL
   OR updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_ff3_commitments_ff3 ON ff3_commitments(ff3_header_id);
CREATE INDEX IF NOT EXISTS idx_ff3_commitments_budget_allocation ON ff3_commitments(budget_allocation_id);
CREATE INDEX IF NOT EXISTS idx_ff3_commitments_fy_status ON ff3_commitments(financial_year, status);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ff3_one_active_original_commitment
ON ff3_commitments(ff3_header_id)
WHERE ff3_header_id IS NOT NULL AND status IN ('ACTIVE','PARTIALLY_PAID','FULLY_PAID','RELEASED','CLOSED');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ff3_commitment_amounts_phase2') THEN
    ALTER TABLE ff3_commitments
      ADD CONSTRAINT chk_ff3_commitment_amounts_phase2
      CHECK (
        COALESCE(original_committed_amount, committed_amount) > 0
        AND COALESCE(current_committed_amount, committed_amount) >= 0
        AND COALESCE(paid_amount, 0) >= 0
        AND COALESCE(outstanding_amount, COALESCE(current_committed_amount, committed_amount) - COALESCE(paid_amount,0)) >= -0.001
        AND COALESCE(paid_amount, 0) <= COALESCE(current_committed_amount, committed_amount) + 0.001
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ff3_commitment_status_phase2') THEN
    ALTER TABLE ff3_commitments
      ADD CONSTRAINT chk_ff3_commitment_status_phase2
      CHECK (status IN ('ACTIVE','PARTIALLY_PAID','FULLY_PAID','CANCELLED','RELEASED','CLOSED','REVERSED'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS commitment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id UUID NOT NULL REFERENCES ff3_commitments(id) ON DELETE RESTRICT,
  ff3_header_id UUID REFERENCES ff3_headers(id) ON DELETE RESTRICT,
  budget_allocation_id UUID NOT NULL REFERENCES budget_allocations(id) ON DELETE RESTRICT,
  transaction_number VARCHAR(80) UNIQUE,
  transaction_type VARCHAR(60) NOT NULL CHECK (transaction_type IN (
    'ORIGINAL_COMMITMENT', 'INCREASE', 'DECREASE', 'PAYMENT_LIQUIDATION',
    'RELEASE_UNUSED_BALANCE', 'CANCELLATION', 'REVERSAL', 'ADJUSTMENT'
  )),
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason_code VARCHAR(80),
  reason TEXT,
  reference VARCHAR(160),
  previous_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  new_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
  approved_by UUID REFERENCES users(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commitment_transactions_commitment ON commitment_transactions(commitment_id, created_at);
CREATE INDEX IF NOT EXISTS idx_commitment_transactions_budget ON commitment_transactions(budget_allocation_id, transaction_type);
CREATE INDEX IF NOT EXISTS idx_commitment_transactions_ff3 ON commitment_transactions(ff3_header_id);

-- Legacy backfill: create immutable ORIGINAL_COMMITMENT entries where missing.
INSERT INTO commitment_transactions (
  commitment_id, ff3_header_id, budget_allocation_id, transaction_type, amount,
  transaction_date, reason_code, reason, reference, previous_balance, new_balance,
  approved_by, created_by, created_at
)
SELECT
  c.id,
  c.ff3_header_id,
  c.budget_allocation_id,
  'ORIGINAL_COMMITMENT',
  COALESCE(c.original_committed_amount, c.committed_amount),
  c.commitment_date,
  'LEGACY_BACKFILL',
  'Phase 2 immutable ledger backfill for existing commitment.',
  c.commitment_number,
  0,
  COALESCE(c.current_committed_amount, c.committed_amount),
  c.approved_by,
  c.created_by,
  COALESCE(c.created_at, NOW())
FROM ff3_commitments c
WHERE c.budget_allocation_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM commitment_transactions ct
    WHERE ct.commitment_id = c.id
      AND ct.transaction_type = 'ORIGINAL_COMMITMENT'
  );

-- ---------------------------------------------------------------------
-- 2. Helper functions: numbering, exact allocation resolution, balances
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION njss_generate_commitment_transaction_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.transaction_number IS NULL OR NEW.transaction_number = '' THEN
    NEW.transaction_number := 'CMTX-' || EXTRACT(YEAR FROM COALESCE(NEW.created_at, NOW()))::INTEGER || '-' || LPAD((
      SELECT (COALESCE(MAX(CAST(SUBSTRING(transaction_number FROM 11) AS INTEGER)), 0) + 1)::TEXT
      FROM commitment_transactions
      WHERE transaction_number ~ ('^CMTX-' || EXTRACT(YEAR FROM COALESCE(NEW.created_at, NOW()))::INTEGER || '-[0-9]+$')
    ), 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_commitment_transaction_number ON commitment_transactions;
CREATE TRIGGER trg_commitment_transaction_number BEFORE INSERT ON commitment_transactions
FOR EACH ROW EXECUTE FUNCTION njss_generate_commitment_transaction_number();

DROP TRIGGER IF EXISTS trg_ff3_commitments_touch ON ff3_commitments;
CREATE TRIGGER trg_ff3_commitments_touch BEFORE UPDATE ON ff3_commitments
FOR EACH ROW EXECUTE FUNCTION njss_touch_updated_at();

CREATE OR REPLACE FUNCTION njss_commitment_signed_amount(p_type TEXT, p_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_type IN ('ORIGINAL_COMMITMENT','INCREASE','REVERSAL','ADJUSTMENT') THEN COALESCE(p_amount,0)
    WHEN p_type IN ('DECREASE','PAYMENT_LIQUIDATION','RELEASE_UNUSED_BALANCE','CANCELLATION') THEN -COALESCE(p_amount,0)
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION njss_sync_commitment_balances(p_commitment_id UUID)
RETURNS ff3_commitments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row ff3_commitments;
  v_original NUMERIC;
  v_current NUMERIC;
  v_paid NUMERIC;
  v_outstanding NUMERIC;
  v_status TEXT;
BEGIN
  SELECT COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'ORIGINAL_COMMITMENT'), 0),
         COALESCE(SUM(njss_commitment_signed_amount(transaction_type, amount)) FILTER (WHERE transaction_type <> 'PAYMENT_LIQUIDATION'), 0),
         COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'PAYMENT_LIQUIDATION'), 0)
  INTO v_original, v_current, v_paid
  FROM commitment_transactions
  WHERE commitment_id = p_commitment_id;

  IF v_original <= 0 THEN
    SELECT COALESCE(original_committed_amount, committed_amount, 0), COALESCE(committed_amount, 0), COALESCE(paid_amount, 0)
    INTO v_original, v_current, v_paid
    FROM ff3_commitments
    WHERE id = p_commitment_id;
  END IF;

  v_outstanding := GREATEST(v_current - v_paid, 0);
  v_status := CASE
    WHEN v_current <= 0 OR v_outstanding <= 0 AND v_paid = 0 THEN 'RELEASED'
    WHEN v_paid >= v_current AND v_current > 0 THEN 'FULLY_PAID'
    WHEN v_paid > 0 THEN 'PARTIALLY_PAID'
    ELSE 'ACTIVE'
  END;

  UPDATE ff3_commitments
  SET original_committed_amount = v_original,
      current_committed_amount = v_current,
      committed_amount = v_current,
      paid_amount = v_paid,
      outstanding_amount = v_outstanding,
      status = CASE WHEN status = 'CANCELLED' THEN 'CANCELLED' ELSE v_status END,
      updated_at = NOW()
  WHERE id = p_commitment_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION njss_resolve_ff3_budget_allocation(p_ff3_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ff3 ff3_headers;
  v_budget_allocation_id UUID;
  v_matches INTEGER;
BEGIN
  SELECT * INTO v_ff3 FROM ff3_headers WHERE id = p_ff3_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FF3 not found'; END IF;

  IF v_ff3.budget_allocation_id IS NOT NULL THEN
    RETURN v_ff3.budget_allocation_id;
  END IF;

  SELECT COUNT(*), MIN(ba.id)
  INTO v_matches, v_budget_allocation_id
  FROM budget_allocations ba
  WHERE ba.financial_year = v_ff3.financial_year
    AND ba.is_active = true
    AND v_ff3.expense_code_registry_id IS NOT NULL
    AND ba.expense_code_registry_id = v_ff3.expense_code_registry_id
    AND (v_ff3.department_id IS NULL OR ba.department_id IS NOT DISTINCT FROM v_ff3.department_id)
    AND (v_ff3.section_id IS NULL OR ba.section_id IS NOT DISTINCT FROM v_ff3.section_id)
    AND (v_ff3.cost_centre_id IS NULL OR ba.cost_centre_id IS NOT DISTINCT FROM v_ff3.cost_centre_id)
    AND (v_ff3.funding_source_id IS NULL OR ba.funding_source_id IS NOT DISTINCT FROM v_ff3.funding_source_id)
    AND (v_ff3.project_id IS NULL OR ba.project_id IS NOT DISTINCT FROM v_ff3.project_id);

  IF v_matches = 1 THEN
    UPDATE ff3_headers
    SET budget_allocation_id = v_budget_allocation_id,
        budget_mapping_status = 'RESOLVED',
        updated_at = NOW()
    WHERE id = p_ff3_id;
    RETURN v_budget_allocation_id;
  END IF;

  UPDATE ff3_headers
  SET budget_mapping_status = CASE WHEN v_matches = 0 THEN 'BUDGET_MAPPING_REQUIRED' ELSE 'BUDGET_MAPPING_REQUIRED_AMBIGUOUS' END,
      updated_at = NOW()
  WHERE id = p_ff3_id;

  IF v_matches = 0 THEN
    RAISE EXCEPTION 'BUDGET_MAPPING_REQUIRED: No exact approved budget allocation could be resolved for this FF3.';
  END IF;
  RAISE EXCEPTION 'BUDGET_MAPPING_REQUIRED: Multiple budget allocations match this FF3. Select the exact budget allocation before proceeding.';
END;
$$;

CREATE OR REPLACE FUNCTION njss_budget_position_for_allocation(p_budget_allocation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_released NUMERIC;
  v_pending NUMERIC;
  v_commitment NUMERIC;
  v_actual NUMERIC;
  v_available NUMERIC;
  v_budget budget_allocations;
BEGIN
  SELECT * INTO v_budget FROM budget_allocations WHERE id = p_budget_allocation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget allocation not found'; END IF;

  SELECT COALESCE(SUM(released_amount),0) INTO v_released
  FROM quarterly_releases WHERE budget_allocation_id = p_budget_allocation_id;

  SELECT COALESCE(SUM(total_estimated_amount),0) INTO v_pending
  FROM ff3_headers
  WHERE budget_allocation_id = p_budget_allocation_id
    AND status IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD');

  SELECT COALESCE(SUM(outstanding_amount),0), COALESCE(SUM(paid_amount),0)
  INTO v_commitment, v_actual
  FROM ff3_commitments
  WHERE budget_allocation_id = p_budget_allocation_id
    AND status IN ('ACTIVE','PARTIALLY_PAID','FULLY_PAID','CANCELLED','RELEASED','CLOSED');

  v_available := v_released - v_commitment - v_actual;

  RETURN jsonb_build_object(
    'budget_allocation_id', p_budget_allocation_id,
    'financial_year', v_budget.financial_year,
    'approved_budget', v_budget.revised_budget,
    'released_amount', v_released,
    'pending_amount', v_pending,
    'outstanding_commitment', v_commitment,
    'actual_expenditure', v_actual,
    'available_amount', v_available
  );
END;
$$;

-- ---------------------------------------------------------------------
-- 3. Exact pending and available budget view corrected for Phase 2 ledger
-- ---------------------------------------------------------------------

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
  COALESCE((SELECT SUM(h.total_estimated_amount) FROM ff3_headers h WHERE h.budget_allocation_id = ba.id AND h.status IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD')), 0)::NUMERIC(15,2) AS pending_amount,
  COALESCE((SELECT SUM(c.outstanding_amount) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID','FULLY_PAID','CANCELLED','RELEASED','CLOSED')), 0)::NUMERIC(15,2) AS outstanding_commitment,
  COALESCE((SELECT SUM(c.paid_amount) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID','FULLY_PAID','CANCELLED','RELEASED','CLOSED')), 0)::NUMERIC(15,2) AS actual_expenditure,
  (
    COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.budget_allocation_id = ba.id), 0)
    - COALESCE((SELECT SUM(c.outstanding_amount) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID','FULLY_PAID','CANCELLED','RELEASED','CLOSED')), 0)
    - COALESCE((SELECT SUM(c.paid_amount) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID','FULLY_PAID','CANCELLED','RELEASED','CLOSED')), 0)
  )::NUMERIC(15,2) AS available_amount,
  (ba.revised_budget - COALESCE((SELECT SUM(fal.allocated_amount) FROM funding_allocations fal WHERE fal.budget_allocation_id = ba.id AND fal.status = 'APPROVED'), 0))::NUMERIC(15,2) AS unfunded_amount,
  (COALESCE((SELECT SUM(fal.allocated_amount) FROM funding_allocations fal WHERE fal.budget_allocation_id = ba.id AND fal.status = 'APPROVED'), 0) - COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.budget_allocation_id = ba.id), 0))::NUMERIC(15,2) AS unreleased_funding,
  (
    COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.budget_allocation_id = ba.id), 0)
    - COALESCE((SELECT SUM(c.outstanding_amount) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID','FULLY_PAID','CANCELLED','RELEASED','CLOSED')), 0)
    - COALESCE((SELECT SUM(c.paid_amount) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID','FULLY_PAID','CANCELLED','RELEASED','CLOSED')), 0)
    - COALESCE((SELECT SUM(h.total_estimated_amount) FROM ff3_headers h WHERE h.budget_allocation_id = ba.id AND h.status IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD')), 0)
  )::NUMERIC(15,2) AS projected_available_after_pending
FROM budget_allocations ba
LEFT JOIN departments d ON d.id = ba.department_id
LEFT JOIN sections s ON s.id = ba.section_id
LEFT JOIN cost_centres cc ON cc.id = ba.cost_centre_id
LEFT JOIN projects p ON p.id = ba.project_id
LEFT JOIN funding_sources fs ON fs.id = ba.funding_source_id
LEFT JOIN expense_code_registry ecr ON ecr.id = ba.expense_code_registry_id
WHERE ba.is_active = true;

CREATE OR REPLACE VIEW v_commitment_ledger AS
SELECT
  c.id AS commitment_id,
  c.commitment_number,
  c.ff3_header_id,
  h.ff3_number,
  c.budget_allocation_id,
  c.financial_year,
  c.original_committed_amount,
  c.current_committed_amount,
  c.paid_amount,
  c.outstanding_amount,
  c.status,
  ct.id AS transaction_id,
  ct.transaction_number,
  ct.transaction_type,
  ct.amount,
  ct.transaction_date,
  ct.reason_code,
  ct.reason,
  ct.reference,
  ct.previous_balance,
  ct.new_balance,
  ct.approved_by,
  au.full_name AS approved_by_name,
  ct.created_by,
  cu.full_name AS created_by_name,
  ct.created_at
FROM ff3_commitments c
JOIN commitment_transactions ct ON ct.commitment_id = c.id
LEFT JOIN ff3_headers h ON h.id = c.ff3_header_id
LEFT JOIN users au ON au.id = ct.approved_by
LEFT JOIN users cu ON cu.id = ct.created_by;

-- ---------------------------------------------------------------------
-- 4. Atomic FF3 workflow and commitment-control RPCs
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION njss_transition_ff3(
  p_ff3_id UUID,
  p_action TEXT,
  p_comments TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ff3 ff3_headers;
  v_old ff3_headers;
  v_budget budget_allocations;
  v_actor UUID := fn_current_app_user_id();
  v_next_status TEXT;
  v_commitment ff3_commitments;
  v_position_before JSONB;
  v_position_after JSONB;
  v_released NUMERIC;
  v_outstanding NUMERIC;
  v_actual NUMERIC;
  v_available NUMERIC;
  v_shortfall NUMERIC;
  v_request NUMERIC;
  v_commitment_count INTEGER;
BEGIN
  IF p_action NOT IN ('SUBMIT','ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD','APPROVE','REJECT','CANCEL','RETURN') THEN
    RAISE EXCEPTION 'Invalid FF3 workflow action: %', p_action;
  END IF;

  PERFORM njss_require_permission(CASE
    WHEN p_action = 'SUBMIT' THEN 'ff3.submit'
    WHEN p_action IN ('ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD','RETURN') THEN 'ff3.endorse'
    WHEN p_action = 'APPROVE' THEN 'ff3.approve'
    WHEN p_action = 'REJECT' THEN 'ff3.reject'
    WHEN p_action = 'CANCEL' THEN 'ff3.cancel'
  END);

  SELECT * INTO v_ff3 FROM ff3_headers WHERE id = p_ff3_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FF3 not found'; END IF;
  v_old := v_ff3;
  v_request := COALESCE(v_ff3.total_estimated_amount, 0);
  IF v_request <= 0 THEN RAISE EXCEPTION 'FF3 amount must be greater than zero.'; END IF;

  IF p_action = 'SUBMIT' THEN
    IF v_ff3.status <> 'DRAFT' THEN RAISE EXCEPTION 'Only DRAFT FF3 can be submitted. Current status: %', v_ff3.status; END IF;
    v_ff3.budget_allocation_id := njss_resolve_ff3_budget_allocation(p_ff3_id);
    SELECT * INTO v_budget FROM budget_allocations WHERE id = v_ff3.budget_allocation_id FOR UPDATE;
    SELECT COALESCE(SUM(released_amount),0) INTO v_released FROM quarterly_releases WHERE budget_allocation_id = v_budget.id;
    SELECT COALESCE(SUM(outstanding_amount),0), COALESCE(SUM(paid_amount),0)
      INTO v_outstanding, v_actual
      FROM ff3_commitments
      WHERE budget_allocation_id = v_budget.id
        AND status IN ('ACTIVE','PARTIALLY_PAID','FULLY_PAID','CANCELLED','RELEASED','CLOSED');
    v_available := v_released - v_outstanding - v_actual;
    IF v_request > v_available + 0.001 THEN
      v_shortfall := v_request - v_available;
      RAISE EXCEPTION 'Insufficient Available Budget. Available: K%, Requested: K%, Shortfall: K%.', v_available, v_request, v_shortfall;
    END IF;
    v_next_status := 'SUBMITTED';
  ELSIF p_action = 'ENDORSE_SUPERVISOR' THEN
    IF v_ff3.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'Only SUBMITTED FF3 can receive supervisor endorsement. Current status: %', v_ff3.status; END IF;
    v_next_status := 'ENDORSED_SUPERVISOR';
  ELSIF p_action = 'ENDORSE_SECTION_HEAD' THEN
    IF v_ff3.status <> 'ENDORSED_SUPERVISOR' THEN RAISE EXCEPTION 'Only supervisor-endorsed FF3 can receive section-head endorsement. Current status: %', v_ff3.status; END IF;
    v_next_status := 'ENDORSED_SECTION_HEAD';
  ELSIF p_action = 'REJECT' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN RAISE EXCEPTION 'Only pending FF3 can be rejected. Current status: %', v_ff3.status; END IF;
    IF COALESCE(TRIM(p_comments), '') = '' THEN RAISE EXCEPTION 'Rejection reason is required.'; END IF;
    v_next_status := 'REJECTED';
  ELSIF p_action = 'RETURN' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN RAISE EXCEPTION 'Only pending FF3 can be returned. Current status: %', v_ff3.status; END IF;
    IF COALESCE(TRIM(p_comments), '') = '' THEN RAISE EXCEPTION 'Return reason is required.'; END IF;
    v_next_status := 'RETURNED';
  ELSIF p_action = 'CANCEL' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN RAISE EXCEPTION 'Use commitment cancellation after approval. Current FF3 status: %', v_ff3.status; END IF;
    IF COALESCE(TRIM(p_comments), '') = '' THEN RAISE EXCEPTION 'Cancellation reason is required.'; END IF;
    v_next_status := 'CANCELLED';
  ELSIF p_action = 'APPROVE' THEN
    IF v_ff3.status <> 'ENDORSED_SECTION_HEAD' THEN RAISE EXCEPTION 'Only section-head-endorsed FF3 can be finally approved. Current status: %', v_ff3.status; END IF;
    v_ff3.budget_allocation_id := njss_resolve_ff3_budget_allocation(p_ff3_id);
    SELECT * INTO v_budget FROM budget_allocations WHERE id = v_ff3.budget_allocation_id AND is_active = true FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Approved budget allocation not found'; END IF;
    IF v_budget.financial_year <> v_ff3.financial_year THEN RAISE EXCEPTION 'FF3 financial year does not match the linked budget allocation.'; END IF;
    IF fn_check_segregation_of_duties('FF3', COALESCE(v_ff3.created_by, v_ff3.requesting_officer_id), COALESCE(v_ff3.supervisor_endorsed_by, v_ff3.section_head_endorsed_by), NULL, v_actor) IS FALSE THEN
      RAISE EXCEPTION 'Segregation of duties prevents the same user from creating/endorsing/approving this FF3.';
    END IF;
    SELECT COUNT(*) INTO v_commitment_count FROM ff3_commitments WHERE ff3_header_id = p_ff3_id AND status <> 'CANCELLED';
    IF v_commitment_count > 0 THEN RAISE EXCEPTION 'Duplicate original commitment blocked. A commitment already exists for this FF3.'; END IF;

    v_position_before := njss_budget_position_for_allocation(v_budget.id);
    v_released := (v_position_before->>'released_amount')::NUMERIC;
    v_outstanding := (v_position_before->>'outstanding_commitment')::NUMERIC;
    v_actual := (v_position_before->>'actual_expenditure')::NUMERIC;
    v_available := v_released - v_outstanding - v_actual;
    IF v_request > v_available + 0.001 THEN
      v_shortfall := v_request - v_available;
      RAISE EXCEPTION 'Insufficient available budget at approval. Available: K%, Requested: K%, Shortfall: K%.', v_available, v_request, v_shortfall;
    END IF;

    UPDATE ff3_headers
    SET status = 'APPROVED',
        approved_date = NOW(),
        approved_by = v_actor,
        budget_allocation_id = v_budget.id,
        budget_mapping_status = 'RESOLVED',
        updated_at = NOW()
    WHERE id = p_ff3_id
    RETURNING * INTO v_ff3;

    INSERT INTO ff3_commitments (
      ff3_header_id, budget_allocation_id, financial_year, commitment_date,
      committed_amount, original_committed_amount, current_committed_amount,
      paid_amount, outstanding_amount, status, created_by, approved_by
    ) VALUES (
      v_ff3.id, v_budget.id, v_ff3.financial_year, CURRENT_DATE,
      v_request, v_request, v_request,
      0, v_request, 'ACTIVE', COALESCE(v_ff3.created_by, v_ff3.requesting_officer_id), v_actor
    ) RETURNING * INTO v_commitment;

    INSERT INTO commitment_transactions (
      commitment_id, ff3_header_id, budget_allocation_id, transaction_type, amount,
      transaction_date, reason_code, reason, reference, previous_balance, new_balance,
      approved_by, created_by
    ) VALUES (
      v_commitment.id, v_ff3.id, v_budget.id, 'ORIGINAL_COMMITMENT', v_request,
      CURRENT_DATE, 'FF3_APPROVAL', COALESCE(p_comments, 'FF3 final approval and original commitment.'),
      v_ff3.ff3_number, 0, v_request, v_actor, v_actor
    );

    UPDATE ff3_headers SET status = 'COMMITTED', updated_at = NOW() WHERE id = p_ff3_id RETURNING * INTO v_ff3;
    v_commitment := njss_sync_commitment_balances(v_commitment.id);
    v_position_after := njss_budget_position_for_allocation(v_budget.id);

    INSERT INTO ff3_approvals (ff3_header_id, approver_id, approval_level, action_taken, comments, action_date)
    VALUES (p_ff3_id, v_actor, p_action, 'APPROVED', p_comments, NOW());

    PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'FF3_APPROVED_COMMITMENT_CREATED', 'FF3', p_ff3_id, v_ff3.ff3_number, to_jsonb(v_old), to_jsonb(v_ff3), jsonb_build_object('old_status', v_old.status, 'new_status', v_ff3.status, 'old_amount', v_old.total_estimated_amount, 'new_amount', v_ff3.total_estimated_amount, 'commitment_id', v_commitment.id, 'financial_position_before', v_position_before, 'financial_position_after', v_position_after, 'reason', p_comments), NULL);
    PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'COMMITMENT_CREATED', 'COMMITMENT', v_commitment.id, v_commitment.commitment_number, NULL, to_jsonb(v_commitment), jsonb_build_object('transaction_type', 'ORIGINAL_COMMITMENT', 'amount', v_request, 'financial_position_before', v_position_before, 'financial_position_after', v_position_after), NULL);

    RETURN jsonb_build_object('header', to_jsonb(v_ff3), 'commitment', to_jsonb(v_commitment), 'financial_position_before', v_position_before, 'financial_position_after', v_position_after);
  END IF;

  UPDATE ff3_headers
  SET status = v_next_status,
      budget_allocation_id = COALESCE(v_ff3.budget_allocation_id, budget_allocation_id),
      budget_mapping_status = CASE WHEN v_ff3.budget_allocation_id IS NOT NULL THEN 'RESOLVED' ELSE budget_mapping_status END,
      submitted_date = CASE WHEN p_action = 'SUBMIT' THEN NOW() ELSE submitted_date END,
      supervisor_endorsed_date = CASE WHEN p_action = 'ENDORSE_SUPERVISOR' THEN NOW() ELSE supervisor_endorsed_date END,
      supervisor_endorsed_by = CASE WHEN p_action = 'ENDORSE_SUPERVISOR' THEN v_actor ELSE supervisor_endorsed_by END,
      section_head_endorsed_date = CASE WHEN p_action = 'ENDORSE_SECTION_HEAD' THEN NOW() ELSE section_head_endorsed_date END,
      section_head_endorsed_by = CASE WHEN p_action = 'ENDORSE_SECTION_HEAD' THEN v_actor ELSE section_head_endorsed_by END,
      rejection_reason = CASE WHEN p_action = 'REJECT' THEN p_comments ELSE rejection_reason END,
      returned_reason = CASE WHEN p_action = 'RETURN' THEN p_comments ELSE returned_reason END,
      cancellation_reason = CASE WHEN p_action = 'CANCEL' THEN p_comments ELSE cancellation_reason END,
      cancelled_by = CASE WHEN p_action = 'CANCEL' THEN v_actor ELSE cancelled_by END,
      cancelled_at = CASE WHEN p_action = 'CANCEL' THEN NOW() ELSE cancelled_at END,
      updated_at = NOW()
  WHERE id = p_ff3_id
  RETURNING * INTO v_ff3;

  INSERT INTO ff3_approvals (ff3_header_id, approver_id, approval_level, action_taken, comments, action_date)
  VALUES (p_ff3_id, v_actor, p_action, CASE WHEN p_action IN ('REJECT','CANCEL','RETURN') THEN v_next_status ELSE 'ENDORSED' END, p_comments, NOW());

  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'FF3_' || p_action, 'FF3', p_ff3_id, v_ff3.ff3_number, to_jsonb(v_old), to_jsonb(v_ff3), jsonb_build_object('old_status', v_old.status, 'new_status', v_next_status, 'reason', p_comments), NULL);
  RETURN jsonb_build_object('header', to_jsonb(v_ff3), 'commitment', NULL, 'financial_position_after', CASE WHEN v_ff3.budget_allocation_id IS NOT NULL THEN njss_budget_position_for_allocation(v_ff3.budget_allocation_id) ELSE NULL END);
END;
$$;

CREATE OR REPLACE FUNCTION njss_adjust_commitment(
  p_commitment_id UUID,
  p_action TEXT,
  p_amount NUMERIC DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_commitment ff3_commitments;
  v_old ff3_commitments;
  v_budget budget_allocations;
  v_actor UUID := fn_current_app_user_id();
  v_type TEXT;
  v_amount NUMERIC;
  v_position_before JSONB;
  v_position_after JSONB;
  v_available NUMERIC;
  v_shortfall NUMERIC;
  v_previous NUMERIC;
  v_new NUMERIC;
BEGIN
  IF p_action NOT IN ('INCREASE','DECREASE','CANCEL','RELEASE_UNUSED_BALANCE') THEN
    RAISE EXCEPTION 'Invalid commitment action: %', p_action;
  END IF;
  PERFORM njss_require_permission(CASE
    WHEN p_action = 'INCREASE' OR p_action = 'DECREASE' THEN 'commitment.adjust'
    WHEN p_action = 'CANCEL' THEN 'commitment.cancel'
    ELSE 'commitment.release'
  END);
  IF COALESCE(TRIM(p_reason), '') = '' THEN RAISE EXCEPTION 'Reason is required for commitment %. ', p_action; END IF;

  SELECT * INTO v_commitment FROM ff3_commitments WHERE id = p_commitment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commitment not found'; END IF;
  v_old := v_commitment;
  IF v_commitment.status = 'CANCELLED' THEN RAISE EXCEPTION 'Cancel already cancelled commitment blocked.'; END IF;
  IF v_commitment.budget_allocation_id IS NULL THEN RAISE EXCEPTION 'Commitment is not linked to an exact budget allocation.'; END IF;

  IF fn_check_segregation_of_duties('COMMITMENT_ADJUSTMENT', v_commitment.created_by, NULL, v_commitment.approved_by, v_actor) IS FALSE THEN
    RAISE EXCEPTION 'Segregation of duties prevents the same user from requesting/approving this commitment adjustment.';
  END IF;

  SELECT * INTO v_budget FROM budget_allocations WHERE id = v_commitment.budget_allocation_id FOR UPDATE;
  v_position_before := njss_budget_position_for_allocation(v_budget.id);
  v_available := (v_position_before->>'available_amount')::NUMERIC;
  v_previous := COALESCE(v_commitment.current_committed_amount, v_commitment.committed_amount, 0);

  IF p_action = 'INCREASE' THEN
    v_type := 'INCREASE';
    v_amount := COALESCE(p_amount, 0);
    IF v_amount <= 0 THEN RAISE EXCEPTION 'Commitment increase amount must be greater than zero.'; END IF;
    IF v_amount > v_available + 0.001 THEN
      v_shortfall := v_amount - v_available;
      RAISE EXCEPTION 'Insufficient available budget for commitment increase. Available: K%, Requested: K%, Shortfall: K%.', v_available, v_amount, v_shortfall;
    END IF;
    v_new := v_previous + v_amount;
  ELSIF p_action = 'DECREASE' THEN
    v_type := 'DECREASE';
    v_amount := COALESCE(p_amount, 0);
    IF v_amount <= 0 THEN RAISE EXCEPTION 'Commitment decrease amount must be greater than zero.'; END IF;
    IF v_previous - v_amount < COALESCE(v_commitment.paid_amount, 0) - 0.001 THEN
      RAISE EXCEPTION 'Commitment decrease below paid amount blocked. Current: K%, Paid: K%, Requested decrease: K%.', v_previous, COALESCE(v_commitment.paid_amount,0), v_amount;
    END IF;
    v_new := v_previous - v_amount;
  ELSE
    v_type := CASE WHEN p_action = 'CANCEL' THEN 'CANCELLATION' ELSE 'RELEASE_UNUSED_BALANCE' END;
    v_amount := COALESCE(v_commitment.outstanding_amount, GREATEST(v_previous - COALESCE(v_commitment.paid_amount,0),0));
    IF v_amount <= 0 THEN RAISE EXCEPTION 'No outstanding commitment balance is available to release.'; END IF;
    v_new := v_previous - v_amount;
  END IF;

  INSERT INTO commitment_transactions (
    commitment_id, ff3_header_id, budget_allocation_id, transaction_type, amount,
    transaction_date, reason_code, reason, reference, previous_balance, new_balance,
    approved_by, created_by
  ) VALUES (
    v_commitment.id, v_commitment.ff3_header_id, v_commitment.budget_allocation_id, v_type, v_amount,
    CURRENT_DATE, p_action, p_reason, p_reference, v_previous, v_new, v_actor, v_actor
  );

  v_commitment := njss_sync_commitment_balances(v_commitment.id);
  IF p_action = 'CANCEL' THEN
    UPDATE ff3_commitments
    SET status = 'CANCELLED', cancelled_by = v_actor, cancellation_reason = p_reason, updated_at = NOW()
    WHERE id = p_commitment_id
    RETURNING * INTO v_commitment;
    UPDATE ff3_headers
    SET status = 'CANCELLED', cancelled_by = v_actor, cancellation_reason = p_reason, cancelled_at = NOW(), updated_at = NOW()
    WHERE id = v_commitment.ff3_header_id;
  END IF;

  v_position_after := njss_budget_position_for_allocation(v_budget.id);
  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'COMMITMENT_' || p_action, 'COMMITMENT', v_commitment.id, v_commitment.commitment_number, to_jsonb(v_old), to_jsonb(v_commitment), jsonb_build_object('transaction_type', v_type, 'amount', v_amount, 'old_amount', v_previous, 'new_amount', v_new, 'reason', p_reason, 'reference', p_reference, 'financial_position_before', v_position_before, 'financial_position_after', v_position_after), NULL);
  RETURN jsonb_build_object('commitment', to_jsonb(v_commitment), 'financial_position_before', v_position_before, 'financial_position_after', v_position_after);
END;
$$;

CREATE OR REPLACE FUNCTION njss_liquidate_commitment_payment(
  p_ff4_id UUID,
  p_payment_reference TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ff4 ff4_headers;
  v_commitment ff3_commitments;
  v_old ff3_commitments;
  v_actor UUID := fn_current_app_user_id();
  v_amount NUMERIC;
  v_previous NUMERIC;
  v_new NUMERIC;
BEGIN
  PERFORM njss_require_permission('ff4.process');
  SELECT * INTO v_ff4 FROM ff4_headers WHERE id = p_ff4_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FF4 not found'; END IF;
  IF v_ff4.commitment_id IS NULL THEN RAISE EXCEPTION 'FF4 is not linked to a commitment.'; END IF;

  SELECT * INTO v_commitment FROM ff3_commitments WHERE id = v_ff4.commitment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commitment not found'; END IF;
  v_old := v_commitment;
  v_amount := COALESCE(v_ff4.net_amount, 0);
  v_previous := COALESCE(v_commitment.current_committed_amount, v_commitment.committed_amount, 0);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Payment amount must be greater than zero.'; END IF;
  IF EXISTS (SELECT 1 FROM payment_transactions WHERE ff4_header_id = p_ff4_id) THEN
    RAISE EXCEPTION 'FF4 payment has already been liquidated against this commitment.';
  END IF;
  IF v_amount > COALESCE(v_commitment.outstanding_amount, v_previous - COALESCE(v_commitment.paid_amount, 0)) + 0.001 THEN
    RAISE EXCEPTION 'Payment exceeds the remaining commitment balance of K%.', COALESCE(v_commitment.outstanding_amount, v_previous - COALESCE(v_commitment.paid_amount,0));
  END IF;

  v_new := v_previous - v_amount;
  INSERT INTO commitment_transactions (
    commitment_id, ff3_header_id, budget_allocation_id, transaction_type, amount,
    transaction_date, reason_code, reason, reference, previous_balance, new_balance,
    approved_by, created_by
  ) VALUES (
    v_commitment.id, v_commitment.ff3_header_id, v_commitment.budget_allocation_id,
    'PAYMENT_LIQUIDATION', v_amount, CURRENT_DATE, 'FF4_PAYMENT', 'FF4 payment liquidation',
    COALESCE(p_payment_reference, v_ff4.external_payment_reference, v_ff4.ff4_number), v_previous, v_new,
    v_actor, v_actor
  );

  INSERT INTO payment_transactions (ff4_header_id, commitment_id, transaction_date, transaction_type, amount, payment_reference, reconciled)
  VALUES (v_ff4.id, v_commitment.id, CURRENT_DATE, 'PAYMENT', v_amount, COALESCE(p_payment_reference, v_ff4.external_payment_reference), false)
  ON CONFLICT DO NOTHING;

  v_commitment := njss_sync_commitment_balances(v_commitment.id);
  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'COMMITMENT_PAYMENT_LIQUIDATION', 'COMMITMENT', v_commitment.id, v_commitment.commitment_number, to_jsonb(v_old), to_jsonb(v_commitment), jsonb_build_object('ff4_id', p_ff4_id, 'amount', v_amount, 'reference', p_payment_reference), NULL);
  RETURN jsonb_build_object('commitment', to_jsonb(v_commitment));
END;
$$;

-- ---------------------------------------------------------------------
-- 5. RBAC, RLS and grants
-- ---------------------------------------------------------------------

INSERT INTO permissions (code, module_code, menu_code, action, label, description, is_active) VALUES
  ('ff3.cancel','finance','finance.ff3','reject','Cancel pending FF3 requisitions','Cancel an FF3 before commitment creation',true),
  ('commitment.view','finance','budget.commitments','view','View commitments','View commitment headers and ledger transactions',true),
  ('commitment.adjust','finance','budget.commitments','approve','Adjust commitments','Increase or decrease commitment balances through the ledger',true),
  ('commitment.approve_adjustment','finance','budget.commitments','approve','Approve commitment adjustments','Approve controlled commitment adjustments',true),
  ('commitment.cancel','finance','budget.commitments','reject','Cancel commitments','Cancel commitments and release unpaid balances',true),
  ('commitment.release','finance','budget.commitments','approve','Release unused commitments','Release unused commitment balances',true),
  ('budget.control.view','budget','budget.control','view','View authoritative budget control','View released, pending, committed, actual and available balances',true)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  menu_code = EXCLUDED.menu_code,
  action = EXCLUDED.action,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active = true;

UPDATE menu_items
SET required_permissions = ARRAY['commitment.view','budget.control.view','budget.view'],
    label = 'Commitment Ledger'
WHERE code = 'budget.commitments';

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, permission, true
FROM roles r
CROSS JOIN LATERAL unnest(ARRAY['commitment.view','commitment.adjust','commitment.cancel','commitment.release','budget.control.view']) permission
WHERE r.name IN ('Finance Officer','Budget Manager','System Administrator')
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = EXCLUDED.is_allowed;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, permission, true
FROM roles r
CROSS JOIN LATERAL unnest(ARRAY['commitment.view','budget.control.view']) permission
WHERE r.name IN ('Auditor','Executive Management')
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = EXCLUDED.is_allowed;

INSERT INTO segregation_rules (entity_type, create_action, verify_action, approve_action, allow_same_user, bypass_permission, is_active)
VALUES ('COMMITMENT_ADJUSTMENT', 'REQUEST', 'REVIEW', 'APPROVE', false, 'all', true)
ON CONFLICT (entity_type, create_action, verify_action, approve_action) DO UPDATE SET
  allow_same_user = EXCLUDED.allow_same_user,
  bypass_permission = EXCLUDED.bypass_permission,
  is_active = true;

ALTER TABLE commitment_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commitment_transactions_select_authorized ON commitment_transactions;
DROP POLICY IF EXISTS commitment_transactions_no_direct_insert ON commitment_transactions;
DROP POLICY IF EXISTS commitment_transactions_no_update ON commitment_transactions;
DROP POLICY IF EXISTS commitment_transactions_no_delete ON commitment_transactions;
CREATE POLICY commitment_transactions_select_authorized ON commitment_transactions
  FOR SELECT USING (fn_current_user_has_permission('commitment.view') OR fn_current_user_has_permission('budget.control.view') OR fn_current_user_has_permission('all'));
CREATE POLICY commitment_transactions_no_direct_insert ON commitment_transactions
  FOR INSERT WITH CHECK (false);
CREATE POLICY commitment_transactions_no_update ON commitment_transactions
  FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY commitment_transactions_no_delete ON commitment_transactions
  FOR DELETE USING (false);

ALTER TABLE ff3_commitments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ff3_commitments_select_authorized_phase2 ON ff3_commitments;
DROP POLICY IF EXISTS ff3_commitments_no_direct_insert_phase2 ON ff3_commitments;
DROP POLICY IF EXISTS ff3_commitments_no_direct_update_phase2 ON ff3_commitments;
DROP POLICY IF EXISTS ff3_commitments_no_delete_phase2 ON ff3_commitments;
CREATE POLICY ff3_commitments_select_authorized_phase2 ON ff3_commitments
  FOR SELECT USING (fn_current_user_has_permission('commitment.view') OR fn_current_user_has_permission('budget.control.view') OR fn_current_user_has_permission('all'));
CREATE POLICY ff3_commitments_no_direct_insert_phase2 ON ff3_commitments
  FOR INSERT WITH CHECK (false);
CREATE POLICY ff3_commitments_no_direct_update_phase2 ON ff3_commitments
  FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY ff3_commitments_no_delete_phase2 ON ff3_commitments
  FOR DELETE USING (false);

GRANT SELECT ON v_authoritative_budget_position, v_commitment_ledger TO authenticated;
GRANT SELECT ON commitment_transactions TO authenticated;
REVOKE ALL ON FUNCTION njss_transition_ff3(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION njss_adjust_commitment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION njss_liquidate_commitment_payment(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION njss_transition_ff3(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_adjust_commitment(UUID, TEXT, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_liquidate_commitment_payment(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_budget_position_for_allocation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_resolve_ff3_budget_allocation(UUID) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Legacy exact mapping status: resolve only unique; flag ambiguity
-- ---------------------------------------------------------------------

WITH candidate_matches AS (
  SELECT h.id AS ff3_id, ba.id AS budget_allocation_id, COUNT(*) OVER (PARTITION BY h.id) AS match_count
  FROM ff3_headers h
  JOIN budget_allocations ba
    ON ba.financial_year = h.financial_year
   AND ba.is_active = true
   AND h.expense_code_registry_id IS NOT NULL
   AND ba.expense_code_registry_id = h.expense_code_registry_id
   AND (h.department_id IS NULL OR ba.department_id IS NOT DISTINCT FROM h.department_id)
   AND (h.section_id IS NULL OR ba.section_id IS NOT DISTINCT FROM h.section_id)
   AND (h.cost_centre_id IS NULL OR ba.cost_centre_id IS NOT DISTINCT FROM h.cost_centre_id)
   AND (h.funding_source_id IS NULL OR ba.funding_source_id IS NOT DISTINCT FROM h.funding_source_id)
   AND (h.project_id IS NULL OR ba.project_id IS NOT DISTINCT FROM h.project_id)
  WHERE h.budget_allocation_id IS NULL
)
UPDATE ff3_headers h
SET budget_allocation_id = c.budget_allocation_id,
    budget_mapping_status = 'RESOLVED'
FROM candidate_matches c
WHERE h.id = c.ff3_id
  AND c.match_count = 1;

WITH unresolved AS (
  SELECT h.id,
         COUNT(ba.id) AS matches
  FROM ff3_headers h
  LEFT JOIN budget_allocations ba
    ON ba.financial_year = h.financial_year
   AND ba.is_active = true
   AND h.expense_code_registry_id IS NOT NULL
   AND ba.expense_code_registry_id = h.expense_code_registry_id
   AND (h.department_id IS NULL OR ba.department_id IS NOT DISTINCT FROM h.department_id)
   AND (h.section_id IS NULL OR ba.section_id IS NOT DISTINCT FROM h.section_id)
   AND (h.cost_centre_id IS NULL OR ba.cost_centre_id IS NOT DISTINCT FROM h.cost_centre_id)
   AND (h.funding_source_id IS NULL OR ba.funding_source_id IS NOT DISTINCT FROM h.funding_source_id)
   AND (h.project_id IS NULL OR ba.project_id IS NOT DISTINCT FROM h.project_id)
  WHERE h.budget_allocation_id IS NULL
  GROUP BY h.id
)
UPDATE ff3_headers h
SET budget_mapping_status = CASE WHEN u.matches = 0 THEN 'BUDGET_MAPPING_REQUIRED' ELSE 'BUDGET_MAPPING_REQUIRED_AMBIGUOUS' END
FROM unresolved u
WHERE h.id = u.id
  AND h.status IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD','APPROVED','COMMITTED');
