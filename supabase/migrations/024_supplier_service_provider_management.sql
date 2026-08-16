-- NJSS Phase 3: Supplier & Service Provider Management
-- This migration is database-first and additive. It preserves Phase 1 funding controls
-- and Phase 2 FF3 atomic commitment controls. It does not implement payment execution,
-- banking integration, goods receiving, returns/replacements, service milestones or Phase 4.

-- -----------------------------------------------------------------------------
-- Supplier master extension
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS supplier_code_seq START WITH 1;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS registration_type TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ipa_registration_number TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS gst_registration_number TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS primary_contact_name TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS alternate_phone TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS physical_address TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS postal_address TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS province TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Papua New Guinea';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'DRAFT';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS compliance_status TEXT DEFAULT 'INCOMPLETE';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS rejected_by UUID REFERENCES users(id);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES users(id);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS suspension_reason TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS legacy_imported BOOLEAN DEFAULT FALSE;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_mapping_required BOOLEAN DEFAULT FALSE;

UPDATE suppliers
SET
  legal_name = COALESCE(NULLIF(legal_name, ''), supplier_name),
  primary_contact_name = COALESCE(NULLIF(primary_contact_name, ''), contact_person),
  physical_address = COALESCE(NULLIF(physical_address, ''), address),
  ipa_registration_number = COALESCE(NULLIF(ipa_registration_number, ''), company_registration_number),
  status = COALESCE(NULLIF(status, ''), CASE WHEN COALESCE(is_active, TRUE) THEN 'APPROVED' ELSE 'INACTIVE' END),
  compliance_status = COALESCE(NULLIF(compliance_status, ''), 'INCOMPLETE'),
  updated_at = COALESCE(updated_at, created_at, NOW());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppliers_phase3_status') THEN
    ALTER TABLE suppliers ADD CONSTRAINT chk_suppliers_phase3_status CHECK (status IN (
      'DRAFT', 'PENDING_VERIFICATION', 'VERIFIED', 'APPROVED', 'REJECTED', 'SUSPENDED', 'INACTIVE'
    ));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_suppliers_phase3_compliance_status') THEN
    ALTER TABLE suppliers ADD CONSTRAINT chk_suppliers_phase3_compliance_status CHECK (compliance_status IN (
      'COMPLIANT', 'INCOMPLETE', 'EXPIRING', 'EXPIRED'
    ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_suppliers_status_phase3 ON suppliers(status);
CREATE INDEX IF NOT EXISTS idx_suppliers_compliance_phase3 ON suppliers(compliance_status);
CREATE INDEX IF NOT EXISTS idx_suppliers_ipa_phase3 ON suppliers(LOWER(NULLIF(ipa_registration_number, '')));
CREATE INDEX IF NOT EXISTS idx_suppliers_tin_phase3 ON suppliers(LOWER(NULLIF(tin, '')));
CREATE INDEX IF NOT EXISTS idx_suppliers_legal_name_phase3 ON suppliers(LOWER(COALESCE(legal_name, supplier_name)));

CREATE OR REPLACE FUNCTION njss_generate_supplier_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.supplier_code IS NULL OR BTRIM(NEW.supplier_code) = '' THEN
    NEW.supplier_code := 'SUP-' || LPAD(NEXTVAL('supplier_code_seq')::TEXT, 6, '0');
  END IF;
  NEW.legal_name := COALESCE(NULLIF(NEW.legal_name, ''), NEW.supplier_name);
  NEW.supplier_name := COALESCE(NULLIF(NEW.supplier_name, ''), NEW.legal_name);
  NEW.status := COALESCE(NULLIF(NEW.status, ''), 'DRAFT');
  NEW.compliance_status := COALESCE(NULLIF(NEW.compliance_status, ''), 'INCOMPLETE');
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_suppliers_generate_code_phase3 ON suppliers;
CREATE TRIGGER trg_suppliers_generate_code_phase3
BEFORE INSERT OR UPDATE ON suppliers
FOR EACH ROW EXECUTE FUNCTION njss_generate_supplier_code();

-- -----------------------------------------------------------------------------
-- Categories, contacts, compliance documents, status history, follow-ups
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 100,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO supplier_categories (code, name, sort_order) VALUES
  ('GOODS_SUPPLIER', 'Goods Supplier', 10),
  ('SERVICE_PROVIDER', 'Service Provider', 20),
  ('CONTRACTOR', 'Contractor', 30),
  ('CONSULTANT', 'Consultant', 40),
  ('ICT_PROVIDER', 'ICT Provider', 50),
  ('MAINTENANCE_PROVIDER', 'Maintenance Provider', 60),
  ('UTILITY_PROVIDER', 'Utility Provider', 70),
  ('TRANSPORT_PROVIDER', 'Transport Provider', 80),
  ('ACCOMMODATION_PROVIDER', 'Accommodation Provider', 90),
  ('PROFESSIONAL_SERVICES', 'Professional Services', 100),
  ('WORKS_CONTRACTOR', 'Works Contractor', 110),
  ('OTHER', 'Other', 999)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS supplier_category_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES supplier_categories(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (supplier_id, category_id)
);

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  contact_name TEXT NOT NULL,
  position TEXT,
  phone TEXT,
  alternate_phone TEXT,
  email TEXT,
  contact_type TEXT DEFAULT 'GENERAL',
  is_primary BOOLEAN DEFAULT FALSE,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_document_requirements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id UUID REFERENCES supplier_categories(id) ON DELETE CASCADE,
  supplier_type TEXT,
  document_type TEXT NOT NULL,
  is_required BOOLEAN DEFAULT TRUE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (category_id, supplier_type, document_type)
);

CREATE TABLE IF NOT EXISTS supplier_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  document_number TEXT,
  issuing_authority TEXT,
  issue_date DATE,
  expiry_date DATE,
  file_name TEXT,
  storage_reference TEXT,
  verification_status TEXT DEFAULT 'PENDING',
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_supplier_documents_verification_status') THEN
    ALTER TABLE supplier_documents ADD CONSTRAINT chk_supplier_documents_verification_status CHECK (verification_status IN ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_documents_supplier ON supplier_documents(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_documents_expiry ON supplier_documents(expiry_date);
CREATE INDEX IF NOT EXISTS idx_supplier_documents_status ON supplier_documents(verification_status);

CREATE TABLE IF NOT EXISTS supplier_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT,
  actor_id UUID REFERENCES users(id),
  actor_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_followups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  related_entity_type TEXT,
  related_entity_id UUID,
  issue_type TEXT NOT NULL,
  issue_description TEXT NOT NULL,
  responsible_officer UUID REFERENCES users(id),
  follow_up_date DATE,
  contact_person TEXT,
  contact_method TEXT,
  supplier_response TEXT,
  next_action TEXT,
  next_follow_up_date DATE,
  escalation_level INTEGER DEFAULT 0,
  status TEXT DEFAULT 'OPEN',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_supplier_followups_status') THEN
    ALTER TABLE supplier_followups ADD CONSTRAINT chk_supplier_followups_status CHECK (status IN (
      'OPEN', 'FOLLOW_UP_REQUIRED', 'SUPPLIER_CONTACTED', 'AWAITING_SUPPLIER', 'RESOLVED', 'CLOSED'
    ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_followups_supplier ON supplier_followups(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_followups_status ON supplier_followups(status);
CREATE INDEX IF NOT EXISTS idx_supplier_followups_next_date ON supplier_followups(next_follow_up_date);

CREATE TABLE IF NOT EXISTS supplier_legacy_candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_table TEXT NOT NULL,
  source_record_id UUID,
  supplier_name_snapshot TEXT NOT NULL,
  possible_supplier_id UUID REFERENCES suppliers(id),
  mapping_status TEXT DEFAULT 'SUPPLIER_MAPPING_REQUIRED',
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  mapped_by UUID REFERENCES users(id),
  mapped_at TIMESTAMPTZ
);

-- Legacy free-text quotation supplier names are tracked as candidates only. They are
-- not automatically promoted to APPROVED supplier records.
INSERT INTO supplier_legacy_candidates (source_table, source_record_id, supplier_name_snapshot)
SELECT 'ff3_quotations', q.id, q.supplier_name
FROM ff3_quotations q
WHERE q.supplier_id IS NULL
  AND q.supplier_name IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM supplier_legacy_candidates c
    WHERE c.source_table = 'ff3_quotations' AND c.source_record_id = q.id
  );

-- -----------------------------------------------------------------------------
-- FF3 / quotation / commitment supplier linkage
-- -----------------------------------------------------------------------------
ALTER TABLE ff3_headers ADD COLUMN IF NOT EXISTS selected_supplier_id UUID REFERENCES suppliers(id);
ALTER TABLE ff3_headers ADD COLUMN IF NOT EXISTS selected_quotation_id UUID REFERENCES ff3_quotations(id);
ALTER TABLE ff3_headers ADD COLUMN IF NOT EXISTS selected_supplier_code_snapshot TEXT;
ALTER TABLE ff3_headers ADD COLUMN IF NOT EXISTS selected_supplier_registration_snapshot TEXT;
ALTER TABLE ff3_headers ADD COLUMN IF NOT EXISTS supplier_not_required BOOLEAN DEFAULT FALSE;
ALTER TABLE ff3_headers ADD COLUMN IF NOT EXISTS supplier_not_required_reason TEXT;
ALTER TABLE ff3_headers ADD COLUMN IF NOT EXISTS supplier_not_required_expenditure_type TEXT;
ALTER TABLE ff3_headers ADD COLUMN IF NOT EXISTS supplier_not_required_authorized_by UUID REFERENCES users(id);
ALTER TABLE ff3_headers ADD COLUMN IF NOT EXISTS supplier_not_required_authorized_at TIMESTAMPTZ;
ALTER TABLE ff3_headers ADD COLUMN IF NOT EXISTS supplier_not_required_comments TEXT;

ALTER TABLE ff3_quotations ADD COLUMN IF NOT EXISTS supplier_code_snapshot TEXT;
ALTER TABLE ff3_quotations ADD COLUMN IF NOT EXISTS supplier_registration_snapshot TEXT;
ALTER TABLE ff3_quotations ADD COLUMN IF NOT EXISTS legacy_imported BOOLEAN DEFAULT FALSE;
ALTER TABLE ff3_quotations ADD COLUMN IF NOT EXISTS supplier_mapping_required BOOLEAN DEFAULT FALSE;

ALTER TABLE ff3_commitments ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);
ALTER TABLE ff3_commitments ADD COLUMN IF NOT EXISTS supplier_code_snapshot TEXT;
ALTER TABLE ff3_commitments ADD COLUMN IF NOT EXISTS supplier_name_snapshot TEXT;
ALTER TABLE ff3_commitments ADD COLUMN IF NOT EXISTS supplier_registration_snapshot TEXT;

UPDATE ff3_quotations q
SET
  supplier_code_snapshot = COALESCE(q.supplier_code_snapshot, s.supplier_code),
  supplier_registration_snapshot = COALESCE(q.supplier_registration_snapshot, s.ipa_registration_number, s.company_registration_number),
  supplier_mapping_required = CASE WHEN q.supplier_id IS NULL THEN TRUE ELSE q.supplier_mapping_required END
FROM suppliers s
WHERE q.supplier_id = s.id;

CREATE OR REPLACE FUNCTION njss_sync_ff3_selected_supplier()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_supplier suppliers%ROWTYPE;
BEGIN
  IF NEW.is_selected IS TRUE THEN
    IF NEW.supplier_id IS NOT NULL THEN
      SELECT * INTO v_supplier FROM suppliers WHERE id = NEW.supplier_id;
      NEW.supplier_code_snapshot := COALESCE(NEW.supplier_code_snapshot, v_supplier.supplier_code);
      NEW.supplier_registration_snapshot := COALESCE(NEW.supplier_registration_snapshot, v_supplier.ipa_registration_number, v_supplier.company_registration_number);
      UPDATE ff3_headers
      SET
        selected_quotation_id = NEW.id,
        selected_supplier_id = NEW.supplier_id,
        selected_supplier_name = COALESCE(NEW.supplier_name, v_supplier.legal_name, v_supplier.supplier_name),
        selected_supplier_code_snapshot = v_supplier.supplier_code,
        selected_supplier_registration_snapshot = COALESCE(v_supplier.ipa_registration_number, v_supplier.company_registration_number)
      WHERE id = NEW.ff3_header_id;
    ELSE
      UPDATE ff3_headers
      SET
        selected_quotation_id = NEW.id,
        selected_supplier_name = NEW.supplier_name
      WHERE id = NEW.ff3_header_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ff3_quotations_sync_selected_supplier ON ff3_quotations;
CREATE TRIGGER trg_ff3_quotations_sync_selected_supplier
BEFORE INSERT OR UPDATE OF is_selected, supplier_id, supplier_name ON ff3_quotations
FOR EACH ROW EXECUTE FUNCTION njss_sync_ff3_selected_supplier();

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
    IF NULLIF(BTRIM(COALESCE(v_header.supplier_not_required_reason, '')), '') IS NULL THEN
      RAISE EXCEPTION 'Supplier not required reason is required before commitment approval.';
    END IF;
    IF v_header.supplier_not_required_authorized_by IS NULL THEN
      UPDATE ff3_headers
      SET supplier_not_required_authorized_by = fn_current_app_user_id(), supplier_not_required_authorized_at = NOW()
      WHERE id = v_header.id;
    END IF;
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
    RAISE EXCEPTION 'Supplier mapping is required for selected quotation %. Use the Supplier Register instead of free-text supplier names.', COALESCE(v_quote.supplier_name, '');
  END IF;

  IF v_header.selected_supplier_id IS NOT NULL AND v_header.selected_supplier_id <> v_quote.supplier_id THEN
    RAISE EXCEPTION 'Selected supplier does not match the selected quotation supplier. Record an authorized correction before final approval.';
  END IF;

  SELECT * INTO v_supplier FROM suppliers WHERE id = v_quote.supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected supplier record no longer exists.';
  END IF;

  IF v_supplier.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Supplier % is not approved for new commitments.', COALESCE(v_supplier.legal_name, v_supplier.supplier_name, v_quote.supplier_name);
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

DROP TRIGGER IF EXISTS trg_ff3_commitments_supplier_validation ON ff3_commitments;
CREATE TRIGGER trg_ff3_commitments_supplier_validation
BEFORE INSERT ON ff3_commitments
FOR EACH ROW EXECUTE FUNCTION njss_validate_ff3_supplier_before_commitment();

-- -----------------------------------------------------------------------------
-- Supplier duplicate detection, compliance and workflow RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION njss_normalize_supplier_name(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT BTRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(COALESCE(p_name, '')), '\\m(limited|ltd|ltd|inc|corporation|corp|company|co)\\M', '', 'g'), '[^a-z0-9]+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION njss_find_supplier_duplicates(
  p_legal_name TEXT DEFAULT NULL,
  p_trading_name TEXT DEFAULT NULL,
  p_ipa_registration_number TEXT DEFAULT NULL,
  p_tin TEXT DEFAULT NULL,
  p_email TEXT DEFAULT NULL,
  p_phone TEXT DEFAULT NULL
)
RETURNS TABLE (
  supplier_id UUID,
  supplier_code TEXT,
  supplier_name TEXT,
  status TEXT,
  match_type TEXT,
  match_score NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_name TEXT := njss_normalize_supplier_name(COALESCE(p_legal_name, p_trading_name));
BEGIN
  RETURN QUERY
  SELECT s.id, s.supplier_code, COALESCE(s.legal_name, s.supplier_name), s.status, 'EXACT_IPA', 100::NUMERIC
  FROM suppliers s
  WHERE NULLIF(BTRIM(COALESCE(p_ipa_registration_number, '')), '') IS NOT NULL
    AND LOWER(COALESCE(s.ipa_registration_number, s.company_registration_number, '')) = LOWER(BTRIM(p_ipa_registration_number))
  UNION ALL
  SELECT s.id, s.supplier_code, COALESCE(s.legal_name, s.supplier_name), s.status, 'EXACT_TIN', 100::NUMERIC
  FROM suppliers s
  WHERE NULLIF(BTRIM(COALESCE(p_tin, '')), '') IS NOT NULL
    AND LOWER(COALESCE(s.tin, '')) = LOWER(BTRIM(p_tin))
  UNION ALL
  SELECT s.id, s.supplier_code, COALESCE(s.legal_name, s.supplier_name), s.status, 'EXACT_EMAIL', 90::NUMERIC
  FROM suppliers s
  WHERE NULLIF(BTRIM(COALESCE(p_email, '')), '') IS NOT NULL
    AND LOWER(COALESCE(s.email, '')) = LOWER(BTRIM(p_email))
  UNION ALL
  SELECT s.id, s.supplier_code, COALESCE(s.legal_name, s.supplier_name), s.status, 'EXACT_PHONE', 80::NUMERIC
  FROM suppliers s
  WHERE NULLIF(BTRIM(COALESCE(p_phone, '')), '') IS NOT NULL
    AND REGEXP_REPLACE(COALESCE(s.phone, ''), '[^0-9]+', '', 'g') = REGEXP_REPLACE(COALESCE(p_phone, ''), '[^0-9]+', '', 'g')
  UNION ALL
  SELECT s.id, s.supplier_code, COALESCE(s.legal_name, s.supplier_name), s.status, 'POSSIBLE_NAME', 60::NUMERIC
  FROM suppliers s
  WHERE v_name <> ''
    AND (
      njss_normalize_supplier_name(COALESCE(s.legal_name, s.supplier_name)) = v_name
      OR njss_normalize_supplier_name(COALESCE(s.legal_name, s.supplier_name)) LIKE '%' || v_name || '%'
      OR v_name LIKE '%' || njss_normalize_supplier_name(COALESCE(s.legal_name, s.supplier_name)) || '%'
    )
  LIMIT 20;
END;
$$;

CREATE OR REPLACE FUNCTION njss_refresh_supplier_compliance_status(p_supplier_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT := 'COMPLIANT';
  v_required_missing BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM supplier_document_requirements r
    WHERE r.is_active IS TRUE
      AND r.is_required IS TRUE
      AND (
        r.supplier_type IS NULL OR r.supplier_type = (SELECT supplier_type FROM suppliers WHERE id = p_supplier_id)
        OR r.category_id IN (SELECT category_id FROM supplier_category_assignments WHERE supplier_id = p_supplier_id)
      )
      AND NOT EXISTS (
        SELECT 1 FROM supplier_documents d
        WHERE d.supplier_id = p_supplier_id
          AND d.document_type = r.document_type
          AND d.verification_status = 'VERIFIED'
      )
  ) INTO v_required_missing;

  IF v_required_missing OR NOT EXISTS (SELECT 1 FROM supplier_documents WHERE supplier_id = p_supplier_id) THEN
    v_status := 'INCOMPLETE';
  ELSIF EXISTS (SELECT 1 FROM supplier_documents WHERE supplier_id = p_supplier_id AND expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE) THEN
    v_status := 'EXPIRED';
  ELSIF EXISTS (SELECT 1 FROM supplier_documents WHERE supplier_id = p_supplier_id AND expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + INTERVAL '90 days') THEN
    v_status := 'EXPIRING';
  ELSE
    v_status := 'COMPLIANT';
  END IF;

  UPDATE suppliers SET compliance_status = v_status, updated_at = NOW() WHERE id = p_supplier_id;
  RETURN v_status;
END;
$$;

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
  v_trading_name TEXT := NULLIF(BTRIM(COALESCE(p_payload->>'trading_name', '')), '');
BEGIN
  PERFORM njss_require_permission('supplier.create');
  v_actor := COALESCE(fn_current_app_user_id(), (SELECT id FROM users WHERE LOWER(email) = LOWER(COALESCE(p_user_email, '')) LIMIT 1));

  SELECT COALESCE(JSONB_AGG(TO_JSONB(d)), '[]'::JSONB) INTO v_duplicates
  FROM njss_find_supplier_duplicates(
    v_legal_name,
    v_trading_name,
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
    supplier_name, legal_name, trading_name, supplier_type, registration_type,
    ipa_registration_number, company_registration_number, tin, gst_registration_number,
    primary_contact_name, contact_person, phone, alternate_phone, email,
    physical_address, address, postal_address, province, country, status,
    compliance_status, notes, created_by, updated_by, is_active
  ) VALUES (
    v_legal_name, v_legal_name, v_trading_name, COALESCE(NULLIF(p_payload->>'supplier_type', ''), 'GOODS_SUPPLIER'),
    NULLIF(p_payload->>'registration_type', ''), NULLIF(p_payload->>'ipa_registration_number', ''), NULLIF(p_payload->>'ipa_registration_number', ''),
    NULLIF(p_payload->>'tin', ''), NULLIF(p_payload->>'gst_registration_number', ''), NULLIF(p_payload->>'primary_contact_name', ''),
    NULLIF(p_payload->>'primary_contact_name', ''), NULLIF(p_payload->>'phone', ''), NULLIF(p_payload->>'alternate_phone', ''), NULLIF(p_payload->>'email', ''),
    NULLIF(p_payload->>'physical_address', ''), NULLIF(p_payload->>'physical_address', ''), NULLIF(p_payload->>'postal_address', ''), NULLIF(p_payload->>'province', ''),
    COALESCE(NULLIF(p_payload->>'country', ''), 'Papua New Guinea'), 'DRAFT', 'INCOMPLETE', NULLIF(p_payload->>'notes', ''), v_actor, v_actor, TRUE
  ) RETURNING * INTO v_supplier;

  IF NULLIF(p_payload->>'category_codes', '') IS NOT NULL THEN
    INSERT INTO supplier_category_assignments (supplier_id, category_id, created_by)
    SELECT v_supplier.id, c.id, v_actor
    FROM supplier_categories c
    WHERE c.code = ANY(STRING_TO_ARRAY(p_payload->>'category_codes', ','))
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO supplier_status_history (supplier_id, previous_status, new_status, action, reason, actor_id, actor_email)
  VALUES (v_supplier.id, NULL, 'DRAFT', 'SUPPLIER_CREATED', p_payload->>'notes', v_actor, p_user_email);

  PERFORM log_audit_event(v_actor, p_user_email, NULL, 'SUPPLIER_CREATED', 'SUPPLIER', v_supplier.id, v_supplier.supplier_code, NULL, TO_JSONB(v_supplier), NULL, JSONB_BUILD_OBJECT('phase', 'PHASE_3'));

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
BEGIN
  PERFORM njss_require_permission('supplier.edit');
  v_actor := COALESCE(fn_current_app_user_id(), (SELECT id FROM users WHERE LOWER(email) = LOWER(COALESCE(p_user_email, '')) LIMIT 1));

  SELECT * INTO v_old FROM suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier not found.'; END IF;
  IF v_old.status = 'APPROVED' AND NOT fn_current_user_has_permission('supplier.approve') AND NOT fn_current_user_has_permission('all') THEN
    RAISE EXCEPTION 'Approved suppliers require supplier approval permission for master-data changes.';
  END IF;

  UPDATE suppliers
  SET
    legal_name = COALESCE(NULLIF(p_payload->>'legal_name', ''), legal_name),
    supplier_name = COALESCE(NULLIF(p_payload->>'legal_name', ''), supplier_name),
    trading_name = COALESCE(NULLIF(p_payload->>'trading_name', ''), trading_name),
    supplier_type = COALESCE(NULLIF(p_payload->>'supplier_type', ''), supplier_type),
    registration_type = COALESCE(NULLIF(p_payload->>'registration_type', ''), registration_type),
    ipa_registration_number = COALESCE(NULLIF(p_payload->>'ipa_registration_number', ''), ipa_registration_number),
    company_registration_number = COALESCE(NULLIF(p_payload->>'ipa_registration_number', ''), company_registration_number),
    tin = COALESCE(NULLIF(p_payload->>'tin', ''), tin),
    gst_registration_number = COALESCE(NULLIF(p_payload->>'gst_registration_number', ''), gst_registration_number),
    primary_contact_name = COALESCE(NULLIF(p_payload->>'primary_contact_name', ''), primary_contact_name),
    contact_person = COALESCE(NULLIF(p_payload->>'primary_contact_name', ''), contact_person),
    phone = COALESCE(NULLIF(p_payload->>'phone', ''), phone),
    alternate_phone = COALESCE(NULLIF(p_payload->>'alternate_phone', ''), alternate_phone),
    email = COALESCE(NULLIF(p_payload->>'email', ''), email),
    physical_address = COALESCE(NULLIF(p_payload->>'physical_address', ''), physical_address),
    address = COALESCE(NULLIF(p_payload->>'physical_address', ''), address),
    postal_address = COALESCE(NULLIF(p_payload->>'postal_address', ''), postal_address),
    province = COALESCE(NULLIF(p_payload->>'province', ''), province),
    country = COALESCE(NULLIF(p_payload->>'country', ''), country),
    notes = COALESCE(NULLIF(p_payload->>'notes', ''), notes),
    updated_by = v_actor,
    updated_at = NOW()
  WHERE id = p_supplier_id
  RETURNING * INTO v_supplier;

  IF p_payload ? 'category_codes' THEN
    DELETE FROM supplier_category_assignments WHERE supplier_id = p_supplier_id;
    INSERT INTO supplier_category_assignments (supplier_id, category_id, created_by)
    SELECT p_supplier_id, c.id, v_actor
    FROM supplier_categories c
    WHERE c.code = ANY(STRING_TO_ARRAY(COALESCE(p_payload->>'category_codes', ''), ','))
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM log_audit_event(v_actor, p_user_email, NULL, 'SUPPLIER_UPDATED', 'SUPPLIER', p_supplier_id, v_supplier.supplier_code, TO_JSONB(v_old), TO_JSONB(v_supplier), NULL, JSONB_BUILD_OBJECT('phase', 'PHASE_3'));
  RETURN TO_JSONB(v_supplier);
END;
$$;

CREATE OR REPLACE FUNCTION njss_transition_supplier(
  p_supplier_id UUID,
  p_action TEXT,
  p_reason TEXT DEFAULT NULL,
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
  v_new_status TEXT;
  v_permission TEXT;
  v_audit_action TEXT;
BEGIN
  v_permission := CASE p_action
    WHEN 'SUBMIT' THEN 'supplier.submit'
    WHEN 'VERIFY' THEN 'supplier.verify'
    WHEN 'APPROVE' THEN 'supplier.approve'
    WHEN 'REJECT' THEN 'supplier.reject'
    WHEN 'SUSPEND' THEN 'supplier.suspend'
    WHEN 'REACTIVATE' THEN 'supplier.reactivate'
    ELSE NULL
  END;
  IF v_permission IS NULL THEN RAISE EXCEPTION 'Invalid supplier workflow action %.', p_action; END IF;
  PERFORM njss_require_permission(v_permission);
  v_actor := COALESCE(fn_current_app_user_id(), (SELECT id FROM users WHERE LOWER(email) = LOWER(COALESCE(p_user_email, '')) LIMIT 1));

  SELECT * INTO v_old FROM suppliers WHERE id = p_supplier_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier not found.'; END IF;

  v_new_status := CASE p_action
    WHEN 'SUBMIT' THEN 'PENDING_VERIFICATION'
    WHEN 'VERIFY' THEN 'VERIFIED'
    WHEN 'APPROVE' THEN 'APPROVED'
    WHEN 'REJECT' THEN 'REJECTED'
    WHEN 'SUSPEND' THEN 'SUSPENDED'
    WHEN 'REACTIVATE' THEN 'APPROVED'
  END;

  IF p_action = 'SUBMIT' AND v_old.status NOT IN ('DRAFT', 'REJECTED') THEN RAISE EXCEPTION 'Only draft or rejected suppliers can be submitted.'; END IF;
  IF p_action = 'VERIFY' AND v_old.status <> 'PENDING_VERIFICATION' THEN RAISE EXCEPTION 'Only pending suppliers can be verified.'; END IF;
  IF p_action = 'APPROVE' AND v_old.status <> 'VERIFIED' THEN RAISE EXCEPTION 'Only verified suppliers can be approved.'; END IF;
  IF p_action = 'APPROVE' AND v_old.created_by = v_actor AND NOT fn_current_user_has_permission('all') THEN RAISE EXCEPTION 'Supplier creator cannot be the final approver.'; END IF;
  IF p_action = 'SUSPEND' AND v_old.status NOT IN ('APPROVED', 'VERIFIED') THEN RAISE EXCEPTION 'Only verified or approved suppliers can be suspended.'; END IF;
  IF p_action = 'REACTIVATE' AND v_old.status NOT IN ('SUSPENDED', 'INACTIVE') THEN RAISE EXCEPTION 'Only suspended or inactive suppliers can be reactivated.'; END IF;

  UPDATE suppliers
  SET
    status = v_new_status,
    verified_by = CASE WHEN p_action = 'VERIFY' THEN v_actor ELSE verified_by END,
    verified_at = CASE WHEN p_action = 'VERIFY' THEN NOW() ELSE verified_at END,
    approved_by = CASE WHEN p_action IN ('APPROVE', 'REACTIVATE') THEN v_actor ELSE approved_by END,
    approved_at = CASE WHEN p_action IN ('APPROVE', 'REACTIVATE') THEN NOW() ELSE approved_at END,
    rejected_by = CASE WHEN p_action = 'REJECT' THEN v_actor ELSE rejected_by END,
    rejected_at = CASE WHEN p_action = 'REJECT' THEN NOW() ELSE rejected_at END,
    rejection_reason = CASE WHEN p_action = 'REJECT' THEN p_reason ELSE rejection_reason END,
    suspended_by = CASE WHEN p_action = 'SUSPEND' THEN v_actor ELSE NULL END,
    suspended_at = CASE WHEN p_action = 'SUSPEND' THEN NOW() ELSE NULL END,
    suspension_reason = CASE WHEN p_action = 'SUSPEND' THEN p_reason ELSE NULL END,
    is_active = CASE WHEN p_action IN ('SUSPEND', 'REJECT') THEN FALSE ELSE TRUE END,
    updated_by = v_actor,
    updated_at = NOW()
  WHERE id = p_supplier_id
  RETURNING * INTO v_supplier;

  v_audit_action := CASE p_action
    WHEN 'SUBMIT' THEN 'SUPPLIER_SUBMITTED'
    WHEN 'VERIFY' THEN 'SUPPLIER_VERIFIED'
    WHEN 'APPROVE' THEN 'SUPPLIER_APPROVED'
    WHEN 'REJECT' THEN 'SUPPLIER_REJECTED'
    WHEN 'SUSPEND' THEN 'SUPPLIER_SUSPENDED'
    WHEN 'REACTIVATE' THEN 'SUPPLIER_REACTIVATED'
  END;

  INSERT INTO supplier_status_history (supplier_id, previous_status, new_status, action, reason, actor_id, actor_email)
  VALUES (p_supplier_id, v_old.status, v_new_status, v_audit_action, p_reason, v_actor, p_user_email);

  PERFORM log_audit_event(v_actor, p_user_email, NULL, v_audit_action, 'SUPPLIER', p_supplier_id, v_supplier.supplier_code, TO_JSONB(v_old), TO_JSONB(v_supplier), JSONB_BUILD_OBJECT('reason', p_reason), JSONB_BUILD_OBJECT('phase', 'PHASE_3'));
  RETURN TO_JSONB(v_supplier);
END;
$$;

CREATE OR REPLACE FUNCTION njss_add_supplier_document(
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
  v_document supplier_documents%ROWTYPE;
BEGIN
  PERFORM njss_require_permission('supplier.compliance.manage');
  v_actor := COALESCE(fn_current_app_user_id(), (SELECT id FROM users WHERE LOWER(email) = LOWER(COALESCE(p_user_email, '')) LIMIT 1));

  INSERT INTO supplier_documents (
    supplier_id, document_type, document_number, issuing_authority, issue_date, expiry_date,
    file_name, storage_reference, verification_status, notes, created_by
  ) VALUES (
    p_supplier_id, p_payload->>'document_type', NULLIF(p_payload->>'document_number', ''), NULLIF(p_payload->>'issuing_authority', ''),
    NULLIF(p_payload->>'issue_date', '')::DATE, NULLIF(p_payload->>'expiry_date', '')::DATE,
    NULLIF(p_payload->>'file_name', ''), NULLIF(p_payload->>'storage_reference', ''), 'PENDING', NULLIF(p_payload->>'notes', ''), v_actor
  ) RETURNING * INTO v_document;

  PERFORM njss_refresh_supplier_compliance_status(p_supplier_id);
  PERFORM log_audit_event(v_actor, p_user_email, NULL, 'SUPPLIER_DOCUMENT_ADDED', 'SUPPLIER_DOCUMENT', v_document.id, v_document.document_type, NULL, TO_JSONB(v_document), NULL, JSONB_BUILD_OBJECT('supplier_id', p_supplier_id));
  RETURN TO_JSONB(v_document);
END;
$$;

CREATE OR REPLACE FUNCTION njss_verify_supplier_document(
  p_document_id UUID,
  p_status TEXT DEFAULT 'VERIFIED',
  p_notes TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_old supplier_documents%ROWTYPE;
  v_document supplier_documents%ROWTYPE;
BEGIN
  PERFORM njss_require_permission('supplier.compliance.manage');
  IF p_status NOT IN ('VERIFIED', 'REJECTED') THEN RAISE EXCEPTION 'Invalid document verification status.'; END IF;
  v_actor := COALESCE(fn_current_app_user_id(), (SELECT id FROM users WHERE LOWER(email) = LOWER(COALESCE(p_user_email, '')) LIMIT 1));

  SELECT * INTO v_old FROM supplier_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier document not found.'; END IF;

  UPDATE supplier_documents
  SET verification_status = p_status, verified_by = v_actor, verified_at = NOW(), notes = COALESCE(p_notes, notes)
  WHERE id = p_document_id
  RETURNING * INTO v_document;

  PERFORM njss_refresh_supplier_compliance_status(v_document.supplier_id);
  PERFORM log_audit_event(v_actor, p_user_email, NULL, 'SUPPLIER_DOCUMENT_VERIFIED', 'SUPPLIER_DOCUMENT', p_document_id, v_document.document_type, TO_JSONB(v_old), TO_JSONB(v_document), JSONB_BUILD_OBJECT('status', p_status, 'notes', p_notes), JSONB_BUILD_OBJECT('supplier_id', v_document.supplier_id));
  RETURN TO_JSONB(v_document);
END;
$$;

CREATE OR REPLACE FUNCTION njss_create_supplier_followup(
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
  v_followup supplier_followups%ROWTYPE;
BEGIN
  PERFORM njss_require_permission('supplier.followup.manage');
  v_actor := COALESCE(fn_current_app_user_id(), (SELECT id FROM users WHERE LOWER(email) = LOWER(COALESCE(p_user_email, '')) LIMIT 1));
  INSERT INTO supplier_followups (
    supplier_id, related_entity_type, related_entity_id, issue_type, issue_description,
    follow_up_date, contact_person, contact_method, supplier_response, next_action,
    next_follow_up_date, escalation_level, status, created_by
  ) VALUES (
    p_supplier_id, NULLIF(p_payload->>'related_entity_type', ''), NULLIF(p_payload->>'related_entity_id', '')::UUID,
    p_payload->>'issue_type', p_payload->>'issue_description', NULLIF(p_payload->>'follow_up_date', '')::DATE,
    NULLIF(p_payload->>'contact_person', ''), NULLIF(p_payload->>'contact_method', ''), NULLIF(p_payload->>'supplier_response', ''),
    NULLIF(p_payload->>'next_action', ''), NULLIF(p_payload->>'next_follow_up_date', '')::DATE,
    COALESCE((p_payload->>'escalation_level')::INTEGER, 0), COALESCE(NULLIF(p_payload->>'status', ''), 'OPEN'), v_actor
  ) RETURNING * INTO v_followup;
  PERFORM log_audit_event(v_actor, p_user_email, NULL, 'SUPPLIER_FOLLOWUP_CREATED', 'SUPPLIER_FOLLOWUP', v_followup.id, v_followup.issue_type, NULL, TO_JSONB(v_followup), NULL, JSONB_BUILD_OBJECT('supplier_id', p_supplier_id));
  RETURN TO_JSONB(v_followup);
END;
$$;

-- -----------------------------------------------------------------------------
-- Views
-- -----------------------------------------------------------------------------
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
  s.province,
  s.country,
  s.status,
  s.compliance_status,
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
  COALESCE(STRING_AGG(DISTINCT c.code, ', '), '') AS category_codes,
  COALESCE(STRING_AGG(DISTINCT c.name, ', '), '') AS category_names,
  s.ipa_registration_number,
  s.tin,
  s.primary_contact_name,
  s.phone,
  s.email,
  s.province,
  s.country,
  s.status,
  s.compliance_status,
  COUNT(DISTINCT fc.id) FILTER (WHERE fc.status NOT IN ('CANCELLED', 'CLOSED', 'LIQUIDATED')) AS active_commitments,
  COALESCE(SUM(COALESCE(fc.outstanding_amount, fc.current_committed_amount, fc.committed_amount, 0)) FILTER (WHERE fc.status NOT IN ('CANCELLED', 'CLOSED', 'LIQUIDATED')), 0) AS outstanding_commitment_value,
  s.created_at,
  s.updated_at
FROM suppliers s
LEFT JOIN supplier_category_assignments sca ON sca.supplier_id = s.id
LEFT JOIN supplier_categories c ON c.id = sca.category_id
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

CREATE OR REPLACE VIEW v_supplier_document_expiry_buckets AS
SELECT
  d.*,
  CASE
    WHEN d.expiry_date IS NULL THEN 'NO_EXPIRY'
    WHEN d.expiry_date < CURRENT_DATE THEN 'EXPIRED'
    WHEN d.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'EXPIRING_30'
    WHEN d.expiry_date <= CURRENT_DATE + INTERVAL '60 days' THEN 'EXPIRING_60'
    WHEN d.expiry_date <= CURRENT_DATE + INTERVAL '90 days' THEN 'EXPIRING_90'
    ELSE 'CURRENT'
  END AS expiry_bucket
FROM supplier_documents d;

-- -----------------------------------------------------------------------------
-- RBAC, menu, RLS and grants
-- -----------------------------------------------------------------------------
INSERT INTO permissions (code, module_code, action, label, is_active) VALUES
  ('supplier.view', 'finance', 'view', 'View supplier register', TRUE),
  ('supplier.create', 'finance', 'create', 'Create suppliers', TRUE),
  ('supplier.edit', 'finance', 'edit', 'Edit suppliers', TRUE),
  ('supplier.submit', 'finance', 'submit', 'Submit suppliers for verification', TRUE),
  ('supplier.verify', 'finance', 'verify', 'Verify suppliers', TRUE),
  ('supplier.approve', 'finance', 'approve', 'Approve suppliers', TRUE),
  ('supplier.reject', 'finance', 'reject', 'Reject suppliers', TRUE),
  ('supplier.suspend', 'finance', 'approve', 'Suspend suppliers', TRUE),
  ('supplier.reactivate', 'finance', 'approve', 'Reactivate suppliers', TRUE),
  ('supplier.compliance.view', 'finance', 'view', 'View supplier compliance', TRUE),
  ('supplier.compliance.manage', 'finance', 'manage', 'Manage supplier compliance', TRUE),
  ('supplier.followup.view', 'finance', 'view', 'View supplier follow-ups', TRUE),
  ('supplier.followup.manage', 'finance', 'manage', 'Manage supplier follow-ups', TRUE)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, module_code = EXCLUDED.module_code, action = EXCLUDED.action, is_active = TRUE;

INSERT INTO menu_items (code, module_code, label, href, icon, sort_order, required_permissions, is_active)
VALUES ('finance.suppliers', 'finance', 'Supplier Management', '/dashboard/suppliers', 'Building2', 55, ARRAY['supplier.view', 'supplier.create'], TRUE)
ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, href = EXCLUDED.href, icon = EXCLUDED.icon, sort_order = EXCLUDED.sort_order, required_permissions = EXCLUDED.required_permissions, is_active = TRUE;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.code, TRUE
FROM roles r
JOIN permissions p ON p.code = ANY(ARRAY[
  'supplier.view', 'supplier.create', 'supplier.edit', 'supplier.submit',
  'supplier.compliance.view', 'supplier.followup.view'
])
WHERE r.name IN ('Finance Officer', 'Budget Officer', 'Budget Manager', 'System Administrator')
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = TRUE;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.code, TRUE
FROM roles r
JOIN permissions p ON p.code = ANY(ARRAY[
  'supplier.verify', 'supplier.approve', 'supplier.reject', 'supplier.suspend', 'supplier.reactivate',
  'supplier.compliance.manage', 'supplier.followup.manage'
])
WHERE r.name IN ('Budget Manager', 'Finance Manager', 'System Administrator')
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = TRUE;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.code, TRUE
FROM roles r
JOIN permissions p ON p.code = ANY(ARRAY['supplier.view', 'supplier.compliance.view', 'supplier.followup.view'])
WHERE r.name IN ('Auditor', 'Executive Management')
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = TRUE;

INSERT INTO segregation_rules (entity_type, create_action, verify_action, approve_action, allow_same_user, bypass_permission, is_active)
VALUES ('SUPPLIER', 'CREATE', 'VERIFY', 'APPROVE', FALSE, 'all', TRUE)
ON CONFLICT (entity_type, create_action, verify_action, approve_action) DO UPDATE SET allow_same_user = FALSE, bypass_permission = 'all', is_active = TRUE;

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_category_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_document_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_legacy_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_select_phase3 ON suppliers;
CREATE POLICY suppliers_select_phase3 ON suppliers FOR SELECT
USING (fn_current_user_has_permission('supplier.view') OR fn_current_user_has_permission('ff3.create') OR fn_current_user_has_permission('ff4.create') OR fn_current_user_has_permission('all'));
DROP POLICY IF EXISTS suppliers_no_insert_phase3 ON suppliers;
CREATE POLICY suppliers_no_insert_phase3 ON suppliers FOR INSERT WITH CHECK (FALSE);
DROP POLICY IF EXISTS suppliers_no_update_phase3 ON suppliers;
CREATE POLICY suppliers_no_update_phase3 ON suppliers FOR UPDATE USING (FALSE) WITH CHECK (FALSE);
DROP POLICY IF EXISTS suppliers_no_delete_phase3 ON suppliers;
CREATE POLICY suppliers_no_delete_phase3 ON suppliers FOR DELETE USING (FALSE);

DROP POLICY IF EXISTS supplier_reference_select_phase3 ON supplier_categories;
CREATE POLICY supplier_reference_select_phase3 ON supplier_categories FOR SELECT USING (fn_current_user_has_permission('supplier.view') OR fn_current_user_has_permission('ff3.create') OR fn_current_user_has_permission('all'));
DROP POLICY IF EXISTS supplier_categories_no_write_phase3 ON supplier_categories;
CREATE POLICY supplier_categories_no_write_phase3 ON supplier_categories FOR ALL USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS supplier_assignments_select_phase3 ON supplier_category_assignments;
CREATE POLICY supplier_assignments_select_phase3 ON supplier_category_assignments FOR SELECT USING (fn_current_user_has_permission('supplier.view') OR fn_current_user_has_permission('ff3.create') OR fn_current_user_has_permission('all'));

DROP POLICY IF EXISTS supplier_assignments_no_write_phase3 ON supplier_category_assignments;
CREATE POLICY supplier_assignments_no_write_phase3 ON supplier_category_assignments FOR ALL USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS supplier_contacts_select_phase3 ON supplier_contacts;
CREATE POLICY supplier_contacts_select_phase3 ON supplier_contacts FOR SELECT USING (fn_current_user_has_permission('supplier.view') OR fn_current_user_has_permission('ff3.create') OR fn_current_user_has_permission('all'));
DROP POLICY IF EXISTS supplier_contacts_no_write_phase3 ON supplier_contacts;
CREATE POLICY supplier_contacts_no_write_phase3 ON supplier_contacts FOR ALL USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS supplier_documents_select_phase3 ON supplier_documents;
CREATE POLICY supplier_documents_select_phase3 ON supplier_documents FOR SELECT USING (fn_current_user_has_permission('supplier.compliance.view') OR fn_current_user_has_permission('supplier.view') OR fn_current_user_has_permission('all'));
DROP POLICY IF EXISTS supplier_documents_no_write_phase3 ON supplier_documents;
CREATE POLICY supplier_documents_no_write_phase3 ON supplier_documents FOR ALL USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS supplier_requirements_select_phase3 ON supplier_document_requirements;
CREATE POLICY supplier_requirements_select_phase3 ON supplier_document_requirements FOR SELECT USING (fn_current_user_has_permission('supplier.compliance.view') OR fn_current_user_has_permission('supplier.view') OR fn_current_user_has_permission('all'));
DROP POLICY IF EXISTS supplier_requirements_no_write_phase3 ON supplier_document_requirements;
CREATE POLICY supplier_requirements_no_write_phase3 ON supplier_document_requirements FOR ALL USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS supplier_history_select_phase3 ON supplier_status_history;
CREATE POLICY supplier_history_select_phase3 ON supplier_status_history FOR SELECT USING (fn_current_user_has_permission('supplier.view') OR fn_current_user_has_permission('audit.view') OR fn_current_user_has_permission('all'));
DROP POLICY IF EXISTS supplier_history_no_write_phase3 ON supplier_status_history;
CREATE POLICY supplier_history_no_write_phase3 ON supplier_status_history FOR ALL USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS supplier_followups_select_phase3 ON supplier_followups;
CREATE POLICY supplier_followups_select_phase3 ON supplier_followups FOR SELECT USING (fn_current_user_has_permission('supplier.followup.view') OR fn_current_user_has_permission('supplier.view') OR fn_current_user_has_permission('all'));
DROP POLICY IF EXISTS supplier_followups_no_write_phase3 ON supplier_followups;
CREATE POLICY supplier_followups_no_write_phase3 ON supplier_followups FOR ALL USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS supplier_legacy_candidates_select_phase3 ON supplier_legacy_candidates;
CREATE POLICY supplier_legacy_candidates_select_phase3 ON supplier_legacy_candidates FOR SELECT USING (fn_current_user_has_permission('supplier.view') OR fn_current_user_has_permission('all'));
DROP POLICY IF EXISTS supplier_legacy_candidates_no_write_phase3 ON supplier_legacy_candidates;
CREATE POLICY supplier_legacy_candidates_no_write_phase3 ON supplier_legacy_candidates FOR ALL USING (FALSE) WITH CHECK (FALSE);

REVOKE INSERT, UPDATE, DELETE ON suppliers FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON supplier_categories FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON supplier_category_assignments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON supplier_contacts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON supplier_documents FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON supplier_document_requirements FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON supplier_status_history FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON supplier_followups FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON supplier_legacy_candidates FROM anon, authenticated;

GRANT SELECT ON v_suppliers_directory TO authenticated;
GRANT SELECT ON v_supplier_register TO authenticated;
GRANT SELECT ON v_supplier_commitment_position TO authenticated;
GRANT SELECT ON v_supplier_document_expiry_buckets TO authenticated;
GRANT SELECT ON supplier_categories TO authenticated;
GRANT SELECT ON supplier_category_assignments TO authenticated;
GRANT SELECT ON supplier_contacts TO authenticated;
GRANT SELECT ON supplier_documents TO authenticated;
GRANT SELECT ON supplier_document_requirements TO authenticated;
GRANT SELECT ON supplier_status_history TO authenticated;
GRANT SELECT ON supplier_followups TO authenticated;
GRANT SELECT ON supplier_legacy_candidates TO authenticated;

REVOKE ALL ON FUNCTION njss_find_supplier_duplicates(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION njss_create_supplier(JSONB, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION njss_update_supplier(UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION njss_transition_supplier(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION njss_add_supplier_document(UUID, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION njss_verify_supplier_document(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION njss_create_supplier_followup(UUID, JSONB, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION njss_find_supplier_duplicates(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_create_supplier(JSONB, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_update_supplier(UUID, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_transition_supplier(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_add_supplier_document(UUID, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_verify_supplier_document(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_create_supplier_followup(UUID, JSONB, TEXT) TO authenticated;

-- Document types seeded as configurable requirements/foundation only. Category-specific
-- requirements can be tightened later without changing transaction history.
INSERT INTO supplier_document_requirements (supplier_type, document_type, is_required)
VALUES
  ('GOODS_SUPPLIER', 'IPA_REGISTRATION', TRUE),
  ('GOODS_SUPPLIER', 'TIN', TRUE),
  ('SERVICE_PROVIDER', 'IPA_REGISTRATION', TRUE),
  ('SERVICE_PROVIDER', 'TIN', TRUE),
  ('ICT_PROVIDER', 'PROFESSIONAL_CERTIFICATION', FALSE),
  ('WORKS_CONTRACTOR', 'INSURANCE', FALSE)
ON CONFLICT (category_id, supplier_type, document_type) DO UPDATE SET is_required = EXCLUDED.is_required, is_active = TRUE;

-- Explicit Phase 3 audit markers for existing free-text supplier records requiring mapping.
INSERT INTO audit_logs (action, entity_type, entity_id, entity_reference, new_values, metadata, created_at)
SELECT
  'SUPPLIER_MAPPING_REQUIRED',
  'FF3_QUOTATION',
  q.id,
  q.supplier_name,
  JSONB_BUILD_OBJECT('supplier_name', q.supplier_name),
  JSONB_BUILD_OBJECT('phase', 'PHASE_3', 'legacy_imported', TRUE),
  NOW()
FROM ff3_quotations q
WHERE q.supplier_id IS NULL
  AND q.supplier_name IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs a
    WHERE a.action = 'SUPPLIER_MAPPING_REQUIRED'
      AND a.entity_type = 'FF3_QUOTATION'
      AND a.entity_id = q.id
  );
