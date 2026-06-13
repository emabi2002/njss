-- NJSS FREMS Database Schema
-- National Judiciary Staff Services Financial Requisition and Expense Management System
-- Papua New Guinea

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- ORGANIZATION AND MASTER DATA
-- =====================================================

-- Departments
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sections
CREATE TABLE sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    department_id UUID REFERENCES departments(id),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Provinces
CREATE TABLE provinces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    region VARCHAR(50),
    is_active BOOLEAN DEFAULT true
);

-- Projects
CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    department_id UUID REFERENCES departments(id),
    start_date DATE,
    end_date DATE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Funding Sources
CREATE TABLE funding_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    source_type VARCHAR(50),
    is_active BOOLEAN DEFAULT true
);

-- Chart of Accounts
CREATE TABLE chart_of_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_code VARCHAR(50) UNIQUE NOT NULL,
    account_name VARCHAR(200) NOT NULL,
    account_type VARCHAR(50),
    is_open_head BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true
);

-- Expense Categories
CREATE TABLE expense_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    is_active BOOLEAN DEFAULT true
);

-- =====================================================
-- USER MANAGEMENT
-- =====================================================

-- Roles
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    permissions JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true
);

-- Users (extends Supabase auth.users)
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    employee_id VARCHAR(50) UNIQUE,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(20),
    department_id UUID REFERENCES departments(id),
    section_id UUID REFERENCES sections(id),
    position VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Roles
CREATE TABLE user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id),
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, role_id)
);

-- =====================================================
-- ANNUAL PLANNING
-- =====================================================

CREATE TABLE annual_plan_headers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE TABLE annual_plan_lines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE TABLE budget_allocations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE TABLE quarterly_releases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE TABLE ff3_headers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ff3_number VARCHAR(50) UNIQUE NOT NULL,
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
    manager_approved_date TIMESTAMPTZ,
    supervisor_endorsed_by UUID REFERENCES users(id),
    section_head_endorsed_by UUID REFERENCES users(id),
    manager_approved_by UUID REFERENCES users(id),
    total_estimated_amount DECIMAL(15,2),
    is_within_budget BOOLEAN,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE TABLE ff3_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
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

CREATE TABLE ff3_quotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ff3_header_id UUID REFERENCES ff3_headers(id) ON DELETE CASCADE,
    supplier_name VARCHAR(200) NOT NULL,
    quotation_number VARCHAR(100),
    quotation_date DATE,
    quotation_amount DECIMAL(15,2) NOT NULL,
    attachment_url TEXT,
    is_selected BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ff3_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ff3_header_id UUID REFERENCES ff3_headers(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50),
    file_url TEXT NOT NULL,
    attachment_type VARCHAR(50),
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE ff3_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ff3_header_id UUID REFERENCES ff3_headers(id) ON DELETE CASCADE,
    approval_level VARCHAR(50),
    approver_id UUID REFERENCES users(id),
    action VARCHAR(20),
    comments TEXT,
    action_date TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- COMMITMENT LEDGER
-- =====================================================

CREATE TABLE ff3_commitments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    commitment_number VARCHAR(50) UNIQUE NOT NULL,
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
-- FF4 EXPENSE TRACKING
-- =====================================================

CREATE TABLE ff4_headers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ff4_number VARCHAR(50) UNIQUE NOT NULL,
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

CREATE TABLE ff4_attachments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ff4_header_id UUID REFERENCES ff4_headers(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(50),
    file_url TEXT NOT NULL,
    attachment_type VARCHAR(50),
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ff4_header_id UUID REFERENCES ff4_headers(id),
    commitment_id UUID REFERENCES ff3_commitments(id),
    transaction_date DATE NOT NULL,
    transaction_type VARCHAR(50),
    amount DECIMAL(15,2) NOT NULL,
    payment_reference VARCHAR(100),
    reconciled BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- NOTIFICATIONS
-- =====================================================

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    notification_type VARCHAR(50),
    title VARCHAR(200) NOT NULL,
    message TEXT,
    reference_type VARCHAR(20),
    reference_id UUID,
    is_read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,
    priority VARCHAR(20) DEFAULT 'NORMAL',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- AUDIT LOGS
-- =====================================================

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    module VARCHAR(50),
    record_type VARCHAR(50),
    record_id UUID,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(50),
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- AUTO-GENERATE NUMBERS
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

CREATE TRIGGER generate_commitment_number_trigger
    BEFORE INSERT ON ff3_commitments
    FOR EACH ROW WHEN (NEW.commitment_number IS NULL)
    EXECUTE FUNCTION generate_commitment_number();

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
    COALESCE((
        SELECT SUM(committed_amount - COALESCE(paid_amount, 0))
        FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE', 'PARTIALLY_PAID')
    ), 0) AS committed_amount,
    COALESCE((
        SELECT SUM(paid_amount) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id
    ), 0) AS actual_expenditure,
    COALESCE(SUM(qr.released_amount), 0) -
    COALESCE((SELECT SUM(committed_amount - COALESCE(paid_amount, 0)) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id AND c.status IN ('ACTIVE', 'PARTIALLY_PAID')), 0) -
    COALESCE((SELECT SUM(paid_amount) FROM ff3_commitments c WHERE c.budget_allocation_id = ba.id), 0) AS available_balance
FROM budget_allocations ba
LEFT JOIN quarterly_releases qr ON qr.budget_allocation_id = ba.id
WHERE ba.is_active = true
GROUP BY ba.id;

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_ff3_status ON ff3_headers(status);
CREATE INDEX idx_ff3_financial_year ON ff3_headers(financial_year);
CREATE INDEX idx_ff4_status ON ff4_headers(status);
CREATE INDEX idx_ff4_financial_year ON ff4_headers(financial_year);
CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_notifications_user ON notifications(user_id);
