-- NJSS PHASE 4 — FF4 Expense and Payment Control
-- FF3 Commitment → FF4 → Payment Recording → Actual Expenditure → Reconciliation.
-- This migration keeps suppliers as simple expenditure references only.

ALTER TABLE ff4_headers
  ADD COLUMN IF NOT EXISTS budget_allocation_id UUID REFERENCES budget_allocations(id),
  ADD COLUMN IF NOT EXISTS expense_code_registry_id UUID REFERENCES expense_code_registry(id),
  ADD COLUMN IF NOT EXISTS cost_centre_id UUID REFERENCES cost_centres(id),
  ADD COLUMN IF NOT EXISTS funding_source_id UUID REFERENCES funding_sources(id),
  ADD COLUMN IF NOT EXISTS payment_type VARCHAR(30) DEFAULT 'COMMITMENT',
  ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS processed_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS returned_reason TEXT,
  ADD COLUMN IF NOT EXISTS remarks TEXT,
  ADD COLUMN IF NOT EXISTS is_partial_payment BOOLEAN DEFAULT FALSE;

ALTER TABLE payment_transactions
  ADD COLUMN IF NOT EXISTS financial_year INTEGER,
  ADD COLUMN IF NOT EXISTS budget_allocation_id UUID REFERENCES budget_allocations(id),
  ADD COLUMN IF NOT EXISTS payment_method_id UUID REFERENCES payment_methods(id),
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'POSTED',
  ADD COLUMN IF NOT EXISTS reversal_of_id UUID REFERENCES payment_transactions(id),
  ADD COLUMN IF NOT EXISTS reconciled_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE ff4_headers f
SET
  budget_allocation_id = COALESCE(f.budget_allocation_id, c.budget_allocation_id),
  expense_code_registry_id = COALESCE(f.expense_code_registry_id, h.expense_code_registry_id),
  cost_centre_id = COALESCE(f.cost_centre_id, h.cost_centre_id),
  funding_source_id = COALESCE(f.funding_source_id, h.funding_source_id),
  department_id = COALESCE(f.department_id, h.department_id),
  section_id = COALESCE(f.section_id, h.section_id),
  supplier_id = COALESCE(f.supplier_id, c.supplier_id),
  supplier_code = COALESCE(f.supplier_code, c.supplier_code_snapshot),
  updated_at = NOW()
FROM ff3_commitments c
LEFT JOIN ff3_headers h ON h.id = c.ff3_header_id
WHERE f.commitment_id = c.id;

UPDATE payment_transactions pt
SET
  financial_year = COALESCE(pt.financial_year, f.financial_year, c.financial_year),
  budget_allocation_id = COALESCE(pt.budget_allocation_id, f.budget_allocation_id, c.budget_allocation_id),
  payment_method_id = COALESCE(pt.payment_method_id, f.payment_method_id),
  created_by = COALESCE(pt.created_by, f.paid_by, f.created_by),
  updated_at = COALESCE(pt.updated_at, pt.created_at, NOW())
FROM ff4_headers f, ff3_commitments c
WHERE pt.ff4_header_id = f.id
  AND c.id = pt.commitment_id;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ff4_status_phase4') THEN
    ALTER TABLE ff4_headers
      ADD CONSTRAINT chk_ff4_status_phase4 CHECK (status IN (
        'DRAFT','SUBMITTED','VERIFIED','APPROVED','PROCESSED','PAID','RECONCILED','CANCELLED','REJECTED','RETURNED'
      )) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ff4_amounts_phase4') THEN
    ALTER TABLE ff4_headers
      ADD CONSTRAINT chk_ff4_amounts_phase4 CHECK (
        COALESCE(gross_amount, 0) > 0
        AND COALESCE(tax_amount, 0) >= 0
        AND COALESCE(deductions, 0) >= 0
        AND COALESCE(net_amount, 0) > 0
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_transactions_ff4_payment_phase4
ON payment_transactions(ff4_header_id)
WHERE transaction_type = 'PAYMENT' AND COALESCE(status, 'POSTED') <> 'REVERSED';

CREATE INDEX IF NOT EXISTS idx_ff4_headers_commitment_status_phase4 ON ff4_headers(commitment_id, status);
CREATE INDEX IF NOT EXISTS idx_ff4_headers_fy_status_phase4 ON ff4_headers(financial_year, status);
CREATE INDEX IF NOT EXISTS idx_ff4_headers_supplier_phase4 ON ff4_headers(supplier_id, financial_year);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_budget_phase4 ON payment_transactions(budget_allocation_id, transaction_date);

CREATE TABLE IF NOT EXISTS ff4_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ff4_header_id UUID NOT NULL REFERENCES ff4_headers(id) ON DELETE CASCADE,
  approval_level VARCHAR(80) NOT NULL,
  approver_id UUID REFERENCES users(id),
  action_taken VARCHAR(80) NOT NULL,
  comments TEXT,
  action_date TIMESTAMPTZ DEFAULT NOW(),
  old_status VARCHAR(50),
  new_status VARCHAR(50),
  amount NUMERIC(15,2),
  reference VARCHAR(160)
);
CREATE INDEX IF NOT EXISTS idx_ff4_approvals_header ON ff4_approvals(ff4_header_id, action_date);

CREATE OR REPLACE FUNCTION njss_ff4_reserved_amount(
  p_commitment_id UUID,
  p_exclude_ff4_id UUID DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(net_amount), 0)::NUMERIC
  FROM ff4_headers
  WHERE commitment_id = p_commitment_id
    AND (p_exclude_ff4_id IS NULL OR id <> p_exclude_ff4_id)
    AND status IN ('SUBMITTED','VERIFIED','APPROVED','PROCESSED');
$$;

CREATE OR REPLACE VIEW v_ff4_payable_commitments AS
SELECT
  c.id AS commitment_id,
  c.commitment_number,
  c.ff3_header_id,
  h.ff3_number,
  h.purpose,
  c.financial_year,
  c.budget_allocation_id,
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
  c.supplier_id,
  COALESCE(s.legal_name, s.supplier_name, c.supplier_name_snapshot, h.selected_supplier_name) AS supplier_name,
  COALESCE(s.supplier_code, c.supplier_code_snapshot) AS supplier_code,
  COALESCE(c.original_committed_amount, c.committed_amount, 0)::NUMERIC(15,2) AS original_commitment,
  COALESCE(c.current_committed_amount, c.committed_amount, 0)::NUMERIC(15,2) AS current_commitment,
  COALESCE(c.paid_amount, 0)::NUMERIC(15,2) AS paid_amount,
  COALESCE(c.outstanding_amount, COALESCE(c.current_committed_amount, c.committed_amount, 0) - COALESCE(c.paid_amount, 0))::NUMERIC(15,2) AS outstanding_commitment,
  njss_ff4_reserved_amount(c.id, NULL)::NUMERIC(15,2) AS pending_ff4_amount,
  (COALESCE(c.outstanding_amount, COALESCE(c.current_committed_amount, c.committed_amount, 0) - COALESCE(c.paid_amount, 0)) - njss_ff4_reserved_amount(c.id, NULL))::NUMERIC(15,2) AS available_for_ff4,
  c.status AS commitment_status
FROM ff3_commitments c
JOIN ff3_headers h ON h.id = c.ff3_header_id
LEFT JOIN suppliers s ON s.id = c.supplier_id
LEFT JOIN departments d ON d.id = h.department_id
LEFT JOIN sections sec ON sec.id = h.section_id
LEFT JOIN cost_centres cc ON cc.id = h.cost_centre_id
LEFT JOIN expense_code_registry ecr ON ecr.id = h.expense_code_registry_id
LEFT JOIN funding_sources fs ON fs.id = h.funding_source_id
WHERE c.status IN ('ACTIVE','PARTIALLY_PAID')
  AND COALESCE(c.outstanding_amount, COALESCE(c.current_committed_amount, c.committed_amount, 0) - COALESCE(c.paid_amount, 0)) > 0;

CREATE OR REPLACE VIEW v_ff4_payment_register AS
SELECT
  f.id,
  f.ff4_number,
  f.financial_year,
  f.payment_request_date,
  f.ff3_header_id,
  h.ff3_number,
  h.purpose AS ff3_purpose,
  f.commitment_id,
  c.commitment_number,
  f.budget_allocation_id,
  f.department_id,
  d.name AS department_name,
  f.section_id,
  sec.name AS section_name,
  f.supplier_id,
  COALESCE(s.legal_name, s.supplier_name, f.payee_name) AS supplier_name,
  f.payee_type,
  f.payee_name,
  f.invoice_number,
  f.invoice_date,
  f.claim_reference,
  f.payment_description,
  f.gross_amount,
  f.tax_amount,
  f.deductions,
  f.net_amount,
  f.payment_method,
  f.external_payment_reference,
  f.cheque_number,
  f.payment_date,
  f.status,
  f.created_at,
  f.submitted_date,
  f.verified_date,
  f.approved_date,
  f.processed_date,
  f.paid_date,
  f.reconciled_date,
  COALESCE(c.original_committed_amount, c.committed_amount, 0) AS original_commitment,
  COALESCE(c.paid_amount, 0) AS commitment_paid_amount,
  COALESCE(c.outstanding_amount, COALESCE(c.current_committed_amount, c.committed_amount, 0) - COALESCE(c.paid_amount, 0)) AS outstanding_commitment
FROM ff4_headers f
LEFT JOIN ff3_headers h ON h.id = f.ff3_header_id
LEFT JOIN ff3_commitments c ON c.id = f.commitment_id
LEFT JOIN suppliers s ON s.id = f.supplier_id
LEFT JOIN departments d ON d.id = f.department_id
LEFT JOIN sections sec ON sec.id = f.section_id;

CREATE OR REPLACE FUNCTION njss_create_ff4(
  p_payload JSONB,
  p_submit BOOLEAN DEFAULT FALSE,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := COALESCE(fn_current_app_user_id(), (SELECT id FROM users WHERE LOWER(email) = LOWER(COALESCE(p_user_email, '')) LIMIT 1));
  v_commitment ff3_commitments%ROWTYPE;
  v_ff3 ff3_headers%ROWTYPE;
  v_ff4 ff4_headers%ROWTYPE;
  v_amount NUMERIC;
  v_reserved NUMERIC;
  v_available NUMERIC;
  v_status TEXT := CASE WHEN p_submit THEN 'SUBMITTED' ELSE 'DRAFT' END;
  v_attachments JSONB := COALESCE(p_payload->'attachments', '[]'::JSONB);
BEGIN
  PERFORM njss_require_permission('ff4.create');

  IF NULLIF(p_payload->>'commitment_id', '') IS NULL THEN
    RAISE EXCEPTION 'FF4 must originate from an existing commitment.';
  END IF;

  SELECT * INTO v_commitment FROM ff3_commitments WHERE id = (p_payload->>'commitment_id')::UUID FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selected commitment was not found.'; END IF;

  SELECT * INTO v_ff3 FROM ff3_headers WHERE id = v_commitment.ff3_header_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Linked FF3 was not found.'; END IF;

  IF NULLIF(p_payload->>'ff3_header_id', '') IS NOT NULL AND (p_payload->>'ff3_header_id')::UUID <> v_commitment.ff3_header_id THEN
    RAISE EXCEPTION 'FF4 linked to the wrong FF3 for this commitment.';
  END IF;

  IF v_commitment.status NOT IN ('ACTIVE','PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'Payment against % commitment is not allowed.', v_commitment.status;
  END IF;

  v_amount := COALESCE((p_payload->>'gross_amount')::NUMERIC, 0)
    - COALESCE((p_payload->>'tax_amount')::NUMERIC, 0)
    - COALESCE((p_payload->>'deductions')::NUMERIC, 0);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'FF4 net amount must be greater than zero.'; END IF;

  v_reserved := njss_ff4_reserved_amount(v_commitment.id, NULL);
  v_available := COALESCE(v_commitment.outstanding_amount, COALESCE(v_commitment.current_committed_amount, v_commitment.committed_amount, 0) - COALESCE(v_commitment.paid_amount, 0)) - v_reserved;
  IF v_amount > v_available + 0.001 THEN
    RAISE EXCEPTION 'FF4 amount exceeds available commitment balance. Available after pending FF4s: K%, Requested: K%.', v_available, v_amount;
  END IF;

  INSERT INTO ff4_headers (
    ff3_header_id, commitment_id, financial_year, payment_request_date,
    payee_type, payee_type_id, payee_name, supplier_id, payee_user_id, supplier_code,
    invoice_number, invoice_date, claim_reference, payment_description,
    gross_amount, tax_amount, deductions,
    department_id, section_id, cost_centre_id, expense_code_registry_id, funding_source_id, budget_allocation_id,
    payment_method, payment_method_id, external_payment_reference, cheque_number,
    status, submitted_date, submitted_by, remarks, is_partial_payment, created_by, updated_at
  ) VALUES (
    v_commitment.ff3_header_id, v_commitment.id, v_commitment.financial_year, COALESCE(NULLIF(p_payload->>'payment_request_date', '')::DATE, CURRENT_DATE),
    NULLIF(p_payload->>'payee_type', ''), NULLIF(p_payload->>'payee_type_id', '')::UUID, COALESCE(NULLIF(p_payload->>'payee_name', ''), COALESCE(v_commitment.supplier_name_snapshot, v_ff3.selected_supplier_name, 'Payee')),
    COALESCE(NULLIF(p_payload->>'supplier_id', '')::UUID, v_commitment.supplier_id), NULLIF(p_payload->>'payee_user_id', '')::UUID,
    COALESCE(NULLIF(p_payload->>'supplier_code', ''), v_commitment.supplier_code_snapshot),
    NULLIF(p_payload->>'invoice_number', ''), NULLIF(p_payload->>'invoice_date', '')::DATE, NULLIF(p_payload->>'claim_reference', ''), NULLIF(p_payload->>'payment_description', ''),
    (p_payload->>'gross_amount')::NUMERIC, COALESCE(NULLIF(p_payload->>'tax_amount', '')::NUMERIC, 0), COALESCE(NULLIF(p_payload->>'deductions', '')::NUMERIC, 0),
    v_ff3.department_id, v_ff3.section_id, v_ff3.cost_centre_id, v_ff3.expense_code_registry_id, v_ff3.funding_source_id, v_commitment.budget_allocation_id,
    NULLIF(p_payload->>'payment_method', ''), NULLIF(p_payload->>'payment_method_id', '')::UUID, NULLIF(p_payload->>'external_payment_reference', ''), NULLIF(p_payload->>'cheque_number', ''),
    v_status, CASE WHEN p_submit THEN NOW() ELSE NULL END, CASE WHEN p_submit THEN v_actor ELSE NULL END, NULLIF(p_payload->>'remarks', ''), COALESCE((p_payload->>'is_partial_payment')::BOOLEAN, FALSE), v_actor, NOW()
  ) RETURNING * INTO v_ff4;

  INSERT INTO ff4_attachments (ff4_header_id, file_name, file_type, file_url, attachment_type)
  SELECT
    v_ff4.id,
    COALESCE(a.value->>'file_name', a.value->>'name', 'Attachment'),
    COALESCE(a.value->>'file_type', a.value->>'type'),
    COALESCE(a.value->>'file_url', a.value->>'url'),
    COALESCE(a.value->>'attachment_type', 'SUPPORTING_DOCUMENT')
  FROM jsonb_array_elements(v_attachments) AS a(value)
  WHERE COALESCE(a.value->>'file_url', a.value->>'url') IS NOT NULL;

  INSERT INTO ff4_approvals (ff4_header_id, approval_level, approver_id, action_taken, comments, old_status, new_status, amount, reference)
  VALUES (v_ff4.id, CASE WHEN p_submit THEN 'SUBMIT' ELSE 'CREATE' END, v_actor, CASE WHEN p_submit THEN 'SUBMITTED' ELSE 'CREATED' END, p_payload->>'comments', NULL, v_ff4.status, v_ff4.net_amount, v_ff4.ff4_number);

  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), CASE WHEN p_submit THEN 'FF4_SUBMITTED' ELSE 'FF4_CREATED' END, 'FF4', v_ff4.id, v_ff4.ff4_number, NULL, TO_JSONB(v_ff4), JSONB_BUILD_OBJECT('amount', v_ff4.net_amount, 'commitment_id', v_commitment.id, 'commitment_number', v_commitment.commitment_number), JSONB_BUILD_OBJECT('phase', 'PHASE_4'));

  RETURN JSONB_BUILD_OBJECT('header', TO_JSONB(v_ff4), 'commitment', TO_JSONB(v_commitment), 'payment_transaction', NULL);
END;
$$;

CREATE OR REPLACE FUNCTION njss_transition_ff4(
  p_ff4_id UUID,
  p_action TEXT,
  p_comments TEXT DEFAULT NULL,
  p_payment_reference TEXT DEFAULT NULL,
  p_payment_date DATE DEFAULT NULL,
  p_payment_method TEXT DEFAULT NULL,
  p_cheque_number TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := COALESCE(fn_current_app_user_id(), (SELECT id FROM users WHERE LOWER(email) = LOWER(COALESCE(p_user_email, '')) LIMIT 1));
  v_ff4 ff4_headers%ROWTYPE;
  v_old ff4_headers%ROWTYPE;
  v_commitment ff3_commitments%ROWTYPE;
  v_old_commitment ff3_commitments%ROWTYPE;
  v_payment payment_transactions%ROWTYPE;
  v_next_status TEXT;
  v_amount NUMERIC;
  v_outstanding NUMERIC;
  v_reserved_other NUMERIC;
  v_position_before JSONB;
  v_position_after JSONB;
BEGIN
  p_action := UPPER(COALESCE(p_action, ''));
  IF p_action NOT IN ('SUBMIT','VERIFY','APPROVE','PROCESS','MARK_PAID','RECONCILE','CANCEL') THEN
    RAISE EXCEPTION 'Invalid FF4 workflow action: %', p_action;
  END IF;

  IF p_action = 'SUBMIT' THEN
    PERFORM njss_require_permission('ff4.create');
  ELSE
    PERFORM njss_require_permission(CASE
      WHEN p_action = 'VERIFY' THEN 'ff4.verify'
      WHEN p_action = 'APPROVE' THEN 'ff4.approve'
      WHEN p_action IN ('PROCESS','MARK_PAID','RECONCILE') THEN 'ff4.process'
      WHEN p_action = 'CANCEL' THEN 'ff4.reject'
    END);
  END IF;

  SELECT * INTO v_ff4 FROM ff4_headers WHERE id = p_ff4_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FF4 not found.'; END IF;
  v_old := v_ff4;

  IF v_ff4.status IN ('PAID','RECONCILED') AND p_action <> 'RECONCILE' THEN
    RAISE EXCEPTION 'Paid or reconciled FF4 records cannot be changed by this action.';
  END IF;

  IF p_action = 'CANCEL' THEN
    IF v_ff4.status IN ('PAID','RECONCILED','CANCELLED') THEN
      RAISE EXCEPTION 'Paid, reconciled or already cancelled FF4 records cannot be cancelled.';
    END IF;
    IF COALESCE(TRIM(p_comments), '') = '' THEN RAISE EXCEPTION 'Cancellation reason is required.'; END IF;
    UPDATE ff4_headers
    SET status = 'CANCELLED', cancellation_reason = p_comments, cancelled_by = v_actor, cancelled_at = NOW(), updated_at = NOW()
    WHERE id = p_ff4_id
    RETURNING * INTO v_ff4;

    INSERT INTO ff4_approvals (ff4_header_id, approval_level, approver_id, action_taken, comments, old_status, new_status, amount, reference)
    VALUES (p_ff4_id, p_action, v_actor, 'CANCELLED', p_comments, v_old.status, v_ff4.status, v_ff4.net_amount, v_ff4.ff4_number);
    PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'FF4_CANCELLED', 'FF4', p_ff4_id, v_ff4.ff4_number, TO_JSONB(v_old), TO_JSONB(v_ff4), JSONB_BUILD_OBJECT('old_status', v_old.status, 'new_status', v_ff4.status, 'amount', v_ff4.net_amount, 'comments', p_comments), JSONB_BUILD_OBJECT('phase', 'PHASE_4'));
    RETURN JSONB_BUILD_OBJECT('header', TO_JSONB(v_ff4), 'commitment', NULL, 'payment_transaction', NULL);
  END IF;

  IF v_ff4.commitment_id IS NULL THEN RAISE EXCEPTION 'FF4 is not linked to a commitment.'; END IF;
  SELECT * INTO v_commitment FROM ff3_commitments WHERE id = v_ff4.commitment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Linked commitment was not found.'; END IF;
  v_old_commitment := v_commitment;

  IF v_ff4.ff3_header_id IS DISTINCT FROM v_commitment.ff3_header_id THEN
    RAISE EXCEPTION 'FF4 is linked to the wrong FF3 for this commitment.';
  END IF;
  IF v_commitment.status NOT IN ('ACTIVE','PARTIALLY_PAID') AND p_action <> 'RECONCILE' THEN
    RAISE EXCEPTION 'Payment against % commitment is not allowed.', v_commitment.status;
  END IF;

  v_amount := COALESCE(v_ff4.net_amount, 0);
  IF v_amount <= 0 THEN RAISE EXCEPTION 'FF4 net amount must be greater than zero.'; END IF;

  v_outstanding := COALESCE(v_commitment.outstanding_amount, COALESCE(v_commitment.current_committed_amount, v_commitment.committed_amount, 0) - COALESCE(v_commitment.paid_amount, 0));
  v_reserved_other := njss_ff4_reserved_amount(v_commitment.id, v_ff4.id);

  IF p_action IN ('SUBMIT','VERIFY','APPROVE','PROCESS') AND v_amount > (v_outstanding - v_reserved_other) + 0.001 THEN
    RAISE EXCEPTION 'FF4 amount exceeds remaining commitment after other pending FF4s. Available: K%, Requested: K%.', (v_outstanding - v_reserved_other), v_amount;
  END IF;

  IF p_action = 'SUBMIT' THEN
    IF v_ff4.status <> 'DRAFT' THEN RAISE EXCEPTION 'Only DRAFT FF4 can be submitted. Current status: %', v_ff4.status; END IF;
    v_next_status := 'SUBMITTED';
    UPDATE ff4_headers SET status = v_next_status, submitted_date = NOW(), submitted_by = v_actor, updated_at = NOW()
    WHERE id = p_ff4_id RETURNING * INTO v_ff4;
  ELSIF p_action = 'VERIFY' THEN
    IF v_ff4.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'Only SUBMITTED FF4 can be verified. Current status: %', v_ff4.status; END IF;
    v_next_status := 'VERIFIED';
    UPDATE ff4_headers SET status = v_next_status, verified_date = NOW(), verified_by = v_actor, updated_at = NOW()
    WHERE id = p_ff4_id RETURNING * INTO v_ff4;
  ELSIF p_action = 'APPROVE' THEN
    IF v_ff4.status <> 'VERIFIED' THEN RAISE EXCEPTION 'Only VERIFIED FF4 can be approved. Current status: %', v_ff4.status; END IF;
    IF v_ff4.created_by IS NOT NULL AND v_ff4.created_by = v_actor AND NOT fn_current_user_has_permission('all') THEN
      RAISE EXCEPTION 'Creator cannot be the final approver for this FF4.';
    END IF;
    v_next_status := 'APPROVED';
    UPDATE ff4_headers SET status = v_next_status, approved_date = NOW(), approved_by = v_actor, updated_at = NOW()
    WHERE id = p_ff4_id RETURNING * INTO v_ff4;
  ELSIF p_action = 'PROCESS' THEN
    IF v_ff4.status <> 'APPROVED' THEN RAISE EXCEPTION 'Only APPROVED FF4 can be processed. Current status: %', v_ff4.status; END IF;
    v_next_status := 'PROCESSED';
    UPDATE ff4_headers SET status = v_next_status, processed_date = NOW(), processed_by = v_actor, updated_at = NOW()
    WHERE id = p_ff4_id RETURNING * INTO v_ff4;
  ELSIF p_action = 'MARK_PAID' THEN
    IF v_ff4.status <> 'PROCESSED' THEN RAISE EXCEPTION 'Only PROCESSED FF4 can be marked paid. Current status: %', v_ff4.status; END IF;
    IF COALESCE(TRIM(p_payment_reference), '') = '' THEN RAISE EXCEPTION 'External payment reference is required to mark FF4 paid.'; END IF;
    IF EXISTS (SELECT 1 FROM payment_transactions WHERE ff4_header_id = p_ff4_id AND transaction_type = 'PAYMENT' AND COALESCE(status, 'POSTED') <> 'REVERSED') THEN
      RAISE EXCEPTION 'Duplicate payment blocked. This FF4 already has a payment transaction.';
    END IF;
    IF v_amount > v_outstanding + 0.001 THEN
      RAISE EXCEPTION 'Payment exceeds outstanding commitment. Outstanding: K%, Requested: K%.', v_outstanding, v_amount;
    END IF;

    v_position_before := njss_budget_position_for_allocation(v_commitment.budget_allocation_id);

    UPDATE ff4_headers
    SET status = 'PAID',
        external_payment_reference = p_payment_reference,
        payment_date = COALESCE(p_payment_date, CURRENT_DATE),
        paid_date = NOW(),
        paid_by = v_actor,
        payment_method = COALESCE(NULLIF(p_payment_method, ''), payment_method),
        cheque_number = COALESCE(NULLIF(p_cheque_number, ''), cheque_number),
        remarks = COALESCE(NULLIF(p_comments, ''), remarks),
        updated_at = NOW()
    WHERE id = p_ff4_id
    RETURNING * INTO v_ff4;

    INSERT INTO commitment_transactions (
      commitment_id, ff3_header_id, budget_allocation_id, transaction_type, amount,
      transaction_date, reason_code, reason, reference, previous_balance, new_balance,
      approved_by, created_by
    ) VALUES (
      v_commitment.id, v_commitment.ff3_header_id, v_commitment.budget_allocation_id, 'PAYMENT_LIQUIDATION', v_amount,
      COALESCE(p_payment_date, CURRENT_DATE), 'FF4_PAYMENT', COALESCE(p_comments, 'FF4 external payment confirmed'),
      p_payment_reference, v_outstanding, GREATEST(v_outstanding - v_amount, 0), v_actor, v_actor
    );

    INSERT INTO payment_transactions (
      ff4_header_id, commitment_id, transaction_date, transaction_type, amount,
      payment_reference, reconciled, financial_year, budget_allocation_id, payment_method_id,
      status, created_by, updated_at
    ) VALUES (
      v_ff4.id, v_commitment.id, COALESCE(p_payment_date, CURRENT_DATE), 'PAYMENT', v_amount,
      p_payment_reference, FALSE, v_ff4.financial_year, v_commitment.budget_allocation_id, v_ff4.payment_method_id,
      'POSTED', v_actor, NOW()
    ) RETURNING * INTO v_payment;

    v_commitment := njss_sync_commitment_balances(v_commitment.id);
    v_position_after := njss_budget_position_for_allocation(v_commitment.budget_allocation_id);

    INSERT INTO ff4_approvals (ff4_header_id, approval_level, approver_id, action_taken, comments, old_status, new_status, amount, reference)
    VALUES (p_ff4_id, p_action, v_actor, 'PAID', p_comments, v_old.status, v_ff4.status, v_amount, p_payment_reference);
    PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'FF4_PAID_COMMITMENT_LIQUIDATED', 'FF4', p_ff4_id, v_ff4.ff4_number, TO_JSONB(v_old), TO_JSONB(v_ff4), JSONB_BUILD_OBJECT('old_status', v_old.status, 'new_status', v_ff4.status, 'amount', v_amount, 'reference', p_payment_reference, 'commitment_id', v_commitment.id, 'financial_position_before', v_position_before, 'financial_position_after', v_position_after), JSONB_BUILD_OBJECT('phase', 'PHASE_4'));
    PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'PAYMENT_LIQUIDATION', 'COMMITMENT', v_commitment.id, v_commitment.commitment_number, TO_JSONB(v_old_commitment), TO_JSONB(v_commitment), JSONB_BUILD_OBJECT('ff4_id', p_ff4_id, 'amount', v_amount, 'reference', p_payment_reference), JSONB_BUILD_OBJECT('phase', 'PHASE_4'));

    RETURN JSONB_BUILD_OBJECT('header', TO_JSONB(v_ff4), 'commitment', TO_JSONB(v_commitment), 'payment_transaction', TO_JSONB(v_payment), 'financial_position_before', v_position_before, 'financial_position_after', v_position_after);
  ELSIF p_action = 'RECONCILE' THEN
    IF v_ff4.status <> 'PAID' THEN RAISE EXCEPTION 'Only PAID FF4 can be reconciled. Current status: %', v_ff4.status; END IF;
    SELECT * INTO v_payment FROM payment_transactions WHERE ff4_header_id = p_ff4_id AND transaction_type = 'PAYMENT' AND COALESCE(status, 'POSTED') <> 'REVERSED' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment transaction is required before reconciliation.'; END IF;
    UPDATE payment_transactions
    SET reconciled = TRUE, reconciled_by = v_actor, reconciled_at = NOW(), status = 'RECONCILED', updated_at = NOW()
    WHERE id = v_payment.id
    RETURNING * INTO v_payment;
    UPDATE ff4_headers
    SET status = 'RECONCILED', reconciled_date = NOW(), reconciled_by = v_actor, remarks = COALESCE(NULLIF(p_comments, ''), remarks), updated_at = NOW()
    WHERE id = p_ff4_id
    RETURNING * INTO v_ff4;
  END IF;

  INSERT INTO ff4_approvals (ff4_header_id, approval_level, approver_id, action_taken, comments, old_status, new_status, amount, reference)
  VALUES (p_ff4_id, p_action, v_actor, v_ff4.status, p_comments, v_old.status, v_ff4.status, v_amount, COALESCE(p_payment_reference, v_ff4.external_payment_reference, v_ff4.ff4_number));

  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'FF4_' || p_action, 'FF4', p_ff4_id, v_ff4.ff4_number, TO_JSONB(v_old), TO_JSONB(v_ff4), JSONB_BUILD_OBJECT('old_status', v_old.status, 'new_status', v_ff4.status, 'amount', v_amount, 'reference', COALESCE(p_payment_reference, v_ff4.external_payment_reference), 'comments', p_comments), JSONB_BUILD_OBJECT('phase', 'PHASE_4'));

  RETURN JSONB_BUILD_OBJECT('header', TO_JSONB(v_ff4), 'commitment', TO_JSONB(v_commitment), 'payment_transaction', TO_JSONB(v_payment), 'financial_position_after', CASE WHEN v_commitment.budget_allocation_id IS NOT NULL THEN njss_budget_position_for_allocation(v_commitment.budget_allocation_id) ELSE NULL END);
END;
$$;

INSERT INTO permissions (code, module_code, action, label, is_active) VALUES
  ('ff4.view', 'finance', 'view', 'View FF4 expense records', TRUE),
  ('ff4.create', 'finance', 'create', 'Create FF4 expense records', TRUE),
  ('ff4.submit', 'finance', 'submit', 'Submit FF4 expense records', TRUE),
  ('ff4.verify', 'finance', 'verify', 'Verify FF4 expense records', TRUE),
  ('ff4.approve', 'finance', 'approve', 'Approve FF4 expense records', TRUE),
  ('ff4.process', 'finance', 'approve', 'Process and record FF4 payments', TRUE),
  ('ff4.reject', 'finance', 'reject', 'Cancel FF4 expense records', TRUE)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, module_code = EXCLUDED.module_code, action = EXCLUDED.action, is_active = TRUE;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.code, TRUE
FROM roles r
JOIN permissions p ON p.code = ANY(ARRAY['ff4.view','ff4.create','ff4.submit'])
WHERE r.name IN ('Finance Officer', 'Budget Officer', 'Budget Manager', 'Finance Manager', 'System Administrator')
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = TRUE;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.code, TRUE
FROM roles r
JOIN permissions p ON p.code = ANY(ARRAY['ff4.verify','ff4.approve','ff4.process','ff4.reject'])
WHERE r.name IN ('Budget Manager', 'Finance Manager', 'System Administrator')
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = TRUE;

INSERT INTO segregation_rules (entity_type, create_action, verify_action, approve_action, allow_same_user, bypass_permission, is_active)
VALUES ('FF4', 'CREATE', 'VERIFY', 'APPROVE', FALSE, 'all', TRUE)
ON CONFLICT (entity_type, create_action, verify_action, approve_action) DO UPDATE SET allow_same_user = FALSE, bypass_permission = 'all', is_active = TRUE;

INSERT INTO workflow_statuses (module_code, status_code, display_name, sort_order, is_filterable, is_active)
VALUES
  ('FF4', 'DRAFT', 'Draft', 10, TRUE, TRUE),
  ('FF4', 'SUBMITTED', 'Submitted', 20, TRUE, TRUE),
  ('FF4', 'VERIFIED', 'Awaiting Approval', 30, TRUE, TRUE),
  ('FF4', 'APPROVED', 'Approved', 40, TRUE, TRUE),
  ('FF4', 'PROCESSED', 'Processed', 50, TRUE, TRUE),
  ('FF4', 'PAID', 'Paid', 60, TRUE, TRUE),
  ('FF4', 'RECONCILED', 'Reconciled', 70, TRUE, TRUE),
  ('FF4', 'CANCELLED', 'Cancelled', 80, TRUE, TRUE)
ON CONFLICT (module_code, status_code) DO UPDATE
SET display_name = EXCLUDED.display_name, sort_order = EXCLUDED.sort_order, is_filterable = TRUE, is_active = TRUE;

ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ff4_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_transactions_select_phase4 ON payment_transactions;
CREATE POLICY payment_transactions_select_phase4 ON payment_transactions FOR SELECT
USING (fn_current_user_has_permission('ff4.view') OR fn_current_user_has_permission('ff4.process') OR fn_current_user_has_permission('commitment.view') OR fn_current_user_has_permission('all'));
DROP POLICY IF EXISTS payment_transactions_no_insert_phase4 ON payment_transactions;
CREATE POLICY payment_transactions_no_insert_phase4 ON payment_transactions FOR INSERT WITH CHECK (FALSE);
DROP POLICY IF EXISTS payment_transactions_no_update_phase4 ON payment_transactions;
CREATE POLICY payment_transactions_no_update_phase4 ON payment_transactions FOR UPDATE USING (FALSE) WITH CHECK (FALSE);
DROP POLICY IF EXISTS payment_transactions_no_delete_phase4 ON payment_transactions;
CREATE POLICY payment_transactions_no_delete_phase4 ON payment_transactions FOR DELETE USING (FALSE);

DROP POLICY IF EXISTS ff4_approvals_select_phase4 ON ff4_approvals;
CREATE POLICY ff4_approvals_select_phase4 ON ff4_approvals FOR SELECT
USING (fn_current_user_has_permission('ff4.view') OR fn_current_user_has_permission('ff4.process') OR fn_current_user_has_permission('audit.view') OR fn_current_user_has_permission('all'));
DROP POLICY IF EXISTS ff4_approvals_no_write_phase4 ON ff4_approvals;
CREATE POLICY ff4_approvals_no_write_phase4 ON ff4_approvals FOR ALL USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS ff3_commitments_select_phase4_ff4 ON ff3_commitments;
CREATE POLICY ff3_commitments_select_phase4_ff4 ON ff3_commitments FOR SELECT
USING (fn_current_user_has_permission('commitment.view') OR fn_current_user_has_permission('budget.control.view') OR fn_current_user_has_permission('ff4.create') OR fn_current_user_has_permission('ff4.view') OR fn_current_user_has_permission('ff4.process') OR fn_current_user_has_permission('all'));

REVOKE INSERT, UPDATE, DELETE ON payment_transactions FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON ff4_approvals FROM anon, authenticated;
GRANT SELECT ON payment_transactions TO authenticated;
GRANT SELECT ON ff4_approvals TO authenticated;
GRANT SELECT ON v_ff4_payable_commitments TO authenticated;
GRANT SELECT ON v_ff4_payment_register TO authenticated;

REVOKE ALL ON FUNCTION njss_create_ff4(JSONB, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION njss_transition_ff4(UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION njss_ff4_reserved_amount(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION njss_create_ff4(JSONB, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_transition_ff4(UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_ff4_reserved_amount(UUID, UUID) TO authenticated;
