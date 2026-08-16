-- NJSS Supplier Module Simplification
-- Suppliers are simple expenditure reference records only.
-- This migration intentionally keeps Phase 3 advanced tables in place for historical safety,
-- but removes supplier approval/compliance workflow blocking from operational paths.

-- Normalize supplier statuses to the simple active/inactive model without deleting history.
UPDATE suppliers
SET
  status = CASE WHEN COALESCE(is_active, TRUE) THEN 'ACTIVE' ELSE 'INACTIVE' END,
  compliance_status = COALESCE(compliance_status, 'INCOMPLETE'),
  updated_at = NOW()
WHERE COALESCE(status, '') <> CASE WHEN COALESCE(is_active, TRUE) THEN 'ACTIVE' ELSE 'INACTIVE' END;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppliers_phase3_status') THEN
    ALTER TABLE suppliers DROP CONSTRAINT chk_suppliers_phase3_status;
  END IF;

  ALTER TABLE suppliers ADD CONSTRAINT chk_suppliers_simple_status CHECK (status IN ('ACTIVE', 'INACTIVE'));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

CREATE OR REPLACE VIEW v_suppliers_directory AS
SELECT
  s.id,
  s.supplier_code,
  COALESCE(s.legal_name, s.supplier_name) AS supplier_name,
  s.legal_name,
  s.trading_name,
  s.supplier_type,
  s.ipa_registration_number,
  s.tin,
  s.primary_contact_name,
  s.phone,
  s.email,
  COALESCE(s.physical_address, s.address) AS physical_address,
  COALESCE(s.physical_address, s.address) AS address,
  s.province,
  s.country,
  CASE WHEN COALESCE(s.is_active, TRUE) THEN 'ACTIVE' ELSE 'INACTIVE' END AS status,
  s.is_active
FROM suppliers s
WHERE COALESCE(s.is_active, TRUE) IS TRUE;

CREATE OR REPLACE VIEW v_supplier_register AS
SELECT
  s.id,
  s.supplier_code,
  COALESCE(s.legal_name, s.supplier_name) AS supplier_name,
  s.legal_name,
  s.trading_name,
  s.supplier_type,
  s.ipa_registration_number,
  s.tin,
  s.primary_contact_name,
  s.phone,
  s.email,
  COALESCE(s.physical_address, s.address) AS physical_address,
  COALESCE(s.physical_address, s.address) AS address,
  s.province,
  s.country,
  CASE WHEN COALESCE(s.is_active, TRUE) THEN 'ACTIVE' ELSE 'INACTIVE' END AS status,
  COUNT(DISTINCT fc.id) FILTER (WHERE COALESCE(fc.status, '') NOT IN ('CANCELLED', 'CLOSED', 'LIQUIDATED')) AS active_commitments,
  COALESCE(SUM(COALESCE(fc.outstanding_amount, fc.current_committed_amount, fc.committed_amount, 0)) FILTER (WHERE COALESCE(fc.status, '') NOT IN ('CANCELLED', 'CLOSED', 'LIQUIDATED')), 0) AS outstanding_commitment_value,
  COALESCE(SUM(COALESCE(fc.paid_amount, 0)), 0) AS total_spend,
  COALESCE(SUM(COALESCE(fc.paid_amount, 0)), 0) AS actual_expenditure,
  s.created_at,
  s.updated_at
FROM suppliers s
LEFT JOIN ff3_commitments fc ON fc.supplier_id = s.id
GROUP BY s.id;

CREATE OR REPLACE VIEW v_supplier_commitment_position AS
SELECT
  s.id AS supplier_id,
  s.supplier_code,
  COALESCE(s.legal_name, s.supplier_name) AS supplier_name,
  fh.ff3_number,
  fc.commitment_number,
  fc.financial_year,
  d.name AS department,
  sec.name AS division,
  sec.name AS section,
  cc.code AS cost_centre,
  ecr.full_expense_code AS finance_code,
  fs.name AS funding_source,
  COALESCE(fc.original_committed_amount, fc.committed_amount, 0) AS original_commitment,
  COALESCE(fc.current_committed_amount, fc.committed_amount, 0) AS current_commitment,
  COALESCE(fc.paid_amount, 0) AS externally_recorded_paid_amount,
  COALESCE(fc.outstanding_amount, COALESCE(fc.current_committed_amount, fc.committed_amount, 0) - COALESCE(fc.paid_amount, 0)) AS outstanding_commitment,
  fc.status AS commitment_status
FROM suppliers s
JOIN ff3_commitments fc ON fc.supplier_id = s.id
LEFT JOIN ff3_headers fh ON fh.id = fc.ff3_header_id
LEFT JOIN departments d ON d.id = fh.department_id
LEFT JOIN sections sec ON sec.id = fh.section_id
LEFT JOIN cost_centres cc ON cc.id = fh.cost_centre_id
LEFT JOIN expense_code_registry ecr ON ecr.id = fh.expense_code_registry_id
LEFT JOIN funding_sources fs ON fs.id = fh.funding_source_id;

CREATE OR REPLACE FUNCTION njss_create_supplier(
  p_payload JSONB,
  p_allow_possible_duplicate BOOLEAN DEFAULT FALSE,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_supplier suppliers%ROWTYPE;
  v_duplicates JSONB;
  v_legal_name TEXT := NULLIF(BTRIM(COALESCE(p_payload->>'legal_name', p_payload->>'supplier_name', '')), '');
BEGIN
  PERFORM njss_require_permission('supplier.create');
  IF v_legal_name IS NULL THEN
    RAISE EXCEPTION 'Supplier / business name is required.';
  END IF;

  v_actor := COALESCE(fn_current_app_user_id(), (SELECT id FROM users WHERE LOWER(email) = LOWER(COALESCE(p_user_email, '')) LIMIT 1));

  SELECT COALESCE(JSONB_AGG(TO_JSONB(d)), '[]'::JSONB) INTO v_duplicates
  FROM njss_find_supplier_duplicates(
    v_legal_name,
    p_payload->>'trading_name',
    p_payload->>'ipa_registration_number',
    p_payload->>'tin',
    p_payload->>'email',
    p_payload->>'phone'
  ) d;

  IF EXISTS (SELECT 1 FROM JSONB_TO_RECORDSET(v_duplicates) AS d(match_type TEXT) WHERE d.match_type IN ('EXACT_IPA', 'EXACT_TIN')) THEN
    RAISE EXCEPTION 'Duplicate supplier blocked. IPA registration number or TIN already exists in the Supplier Register.';
  END IF;

  IF p_allow_possible_duplicate IS NOT TRUE AND JSONB_ARRAY_LENGTH(v_duplicates) > 0 THEN
    RETURN JSONB_BUILD_OBJECT('created', FALSE, 'requires_review', TRUE, 'possible_duplicates', v_duplicates);
  END IF;

  INSERT INTO suppliers (
    supplier_name, legal_name, trading_name, supplier_type,
    ipa_registration_number, company_registration_number, tin,
    primary_contact_name, contact_person, phone, email,
    physical_address, address, province, country, status,
    compliance_status, notes, created_by, updated_by, is_active
  ) VALUES (
    v_legal_name, v_legal_name, NULLIF(p_payload->>'trading_name', ''), COALESCE(NULLIF(p_payload->>'supplier_type', ''), 'SUPPLIER'),
    NULLIF(p_payload->>'ipa_registration_number', ''), NULLIF(p_payload->>'ipa_registration_number', ''), NULLIF(p_payload->>'tin', ''),
    NULLIF(p_payload->>'primary_contact_name', ''), NULLIF(p_payload->>'primary_contact_name', ''), NULLIF(p_payload->>'phone', ''), NULLIF(p_payload->>'email', ''),
    NULLIF(COALESCE(p_payload->>'physical_address', p_payload->>'address'), ''), NULLIF(COALESCE(p_payload->>'physical_address', p_payload->>'address'), ''),
    NULLIF(p_payload->>'province', ''), COALESCE(NULLIF(p_payload->>'country', ''), 'Papua New Guinea'),
    CASE WHEN COALESCE((p_payload->>'is_active')::BOOLEAN, TRUE) THEN 'ACTIVE' ELSE 'INACTIVE' END,
    'INCOMPLETE', NULLIF(p_payload->>'notes', ''), v_actor, v_actor, COALESCE((p_payload->>'is_active')::BOOLEAN, TRUE)
  ) RETURNING * INTO v_supplier;

  INSERT INTO supplier_status_history (supplier_id, previous_status, new_status, action, reason, actor_id, actor_email)
  VALUES (v_supplier.id, NULL, v_supplier.status, 'SUPPLIER_CREATED', 'Simple supplier reference created', v_actor, p_user_email);

  PERFORM log_audit_event(v_actor, p_user_email, NULL, 'SUPPLIER_CREATED', 'SUPPLIER', v_supplier.id, v_supplier.supplier_code, NULL, TO_JSONB(v_supplier), NULL, JSONB_BUILD_OBJECT('phase', 'SUPPLIER_REFERENCE'));

  RETURN JSONB_BUILD_OBJECT('created', TRUE, 'supplier', TO_JSONB(v_supplier));
END;
$$;

CREATE OR REPLACE FUNCTION njss_update_supplier(
  p_supplier_id UUID,
  p_payload JSONB,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_old suppliers%ROWTYPE;
  v_supplier suppliers%ROWTYPE;
  v_is_active BOOLEAN;
BEGIN
  PERFORM njss_require_permission('supplier.edit');
  v_actor := COALESCE(fn_current_app_user_id(), (SELECT id FROM users WHERE LOWER(email) = LOWER(COALESCE(p_user_email, '')) LIMIT 1));

  SELECT * INTO v_old FROM suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier not found.'; END IF;

  v_is_active := COALESCE((p_payload->>'is_active')::BOOLEAN, COALESCE(v_old.is_active, TRUE));

  UPDATE suppliers
  SET
    legal_name = COALESCE(NULLIF(p_payload->>'legal_name', ''), legal_name),
    supplier_name = COALESCE(NULLIF(p_payload->>'legal_name', ''), supplier_name),
    trading_name = NULLIF(COALESCE(p_payload->>'trading_name', trading_name), ''),
    supplier_type = COALESCE(NULLIF(p_payload->>'supplier_type', ''), supplier_type, 'SUPPLIER'),
    ipa_registration_number = NULLIF(COALESCE(p_payload->>'ipa_registration_number', ipa_registration_number), ''),
    company_registration_number = NULLIF(COALESCE(p_payload->>'ipa_registration_number', company_registration_number), ''),
    tin = NULLIF(COALESCE(p_payload->>'tin', tin), ''),
    primary_contact_name = NULLIF(COALESCE(p_payload->>'primary_contact_name', primary_contact_name), ''),
    contact_person = NULLIF(COALESCE(p_payload->>'primary_contact_name', contact_person), ''),
    phone = NULLIF(COALESCE(p_payload->>'phone', phone), ''),
    email = NULLIF(COALESCE(p_payload->>'email', email), ''),
    physical_address = NULLIF(COALESCE(p_payload->>'physical_address', p_payload->>'address', physical_address), ''),
    address = NULLIF(COALESCE(p_payload->>'physical_address', p_payload->>'address', address), ''),
    province = NULLIF(COALESCE(p_payload->>'province', province), ''),
    country = COALESCE(NULLIF(p_payload->>'country', ''), country, 'Papua New Guinea'),
    notes = NULLIF(COALESCE(p_payload->>'notes', notes), ''),
    is_active = v_is_active,
    status = CASE WHEN v_is_active THEN 'ACTIVE' ELSE 'INACTIVE' END,
    updated_by = v_actor,
    updated_at = NOW()
  WHERE id = p_supplier_id
  RETURNING * INTO v_supplier;

  IF COALESCE(v_old.status, '') <> COALESCE(v_supplier.status, '') THEN
    INSERT INTO supplier_status_history (supplier_id, previous_status, new_status, action, reason, actor_id, actor_email)
    VALUES (v_supplier.id, v_old.status, v_supplier.status, 'SUPPLIER_STATUS_UPDATED', 'Active/inactive status updated', v_actor, p_user_email);
  END IF;

  PERFORM log_audit_event(v_actor, p_user_email, NULL, 'SUPPLIER_UPDATED', 'SUPPLIER', v_supplier.id, v_supplier.supplier_code, TO_JSONB(v_old), TO_JSONB(v_supplier), NULL, JSONB_BUILD_OBJECT('phase', 'SUPPLIER_REFERENCE'));

  RETURN TO_JSONB(v_supplier);
END;
$$;

CREATE OR REPLACE FUNCTION njss_validate_ff3_supplier_before_commitment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_header ff3_headers%ROWTYPE;
  v_quote ff3_quotations%ROWTYPE;
  v_supplier suppliers%ROWTYPE;
BEGIN
  SELECT * INTO v_header FROM ff3_headers WHERE id = NEW.ff3_header_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FF3 header not found for commitment.';
  END IF;

  IF COALESCE(v_header.supplier_not_required, FALSE) IS TRUE THEN
    NEW.supplier_id := NULL;
    NEW.supplier_name_snapshot := 'SUPPLIER_NOT_REQUIRED';
    RETURN NEW;
  END IF;

  IF v_header.selected_quotation_id IS NULL THEN
    SELECT * INTO v_quote FROM ff3_quotations WHERE ff3_header_id = v_header.id AND is_selected IS TRUE LIMIT 1;
  ELSE
    SELECT * INTO v_quote FROM ff3_quotations WHERE id = v_header.selected_quotation_id;
  END IF;

  IF NOT FOUND OR v_quote.id IS NULL THEN
    RAISE EXCEPTION 'Selected quotation is required before final FF3 approval.';
  END IF;

  IF v_quote.supplier_id IS NULL THEN
    RAISE EXCEPTION 'Select or quick add a supplier for the selected quotation before final FF3 approval.';
  END IF;

  SELECT * INTO v_supplier FROM suppliers WHERE id = v_quote.supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected supplier record no longer exists.';
  END IF;

  IF COALESCE(v_supplier.is_active, TRUE) IS NOT TRUE OR v_supplier.status = 'INACTIVE' THEN
    RAISE EXCEPTION 'Supplier % is inactive. Reactivate or select another supplier.', COALESCE(v_supplier.legal_name, v_supplier.supplier_name, v_quote.supplier_name);
  END IF;

  NEW.supplier_id := v_supplier.id;
  NEW.supplier_code_snapshot := v_supplier.supplier_code;
  NEW.supplier_name_snapshot := COALESCE(v_supplier.legal_name, v_supplier.supplier_name);
  NEW.supplier_registration_snapshot := COALESCE(v_supplier.ipa_registration_number, v_supplier.company_registration_number);

  UPDATE ff3_headers
  SET
    selected_quotation_id = v_quote.id,
    selected_supplier_id = v_supplier.id,
    selected_supplier_name = COALESCE(v_quote.supplier_name, v_supplier.legal_name, v_supplier.supplier_name),
    selected_supplier_code_snapshot = v_supplier.supplier_code,
    selected_supplier_registration_snapshot = COALESCE(v_supplier.ipa_registration_number, v_supplier.company_registration_number)
  WHERE id = v_header.id;

  RETURN NEW;
END;
$$;

UPDATE permissions
SET is_active = FALSE
WHERE code IN (
  'supplier.submit', 'supplier.verify', 'supplier.approve', 'supplier.reject',
  'supplier.suspend', 'supplier.reactivate', 'supplier.compliance.view',
  'supplier.compliance.manage', 'supplier.followup.view', 'supplier.followup.manage'
);

UPDATE menu_items
SET label = 'Supplier Register', required_permissions = ARRAY['supplier.view', 'supplier.create']
WHERE code = 'finance.suppliers';

GRANT SELECT ON v_suppliers_directory TO authenticated;
GRANT SELECT ON v_supplier_register TO authenticated;
GRANT SELECT ON v_supplier_commitment_position TO authenticated;
REVOKE ALL ON FUNCTION njss_create_supplier(JSONB, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION njss_create_supplier(JSONB, BOOLEAN, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION njss_update_supplier(UUID, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION njss_update_supplier(UUID, JSONB, TEXT) TO authenticated;
