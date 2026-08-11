-- =====================================================
-- NJSS RBAC HARDENING FOR LEGACY GRANTS
-- Run after 015_rbac_framework.sql and after confirming System Administrator access.
-- =====================================================

-- Remove anonymous write access from high-risk operational and security tables.
REVOKE INSERT, UPDATE, DELETE ON
  ff3_headers,
  ff3_items,
  ff3_quotations,
  ff3_attachments,
  ff3_approvals,
  ff3_commitments,
  ff4_headers,
  ff4_attachments,
  payment_transactions,
  annual_plan_headers,
  annual_plan_lines,
  budget_allocations,
  quarterly_releases,
  budget_consolidations,
  divisional_budget_submissions,
  divisional_budget_lines,
  budget_monthly_allocations,
  roles,
  user_roles,
  role_permissions,
  user_permissions,
  role_data_scopes,
  user_data_scopes,
  audit_logs
FROM anon;

-- Keep read access for authenticated users. Browser writes should go through
-- protected route handlers and RLS policies.
GRANT SELECT ON
  ff3_headers,
  ff3_items,
  ff3_quotations,
  ff3_attachments,
  ff3_approvals,
  ff3_commitments,
  ff4_headers,
  ff4_attachments,
  payment_transactions,
  annual_plan_headers,
  annual_plan_lines,
  budget_allocations,
  quarterly_releases,
  budget_consolidations,
  divisional_budget_submissions,
  divisional_budget_lines,
  budget_monthly_allocations,
  roles,
  user_roles,
  role_permissions,
  user_permissions,
  role_data_scopes,
  user_data_scopes,
  audit_logs
TO authenticated;

-- Revoke legacy anonymous execution of high-risk workflow functions.
REVOKE EXECUTE ON FUNCTION transition_divisional_budget_submission(UUID, TEXT, TEXT, TEXT) FROM anon;

-- FF3 policies.
ALTER TABLE ff3_headers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ff3_headers_select_rbac ON ff3_headers;
DROP POLICY IF EXISTS ff3_headers_insert_rbac ON ff3_headers;
DROP POLICY IF EXISTS ff3_headers_update_rbac ON ff3_headers;
CREATE POLICY ff3_headers_select_rbac ON ff3_headers
  FOR SELECT USING (fn_current_user_has_permission('ff3.view') OR fn_current_user_has_permission('ff3.create') OR fn_current_user_has_permission('ff3.approve') OR fn_current_user_has_permission('all'));
CREATE POLICY ff3_headers_insert_rbac ON ff3_headers
  FOR INSERT WITH CHECK (fn_current_user_has_permission('ff3.create') OR fn_current_user_has_permission('all'));
CREATE POLICY ff3_headers_update_rbac ON ff3_headers
  FOR UPDATE USING (fn_current_user_has_permission('ff3.edit') OR fn_current_user_has_permission('ff3.endorse') OR fn_current_user_has_permission('ff3.approve') OR fn_current_user_has_permission('ff3.reject') OR fn_current_user_has_permission('all'))
  WITH CHECK (fn_current_user_has_permission('ff3.edit') OR fn_current_user_has_permission('ff3.endorse') OR fn_current_user_has_permission('ff3.approve') OR fn_current_user_has_permission('ff3.reject') OR fn_current_user_has_permission('all'));

ALTER TABLE ff3_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ff3_approvals_select_rbac ON ff3_approvals;
DROP POLICY IF EXISTS ff3_approvals_insert_rbac ON ff3_approvals;
CREATE POLICY ff3_approvals_select_rbac ON ff3_approvals
  FOR SELECT USING (fn_current_user_has_permission('ff3.view') OR fn_current_user_has_permission('all'));
CREATE POLICY ff3_approvals_insert_rbac ON ff3_approvals
  FOR INSERT WITH CHECK (fn_current_user_has_permission('ff3.endorse') OR fn_current_user_has_permission('ff3.approve') OR fn_current_user_has_permission('ff3.reject') OR fn_current_user_has_permission('all'));

-- FF4 policies.
ALTER TABLE ff4_headers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ff4_headers_select_rbac ON ff4_headers;
DROP POLICY IF EXISTS ff4_headers_insert_rbac ON ff4_headers;
DROP POLICY IF EXISTS ff4_headers_update_rbac ON ff4_headers;
CREATE POLICY ff4_headers_select_rbac ON ff4_headers
  FOR SELECT USING (fn_current_user_has_permission('ff4.view') OR fn_current_user_has_permission('ff4.create') OR fn_current_user_has_permission('ff4.verify') OR fn_current_user_has_permission('ff4.process') OR fn_current_user_has_permission('all'));
CREATE POLICY ff4_headers_insert_rbac ON ff4_headers
  FOR INSERT WITH CHECK (fn_current_user_has_permission('ff4.create') OR fn_current_user_has_permission('all'));
CREATE POLICY ff4_headers_update_rbac ON ff4_headers
  FOR UPDATE USING (fn_current_user_has_permission('ff4.edit') OR fn_current_user_has_permission('ff4.verify') OR fn_current_user_has_permission('ff4.approve') OR fn_current_user_has_permission('ff4.process') OR fn_current_user_has_permission('ff4.reject') OR fn_current_user_has_permission('all'))
  WITH CHECK (fn_current_user_has_permission('ff4.edit') OR fn_current_user_has_permission('ff4.verify') OR fn_current_user_has_permission('ff4.approve') OR fn_current_user_has_permission('ff4.process') OR fn_current_user_has_permission('ff4.reject') OR fn_current_user_has_permission('all'));

-- Budget and planning policies.
ALTER TABLE annual_plan_headers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS annual_plan_headers_select_rbac ON annual_plan_headers;
DROP POLICY IF EXISTS annual_plan_headers_insert_rbac ON annual_plan_headers;
DROP POLICY IF EXISTS annual_plan_headers_update_rbac ON annual_plan_headers;
CREATE POLICY annual_plan_headers_select_rbac ON annual_plan_headers
  FOR SELECT USING (fn_current_user_has_permission('plans.create') OR fn_current_user_has_permission('plans.review') OR fn_current_user_has_permission('budget.view') OR fn_current_user_has_permission('all'));
CREATE POLICY annual_plan_headers_insert_rbac ON annual_plan_headers
  FOR INSERT WITH CHECK (fn_current_user_has_permission('plans.create') OR fn_current_user_has_permission('all'));
CREATE POLICY annual_plan_headers_update_rbac ON annual_plan_headers
  FOR UPDATE USING (fn_current_user_has_permission('plans.submit') OR fn_current_user_has_permission('plans.review') OR fn_current_user_has_permission('plans.approve') OR fn_current_user_has_permission('plans.authorize') OR fn_current_user_has_permission('plans.confirm') OR fn_current_user_has_permission('all'))
  WITH CHECK (fn_current_user_has_permission('plans.submit') OR fn_current_user_has_permission('plans.review') OR fn_current_user_has_permission('plans.approve') OR fn_current_user_has_permission('plans.authorize') OR fn_current_user_has_permission('plans.confirm') OR fn_current_user_has_permission('all'));

ALTER TABLE budget_allocations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS budget_allocations_select_rbac ON budget_allocations;
DROP POLICY IF EXISTS budget_allocations_insert_rbac ON budget_allocations;
DROP POLICY IF EXISTS budget_allocations_update_rbac ON budget_allocations;
CREATE POLICY budget_allocations_select_rbac ON budget_allocations
  FOR SELECT USING (fn_current_user_has_permission('budget.view') OR fn_current_user_has_permission('budget.module.view') OR fn_current_user_has_permission('all'));
CREATE POLICY budget_allocations_insert_rbac ON budget_allocations
  FOR INSERT WITH CHECK (fn_current_user_has_permission('plans.confirm') OR fn_current_user_has_permission('budget.module.admin') OR fn_current_user_has_permission('all'));
CREATE POLICY budget_allocations_update_rbac ON budget_allocations
  FOR UPDATE USING (fn_current_user_has_permission('budget.module.admin') OR fn_current_user_has_permission('all'))
  WITH CHECK (fn_current_user_has_permission('budget.module.admin') OR fn_current_user_has_permission('all'));

ALTER TABLE quarterly_releases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quarterly_releases_select_rbac ON quarterly_releases;
DROP POLICY IF EXISTS quarterly_releases_insert_rbac ON quarterly_releases;
CREATE POLICY quarterly_releases_select_rbac ON quarterly_releases
  FOR SELECT USING (fn_current_user_has_permission('budget.view') OR fn_current_user_has_permission('budget.release') OR fn_current_user_has_permission('all'));
CREATE POLICY quarterly_releases_insert_rbac ON quarterly_releases
  FOR INSERT WITH CHECK (fn_current_user_has_permission('budget.release') OR fn_current_user_has_permission('all'));

ALTER TABLE divisional_budget_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS divisional_budget_submissions_select_rbac ON divisional_budget_submissions;
DROP POLICY IF EXISTS divisional_budget_submissions_insert_rbac ON divisional_budget_submissions;
DROP POLICY IF EXISTS divisional_budget_submissions_update_rbac ON divisional_budget_submissions;
CREATE POLICY divisional_budget_submissions_select_rbac ON divisional_budget_submissions
  FOR SELECT USING (fn_current_user_has_permission('budget.module.view') OR fn_current_user_has_permission('budget.template') OR fn_current_user_has_permission('all'));
CREATE POLICY divisional_budget_submissions_insert_rbac ON divisional_budget_submissions
  FOR INSERT WITH CHECK (fn_current_user_has_permission('budget.template.submit') OR fn_current_user_has_permission('budget.module.submit') OR fn_current_user_has_permission('all'));
CREATE POLICY divisional_budget_submissions_update_rbac ON divisional_budget_submissions
  FOR UPDATE USING (fn_current_user_has_permission('budget.template.submit') OR fn_current_user_has_permission('budget.template.review') OR fn_current_user_has_permission('budget.template.approve') OR fn_current_user_has_permission('all'))
  WITH CHECK (fn_current_user_has_permission('budget.template.submit') OR fn_current_user_has_permission('budget.template.review') OR fn_current_user_has_permission('budget.template.approve') OR fn_current_user_has_permission('all'));

-- Access-control tables are managed only by authorized administrators.
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roles_read_auth ON roles;
DROP POLICY IF EXISTS roles_manage_rbac ON roles;
DROP POLICY IF EXISTS user_roles_read_manage_rbac ON user_roles;
DROP POLICY IF EXISTS user_roles_manage_rbac ON user_roles;
CREATE POLICY roles_read_auth ON roles FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY roles_manage_rbac ON roles FOR ALL USING (fn_current_user_has_permission('roles.manage') OR fn_current_user_has_permission('all')) WITH CHECK (fn_current_user_has_permission('roles.manage') OR fn_current_user_has_permission('all'));
CREATE POLICY user_roles_read_manage_rbac ON user_roles FOR SELECT USING (fn_current_user_has_permission('users.manage') OR fn_current_user_has_permission('all'));
CREATE POLICY user_roles_manage_rbac ON user_roles FOR ALL USING (fn_current_user_has_permission('users.manage') OR fn_current_user_has_permission('all')) WITH CHECK (fn_current_user_has_permission('users.manage') OR fn_current_user_has_permission('all'));
