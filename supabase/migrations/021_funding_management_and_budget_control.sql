-- =====================================================================
-- NJSS PHASE 1 — Funding Management and Authoritative Budget Control
-- Approved Budget -> Funding Authority -> Receipt -> Allocation -> Release
-- Additive and defensive: preserves existing budget_allocations, quarterly_releases,
-- FF3 commitments and FF4 expenditure structures.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------
-- 1. PHASE 1 ENUM-LIKE DOMAIN CHECKS VIA TABLE CONSTRAINTS
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS funding_authorities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authority_number VARCHAR(80) UNIQUE,
  financial_year INTEGER NOT NULL,
  authority_type VARCHAR(60) NOT NULL CHECK (authority_type IN (
    'GOVERNMENT_APPROPRIATION', 'WARRANT', 'NJSS_ALLOCATION',
    'TREASURY_FINANCE_AUTHORITY', 'SUPPLEMENTAL_ALLOCATION', 'DONOR_GRANT',
    'DEVELOPMENT_PARTNER', 'TRUST_FUND', 'PROJECT_FUNDING', 'OTHER'
  )),
  funding_source_id UUID REFERENCES funding_sources(id),
  source_agency VARCHAR(200),
  source_department VARCHAR(200),
  appropriation_reference VARCHAR(160),
  warrant_number VARCHAR(120),
  warrant_date DATE,
  donor_agreement_reference VARCHAR(160),
  project_reference VARCHAR(160),
  approved_amount NUMERIC(15,2) NOT NULL CHECK (approved_amount >= 0),
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  expiry_date DATE,
  description TEXT,
  status VARCHAR(40) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','VERIFIED','APPROVED','REJECTED','CANCELLED','EXPIRED')),
  supporting_document_url TEXT,
  supporting_document_name VARCHAR(255),
  restricted_project_id UUID REFERENCES projects(id),
  restricted_department_id UUID REFERENCES departments(id),
  restricted_section_id UUID REFERENCES sections(id),
  restricted_cost_centre_id UUID REFERENCES cost_centres(id),
  restricted_expense_code_registry_id UUID REFERENCES expense_code_registry(id),
  restriction_notes TEXT,
  created_by UUID REFERENCES users(id),
  verified_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS funding_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number VARCHAR(80) UNIQUE,
  financial_year INTEGER NOT NULL,
  funding_authority_id UUID NOT NULL REFERENCES funding_authorities(id) ON DELETE RESTRICT,
  funding_source_id UUID REFERENCES funding_sources(id),
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount_received NUMERIC(15,2) NOT NULL CHECK (amount_received >= 0),
  source_agency VARCHAR(200),
  finance_ifms_reference VARCHAR(160),
  external_reference VARCHAR(160),
  bank_reference VARCHAR(160),
  description TEXT,
  supporting_document_url TEXT,
  supporting_document_name VARCHAR(255),
  status VARCHAR(40) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED','VERIFIED','APPROVED','REJECTED','CANCELLED')),
  entered_by UUID REFERENCES users(id),
  verified_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS funding_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocation_number VARCHAR(80) UNIQUE,
  financial_year INTEGER NOT NULL,
  funding_receipt_id UUID NOT NULL REFERENCES funding_receipts(id) ON DELETE RESTRICT,
  funding_authority_id UUID REFERENCES funding_authorities(id) ON DELETE RESTRICT,
  funding_source_id UUID REFERENCES funding_sources(id),
  budget_allocation_id UUID NOT NULL REFERENCES budget_allocations(id) ON DELETE RESTRICT,
  department_id UUID REFERENCES departments(id),
  section_id UUID REFERENCES sections(id),
  cost_centre_id UUID REFERENCES cost_centres(id),
  budget_division_id UUID REFERENCES budget_divisions(id),
  project_id UUID REFERENCES projects(id),
  expense_code_registry_id UUID REFERENCES expense_code_registry(id),
  allocated_amount NUMERIC(15,2) NOT NULL CHECK (allocated_amount > 0),
  allocation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(40) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','CANCELLED')),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE quarterly_releases
  ADD COLUMN IF NOT EXISTS funding_allocation_id UUID REFERENCES funding_allocations(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_funding_authorities_fy_status ON funding_authorities(financial_year, status);
CREATE INDEX IF NOT EXISTS idx_funding_authorities_source ON funding_authorities(funding_source_id);
CREATE INDEX IF NOT EXISTS idx_funding_receipts_authority ON funding_receipts(funding_authority_id);
CREATE INDEX IF NOT EXISTS idx_funding_receipts_fy_status ON funding_receipts(financial_year, status);
CREATE INDEX IF NOT EXISTS idx_funding_allocations_receipt ON funding_allocations(funding_receipt_id);
CREATE INDEX IF NOT EXISTS idx_funding_allocations_budget ON funding_allocations(budget_allocation_id);
CREATE INDEX IF NOT EXISTS idx_funding_allocations_fy_status ON funding_allocations(financial_year, status);
CREATE INDEX IF NOT EXISTS idx_quarterly_releases_funding_allocation ON quarterly_releases(funding_allocation_id);

CREATE UNIQUE INDEX IF NOT EXISTS ux_funding_allocations_duplicate_guard
ON funding_allocations(funding_receipt_id, budget_allocation_id, allocated_amount, allocation_date)
WHERE status IN ('DRAFT','APPROVED');

-- ---------------------------------------------------------------------
-- 2. UPDATED_AT AND NUMBERING TRIGGERS
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION njss_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_funding_authorities_touch ON funding_authorities;
CREATE TRIGGER trg_funding_authorities_touch BEFORE UPDATE ON funding_authorities
FOR EACH ROW EXECUTE FUNCTION njss_touch_updated_at();

DROP TRIGGER IF EXISTS trg_funding_receipts_touch ON funding_receipts;
CREATE TRIGGER trg_funding_receipts_touch BEFORE UPDATE ON funding_receipts
FOR EACH ROW EXECUTE FUNCTION njss_touch_updated_at();

DROP TRIGGER IF EXISTS trg_funding_allocations_touch ON funding_allocations;
CREATE TRIGGER trg_funding_allocations_touch BEFORE UPDATE ON funding_allocations
FOR EACH ROW EXECUTE FUNCTION njss_touch_updated_at();

CREATE OR REPLACE FUNCTION njss_generate_funding_authority_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.authority_number IS NULL OR NEW.authority_number = '' THEN
    NEW.authority_number := 'FA-' || NEW.financial_year || '-' || LPAD((
      SELECT (COALESCE(MAX(CAST(SUBSTRING(authority_number FROM 9) AS INTEGER)), 0) + 1)::TEXT
      FROM funding_authorities
      WHERE financial_year = NEW.financial_year
        AND authority_number ~ ('^FA-' || NEW.financial_year || '-[0-9]+$')
    ), 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_funding_authority_number ON funding_authorities;
CREATE TRIGGER trg_funding_authority_number BEFORE INSERT ON funding_authorities
FOR EACH ROW EXECUTE FUNCTION njss_generate_funding_authority_number();

CREATE OR REPLACE FUNCTION njss_generate_funding_receipt_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.receipt_number IS NULL OR NEW.receipt_number = '' THEN
    NEW.receipt_number := 'FR-' || NEW.financial_year || '-' || LPAD((
      SELECT (COALESCE(MAX(CAST(SUBSTRING(receipt_number FROM 9) AS INTEGER)), 0) + 1)::TEXT
      FROM funding_receipts
      WHERE financial_year = NEW.financial_year
        AND receipt_number ~ ('^FR-' || NEW.financial_year || '-[0-9]+$')
    ), 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_funding_receipt_number ON funding_receipts;
CREATE TRIGGER trg_funding_receipt_number BEFORE INSERT ON funding_receipts
FOR EACH ROW EXECUTE FUNCTION njss_generate_funding_receipt_number();

CREATE OR REPLACE FUNCTION njss_generate_funding_allocation_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.allocation_number IS NULL OR NEW.allocation_number = '' THEN
    NEW.allocation_number := 'FAL-' || NEW.financial_year || '-' || LPAD((
      SELECT (COALESCE(MAX(CAST(SUBSTRING(allocation_number FROM 10) AS INTEGER)), 0) + 1)::TEXT
      FROM funding_allocations
      WHERE financial_year = NEW.financial_year
        AND allocation_number ~ ('^FAL-' || NEW.financial_year || '-[0-9]+$')
    ), 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_funding_allocation_number ON funding_allocations;
CREATE TRIGGER trg_funding_allocation_number BEFORE INSERT ON funding_allocations
FOR EACH ROW EXECUTE FUNCTION njss_generate_funding_allocation_number();

-- ---------------------------------------------------------------------
-- 3. FINANCIAL POSITION VIEWS
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW v_funding_authority_register AS
SELECT
  fa.*,
  fs.code AS funding_source_code,
  fs.name AS funding_source_name,
  COALESCE((SELECT SUM(fr.amount_received) FROM funding_receipts fr WHERE fr.funding_authority_id = fa.id AND fr.status = 'APPROVED'), 0)::NUMERIC(15,2) AS approved_receipts,
  (fa.approved_amount - COALESCE((SELECT SUM(fr.amount_received) FROM funding_receipts fr WHERE fr.funding_authority_id = fa.id AND fr.status = 'APPROVED'), 0))::NUMERIC(15,2) AS authority_remaining,
  COALESCE((SELECT SUM(fal.allocated_amount) FROM funding_allocations fal WHERE fal.funding_authority_id = fa.id AND fal.status = 'APPROVED'), 0)::NUMERIC(15,2) AS approved_allocations
FROM funding_authorities fa
LEFT JOIN funding_sources fs ON fs.id = fa.funding_source_id;

CREATE OR REPLACE VIEW v_funding_receipt_register AS
SELECT
  fr.*,
  fa.authority_number,
  fa.approved_amount AS authority_amount,
  fs.code AS funding_source_code,
  fs.name AS funding_source_name,
  COALESCE((SELECT SUM(fr2.amount_received) FROM funding_receipts fr2 WHERE fr2.funding_authority_id = fr.funding_authority_id AND fr2.status = 'APPROVED' AND fr2.id <> fr.id), 0)::NUMERIC(15,2) AS previous_approved_receipts,
  (fa.approved_amount - COALESCE((SELECT SUM(fr2.amount_received) FROM funding_receipts fr2 WHERE fr2.funding_authority_id = fr.funding_authority_id AND fr2.status = 'APPROVED' AND fr2.id <> fr.id), 0))::NUMERIC(15,2) AS authority_balance_before_this_receipt,
  COALESCE((SELECT SUM(fal.allocated_amount) FROM funding_allocations fal WHERE fal.funding_receipt_id = fr.id AND fal.status = 'APPROVED'), 0)::NUMERIC(15,2) AS approved_allocations,
  (CASE WHEN fr.status = 'APPROVED' THEN fr.amount_received ELSE 0 END - COALESCE((SELECT SUM(fal.allocated_amount) FROM funding_allocations fal WHERE fal.funding_receipt_id = fr.id AND fal.status = 'APPROVED'), 0))::NUMERIC(15,2) AS receipt_unallocated_balance
FROM funding_receipts fr
JOIN funding_authorities fa ON fa.id = fr.funding_authority_id
LEFT JOIN funding_sources fs ON fs.id = fr.funding_source_id;

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
  COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.funding_allocation_id = fal.id), 0)::NUMERIC(15,2) AS released_from_allocation,
  (fal.allocated_amount - COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.funding_allocation_id = fal.id), 0))::NUMERIC(15,2) AS allocation_unreleased_balance
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
  COALESCE((SELECT SUM(h.total_estimated_amount) FROM ff3_headers h WHERE h.financial_year = ba.financial_year AND h.status = 'SUBMITTED' AND (h.department_id IS NOT DISTINCT FROM ba.department_id OR h.department_id IS NULL) AND (h.section_id IS NOT DISTINCT FROM ba.section_id OR h.section_id IS NULL) AND (h.funding_source_id IS NOT DISTINCT FROM ba.funding_source_id OR h.funding_source_id IS NULL)), 0)::NUMERIC(15,2) AS pending_amount,
  COALESCE((SELECT SUM(c.committed_amount - COALESCE(c.paid_amount,0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID')), 0)::NUMERIC(15,2) AS outstanding_commitment,
  COALESCE((SELECT SUM(COALESCE(c.paid_amount,0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status <> 'CANCELLED'), 0)::NUMERIC(15,2) AS actual_expenditure,
  (
    COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.budget_allocation_id = ba.id), 0)
    - COALESCE((SELECT SUM(c.committed_amount - COALESCE(c.paid_amount,0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID')), 0)
    - COALESCE((SELECT SUM(COALESCE(c.paid_amount,0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status <> 'CANCELLED'), 0)
  )::NUMERIC(15,2) AS available_amount,
  (ba.revised_budget - COALESCE((SELECT SUM(fal.allocated_amount) FROM funding_allocations fal WHERE fal.budget_allocation_id = ba.id AND fal.status = 'APPROVED'), 0))::NUMERIC(15,2) AS unfunded_amount,
  (
    COALESCE((SELECT SUM(fal.allocated_amount) FROM funding_allocations fal WHERE fal.budget_allocation_id = ba.id AND fal.status = 'APPROVED'), 0)
    - COALESCE((SELECT SUM(qr.released_amount) FROM quarterly_releases qr WHERE qr.budget_allocation_id = ba.id), 0)
  )::NUMERIC(15,2) AS unreleased_funding
FROM budget_allocations ba
LEFT JOIN departments d ON d.id = ba.department_id
LEFT JOIN sections s ON s.id = ba.section_id
LEFT JOIN cost_centres cc ON cc.id = ba.cost_centre_id
LEFT JOIN projects p ON p.id = ba.project_id
LEFT JOIN funding_sources fs ON fs.id = ba.funding_source_id
LEFT JOIN expense_code_registry ecr ON ecr.id = ba.expense_code_registry_id
WHERE ba.is_active = true;

CREATE OR REPLACE VIEW v_funding_source_report AS
SELECT
  COALESCE(fs.id, fa.funding_source_id) AS funding_source_id,
  fs.code AS funding_source_code,
  fs.name AS funding_source_name,
  fa.financial_year,
  SUM(fa.approved_amount)::NUMERIC(15,2) AS authority_amount,
  COALESCE(SUM((SELECT SUM(fr.amount_received) FROM funding_receipts fr WHERE fr.funding_authority_id = fa.id AND fr.status = 'APPROVED')), 0)::NUMERIC(15,2) AS received_amount,
  COALESCE(SUM((SELECT SUM(fal.allocated_amount) FROM funding_allocations fal WHERE fal.funding_authority_id = fa.id AND fal.status = 'APPROVED')), 0)::NUMERIC(15,2) AS allocated_amount
FROM funding_authorities fa
LEFT JOIN funding_sources fs ON fs.id = fa.funding_source_id
WHERE fa.status = 'APPROVED'
GROUP BY COALESCE(fs.id, fa.funding_source_id), fs.code, fs.name, fa.financial_year;

-- ---------------------------------------------------------------------
-- 4. DATABASE-FIRST CONTROL RPCs
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION njss_require_permission(p_permission TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(fn_current_user_has_permission(p_permission), false) IS DISTINCT FROM true
     AND COALESCE(fn_current_user_has_permission('all'), false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Access denied. Required permission: %', p_permission;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION njss_create_funding_authority(
  p_financial_year INTEGER,
  p_authority_type TEXT,
  p_funding_source_id UUID,
  p_approved_amount NUMERIC,
  p_effective_date DATE,
  p_expiry_date DATE DEFAULT NULL,
  p_source_agency TEXT DEFAULT NULL,
  p_source_department TEXT DEFAULT NULL,
  p_appropriation_reference TEXT DEFAULT NULL,
  p_warrant_number TEXT DEFAULT NULL,
  p_warrant_date DATE DEFAULT NULL,
  p_donor_agreement_reference TEXT DEFAULT NULL,
  p_project_reference TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_supporting_document_url TEXT DEFAULT NULL,
  p_supporting_document_name TEXT DEFAULT NULL,
  p_restricted_project_id UUID DEFAULT NULL,
  p_restricted_department_id UUID DEFAULT NULL,
  p_restricted_section_id UUID DEFAULT NULL,
  p_restricted_cost_centre_id UUID DEFAULT NULL,
  p_restricted_expense_code_registry_id UUID DEFAULT NULL,
  p_restriction_notes TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS funding_authorities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row funding_authorities;
  v_actor UUID := fn_current_app_user_id();
BEGIN
  PERFORM njss_require_permission('funding.create');

  IF p_approved_amount IS NULL OR p_approved_amount <= 0 THEN
    RAISE EXCEPTION 'Funding authority amount must be greater than zero. Requested amount: K%', COALESCE(p_approved_amount, 0);
  END IF;

  INSERT INTO funding_authorities (
    financial_year, authority_type, funding_source_id, source_agency, source_department,
    appropriation_reference, warrant_number, warrant_date, donor_agreement_reference, project_reference,
    approved_amount, effective_date, expiry_date, description, supporting_document_url,
    supporting_document_name, restricted_project_id, restricted_department_id, restricted_section_id,
    restricted_cost_centre_id, restricted_expense_code_registry_id, restriction_notes, created_by
  ) VALUES (
    p_financial_year, p_authority_type, p_funding_source_id, p_source_agency, p_source_department,
    p_appropriation_reference, p_warrant_number, p_warrant_date, p_donor_agreement_reference, p_project_reference,
    p_approved_amount, COALESCE(p_effective_date, CURRENT_DATE), p_expiry_date, p_description, p_supporting_document_url,
    p_supporting_document_name, p_restricted_project_id, p_restricted_department_id, p_restricted_section_id,
    p_restricted_cost_centre_id, p_restricted_expense_code_registry_id, p_restriction_notes, v_actor
  ) RETURNING * INTO v_row;

  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'FUNDING_AUTHORITY_CREATED', 'FUNDING_AUTHORITY', v_row.id, v_row.authority_number, NULL, to_jsonb(v_row), jsonb_build_object('amount', v_row.approved_amount), NULL);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION njss_transition_funding_authority(
  p_authority_id UUID,
  p_action TEXT,
  p_comments TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS funding_authorities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row funding_authorities;
  v_old funding_authorities;
  v_actor UUID := fn_current_app_user_id();
  v_next_status TEXT;
  v_audit_action TEXT;
BEGIN
  IF UPPER(p_action) = 'SUBMIT' THEN
    PERFORM njss_require_permission('funding.submit');
  ELSIF UPPER(p_action) = 'VERIFY' THEN
    PERFORM njss_require_permission('funding.verify');
  ELSIF UPPER(p_action) = 'APPROVE' THEN
    PERFORM njss_require_permission('funding.approve');
  ELSIF UPPER(p_action) = 'REJECT' THEN
    PERFORM njss_require_permission('funding.reject');
  ELSE
    RAISE EXCEPTION 'Unsupported funding authority action: %', p_action;
  END IF;

  SELECT * INTO v_old FROM funding_authorities WHERE id = p_authority_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funding authority not found'; END IF;

  IF UPPER(p_action) = 'SUBMIT' THEN
    IF v_old.status <> 'DRAFT' THEN RAISE EXCEPTION 'Only DRAFT funding authorities can be submitted. Current status: %', v_old.status; END IF;
    v_next_status := 'SUBMITTED'; v_audit_action := 'FUNDING_AUTHORITY_SUBMITTED';
  ELSIF UPPER(p_action) = 'VERIFY' THEN
    IF v_old.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'Only SUBMITTED funding authorities can be verified. Current status: %', v_old.status; END IF;
    v_next_status := 'VERIFIED'; v_audit_action := 'FUNDING_AUTHORITY_VERIFIED';
  ELSIF UPPER(p_action) = 'APPROVE' THEN
    IF v_old.status <> 'VERIFIED' THEN RAISE EXCEPTION 'Only VERIFIED funding authorities can be approved. Current status: %', v_old.status; END IF;
    IF fn_check_segregation_of_duties('FUNDING_AUTHORITY', v_old.created_by, v_old.verified_by, NULL, v_actor) IS FALSE THEN
      RAISE EXCEPTION 'Segregation of duties prevents the same user from creating/verifying/approving this funding authority.';
    END IF;
    v_next_status := 'APPROVED'; v_audit_action := 'FUNDING_AUTHORITY_APPROVED';
  ELSE
    IF v_old.status IN ('APPROVED','CANCELLED','EXPIRED') THEN RAISE EXCEPTION 'Cannot reject funding authority in status %', v_old.status; END IF;
    v_next_status := 'REJECTED'; v_audit_action := 'FUNDING_AUTHORITY_REJECTED';
  END IF;

  UPDATE funding_authorities SET
    status = v_next_status,
    verified_by = CASE WHEN UPPER(p_action) = 'VERIFY' THEN v_actor ELSE verified_by END,
    verified_at = CASE WHEN UPPER(p_action) = 'VERIFY' THEN NOW() ELSE verified_at END,
    approved_by = CASE WHEN UPPER(p_action) = 'APPROVE' THEN v_actor ELSE approved_by END,
    approved_at = CASE WHEN UPPER(p_action) = 'APPROVE' THEN NOW() ELSE approved_at END,
    rejection_reason = CASE WHEN UPPER(p_action) = 'REJECT' THEN p_comments ELSE rejection_reason END
  WHERE id = p_authority_id
  RETURNING * INTO v_row;

  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), v_audit_action, 'FUNDING_AUTHORITY', v_row.id, v_row.authority_number, to_jsonb(v_old), to_jsonb(v_row), jsonb_build_object('old_status', v_old.status, 'new_status', v_row.status, 'comments', p_comments, 'amount', v_row.approved_amount), NULL);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION njss_create_funding_receipt(
  p_funding_authority_id UUID,
  p_receipt_date DATE,
  p_amount_received NUMERIC,
  p_source_agency TEXT DEFAULT NULL,
  p_finance_ifms_reference TEXT DEFAULT NULL,
  p_external_reference TEXT DEFAULT NULL,
  p_bank_reference TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_supporting_document_url TEXT DEFAULT NULL,
  p_supporting_document_name TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS funding_receipts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_auth funding_authorities;
  v_row funding_receipts;
  v_actor UUID := fn_current_app_user_id();
BEGIN
  PERFORM njss_require_permission('funding.create');

  IF p_amount_received IS NULL OR p_amount_received <= 0 THEN
    RAISE EXCEPTION 'Funding receipt amount must be greater than zero. Requested amount: K%', COALESCE(p_amount_received, 0);
  END IF;

  SELECT * INTO v_auth FROM funding_authorities WHERE id = p_funding_authority_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funding authority not found'; END IF;
  IF v_auth.status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Funding receipt requires an APPROVED funding authority. Authority % is currently %.', v_auth.authority_number, v_auth.status;
  END IF;

  INSERT INTO funding_receipts (
    financial_year, funding_authority_id, funding_source_id, receipt_date, amount_received,
    source_agency, finance_ifms_reference, external_reference, bank_reference, description,
    supporting_document_url, supporting_document_name, entered_by
  ) VALUES (
    v_auth.financial_year, v_auth.id, v_auth.funding_source_id, COALESCE(p_receipt_date, CURRENT_DATE), p_amount_received,
    COALESCE(p_source_agency, v_auth.source_agency), p_finance_ifms_reference, p_external_reference, p_bank_reference, p_description,
    p_supporting_document_url, p_supporting_document_name, v_actor
  ) RETURNING * INTO v_row;

  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'FUNDING_RECEIPT_CREATED', 'FUNDING_RECEIPT', v_row.id, v_row.receipt_number, NULL, to_jsonb(v_row), jsonb_build_object('amount', v_row.amount_received, 'authority', v_auth.authority_number), NULL);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION njss_transition_funding_receipt(
  p_receipt_id UUID,
  p_action TEXT,
  p_comments TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS funding_receipts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row funding_receipts;
  v_old funding_receipts;
  v_auth funding_authorities;
  v_actor UUID := fn_current_app_user_id();
  v_next_status TEXT;
  v_audit_action TEXT;
  v_existing_approved NUMERIC;
  v_remaining NUMERIC;
BEGIN
  IF UPPER(p_action) = 'SUBMIT' THEN
    PERFORM njss_require_permission('funding.submit');
  ELSIF UPPER(p_action) = 'VERIFY' THEN
    PERFORM njss_require_permission('funding.verify');
  ELSIF UPPER(p_action) = 'APPROVE' THEN
    PERFORM njss_require_permission('funding.approve');
  ELSIF UPPER(p_action) = 'REJECT' THEN
    PERFORM njss_require_permission('funding.reject');
  ELSE
    RAISE EXCEPTION 'Unsupported funding receipt action: %', p_action;
  END IF;

  SELECT * INTO v_old FROM funding_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funding receipt not found'; END IF;

  SELECT * INTO v_auth FROM funding_authorities WHERE id = v_old.funding_authority_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funding authority not found'; END IF;
  IF v_auth.status <> 'APPROVED' THEN RAISE EXCEPTION 'Receipt cannot proceed because authority % is %.', v_auth.authority_number, v_auth.status; END IF;

  IF UPPER(p_action) = 'SUBMIT' THEN
    IF v_old.status <> 'DRAFT' THEN RAISE EXCEPTION 'Only DRAFT funding receipts can be submitted. Current status: %', v_old.status; END IF;
    v_next_status := 'SUBMITTED'; v_audit_action := 'FUNDING_RECEIPT_SUBMITTED';
  ELSIF UPPER(p_action) = 'VERIFY' THEN
    IF v_old.status <> 'SUBMITTED' THEN RAISE EXCEPTION 'Only SUBMITTED funding receipts can be verified. Current status: %', v_old.status; END IF;
    v_next_status := 'VERIFIED'; v_audit_action := 'FUNDING_RECEIPT_VERIFIED';
  ELSIF UPPER(p_action) = 'APPROVE' THEN
    IF v_old.status <> 'VERIFIED' THEN RAISE EXCEPTION 'Only VERIFIED funding receipts can be approved. Current status: %', v_old.status; END IF;
    IF fn_check_segregation_of_duties('FUNDING_RECEIPT', v_old.entered_by, v_old.verified_by, NULL, v_actor) IS FALSE THEN
      RAISE EXCEPTION 'Segregation of duties prevents the same user from entering/verifying/approving this funding receipt.';
    END IF;
    SELECT COALESCE(SUM(amount_received), 0) INTO v_existing_approved FROM funding_receipts WHERE funding_authority_id = v_old.funding_authority_id AND status = 'APPROVED' AND id <> v_old.id;
    v_remaining := v_auth.approved_amount - v_existing_approved;
    IF v_old.amount_received > v_remaining + 0.001 THEN
      RAISE EXCEPTION 'Cannot approve receipt K%. Authority: K%; Previous approved receipts: K%; Remaining authority: K%.', v_old.amount_received, v_auth.approved_amount, v_existing_approved, v_remaining;
    END IF;
    v_next_status := 'APPROVED'; v_audit_action := 'FUNDING_RECEIPT_APPROVED';
  ELSE
    IF v_old.status IN ('APPROVED','CANCELLED') THEN RAISE EXCEPTION 'Cannot reject funding receipt in status %', v_old.status; END IF;
    v_next_status := 'REJECTED'; v_audit_action := 'FUNDING_RECEIPT_REJECTED';
  END IF;

  UPDATE funding_receipts SET
    status = v_next_status,
    verified_by = CASE WHEN UPPER(p_action) = 'VERIFY' THEN v_actor ELSE verified_by END,
    verified_at = CASE WHEN UPPER(p_action) = 'VERIFY' THEN NOW() ELSE verified_at END,
    approved_by = CASE WHEN UPPER(p_action) = 'APPROVE' THEN v_actor ELSE approved_by END,
    approved_at = CASE WHEN UPPER(p_action) = 'APPROVE' THEN NOW() ELSE approved_at END,
    rejection_reason = CASE WHEN UPPER(p_action) = 'REJECT' THEN p_comments ELSE rejection_reason END
  WHERE id = p_receipt_id
  RETURNING * INTO v_row;

  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), v_audit_action, 'FUNDING_RECEIPT', v_row.id, v_row.receipt_number, to_jsonb(v_old), to_jsonb(v_row), jsonb_build_object('old_status', v_old.status, 'new_status', v_row.status, 'comments', p_comments, 'amount', v_row.amount_received), NULL);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION njss_allocate_funding(
  p_funding_receipt_id UUID,
  p_budget_allocation_id UUID,
  p_allocated_amount NUMERIC,
  p_allocation_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_approve_immediately BOOLEAN DEFAULT FALSE,
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
  v_action TEXT;
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

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_receipt_allocated FROM funding_allocations WHERE funding_receipt_id = v_receipt.id AND status = 'APPROVED';
  v_receipt_available := v_receipt.amount_received - v_receipt_allocated;
  IF p_allocated_amount > v_receipt_available + 0.001 THEN
    RAISE EXCEPTION 'Cannot allocate K%. Receipt available balance is K%. Existing approved allocations: K%. Receipt amount: K%.', p_allocated_amount, v_receipt_available, v_receipt_allocated, v_receipt.amount_received;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_budget_funded FROM funding_allocations WHERE budget_allocation_id = v_budget.id AND status = 'APPROVED';
  v_budget_remaining := v_budget.revised_budget - v_budget_funded;
  IF p_allocated_amount > v_budget_remaining + 0.001 THEN
    RAISE EXCEPTION 'Cannot allocate K%. Budget remaining funding capacity is K%. Approved budget: K%; existing funded amount: K%.', p_allocated_amount, v_budget_remaining, v_budget.revised_budget, v_budget_funded;
  END IF;

  INSERT INTO funding_allocations (
    financial_year, funding_receipt_id, funding_authority_id, funding_source_id,
    budget_allocation_id, department_id, section_id, cost_centre_id, budget_division_id,
    project_id, expense_code_registry_id, allocated_amount, allocation_date, status,
    notes, created_by, approved_by, approved_at
  ) VALUES (
    v_budget.financial_year, v_receipt.id, v_auth.id, COALESCE(v_receipt.funding_source_id, v_auth.funding_source_id),
    v_budget.id, v_budget.department_id, v_budget.section_id, v_budget.cost_centre_id,
    CASE WHEN to_jsonb(v_budget) ? 'budget_division_id' THEN (to_jsonb(v_budget)->>'budget_division_id')::UUID ELSE NULL END,
    v_budget.project_id, v_budget.expense_code_registry_id, p_allocated_amount, COALESCE(p_allocation_date, CURRENT_DATE),
    CASE WHEN p_approve_immediately THEN 'APPROVED' ELSE 'DRAFT' END,
    p_notes, v_actor, CASE WHEN p_approve_immediately THEN v_actor ELSE NULL END, CASE WHEN p_approve_immediately THEN NOW() ELSE NULL END
  ) RETURNING * INTO v_row;

  v_action := CASE WHEN p_approve_immediately THEN 'FUNDING_ALLOCATION_APPROVED' ELSE 'FUNDING_ALLOCATION_CREATED' END;
  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), v_action, 'FUNDING_ALLOCATION', v_row.id, v_row.allocation_number, NULL, to_jsonb(v_row), jsonb_build_object('amount', v_row.allocated_amount, 'receipt_available_before', v_receipt_available, 'budget_remaining_before', v_budget_remaining), NULL);
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

  SELECT * INTO v_receipt FROM funding_receipts WHERE id = v_old.funding_receipt_id FOR UPDATE;
  SELECT * INTO v_budget FROM budget_allocations WHERE id = v_old.budget_allocation_id FOR UPDATE;
  IF v_receipt.status <> 'APPROVED' THEN RAISE EXCEPTION 'Cannot approve allocation because receipt % is %.', v_receipt.receipt_number, v_receipt.status; END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_receipt_allocated FROM funding_allocations WHERE funding_receipt_id = v_receipt.id AND status = 'APPROVED' AND id <> v_old.id;
  v_receipt_available := v_receipt.amount_received - v_receipt_allocated;
  IF v_old.allocated_amount > v_receipt_available + 0.001 THEN
    RAISE EXCEPTION 'Cannot approve allocation K%. Receipt available balance is K%. Existing approved allocations: K%.', v_old.allocated_amount, v_receipt_available, v_receipt_allocated;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_budget_funded FROM funding_allocations WHERE budget_allocation_id = v_budget.id AND status = 'APPROVED' AND id <> v_old.id;
  v_budget_remaining := v_budget.revised_budget - v_budget_funded;
  IF v_old.allocated_amount > v_budget_remaining + 0.001 THEN
    RAISE EXCEPTION 'Cannot approve allocation K%. Budget remaining funding capacity is K%. Approved budget: K%; existing funded amount: K%.', v_old.allocated_amount, v_budget_remaining, v_budget.revised_budget, v_budget_funded;
  END IF;

  UPDATE funding_allocations SET status = 'APPROVED', approved_by = v_actor, approved_at = NOW(), notes = COALESCE(notes, p_comments)
  WHERE id = p_allocation_id
  RETURNING * INTO v_row;

  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'FUNDING_ALLOCATION_APPROVED', 'FUNDING_ALLOCATION', v_row.id, v_row.allocation_number, to_jsonb(v_old), to_jsonb(v_row), jsonb_build_object('amount', v_row.allocated_amount, 'comments', p_comments), NULL);
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION njss_create_budget_release(
  p_budget_allocation_id UUID,
  p_financial_year INTEGER,
  p_quarter INTEGER,
  p_released_amount NUMERIC,
  p_release_date DATE DEFAULT NULL,
  p_funding_allocation_id UUID DEFAULT NULL,
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
  v_funding_allocation funding_allocations;
  v_row quarterly_releases;
  v_actor UUID := fn_current_app_user_id();
  v_funded NUMERIC;
  v_released NUMERIC;
  v_approved_remaining NUMERIC;
  v_funded_remaining NUMERIC;
  v_max_releasable NUMERIC;
  v_allocation_released NUMERIC;
  v_allocation_remaining NUMERIC;
BEGIN
  PERFORM njss_require_permission('budget.release');

  IF p_released_amount IS NULL OR p_released_amount <= 0 THEN
    RAISE EXCEPTION 'Release amount must be greater than zero. Requested amount: K%', COALESCE(p_released_amount, 0);
  END IF;
  IF p_quarter NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'Quarter must be between 1 and 4. Requested quarter: %', p_quarter;
  END IF;

  SELECT * INTO v_budget FROM budget_allocations WHERE id = p_budget_allocation_id AND is_active = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved budget allocation not found'; END IF;
  IF v_budget.financial_year <> p_financial_year THEN RAISE EXCEPTION 'Release FY% does not match budget allocation FY%.', p_financial_year, v_budget.financial_year; END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_funded FROM funding_allocations WHERE budget_allocation_id = v_budget.id AND status = 'APPROVED';
  SELECT COALESCE(SUM(released_amount), 0) INTO v_released FROM quarterly_releases WHERE budget_allocation_id = v_budget.id;
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

  IF p_funding_allocation_id IS NOT NULL THEN
    SELECT * INTO v_funding_allocation FROM funding_allocations WHERE id = p_funding_allocation_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Funding allocation not found'; END IF;
    IF v_funding_allocation.status <> 'APPROVED' THEN RAISE EXCEPTION 'Cannot release against funding allocation %. Status is %.', v_funding_allocation.allocation_number, v_funding_allocation.status; END IF;
    IF v_funding_allocation.budget_allocation_id <> v_budget.id THEN RAISE EXCEPTION 'Funding allocation does not belong to the selected budget allocation.'; END IF;
    SELECT COALESCE(SUM(released_amount), 0) INTO v_allocation_released FROM quarterly_releases WHERE funding_allocation_id = p_funding_allocation_id;
    v_allocation_remaining := v_funding_allocation.allocated_amount - v_allocation_released;
    IF p_released_amount > v_allocation_remaining + 0.001 THEN
      RAISE EXCEPTION 'Cannot release K%. Selected funding allocation available balance is K%. Allocation amount: K%; previously released from allocation: K%.', p_released_amount, v_allocation_remaining, v_funding_allocation.allocated_amount, v_allocation_released;
    END IF;
  END IF;

  INSERT INTO quarterly_releases (budget_allocation_id, financial_year, quarter, release_date, released_amount, funding_allocation_id, created_by, notes)
  VALUES (v_budget.id, p_financial_year, p_quarter, COALESCE(p_release_date, CURRENT_DATE), p_released_amount, p_funding_allocation_id, v_actor, p_notes)
  RETURNING * INTO v_row;

  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'BUDGET_RELEASE_CREATED', 'QUARTERLY_RELEASE', v_row.id, v_row.release_number, NULL, to_jsonb(v_row), jsonb_build_object('amount', v_row.released_amount, 'funded', v_funded, 'previously_released', v_released, 'maximum_additional_release', v_max_releasable), NULL);
  RETURN v_row;
END;
$$;

-- ---------------------------------------------------------------------
-- 5. RBAC, RLS AND GRANTS
-- ---------------------------------------------------------------------

INSERT INTO menu_items (code, module_code, parent_code, label, href, icon, sort_order, required_permissions, is_active)
VALUES ('budget.funding', 'budget', NULL, 'Funding Management', '/dashboard/budget/funding', 'Banknote', 25, ARRAY['funding.view'], true)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  required_permissions = EXCLUDED.required_permissions,
  is_active = true,
  updated_at = NOW();

INSERT INTO permissions (code, module_code, menu_code, action, label, description, is_active) VALUES
  ('funding.view','budget','budget.funding','view','View funding management','View funding authorities, receipts, allocations and funding reports',true),
  ('funding.create','budget','budget.funding','create','Create funding records','Create funding authorities and receipts',true),
  ('funding.submit','budget','budget.funding','submit','Submit funding records','Submit funding authorities and receipts for verification',true),
  ('funding.verify','budget','budget.funding','verify','Verify funding records','Verify funding authorities and receipts',true),
  ('funding.approve','budget','budget.funding','approve','Approve funding records','Approve funding authorities and receipts',true),
  ('funding.reject','budget','budget.funding','reject','Reject funding records','Reject funding authorities and receipts',true),
  ('funding.allocate','budget','budget.funding','create','Allocate funding','Allocate approved receipts to approved operational budget allocations',true),
  ('funding.allocation.approve','budget','budget.funding','approve','Approve funding allocations','Approve funding allocations before release',true),
  ('budget.control.view','budget','budget.control','view','View authoritative budget control','View authoritative budget position including funding and release controls',true),
  ('budget.report.view','budget','reports.library','view','View budget reports','View budget and funding reports',true)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  menu_code = EXCLUDED.menu_code,
  action = EXCLUDED.action,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active = true;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.permission, true
FROM roles r
CROSS JOIN LATERAL unnest(ARRAY[
  'funding.view','funding.create','funding.submit','funding.verify','funding.approve','funding.reject','funding.allocate','funding.allocation.approve','budget.release','budget.control.view','budget.report.view'
]) AS p(permission)
WHERE r.name IN ('System Administrator','Administrator','Finance Manager','Budget Manager')
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.permission, true
FROM roles r
CROSS JOIN LATERAL unnest(ARRAY['funding.view','funding.create','funding.submit','funding.allocate','budget.control.view','budget.report.view']) AS p(permission)
WHERE r.name IN ('Finance Officer','Budget Officer')
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

ALTER TABLE funding_authorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE funding_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS funding_authorities_select_rbac ON funding_authorities;
DROP POLICY IF EXISTS funding_authorities_insert_rbac ON funding_authorities;
DROP POLICY IF EXISTS funding_authorities_update_rbac ON funding_authorities;
CREATE POLICY funding_authorities_select_rbac ON funding_authorities
  FOR SELECT USING (fn_current_user_has_permission('funding.view') OR fn_current_user_has_permission('budget.control.view') OR fn_current_user_has_permission('all'));
CREATE POLICY funding_authorities_insert_rbac ON funding_authorities
  FOR INSERT WITH CHECK (fn_current_user_has_permission('funding.create') OR fn_current_user_has_permission('all'));
CREATE POLICY funding_authorities_update_rbac ON funding_authorities
  FOR UPDATE USING (fn_current_user_has_permission('funding.verify') OR fn_current_user_has_permission('funding.approve') OR fn_current_user_has_permission('funding.reject') OR fn_current_user_has_permission('all'))
  WITH CHECK (fn_current_user_has_permission('funding.verify') OR fn_current_user_has_permission('funding.approve') OR fn_current_user_has_permission('funding.reject') OR fn_current_user_has_permission('all'));

DROP POLICY IF EXISTS funding_receipts_select_rbac ON funding_receipts;
DROP POLICY IF EXISTS funding_receipts_insert_rbac ON funding_receipts;
DROP POLICY IF EXISTS funding_receipts_update_rbac ON funding_receipts;
CREATE POLICY funding_receipts_select_rbac ON funding_receipts
  FOR SELECT USING (fn_current_user_has_permission('funding.view') OR fn_current_user_has_permission('budget.control.view') OR fn_current_user_has_permission('all'));
CREATE POLICY funding_receipts_insert_rbac ON funding_receipts
  FOR INSERT WITH CHECK (fn_current_user_has_permission('funding.create') OR fn_current_user_has_permission('all'));
CREATE POLICY funding_receipts_update_rbac ON funding_receipts
  FOR UPDATE USING (fn_current_user_has_permission('funding.verify') OR fn_current_user_has_permission('funding.approve') OR fn_current_user_has_permission('funding.reject') OR fn_current_user_has_permission('all'))
  WITH CHECK (fn_current_user_has_permission('funding.verify') OR fn_current_user_has_permission('funding.approve') OR fn_current_user_has_permission('funding.reject') OR fn_current_user_has_permission('all'));

DROP POLICY IF EXISTS funding_allocations_select_rbac ON funding_allocations;
DROP POLICY IF EXISTS funding_allocations_insert_rbac ON funding_allocations;
DROP POLICY IF EXISTS funding_allocations_update_rbac ON funding_allocations;
CREATE POLICY funding_allocations_select_rbac ON funding_allocations
  FOR SELECT USING (fn_current_user_has_permission('funding.view') OR fn_current_user_has_permission('budget.control.view') OR fn_current_user_has_permission('all'));
CREATE POLICY funding_allocations_insert_rbac ON funding_allocations
  FOR INSERT WITH CHECK (fn_current_user_has_permission('funding.allocate') OR fn_current_user_has_permission('all'));
CREATE POLICY funding_allocations_update_rbac ON funding_allocations
  FOR UPDATE USING (fn_current_user_has_permission('funding.allocation.approve') OR fn_current_user_has_permission('all'))
  WITH CHECK (fn_current_user_has_permission('funding.allocation.approve') OR fn_current_user_has_permission('all'));

REVOKE INSERT, UPDATE, DELETE ON funding_authorities, funding_receipts, funding_allocations FROM anon;
GRANT SELECT ON funding_authorities, funding_receipts, funding_allocations TO authenticated;
GRANT SELECT ON v_funding_authority_register, v_funding_receipt_register, v_funding_allocation_register, v_authoritative_budget_position, v_funding_source_report TO authenticated;
GRANT EXECUTE ON FUNCTION njss_create_funding_authority(INTEGER, TEXT, UUID, NUMERIC, DATE, DATE, TEXT, TEXT, TEXT, TEXT, DATE, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_transition_funding_authority(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_create_funding_receipt(UUID, DATE, NUMERIC, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_transition_funding_receipt(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_allocate_funding(UUID, UUID, NUMERIC, DATE, TEXT, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_approve_funding_allocation(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION njss_create_budget_release(UUID, INTEGER, INTEGER, NUMERIC, DATE, UUID, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------
-- 6. REPORT CATALOGUE OPTIONAL REGISTRATION
-- ---------------------------------------------------------------------

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
