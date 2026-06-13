-- NJSS FREMS Row Level Security Policies
-- Run this after the initial schema to enable data access

-- For demo purposes, we'll allow public read access to master data tables
-- In production, you would restrict this based on authentication

-- Disable RLS on master data tables (read-only reference data)
ALTER TABLE departments DISABLE ROW LEVEL SECURITY;
ALTER TABLE sections DISABLE ROW LEVEL SECURITY;
ALTER TABLE provinces DISABLE ROW LEVEL SECURITY;
ALTER TABLE projects DISABLE ROW LEVEL SECURITY;
ALTER TABLE funding_sources DISABLE ROW LEVEL SECURITY;
ALTER TABLE chart_of_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE roles DISABLE ROW LEVEL SECURITY;

-- Disable RLS on transactional tables for demo
-- In production, enable RLS with proper policies
ALTER TABLE budget_allocations DISABLE ROW LEVEL SECURITY;
ALTER TABLE quarterly_releases DISABLE ROW LEVEL SECURITY;
ALTER TABLE ff3_headers DISABLE ROW LEVEL SECURITY;
ALTER TABLE ff3_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE ff3_quotations DISABLE ROW LEVEL SECURITY;
ALTER TABLE ff3_attachments DISABLE ROW LEVEL SECURITY;
ALTER TABLE ff3_approvals DISABLE ROW LEVEL SECURITY;
ALTER TABLE ff3_commitments DISABLE ROW LEVEL SECURITY;
ALTER TABLE ff4_headers DISABLE ROW LEVEL SECURITY;
ALTER TABLE ff4_attachments DISABLE ROW LEVEL SECURITY;
ALTER TABLE payment_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles DISABLE ROW LEVEL SECURITY;
ALTER TABLE annual_plan_headers DISABLE ROW LEVEL SECURITY;
ALTER TABLE annual_plan_lines DISABLE ROW LEVEL SECURITY;

-- Grant usage on schema
GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- Grant select on all tables for read access
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;

-- Grant insert, update, delete for authenticated users
GRANT INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- Grant usage on sequences
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
