-- =====================================================================
-- CRMS — Court Registry Requisition & Expense Monitoring System
-- COMPLETE, AUTHORITATIVE SCHEMA (matches the application code)
-- Safe to run on a fresh Supabase project. Idempotent where practical.
-- =====================================================================

-- gen_random_uuid() is built-in on Supabase (pgcrypto)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- ORGANIZATION & MASTER DATA
-- =====================================================
CREATE TABLE IF NOT EXISTS departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    department_id UUID REFERENCES departments(id),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS provinces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    region VARCHAR(50),
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    department_id UUID REFERENCES departments(id),
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS funding_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    source_type VARCHAR(50),
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_code VARCHAR(50) UNIQUE NOT NULL,
    account_name VARCHAR(200) NOT NULL,
    account_type VARCHAR(50),
    is_open_head BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS expense_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    is_active BOOLEAN DEFAULT true
);

-- =====================================================
-- USERS, ROLES & PERMISSIONS
-- =====================================================
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    permissions JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- NOTE: id defaults to a generated uuid (NOT a hard FK to auth.users) so the
-- Users admin screen can create profile records without an auth account.
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID,
    employee_id VARCHAR(50) UNIQUE,
    full_name VARCHAR(200) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    department_id UUID REFERENCES departments(id),
    section_id UUID REFERENCES sections(id),
    position VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, role_id)
);

-- Granular permission map (spec requirement)
CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
    permission VARCHAR(100) NOT NULL,
    is_allowed BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(role_id, permission)
);

-- =====================================================
-- ANNUAL PLANNING
-- =====================================================
CREATE TABLE IF NOT EXISTS annual_plan_headers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_number VARCHAR(50) UNIQUE NOT NULL,
    financial_year INTEGER NOT NULL,
    department_id UUID REFERENCES departments(id),
    section_id UUID REFERENCES sections(id),
    status VARCHAR(50) DEFAULT 'DRAFT',
    submitted_date DATE,
    approved_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS annual_plan_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_header_id UUID REFERENCES annual_plan_headers(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    activity_code VARCHAR(50),
    activity_description TEXT NOT NULL,
    expense_category_id UUID REFERENCES expense_categories(id),
    account_id UUID REFERENCES chart_of_accounts(id),
    project_id UUID REFERENCES projects(id),
    funding_source_id UUID REFERENCES funding_sources(id),
    q1_amount DECIMAL(15,2) DEFAULT 0,
    q2_amount DECIMAL(15,2) DEFAULT 0,
    q3_amount DECIMAL(15,2) DEFAULT 0,
    q4_amount DECIMAL(15,2) DEFAULT 0,
    total_amount DECIMAL(15,2) GENERATED ALWAYS AS (q1_amount + q2_amount + q3_amount + q4_amount) STORED
);

-- =====================================================
-- BUDGET MANAGEMENT
-- =====================================================
CREATE TABLE IF NOT EXISTS budget_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    financial_year INTEGER NOT NULL,
    department_id UUID REFERENCES departments(id),
    section_id UUID REFERENCES sections(id),
    project_id UUID REFERENCES projects(id),
    funding_source_id UUID REFERENCES funding_sources(id),
    account_id UUID REFERENCES chart_of_accounts(id) NOT NULL,
    annual_plan_line_id UUID REFERENCES annual_plan_lines(id),
    original_budget DECIMAL(15,2) DEFAULT 0 NOT NULL,
    supplemental_budget DECIMAL(15,2) DEFAULT 0,
    revised_budget DECIMAL(15,2) GENERATED ALWAYS AS (original_budget + COALESCE(supplemental_budget, 0)) STORED,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quarterly_releases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    budget_allocation_id UUID REFERENCES budget_allocations(id) ON DELETE CASCADE,
    financial_year INTEGER NOT NULL,
    quarter INTEGER CHECK (quarter BETWEEN 1 AND 4),
    release_number VARCHAR(50),
    release_date DATE NOT NULL,
    released_amount DECIMAL(15,2) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- FF3 REQUISITION SYSTEM
-- =====================================================
CREATE TABLE IF NOT EXISTS ff3_headers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ff3_number VARCHAR(50) UNIQUE,
    financial_year INTEGER NOT NULL,
    request_date DATE NOT NULL DEFAULT CURRENT_DATE,
    requesting_officer_id UUID REFERENCES users(id),
    department_id UUID REFERENCES departments(id),
    section_id UUID REFERENCES sections(id),
    project_id UUID REFERENCES projects(id),
    province_id UUID REFERENCES provinces(id),
    funding_source_id UUID REFERENCES funding_sources(id),
    annual_plan_line_id UUID REFERENCES annual_plan_lines(id),
    purpose TEXT NOT NULL,
    justification TEXT,
    required_by_date DATE,
    urgency_level VARCHAR(20),
    procurement_method VARCHAR(50),
    selected_supplier_name VARCHAR(200),
    supplier_selection_justification TEXT,
    status VARCHAR(50) DEFAULT 'DRAFT',
    submitted_date TIMESTAMPTZ,
    supervisor_endorsed_date TIMESTAMPTZ,
    section_head_endorsed_date TIMESTAMPTZ,
    approved_date TIMESTAMPTZ,
    supervisor_endorsed_by UUID REFERENCES users(id),
    section_head_endorsed_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    total_estimated_amount DECIMAL(15,2),
    is_within_budget BOOLEAN,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ff3_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ff3_header_id UUID REFERENCES ff3_headers(id) ON DELETE CASCADE,
    line_number INTEGER NOT NULL,
    item_description TEXT NOT NULL,
    specifications TEXT,
    quantity DECIMAL(10,2) NOT NULL,
    unit_of_measure VARCHAR(50),
    estimated_unit_price DECIMAL(15,2),
    total_amount DECIMAL(15,2) GENERATED ALWAYS AS (quantity * COALESCE(estimated_unit_price, 0)) STORED,
    account_id UUID REFERENCES chart_of_accounts(id)
);

CREATE TABLE IF NOT EXISTS ff3_quotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ff3_header_id UUID REFERENCES ff3_headers(id) ON DELETE CASCADE,
    supplier_name VARCHAR(200) NOT NULL,
    quotation_number VARCHAR(100),
    quotation_date DATE,
    quotation_amount DECIMAL(15,2) NOT NULL,
    attachment_url TEXT,
    is_selected BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ff3_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ff3_header_id UUID REFERENCES ff3_headers(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50),
    file_url TEXT NOT NULL,
    attachment_type VARCHAR(50),
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

-- ff3_approvals uses action_taken / approval_level (matches the app code)
CREATE TABLE IF NOT EXISTS ff3_approvals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ff3_header_id UUID REFERENCES ff3_headers(id) ON DELETE CASCADE,
    approval_level VARCHAR(50),
    approver_id UUID REFERENCES users(id),
    action_taken VARCHAR(30),
    comments TEXT,
    action_date TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- COMMITMENT LEDGER
-- =====================================================
CREATE TABLE IF NOT EXISTS ff3_commitments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    commitment_number VARCHAR(50) UNIQUE,
    ff3_header_id UUID REFERENCES ff3_headers(id),
    budget_allocation_id UUID REFERENCES budget_allocations(id),
    financial_year INTEGER NOT NULL,
    commitment_date DATE NOT NULL DEFAULT CURRENT_DATE,
    committed_amount DECIMAL(15,2) NOT NULL,
    paid_amount DECIMAL(15,2) DEFAULT 0,
    remaining_balance DECIMAL(15,2) GENERATED ALWAYS AS (committed_amount - COALESCE(paid_amount, 0)) STORED,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- FF4 EXPENSE / PAYMENT SYSTEM
-- =====================================================
CREATE TABLE IF NOT EXISTS ff4_headers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ff4_number VARCHAR(50) UNIQUE,
    ff3_header_id UUID REFERENCES ff3_headers(id),
    commitment_id UUID REFERENCES ff3_commitments(id),
    financial_year INTEGER NOT NULL,
    payment_request_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payee_type VARCHAR(50),
    payee_name VARCHAR(200) NOT NULL,
    supplier_code VARCHAR(50),
    invoice_number VARCHAR(100),
    invoice_date DATE,
    claim_reference VARCHAR(100),
    payment_description TEXT,
    gross_amount DECIMAL(15,2) NOT NULL,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    deductions DECIMAL(15,2) DEFAULT 0,
    net_amount DECIMAL(15,2) GENERATED ALWAYS AS (gross_amount - COALESCE(tax_amount, 0) - COALESCE(deductions, 0)) STORED,
    department_id UUID REFERENCES departments(id),
    section_id UUID REFERENCES sections(id),
    account_id UUID REFERENCES chart_of_accounts(id),
    payment_method VARCHAR(50),
    external_payment_reference VARCHAR(100),
    cheque_number VARCHAR(50),
    payment_date DATE,
    status VARCHAR(50) DEFAULT 'DRAFT',
    submitted_date TIMESTAMPTZ,
    verified_date TIMESTAMPTZ,
    approved_date TIMESTAMPTZ,
    paid_date TIMESTAMPTZ,
    reconciled_date TIMESTAMPTZ,
    verified_by UUID REFERENCES users(id),
    approved_by UUID REFERENCES users(id),
    reconciled_by UUID REFERENCES users(id),
    is_locked BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ff4_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ff4_header_id UUID REFERENCES ff4_headers(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50),
    file_url TEXT NOT NULL,
    attachment_type VARCHAR(50),
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ff4_header_id UUID REFERENCES ff4_headers(id),
    commitment_id UUID REFERENCES ff3_commitments(id),
    transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
    transaction_type VARCHAR(50),
    amount DECIMAL(15,2) NOT NULL,
    payment_reference VARCHAR(100),
    reconciled BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- DOCUMENTS (generic registry — spec requirement)
-- =====================================================
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module VARCHAR(20),                -- 'FF3' | 'FF4' | 'QUOTATION' | 'OTHER'
    reference_id UUID,
    reference_number VARCHAR(100),
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100),
    file_size BIGINT,
    file_url TEXT NOT NULL,
    bucket VARCHAR(100),
    storage_path TEXT,
    uploaded_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- NOTIFICATIONS  (reference_id is TEXT — app stores the FF3/FF4 number)
-- =====================================================
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    reference_type VARCHAR(20),
    reference_id TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    is_email_sent BOOLEAN DEFAULT FALSE,
    priority VARCHAR(20) DEFAULT 'MEDIUM',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    read_at TIMESTAMPTZ
);

-- =====================================================
-- AUDIT LOGS  (matches the audit-log page: entity_type/entity_reference/changes/created_at)
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_email VARCHAR(255),
    user_name VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    entity_reference VARCHAR(100),
    old_values JSONB,
    new_values JSONB,
    changes JSONB,
    ip_address VARCHAR(50),
    user_agent TEXT,
    session_id VARCHAR(100),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- SYSTEM SETTINGS (spec requirement)
-- =====================================================
CREATE TABLE IF NOT EXISTS system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value JSONB,
    description TEXT,
    updated_by UUID REFERENCES users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- AUTO-NUMBERING TRIGGERS
-- =====================================================
CREATE OR REPLACE FUNCTION generate_ff3_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.ff3_number := 'FF3-' || NEW.financial_year || '-' ||
        LPAD((SELECT COALESCE(MAX(CAST(SUBSTRING(ff3_number FROM 10) AS INTEGER)), 0) + 1
              FROM ff3_headers WHERE financial_year = NEW.financial_year)::TEXT, 5, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generate_ff3_number_trigger ON ff3_headers;
CREATE TRIGGER generate_ff3_number_trigger
    BEFORE INSERT ON ff3_headers
    FOR EACH ROW WHEN (NEW.ff3_number IS NULL)
    EXECUTE FUNCTION generate_ff3_number();

CREATE OR REPLACE FUNCTION generate_ff4_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.ff4_number := 'FF4-' || NEW.financial_year || '-' ||
        LPAD((SELECT COALESCE(MAX(CAST(SUBSTRING(ff4_number FROM 10) AS INTEGER)), 0) + 1
              FROM ff4_headers WHERE financial_year = NEW.financial_year)::TEXT, 5, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generate_ff4_number_trigger ON ff4_headers;
CREATE TRIGGER generate_ff4_number_trigger
    BEFORE INSERT ON ff4_headers
    FOR EACH ROW WHEN (NEW.ff4_number IS NULL)
    EXECUTE FUNCTION generate_ff4_number();

CREATE OR REPLACE FUNCTION generate_commitment_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.commitment_number := 'CMT-' || NEW.financial_year || '-' ||
        LPAD((SELECT COALESCE(MAX(CAST(SUBSTRING(commitment_number FROM 10) AS INTEGER)), 0) + 1
              FROM ff3_commitments WHERE financial_year = NEW.financial_year)::TEXT, 5, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS generate_commitment_number_trigger ON ff3_commitments;
CREATE TRIGGER generate_commitment_number_trigger
    BEFORE INSERT ON ff3_commitments
    FOR EACH ROW WHEN (NEW.commitment_number IS NULL)
    EXECUTE FUNCTION generate_commitment_number();

-- =====================================================
-- AUDIT LOGGING (DB-level, reliable across every workflow step)
-- =====================================================
CREATE OR REPLACE FUNCTION log_audit_event(
    p_user_id UUID, p_user_email VARCHAR, p_user_name VARCHAR,
    p_action VARCHAR, p_entity_type VARCHAR, p_entity_id UUID, p_entity_reference VARCHAR,
    p_old_values JSONB DEFAULT NULL, p_new_values JSONB DEFAULT NULL,
    p_changes JSONB DEFAULT NULL, p_metadata JSONB DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_audit_id UUID;
BEGIN
    INSERT INTO audit_logs (user_id, user_email, user_name, action, entity_type,
        entity_id, entity_reference, old_values, new_values, changes, metadata)
    VALUES (p_user_id, p_user_email, p_user_name, p_action, p_entity_type,
        p_entity_id, p_entity_reference, p_old_values, p_new_values, p_changes, p_metadata)
    RETURNING id INTO v_audit_id;
    RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- FF3 audit
CREATE OR REPLACE FUNCTION audit_ff3_changes() RETURNS TRIGGER AS $$
DECLARE v_action VARCHAR(30);
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'CREATE', 'FF3', NEW.id, NEW.ff3_number,
            NULL, to_jsonb(NEW), jsonb_build_object('status', NEW.status), NULL);
    ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        v_action := CASE NEW.status
            WHEN 'SUBMITTED' THEN 'SUBMIT'
            WHEN 'ENDORSED_SUPERVISOR' THEN 'ENDORSE'
            WHEN 'ENDORSED_SECTION_HEAD' THEN 'ENDORSE'
            WHEN 'APPROVED' THEN 'APPROVE'
            WHEN 'REJECTED' THEN 'REJECT'
            WHEN 'EXPIRED' THEN 'UPDATE'
            ELSE 'UPDATE' END;
        PERFORM log_audit_event(NULL, NULL, 'System', v_action, 'FF3', NEW.id, NEW.ff3_number,
            jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status),
            jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status), NULL);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS ff3_audit_trigger ON ff3_headers;
CREATE TRIGGER ff3_audit_trigger AFTER INSERT OR UPDATE ON ff3_headers
    FOR EACH ROW EXECUTE FUNCTION audit_ff3_changes();

-- FF4 audit
CREATE OR REPLACE FUNCTION audit_ff4_changes() RETURNS TRIGGER AS $$
DECLARE v_action VARCHAR(30);
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'CREATE', 'FF4', NEW.id, NEW.ff4_number,
            NULL, to_jsonb(NEW), jsonb_build_object('status', NEW.status), NULL);
    ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        v_action := CASE NEW.status
            WHEN 'SUBMITTED' THEN 'SUBMIT'
            WHEN 'VERIFIED' THEN 'VERIFY'
            WHEN 'APPROVED' THEN 'APPROVE'
            WHEN 'PROCESSED' THEN 'PROCESS'
            WHEN 'PAID' THEN 'PAYMENT'
            WHEN 'RECONCILED' THEN 'RECONCILE'
            WHEN 'CANCELLED' THEN 'CANCEL'
            ELSE 'UPDATE' END;
        PERFORM log_audit_event(NULL, NULL, 'System', v_action, 'FF4', NEW.id, NEW.ff4_number,
            jsonb_build_object('status', OLD.status), jsonb_build_object('status', NEW.status),
            jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status), NULL);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS ff4_audit_trigger ON ff4_headers;
CREATE TRIGGER ff4_audit_trigger AFTER INSERT OR UPDATE ON ff4_headers
    FOR EACH ROW EXECUTE FUNCTION audit_ff4_changes();

-- Commitment audit
CREATE OR REPLACE FUNCTION audit_commitment_changes() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'CREATE', 'COMMITMENT', NEW.id, NEW.commitment_number,
            NULL, to_jsonb(NEW), jsonb_build_object('status', NEW.status, 'committed', NEW.committed_amount), NULL);
    ELSIF TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.paid_amount IS DISTINCT FROM NEW.paid_amount) THEN
        PERFORM log_audit_event(NULL, NULL, 'System', 'UPDATE', 'COMMITMENT', NEW.id, NEW.commitment_number,
            jsonb_build_object('status', OLD.status, 'paid', OLD.paid_amount),
            jsonb_build_object('status', NEW.status, 'paid', NEW.paid_amount),
            jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status), NULL);
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS commitment_audit_trigger ON ff3_commitments;
CREATE TRIGGER commitment_audit_trigger AFTER INSERT OR UPDATE ON ff3_commitments
    FOR EACH ROW EXECUTE FUNCTION audit_commitment_changes();

-- =====================================================
-- BUDGET CONTROL VIEW
-- =====================================================
CREATE OR REPLACE VIEW v_budget_control AS
SELECT
    ba.id AS budget_allocation_id,
    ba.financial_year,
    ba.department_id,
    ba.section_id,
    ba.account_id,
    ba.original_budget,
    ba.supplemental_budget,
    ba.revised_budget,
    COALESCE(SUM(qr.released_amount), 0) AS quarterly_released,
    COALESCE((SELECT SUM(committed_amount - COALESCE(paid_amount, 0)) FROM ff3_commitments c
              WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID')), 0) AS committed_amount,
    COALESCE((SELECT SUM(paid_amount) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id), 0) AS actual_expenditure,
    COALESCE(SUM(qr.released_amount), 0)
      - COALESCE((SELECT SUM(committed_amount - COALESCE(paid_amount, 0)) FROM ff3_commitments c
                  WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE','PARTIALLY_PAID')), 0)
      - COALESCE((SELECT SUM(paid_amount) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id), 0) AS available_balance
FROM budget_allocations ba
LEFT JOIN quarterly_releases qr ON qr.budget_allocation_id = ba.id
WHERE ba.is_active = true
GROUP BY ba.id;

-- =====================================================
-- INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_ff3_status ON ff3_headers(status);
CREATE INDEX IF NOT EXISTS idx_ff3_fy ON ff3_headers(financial_year);
CREATE INDEX IF NOT EXISTS idx_ff4_status ON ff4_headers(status);
CREATE INDEX IF NOT EXISTS idx_ff4_fy ON ff4_headers(financial_year);
CREATE INDEX IF NOT EXISTS idx_commitment_status ON ff3_commitments(status);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notif_read ON notifications(is_read);

-- =====================================================
-- ACCESS (testing mode uses the anon role for reads AND writes)
-- RLS disabled + full grants. Tighten for production.
-- =====================================================
DO $$
DECLARE t RECORD;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t.tablename);
    END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;

-- =====================================================
-- STORAGE BUCKETS + POLICIES
-- =====================================================
INSERT INTO storage.buckets (id, name, public) VALUES
    ('ff3-attachments', 'ff3-attachments', true),
    ('ff4-attachments', 'ff4-attachments', true),
    ('quotations', 'quotations', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "crms_storage_read" ON storage.objects;
CREATE POLICY "crms_storage_read" ON storage.objects FOR SELECT TO anon, authenticated
    USING (bucket_id IN ('ff3-attachments','ff4-attachments','quotations'));

DROP POLICY IF EXISTS "crms_storage_write" ON storage.objects;
CREATE POLICY "crms_storage_write" ON storage.objects FOR INSERT TO anon, authenticated
    WITH CHECK (bucket_id IN ('ff3-attachments','ff4-attachments','quotations'));

DROP POLICY IF EXISTS "crms_storage_update" ON storage.objects;
CREATE POLICY "crms_storage_update" ON storage.objects FOR UPDATE TO anon, authenticated
    USING (bucket_id IN ('ff3-attachments','ff4-attachments','quotations'));

DROP POLICY IF EXISTS "crms_storage_delete" ON storage.objects;
CREATE POLICY "crms_storage_delete" ON storage.objects FOR DELETE TO anon, authenticated
    USING (bucket_id IN ('ff3-attachments','ff4-attachments','quotations'));

-- Realtime for notifications (ignore if already added)
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
END $$;
