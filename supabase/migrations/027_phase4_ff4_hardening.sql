-- NJSS PHASE 4 FINAL HARDENING — FF4 financial controls
-- Additive hardening only. Do not start Phase 5.
-- Ensures ff4_headers writes occur only through SECURITY DEFINER RPCs and
-- prevents caller-supplied suppliers from overriding the linked commitment supplier.

-- -----------------------------------------------------------------------------
-- 1. Lock down direct browser/client writes to ff4_headers
-- -----------------------------------------------------------------------------
ALTER TABLE ff4_headers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ff4_headers_insert_rbac ON ff4_headers;
DROP POLICY IF EXISTS ff4_headers_update_rbac ON ff4_headers;
DROP POLICY IF EXISTS ff4_headers_delete_rbac ON ff4_headers;
DROP POLICY IF EXISTS ff4_headers_no_insert_phase4_hardening ON ff4_headers;
DROP POLICY IF EXISTS ff4_headers_no_update_phase4_hardening ON ff4_headers;
DROP POLICY IF EXISTS ff4_headers_no_delete_phase4_hardening ON ff4_headers;
DROP POLICY IF EXISTS ff4_headers_select_rbac ON ff4_headers;
DROP POLICY IF EXISTS ff4_headers_select_phase4_hardening ON ff4_headers;

CREATE POLICY ff4_headers_select_phase4_hardening ON ff4_headers
  FOR SELECT
  USING (
    fn_current_user_has_permission('ff4.view')
    OR fn_current_user_has_permission('ff4.create')
    OR fn_current_user_has_permission('ff4.verify')
    OR fn_current_user_has_permission('ff4.approve')
    OR fn_current_user_has_permission('ff4.process')
    OR fn_current_user_has_permission('ff4.reject')
    OR fn_current_user_has_permission('all')
  );

CREATE POLICY ff4_headers_no_insert_phase4_hardening ON ff4_headers
  FOR INSERT WITH CHECK (FALSE);

CREATE POLICY ff4_headers_no_update_phase4_hardening ON ff4_headers
  FOR UPDATE USING (FALSE) WITH CHECK (FALSE);

CREATE POLICY ff4_headers_no_delete_phase4_hardening ON ff4_headers
  FOR DELETE USING (FALSE);

REVOKE INSERT, UPDATE, DELETE ON ff4_headers FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Recreate controlled FF4 creation RPC with supplier/payee consistency checks
-- -----------------------------------------------------------------------------
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
  v_supplier suppliers%ROWTYPE;
  v_ff4 ff4_headers%ROWTYPE;
  v_amount NUMERIC;
  v_reserved NUMERIC;
  v_available NUMERIC;
  v_status TEXT := CASE WHEN p_submit THEN 'SUBMITTED' ELSE 'DRAFT' END;
  v_attachments JSONB := COALESCE(p_payload->'attachments', '[]'::JSONB);
  v_payload_supplier_id UUID := NULLIF(p_payload->>'supplier_id', '')::UUID;
  v_final_supplier_id UUID;
  v_final_supplier_code TEXT;
  v_final_payee_name TEXT;
  v_final_payee_type TEXT;
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

  IF v_commitment.supplier_id IS NOT NULL THEN
    IF v_payload_supplier_id IS NOT NULL AND v_payload_supplier_id <> v_commitment.supplier_id THEN
      RAISE EXCEPTION 'Supplier mismatch blocked. FF4 supplier must match the supplier attached to the selected commitment.';
    END IF;

    SELECT * INTO v_supplier FROM suppliers WHERE id = v_commitment.supplier_id;
    v_final_supplier_id := v_commitment.supplier_id;
    v_final_supplier_code := COALESCE(v_commitment.supplier_code_snapshot, v_supplier.supplier_code, NULLIF(p_payload->>'supplier_code', ''));
    v_final_payee_name := COALESCE(v_commitment.supplier_name_snapshot, v_supplier.legal_name, v_supplier.supplier_name, v_ff3.selected_supplier_name, NULLIF(p_payload->>'payee_name', ''), 'Supplier');
    v_final_payee_type := 'SUPPLIER';
  ELSE
    v_final_supplier_id := v_payload_supplier_id;
    v_final_supplier_code := NULLIF(p_payload->>'supplier_code', '');
    v_final_payee_name := COALESCE(NULLIF(p_payload->>'payee_name', ''), v_commitment.supplier_name_snapshot, v_ff3.selected_supplier_name, 'Payee');
    v_final_payee_type := COALESCE(NULLIF(p_payload->>'payee_type', ''), 'OTHER');
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
    v_final_payee_type, NULLIF(p_payload->>'payee_type_id', '')::UUID, v_final_payee_name,
    v_final_supplier_id, NULLIF(p_payload->>'payee_user_id', '')::UUID, v_final_supplier_code,
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

  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), CASE WHEN p_submit THEN 'FF4_SUBMITTED' ELSE 'FF4_CREATED' END, 'FF4', v_ff4.id, v_ff4.ff4_number, NULL, TO_JSONB(v_ff4), JSONB_BUILD_OBJECT('amount', v_ff4.net_amount, 'commitment_id', v_commitment.id, 'commitment_number', v_commitment.commitment_number, 'supplier_id', v_final_supplier_id), JSONB_BUILD_OBJECT('phase', 'PHASE_4_HARDENING'));

  RETURN JSONB_BUILD_OBJECT('header', TO_JSONB(v_ff4), 'commitment', TO_JSONB(v_commitment), 'payment_transaction', NULL);
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Recreate transition RPC to keep cancellation consistently under ff4.reject
-- -----------------------------------------------------------------------------
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

  PERFORM njss_require_permission(CASE
    WHEN p_action = 'SUBMIT' THEN 'ff4.create'
    WHEN p_action = 'VERIFY' THEN 'ff4.verify'
    WHEN p_action = 'APPROVE' THEN 'ff4.approve'
    WHEN p_action IN ('PROCESS','MARK_PAID','RECONCILE') THEN 'ff4.process'
    WHEN p_action = 'CANCEL' THEN 'ff4.reject'
  END);

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

    PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'FF4_CANCELLED', 'FF4', p_ff4_id, v_ff4.ff4_number, TO_JSONB(v_old), TO_JSONB(v_ff4), JSONB_BUILD_OBJECT('old_status', v_old.status, 'new_status', v_ff4.status, 'amount', v_ff4.net_amount, 'comments', p_comments), JSONB_BUILD_OBJECT('phase', 'PHASE_4_HARDENING'));
    RETURN JSONB_BUILD_OBJECT('header', TO_JSONB(v_ff4), 'commitment', NULL, 'payment_transaction', NULL);
  END IF;

  IF v_ff4.commitment_id IS NULL THEN RAISE EXCEPTION 'FF4 is not linked to a commitment.'; END IF;
  SELECT * INTO v_commitment FROM ff3_commitments WHERE id = v_ff4.commitment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Linked commitment was not found.'; END IF;
  v_old_commitment := v_commitment;

  IF v_ff4.ff3_header_id IS DISTINCT FROM v_commitment.ff3_header_id THEN
    RAISE EXCEPTION 'FF4 is linked to the wrong FF3 for this commitment.';
  END IF;
  IF v_ff4.supplier_id IS NOT NULL AND v_commitment.supplier_id IS NOT NULL AND v_ff4.supplier_id <> v_commitment.supplier_id THEN
    RAISE EXCEPTION 'Supplier mismatch blocked. FF4 supplier does not match the selected commitment supplier.';
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
    PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'FF4_PAID_COMMITMENT_LIQUIDATED', 'FF4', p_ff4_id, v_ff4.ff4_number, TO_JSONB(v_old), TO_JSONB(v_ff4), JSONB_BUILD_OBJECT('old_status', v_old.status, 'new_status', v_ff4.status, 'amount', v_amount, 'reference', p_payment_reference, 'commitment_id', v_commitment.id, 'financial_position_before', v_position_before, 'financial_position_after', v_position_after), JSONB_BUILD_OBJECT('phase', 'PHASE_4_HARDENING'));
    PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'PAYMENT_LIQUIDATION', 'COMMITMENT', v_commitment.id, v_commitment.commitment_number, TO_JSONB(v_old_commitment), TO_JSONB(v_commitment), JSONB_BUILD_OBJECT('ff4_id', p_ff4_id, 'amount', v_amount, 'reference', p_payment_reference), JSONB_BUILD_OBJECT('phase', 'PHASE_4_HARDENING'));

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

  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'FF4_' || p_action, 'FF4', p_ff4_id, v_ff4.ff4_number, TO_JSONB(v_old), TO_JSONB(v_ff4), JSONB_BUILD_OBJECT('old_status', v_old.status, 'new_status', v_ff4.status, 'amount', v_amount, 'reference', COALESCE(p_payment_reference, v_ff4.external_payment_reference), 'comments', p_comments), JSONB_BUILD_OBJECT('phase', 'PHASE_4_HARDENING'));

  RETURN JSONB_BUILD_OBJECT('header', TO_JSONB(v_ff4), 'commitment', TO_JSONB(v_commitment), 'payment_transaction', TO_JSONB(v_payment), 'financial_position_after', CASE WHEN v_commitment.budget_allocation_id IS NOT NULL THEN njss_budget_position_for_allocation(v_commitment.budget_allocation_id) ELSE NULL END);
END;
$$;

REVOKE ALL ON FUNCTION njss_create_ff4(JSONB, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION njss_transition_ff4(UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION njss_create_ff4(JSONB, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_transition_ff4(UUID, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT) TO authenticated;
