-- =============================================================================
-- NJSS 041 — USER ADMINISTRATION AND ACCESS CONTROL
-- Additive only. Historic FF3/FF4/payment/audit data is preserved.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 0. Re-run safety.
--    The guard triggers created later in this file are BEFORE INSERT triggers.
--    PostgreSQL fires BEFORE INSERT triggers before ON CONFLICT resolution, so
--    on a second execution the seeding statements in sections 4 and 6 would be
--    rejected by the very rules they install. Dropping them up front (they are
--    re-created below, in the same transaction) keeps this migration idempotent
--    without weakening any rule.
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_roles_block_new_business ON roles;
DROP TRIGGER IF EXISTS trg_roles_protect_controlled ON roles;
DROP TRIGGER IF EXISTS trg_user_roles_single_workflow_role ON user_roles;
DROP TRIGGER IF EXISTS trg_users_guard_last_administrator ON users;
DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON audit_logs;

-- -----------------------------------------------------------------------------
-- 1. User account state columns
--    No password material is ever stored here. Supabase Auth owns credentials.
-- -----------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS archive_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

COMMENT ON COLUMN users.must_change_password IS 'True when an administrator set or reset the password. Forces the Set New Password screen at next login.';
COMMENT ON COLUMN users.is_protected IS 'Protected technical accounts cannot be deleted or deactivated by ordinary administration flows.';

CREATE INDEX IF NOT EXISTS idx_users_archived_at_041 ON users(archived_at);
CREATE INDEX IF NOT EXISTS idx_users_is_active_041 ON users(is_active);

-- -----------------------------------------------------------------------------
-- 2. Role classification columns
-- -----------------------------------------------------------------------------

ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_business_role BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_protected BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS workflow_sequence INTEGER;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS deactivation_reason TEXT;

COMMENT ON COLUMN roles.is_business_role IS 'One of the five controlled NJSS workflow roles. Exactly one may be held by a normal staff account.';
COMMENT ON COLUMN roles.is_protected IS 'Controlled role that cannot be renamed away or destructively deleted.';

-- -----------------------------------------------------------------------------
-- 3. New permission: ff4.reconcile
--    RECONCILE is separated from the broad ff4.process permission.
-- -----------------------------------------------------------------------------

INSERT INTO permissions (code, module_code, menu_code, action, label, description, is_active)
VALUES ('ff4.reconcile', 'finance', NULL, 'manage', 'Reconcile FF4 payments',
        'Reconcile paid FF4 records and confirm bank/ledger agreement', true)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  action = EXCLUDED.action,
  is_active = true;

-- -----------------------------------------------------------------------------
-- 4. The five controlled business roles plus the protected administrator
-- -----------------------------------------------------------------------------

INSERT INTO roles (name, description, data_scope_type, is_system_role, is_active, is_business_role, is_protected, workflow_sequence) VALUES
  ('FF Requisition Officer',
   'Creates, edits, deletes drafts and submits FF3 requisitions.',
   'OWN_RECORDS', false, true, true, true, 1),
  ('Line/Section Supervisor',
   'Reviews, endorses or rejects FF3 requisitions for the assigned section or department.',
   'DEPARTMENT_WIDE', false, true, true, true, 2),
  ('Registrar',
   'Finally approves or rejects FF3, and approves or rejects submitted FF4 where required.',
   'DEPARTMENT_WIDE', false, true, true, true, 3),
  ('FF4 Officer',
   'Creates, edits, deletes drafts, verifies and submits FF4 payment requests against approved FF3 commitments.',
   'DEPARTMENT_WIDE', false, true, true, true, 4),
  ('Accounts Reconciliation Officer',
   'Processes authorised FF4 payments, records payment references and reconciles accounts.',
   'DEPARTMENT_WIDE', false, true, true, true, 5)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  data_scope_type = EXCLUDED.data_scope_type,
  is_active = true,
  is_business_role = true,
  is_protected = true,
  workflow_sequence = EXCLUDED.workflow_sequence,
  deactivated_at = NULL,
  deactivation_reason = NULL,
  updated_at = NOW();

UPDATE roles
SET is_system_role = true,
    is_protected = true,
    is_business_role = false,
    is_active = true,
    data_scope_type = 'SYSTEM_WIDE',
    description = 'Protected technical administration account. Not a business workflow role and must not process FF3 or FF4 transactions.',
    workflow_sequence = NULL,
    deactivated_at = NULL,
    deactivation_reason = NULL,
    updated_at = NOW()
WHERE name = 'System Administrator';

INSERT INTO role_data_scopes (role_id, scope_type)
SELECT id, COALESCE(data_scope_type, 'OWN_RECORDS')
FROM roles
WHERE is_business_role = true OR is_protected = true
ON CONFLICT (role_id, scope_type) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Controlled starting permissions for each business role
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION njss_set_role_permissions(p_role_name TEXT, p_permissions TEXT[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role_id UUID;
BEGIN
  SELECT id INTO v_role_id FROM roles WHERE name = p_role_name;
  IF v_role_id IS NULL THEN
    RAISE NOTICE 'Role % not found; skipping permission seed.', p_role_name;
    RETURN;
  END IF;

  DELETE FROM role_permissions WHERE role_id = v_role_id AND permission <> ALL(p_permissions);

  INSERT INTO role_permissions (role_id, permission, is_allowed)
  SELECT v_role_id, perm, true
  FROM unnest(p_permissions) perm
  WHERE EXISTS (SELECT 1 FROM permissions p WHERE p.code = perm)
  ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;
END;
$$;

SELECT njss_set_role_permissions('FF Requisition Officer', ARRAY[
  'dashboard.view','ff3.view','ff3.create','ff3.edit','ff3.delete','ff3.submit','ff3.print'
]);

SELECT njss_set_role_permissions('Line/Section Supervisor', ARRAY[
  'dashboard.view','ff3.view','ff3.endorse','ff3.reject','ff3.print'
]);

SELECT njss_set_role_permissions('Registrar', ARRAY[
  'dashboard.view','ff3.view','ff3.approve','ff3.reject','ff3.print',
  'ff4.view','ff4.approve','ff4.reject'
]);

SELECT njss_set_role_permissions('FF4 Officer', ARRAY[
  'dashboard.view','ff3.view','ff4.view','ff4.create','ff4.edit','ff4.delete',
  'ff4.submit','ff4.verify','ff4.print'
]);

SELECT njss_set_role_permissions('Accounts Reconciliation Officer', ARRAY[
  'dashboard.view','ff4.view','ff4.process','ff4.reconcile','ff4.export',
  'reports.view','reports.export'
]);

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, 'all', true FROM roles r WHERE r.name = 'System Administrator'
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

-- -----------------------------------------------------------------------------
-- 6. Map existing users onto the controlled roles, then retire legacy roles.
--    Least privilege: anything without a clear workflow equivalent becomes
--    FF Requisition Officer and is flagged in audit for administrator review.
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS role_migration_map_041 (
  legacy_role_name TEXT PRIMARY KEY,
  target_role_name TEXT NOT NULL,
  is_exact_match BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO role_migration_map_041 (legacy_role_name, target_role_name, is_exact_match) VALUES
  ('Requisition Officer',     'FF Requisition Officer',          true),
  ('Section Head',            'Line/Section Supervisor',         true),
  ('Section Manager',         'Line/Section Supervisor',         true),
  ('Approver',                'Registrar',                       true),
  ('Department Head',         'Registrar',                       true),
  ('Divisional Manager',      'Registrar',                       true),
  ('Finance Officer',         'FF4 Officer',                     true),
  ('Finance Manager',         'FF4 Officer',                     true),
  ('Administrator',           'System Administrator',            true),
  ('Auditor',                 'FF Requisition Officer',          false),
  ('Executive Management',    'FF Requisition Officer',          false),
  ('Executive Viewer',        'FF Requisition Officer',          false),
  ('Budget Officer',          'FF Requisition Officer',          false),
  ('Budget Manager',          'Registrar',                       false),
  ('HR Officer',              'FF Requisition Officer',          false),
  ('HR Manager',              'FF Requisition Officer',          false),
  ('Payroll Officer',         'FF Requisition Officer',          false),
  ('Payroll Manager',         'FF Requisition Officer',          false),
  ('Procurement Officer',     'FF Requisition Officer',          false),
  ('Asset Officer',           'FF Requisition Officer',          false)
ON CONFLICT (legacy_role_name) DO UPDATE SET
  target_role_name = EXCLUDED.target_role_name,
  is_exact_match = EXCLUDED.is_exact_match;

DO $$
DECLARE
  v_row RECORD;
  v_assigned BOOLEAN;
BEGIN
  -- Ordered by workflow_sequence so an account holding several legacy roles
  -- deterministically lands on the least-privileged equivalent.
  FOR v_row IN
    SELECT DISTINCT
      u.id                        AS user_id,
      u.email,
      u.full_name,
      r.name                      AS legacy_role_name,
      m.target_role_name,
      m.is_exact_match,
      tr.id                       AS target_role_id,
      COALESCE(tr.workflow_sequence, 0) AS target_sequence
    FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    JOIN role_migration_map_041 m ON m.legacy_role_name = r.name
    LEFT JOIN roles tr ON tr.name = m.target_role_name
    WHERE r.is_business_role = false
      AND r.name <> 'System Administrator'
    ORDER BY 1, 8, 4
  LOOP
    CONTINUE WHEN v_row.target_role_id IS NULL;

    -- Only assign when the account does not already hold a controlled role.
    SELECT NOT EXISTS (
      SELECT 1 FROM user_roles ur2
      JOIN roles r2 ON r2.id = ur2.role_id
      WHERE ur2.user_id = v_row.user_id
        AND (r2.is_business_role = true OR r2.name = 'System Administrator')
    ) INTO v_assigned;

    IF v_assigned THEN
      IF v_row.target_role_name = 'System Administrator' THEN
        UPDATE users SET is_protected = true WHERE id = v_row.user_id;
      END IF;

      INSERT INTO user_roles (user_id, role_id)
      VALUES (v_row.user_id, v_row.target_role_id)
      ON CONFLICT (user_id, role_id) DO NOTHING;
    END IF;

    PERFORM log_audit_event(
      NULL::UUID, v_row.email, v_row.full_name,
      'USER_ROLE_MIGRATED', 'USER', v_row.user_id, v_row.email,
      JSONB_BUILD_OBJECT('role', v_row.legacy_role_name),
      JSONB_BUILD_OBJECT('role', v_row.target_role_name),
      JSONB_BUILD_OBJECT(
        'from_role', v_row.legacy_role_name,
        'to_role', v_row.target_role_name,
        'exact_equivalent', v_row.is_exact_match,
        'role_assigned', v_assigned,
        'requires_administrator_review', NOT v_row.is_exact_match
      ),
      JSONB_BUILD_OBJECT('migration', '041_user_administration_and_access_control')
    );
  END LOOP;
END $$;

-- Remove legacy (non-controlled) role assignments now that mapping is complete.
DELETE FROM user_roles ur
USING roles r
WHERE r.id = ur.role_id
  AND r.is_business_role = false
  AND r.is_protected = false;

-- Retire every legacy generic role. Rows are kept so historic audit references resolve.
UPDATE roles
SET is_active = false,
    deactivated_at = NOW(),
    deactivation_reason = 'Superseded by the five controlled NJSS business workflow roles (migration 041).',
    updated_at = NOW()
WHERE is_business_role = false
  AND is_protected = false
  AND is_active = true;

-- Users left with no role at all fall back to the least-privileged business role.
INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
CROSS JOIN roles r
WHERE r.name = 'FF Requisition Officer'
  AND u.is_active = true
  AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)
ON CONFLICT (user_id, role_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 7. Segregation of duties: exactly one workflow role per normal account
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION njss_enforce_single_workflow_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_business BOOLEAN;
  v_is_admin BOOLEAN;
  v_other_business INTEGER;
  v_other_admin INTEGER;
BEGIN
  SELECT COALESCE(is_business_role, false), (name = 'System Administrator')
  INTO v_is_business, v_is_admin
  FROM roles WHERE id = NEW.role_id;

  IF v_is_business IS NULL THEN
    RAISE EXCEPTION 'Unknown role assignment.';
  END IF;

  IF NOT v_is_business AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Only the five controlled business roles or System Administrator can be assigned.';
  END IF;

  SELECT COUNT(*) INTO v_other_business
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = NEW.user_id
    AND r.is_business_role = true
    AND ur.id IS DISTINCT FROM NEW.id;

  SELECT COUNT(*) INTO v_other_admin
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = NEW.user_id
    AND r.name = 'System Administrator'
    AND ur.id IS DISTINCT FROM NEW.id;

  IF v_is_business AND v_other_business > 0 THEN
    RAISE EXCEPTION 'Segregation of duties: a staff account may hold only one workflow role at a time.';
  END IF;

  IF v_is_business AND v_other_admin > 0 THEN
    RAISE EXCEPTION 'Segregation of duties: the System Administrator account must not hold a business workflow role.';
  END IF;

  IF v_is_admin AND v_other_business > 0 THEN
    RAISE EXCEPTION 'Segregation of duties: System Administrator is technical only and cannot be combined with a workflow role.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_roles_single_workflow_role
  BEFORE INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION njss_enforce_single_workflow_role();

-- -----------------------------------------------------------------------------
-- 8. Protected roles cannot be renamed, deactivated or deleted
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION njss_protect_controlled_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF COALESCE(OLD.is_protected, false) THEN
      RAISE EXCEPTION 'Controlled role "%" cannot be deleted.', OLD.name;
    END IF;
    RETURN OLD;
  END IF;

  IF COALESCE(OLD.is_protected, false) THEN
    IF NEW.name IS DISTINCT FROM OLD.name THEN
      RAISE EXCEPTION 'Controlled role "%" cannot be renamed.', OLD.name;
    END IF;
    IF NEW.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Controlled role "%" cannot be deactivated.', OLD.name;
    END IF;
    IF NEW.is_protected IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Controlled role "%" cannot lose protected status.', OLD.name;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_roles_protect_controlled
  BEFORE UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION njss_protect_controlled_roles();

-- Block creation of arbitrary new business roles from the application layer.
CREATE OR REPLACE FUNCTION njss_block_new_business_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(NEW.is_business_role, false) OR COALESCE(NEW.is_protected, false) THEN
    RAISE EXCEPTION 'New controlled business roles cannot be created. The five NJSS workflow roles are fixed.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_roles_block_new_business
  BEFORE INSERT ON roles
  FOR EACH ROW EXECUTE FUNCTION njss_block_new_business_roles();

-- -----------------------------------------------------------------------------
-- 9. Absolute segregation of duties on FF3 / FF4
--    The 'all' permission no longer bypasses self-action checks.
-- -----------------------------------------------------------------------------

UPDATE segregation_rules
SET allow_same_user = false,
    bypass_permission = NULL,
    is_active = true
WHERE entity_type IN ('FF3', 'FF4');

CREATE OR REPLACE FUNCTION njss_assert_not_self_action(
  p_entity_type TEXT,
  p_action TEXT,
  p_actor UUID,
  p_participants UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'Unable to identify the acting user for % %.', p_entity_type, p_action;
  END IF;

  IF p_actor = ANY(COALESCE(p_participants, ARRAY[]::UUID[])) THEN
    RAISE EXCEPTION
      'Segregation of duties: you cannot % a % you raised or already actioned.',
      LOWER(p_action), p_entity_type;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION njss_assert_not_self_action(TEXT, TEXT, UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION njss_assert_not_self_action(TEXT, TEXT, UUID, UUID[]) TO authenticated;

-- -----------------------------------------------------------------------------
-- 10. History detection for safe deletion
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION njss_user_activity_summary(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB := '{}'::JSONB;
  v_count BIGINT;
  v_total BIGINT := 0;
BEGIN
  SELECT COUNT(*) INTO v_count FROM ff3_headers
   WHERE created_by = p_user_id OR requesting_officer_id = p_user_id;
  v_result := v_result || JSONB_BUILD_OBJECT('ff3_requisitions', v_count);
  v_total := v_total + v_count;

  SELECT COUNT(*) INTO v_count FROM ff4_headers WHERE created_by = p_user_id;
  v_result := v_result || JSONB_BUILD_OBJECT('ff4_payments', v_count);
  v_total := v_total + v_count;

  IF to_regclass('public.ff3_approvals') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*) FROM ff3_approvals WHERE approver_id = $1' INTO v_count USING p_user_id;
    v_result := v_result || JSONB_BUILD_OBJECT('ff3_approvals', v_count);
    v_total := v_total + v_count;
  END IF;

  IF to_regclass('public.ff4_approvals') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*) FROM ff4_approvals WHERE approver_id = $1' INTO v_count USING p_user_id;
    v_result := v_result || JSONB_BUILD_OBJECT('ff4_approvals', v_count);
    v_total := v_total + v_count;
  END IF;

  IF to_regclass('public.payment_transactions') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*) FROM payment_transactions WHERE created_by = $1 OR reconciled_by = $1'
      INTO v_count USING p_user_id;
    v_result := v_result || JSONB_BUILD_OBJECT('payment_transactions', v_count);
    v_total := v_total + v_count;
  END IF;

  IF to_regclass('public.commitment_transactions') IS NOT NULL THEN
    EXECUTE 'SELECT COUNT(*) FROM commitment_transactions WHERE created_by = $1 OR approved_by = $1'
      INTO v_count USING p_user_id;
    v_result := v_result || JSONB_BUILD_OBJECT('commitment_transactions', v_count);
    v_total := v_total + v_count;
  END IF;

  SELECT COUNT(*) INTO v_count FROM audit_logs WHERE user_id = p_user_id;
  v_result := v_result || JSONB_BUILD_OBJECT('audit_events', v_count);
  v_total := v_total + v_count;

  RETURN v_result || JSONB_BUILD_OBJECT('total', v_total, 'can_hard_delete', v_total = 0);
END;
$$;

REVOKE ALL ON FUNCTION njss_user_activity_summary(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION njss_user_activity_summary(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION njss_active_system_administrator_count()
RETURNS INTEGER
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COUNT(*)::INTEGER
  FROM users u
  JOIN user_roles ur ON ur.user_id = u.id
  JOIN roles r ON r.id = ur.role_id
  WHERE r.name = 'System Administrator'
    AND u.is_active = true
    AND u.archived_at IS NULL;
$$;

REVOKE ALL ON FUNCTION njss_active_system_administrator_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION njss_active_system_administrator_count() TO authenticated, service_role;

-- Database-level backstop: never allow the final active administrator to be
-- deactivated, archived or deleted, whatever the calling layer does.
CREATE OR REPLACE FUNCTION njss_guard_last_administrator()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_remaining INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = OLD.id AND r.name = 'System Administrator'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(NEW.is_active, false) AND NEW.archived_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_remaining
  FROM users u
  JOIN user_roles ur ON ur.user_id = u.id
  JOIN roles r ON r.id = ur.role_id
  WHERE r.name = 'System Administrator'
    AND u.is_active = true
    AND u.archived_at IS NULL
    AND u.id <> OLD.id;

  IF v_remaining < 1 THEN
    RAISE EXCEPTION 'The final active System Administrator cannot be deactivated, archived or deleted.';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER trg_users_guard_last_administrator
  BEFORE UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION njss_guard_last_administrator();

-- -----------------------------------------------------------------------------
-- 11. FF4 workflow: RECONCILE requires ff4.reconcile, plus hard self-action bans
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION njss_ff4_guard_action(p_ff4_id UUID, p_action TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := fn_current_app_user_id();
  v_ff4 ff4_headers%ROWTYPE;
BEGIN
  p_action := UPPER(COALESCE(p_action, ''));

  PERFORM njss_require_permission(CASE
    WHEN p_action = 'SUBMIT'    THEN 'ff4.submit'
    WHEN p_action = 'VERIFY'    THEN 'ff4.verify'
    WHEN p_action = 'APPROVE'   THEN 'ff4.approve'
    WHEN p_action = 'PROCESS'   THEN 'ff4.process'
    WHEN p_action = 'MARK_PAID' THEN 'ff4.process'
    WHEN p_action = 'RECONCILE' THEN 'ff4.reconcile'
    WHEN p_action = 'CANCEL'    THEN 'ff4.reject'
    ELSE 'ff4.view'
  END);

  SELECT * INTO v_ff4 FROM ff4_headers WHERE id = p_ff4_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_action IN ('VERIFY','APPROVE','PROCESS','MARK_PAID','RECONCILE') THEN
    PERFORM njss_assert_not_self_action('FF4', p_action, v_actor, ARRAY[v_ff4.created_by]);
  END IF;

  IF p_action IN ('APPROVE','PROCESS','MARK_PAID') THEN
    PERFORM njss_assert_not_self_action('FF4', p_action, v_actor, ARRAY[v_ff4.verified_by]);
  END IF;

  IF p_action = 'RECONCILE' THEN
    PERFORM njss_assert_not_self_action('FF4', p_action, v_actor,
      ARRAY[v_ff4.created_by, v_ff4.approved_by]);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION njss_ff4_guard_action(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION njss_ff4_guard_action(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION njss_ff3_guard_action(p_ff3_id UUID, p_action TEXT)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := fn_current_app_user_id();
  v_ff3 ff3_headers%ROWTYPE;
BEGIN
  p_action := UPPER(COALESCE(p_action, ''));

  SELECT * INTO v_ff3 FROM ff3_headers WHERE id = p_ff3_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_action IN ('ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD','APPROVE') THEN
    PERFORM njss_assert_not_self_action('FF3', p_action, v_actor,
      ARRAY[v_ff3.created_by, v_ff3.requesting_officer_id]);
  END IF;

  IF p_action = 'APPROVE' THEN
    PERFORM njss_assert_not_self_action('FF3', p_action, v_actor,
      ARRAY[v_ff3.supervisor_endorsed_by, v_ff3.section_head_endorsed_by]);
  END IF;

  IF p_action = 'ENDORSE_SECTION_HEAD' THEN
    PERFORM njss_assert_not_self_action('FF3', p_action, v_actor,
      ARRAY[v_ff3.supervisor_endorsed_by]);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION njss_ff3_guard_action(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION njss_ff3_guard_action(UUID, TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 12. Administration writes must go through protected server APIs.
--     Browser sessions keep read access only.
-- -----------------------------------------------------------------------------

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;

-- Drop every existing write-capable policy on the access-control tables so no
-- permissive policy can OR its way past the deny rules created below.
DO $$
DECLARE
  v_table TEXT;
  v_policy RECORD;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'users', 'user_roles', 'roles', 'role_permissions', 'user_permissions',
    'role_data_scopes', 'user_data_scopes', 'modules', 'menu_items', 'permissions'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      CONTINUE;
    END IF;

    FOR v_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = v_table
        AND cmd <> 'SELECT'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_policy.policyname, v_table);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR INSERT WITH CHECK (false)',
      v_table || '_deny_client_insert_041', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR UPDATE USING (false) WITH CHECK (false)',
      v_table || '_deny_client_update_041', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE USING (false)',
      v_table || '_deny_client_delete_041', v_table);
  END LOOP;
END $$;

-- Administrators still need to read the full user register.
DROP POLICY IF EXISTS users_select_self_or_admin_phase6 ON users;
DROP POLICY IF EXISTS users_select_self_or_admin_041 ON users;
CREATE POLICY users_select_self_or_admin_041 ON users
  FOR SELECT USING (
    auth.role() = 'authenticated'
    AND (
      id = fn_current_app_user_id()
      OR auth_user_id = auth.uid()
      OR email = auth.email()
      OR (SELECT fn_current_user_has_permission('users.manage'))
      OR (SELECT fn_current_user_has_permission('all'))
    )
  );

DROP POLICY IF EXISTS roles_select_all_authenticated_041 ON roles;
CREATE POLICY roles_select_all_authenticated_041 ON roles
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS user_roles_select_admin_041 ON user_roles;
CREATE POLICY user_roles_select_admin_041 ON user_roles
  FOR SELECT USING (
    user_id = fn_current_app_user_id()
    OR (SELECT fn_current_user_has_permission('users.manage'))
    OR (SELECT fn_current_user_has_permission('all'))
  );

-- Writes are performed by the server-side administration API using the
-- service role, which bypasses RLS after the caller has been authorised.
GRANT SELECT ON users, user_roles, roles, role_permissions, user_permissions,
  role_data_scopes, user_data_scopes, modules, menu_items, permissions TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON users, user_roles, roles, role_permissions,
  user_permissions, role_data_scopes, user_data_scopes, modules, menu_items, permissions
  FROM authenticated, anon;

-- -----------------------------------------------------------------------------
-- 13. Access Audit stays immutable and append-only
-- -----------------------------------------------------------------------------

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_no_update ON audit_logs;
DROP POLICY IF EXISTS audit_logs_no_delete ON audit_logs;
CREATE POLICY audit_logs_no_update ON audit_logs FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY audit_logs_no_delete ON audit_logs FOR DELETE USING (false);

REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM authenticated, anon;
GRANT SELECT, INSERT ON audit_logs TO authenticated;

-- Even the service role must not rewrite audit evidence.
CREATE OR REPLACE FUNCTION njss_audit_logs_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $func$
BEGIN
  RAISE EXCEPTION
    'Access Audit records are immutable evidence and cannot be %.',
    CASE TG_OP
      WHEN 'UPDATE' THEN 'updated'
      WHEN 'DELETE' THEN 'deleted'
      WHEN 'TRUNCATE' THEN 'truncated'
      ELSE LOWER(TG_OP)
    END
  USING HINT = 'Append a correcting entry instead. Existing evidence is never rewritten.';
END;
$func$;

CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION njss_audit_logs_immutable();

-- -----------------------------------------------------------------------------
-- 14. Administration reporting view (no credential material of any kind)
-- -----------------------------------------------------------------------------

DROP VIEW IF EXISTS v_user_administration;
CREATE VIEW v_user_administration AS
SELECT
  u.id,
  u.email,
  u.full_name,
  u.employee_id,
  u.phone,
  u.position,
  u.department_id,
  d.name  AS department_name,
  u.section_id,
  s.name  AS section_name,
  u.is_active,
  u.is_protected,
  u.must_change_password,
  u.auth_user_id IS NOT NULL AS has_auth_account,
  u.password_set_at,
  u.password_changed_at,
  u.last_login_at,
  u.invited_at,
  u.archived_at,
  u.archive_reason,
  u.created_at,
  r.id    AS role_id,
  r.name  AS role_name,
  r.is_business_role,
  r.is_protected AS role_is_protected,
  r.data_scope_type
FROM users u
LEFT JOIN departments d ON d.id = u.department_id
LEFT JOIN sections s    ON s.id = u.section_id
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r       ON r.id = ur.role_id;

ALTER VIEW v_user_administration SET (security_invoker = true);
GRANT SELECT ON v_user_administration TO authenticated;

-- -----------------------------------------------------------------------------
-- 15. Protect every technical administration account
--     njss_guard_last_administrator already blocks removal of the final active
--     administrator; this additionally marks all administrator accounts so the
--     user-administration UI and API refuse destructive actions against them.
-- -----------------------------------------------------------------------------

UPDATE users u
SET is_protected = true,
    updated_at = NOW()
WHERE EXISTS (
  SELECT 1
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = u.id
    AND r.name = 'System Administrator'
)
AND u.is_protected = false;

DO $$
DECLARE
  v_admins INTEGER;
  v_business_roles INTEGER;
  v_unassigned INTEGER;
BEGIN
  SELECT njss_active_system_administrator_count() INTO v_admins;
  SELECT COUNT(*) INTO v_business_roles FROM roles WHERE is_business_role = true AND is_active = true;
  SELECT COUNT(*) INTO v_unassigned FROM users u
   WHERE u.is_active = true
     AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id);

  IF v_admins < 1 THEN
    RAISE EXCEPTION 'Migration aborted: no active System Administrator would remain.';
  END IF;
  IF v_business_roles <> 5 THEN
    RAISE EXCEPTION 'Migration aborted: expected exactly 5 active business roles, found %.', v_business_roles;
  END IF;

  RAISE NOTICE 'NJSS 041 complete. Active administrators: %, business roles: %, users without a role: %.',
    v_admins, v_business_roles, v_unassigned;
END $$;

DROP FUNCTION IF EXISTS njss_set_role_permissions(TEXT, TEXT[]);
