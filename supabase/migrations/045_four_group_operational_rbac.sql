-- =============================================================================
-- NJSS 045 — FOUR-GROUP OPERATIONAL RBAC
-- Additive migration. Preserves historic FF3/FF4/payment/audit records.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_roles_block_new_business ON roles;
DROP TRIGGER IF EXISTS trg_roles_protect_controlled ON roles;
DROP TRIGGER IF EXISTS trg_roles_four_group_scope ON roles;
DROP TRIGGER IF EXISTS trg_user_roles_single_workflow_role ON user_roles;

-- -----------------------------------------------------------------------------
-- 1. Add SECTION_WIDE to role/user data-scope check constraints.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_constraint RECORD;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'role_data_scopes'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%scope_type%'
  LOOP
    EXECUTE format('ALTER TABLE role_data_scopes DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;

  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'user_data_scopes'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%scope_type%'
  LOOP
    EXECUTE format('ALTER TABLE user_data_scopes DROP CONSTRAINT %I', v_constraint.conname);
  END LOOP;
END $$;

ALTER TABLE role_data_scopes
  ADD CONSTRAINT role_data_scopes_scope_type_check
  CHECK (scope_type IN ('OWN_RECORDS', 'SECTION_WIDE', 'OWN_DIVISION', 'OWN_BRANCH', 'OWN_PROVINCE', 'DEPARTMENT_WIDE', 'SYSTEM_WIDE'));

ALTER TABLE user_data_scopes
  ADD CONSTRAINT user_data_scopes_scope_type_check
  CHECK (scope_type IN ('OWN_RECORDS', 'SECTION_WIDE', 'OWN_DIVISION', 'OWN_BRANCH', 'OWN_PROVINCE', 'DEPARTMENT_WIDE', 'SYSTEM_WIDE'));

-- -----------------------------------------------------------------------------
-- 2. Ensure every permission required by the approved four-group model exists.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_missing TEXT[];
BEGIN
  SELECT array_agg(required_permission ORDER BY required_permission)
  INTO v_missing
  FROM unnest(ARRAY[
    'dashboard.view',
    'ff3.view','ff3.create','ff3.edit','ff3.delete','ff3.submit','ff3.endorse','ff3.approve','ff3.reject','ff3.print','ff3.export',
    'ff4.view','ff4.create','ff4.edit','ff4.submit','ff4.verify','ff4.process','ff4.reconcile','ff4.print','ff4.export',
    'supplier.view','supplier.create','commitment.view',
    'reports.view','reports.export',
    'budget.view','budget.template','budget.template.view','budget.template.create','budget.template.edit','budget.template.submit','budget.template.review','budget.template.approve',
    'budget.report.view','budget.report.export',
    'audit.view','audit.export',
    'all'
  ]::TEXT[]) AS required_permission
  WHERE NOT EXISTS (
    SELECT 1 FROM permissions p WHERE p.code = required_permission
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 045 cannot continue. Missing RBAC permissions: %', array_to_string(v_missing, ', ');
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 3. Define the four controlled business groups plus protected administrator.
-- -----------------------------------------------------------------------------
INSERT INTO roles (
  name, description, data_scope_type, is_system_role, is_active,
  is_business_role, is_protected, workflow_sequence
) VALUES
  ('Requisition Officer',
   'Creates and manages FF3 requisitions, creates suppliers, and views authorised activity and reports for the assigned section.',
   'SECTION_WIDE', false, true, true, true, 1),
  ('Line Supervisor',
   'Prepares and submits section budgets, endorses or returns FF3 requisitions, creates suppliers, and views authorised section reports.',
   'SECTION_WIDE', false, true, true, true, 2),
  ('Registrar',
   'Organisation-wide business approver for submitted budgets and endorsed FF3 requisitions, with unrestricted business reporting visibility.',
   'SYSTEM_WIDE', false, true, true, true, 3),
  ('Payment/Reconciliation Officer',
   'Organisation-wide payment officer responsible for FF4 preparation, payment processing, payment recording and reconciliation.',
   'SYSTEM_WIDE', false, true, true, true, 4)
ON CONFLICT (name) DO UPDATE SET
  description = EXCLUDED.description,
  data_scope_type = EXCLUDED.data_scope_type,
  is_system_role = false,
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
    description = 'Protected technical administration account with full system access. It is not a business workflow group.',
    workflow_sequence = NULL,
    deactivated_at = NULL,
    deactivation_reason = NULL,
    updated_at = NOW()
WHERE name = 'System Administrator';

COMMENT ON COLUMN roles.is_business_role IS 'One of the four controlled NJSS business workflow groups. Exactly one may be held by a normal staff account.';

-- -----------------------------------------------------------------------------
-- 4. Automatic permission bundles.
-- -----------------------------------------------------------------------------
SELECT njss_set_role_permissions('Requisition Officer', ARRAY[
  'dashboard.view',
  'ff3.view','ff3.create','ff3.edit','ff3.delete','ff3.submit','ff3.print','ff3.export',
  'supplier.view','supplier.create',
  'reports.view','reports.export',
  'budget.view','budget.report.view',
  'commitment.view'
]);

SELECT njss_set_role_permissions('Line Supervisor', ARRAY[
  'dashboard.view',
  'budget.template','budget.template.view','budget.template.create','budget.template.edit','budget.template.submit',
  'budget.view','budget.report.view','budget.report.export',
  'ff3.view','ff3.endorse','ff3.reject','ff3.print','ff3.export',
  'supplier.view','supplier.create',
  'commitment.view',
  'reports.view','reports.export'
]);

SELECT njss_set_role_permissions('Registrar', ARRAY[
  'dashboard.view',
  'budget.template','budget.template.view','budget.template.review','budget.template.approve',
  'budget.view','budget.report.view','budget.report.export',
  'ff3.view','ff3.approve','ff3.reject','ff3.print','ff3.export',
  'commitment.view',
  'ff4.view',
  'supplier.view',
  'reports.view','reports.export',
  'audit.view','audit.export'
]);

SELECT njss_set_role_permissions('Payment/Reconciliation Officer', ARRAY[
  'dashboard.view',
  'ff3.view',
  'commitment.view',
  'ff4.view','ff4.create','ff4.edit','ff4.submit','ff4.verify','ff4.process','ff4.reconcile','ff4.print','ff4.export',
  'supplier.view',
  'reports.view','reports.export',
  'budget.view','budget.report.view'
]);

DELETE FROM role_permissions
WHERE role_id = (SELECT id FROM roles WHERE name = 'System Administrator')
  AND permission <> 'all';

INSERT INTO role_permissions (role_id, permission, is_allowed)
SELECT r.id, 'all', true
FROM roles r
WHERE r.name = 'System Administrator'
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

-- -----------------------------------------------------------------------------
-- 5. Replace role scopes; group + user section becomes authoritative.
-- -----------------------------------------------------------------------------
DELETE FROM role_data_scopes
WHERE role_id IN (
  SELECT id FROM roles
  WHERE name IN (
    'Requisition Officer','Line Supervisor','Registrar',
    'Payment/Reconciliation Officer','System Administrator'
  )
);

INSERT INTO role_data_scopes (role_id, scope_type)
SELECT id, data_scope_type
FROM roles
WHERE name IN (
  'Requisition Officer','Line Supervisor','Registrar',
  'Payment/Reconciliation Officer','System Administrator'
)
ON CONFLICT (role_id, scope_type) DO NOTHING;

DELETE FROM user_data_scopes uds
USING user_roles ur, roles r
WHERE uds.user_id = ur.user_id
  AND ur.role_id = r.id
  AND r.name IN ('Requisition Officer','Line Supervisor','Registrar','Payment/Reconciliation Officer');

-- -----------------------------------------------------------------------------
-- 6. Migrate the old five-role assignments into the approved four-group model.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_migration_map_045 (
  legacy_role_name TEXT PRIMARY KEY,
  target_role_name TEXT NOT NULL,
  migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO role_migration_map_045 (legacy_role_name, target_role_name) VALUES
  ('FF Requisition Officer', 'Requisition Officer'),
  ('Line/Section Supervisor', 'Line Supervisor'),
  ('FF4 Officer', 'Payment/Reconciliation Officer'),
  ('Accounts Reconciliation Officer', 'Payment/Reconciliation Officer')
ON CONFLICT (legacy_role_name) DO UPDATE SET
  target_role_name = EXCLUDED.target_role_name,
  migrated_at = NOW();

DO $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT ur.user_id,
           u.email,
           u.full_name,
           old_role.name AS legacy_role_name,
           target_role.name AS target_role_name,
           target_role.id AS target_role_id
    FROM user_roles ur
    JOIN users u ON u.id = ur.user_id
    JOIN roles old_role ON old_role.id = ur.role_id
    JOIN role_migration_map_045 m ON m.legacy_role_name = old_role.name
    JOIN roles target_role ON target_role.name = m.target_role_name
  LOOP
    INSERT INTO user_roles (user_id, role_id)
    VALUES (v_row.user_id, v_row.target_role_id)
    ON CONFLICT (user_id, role_id) DO NOTHING;

    PERFORM log_audit_event(
      NULL::UUID, v_row.email, v_row.full_name,
      'USER_ROLE_MIGRATED', 'USER', v_row.user_id, v_row.email,
      JSONB_BUILD_OBJECT('role', v_row.legacy_role_name),
      JSONB_BUILD_OBJECT('role', v_row.target_role_name),
      JSONB_BUILD_OBJECT(
        'from_role', v_row.legacy_role_name,
        'to_role', v_row.target_role_name,
        'migration', '045_four_group_operational_rbac'
      ),
      JSONB_BUILD_OBJECT('migration', '045_four_group_operational_rbac')
    );
  END LOOP;
END $$;

DELETE FROM user_roles ur
USING roles r
WHERE ur.role_id = r.id
  AND r.name IN ('FF Requisition Officer','Line/Section Supervisor','FF4 Officer','Accounts Reconciliation Officer');

DELETE FROM user_data_scopes uds
USING user_roles ur, roles r
WHERE uds.user_id = ur.user_id
  AND ur.role_id = r.id
  AND r.name IN ('Requisition Officer','Line Supervisor','Registrar','Payment/Reconciliation Officer');

DELETE FROM role_data_scopes
WHERE role_id IN (
  SELECT id FROM roles
  WHERE name IN ('FF Requisition Officer','Line/Section Supervisor','FF4 Officer','Accounts Reconciliation Officer')
);

UPDATE roles
SET is_active = false,
    is_business_role = false,
    is_protected = false,
    is_system_role = false,
    workflow_sequence = NULL,
    deactivated_at = NOW(),
    deactivation_reason = 'Superseded by the four controlled NJSS business groups in migration 045.',
    updated_at = NOW()
WHERE name IN ('FF Requisition Officer','Line/Section Supervisor','FF4 Officer','Accounts Reconciliation Officer');

INSERT INTO user_roles (user_id, role_id)
SELECT u.id, r.id
FROM users u
CROSS JOIN roles r
WHERE r.name = 'Requisition Officer'
  AND u.is_active = true
  AND u.is_protected = false
  AND u.section_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id)
ON CONFLICT (user_id, role_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 7. Reinstate single-group segregation of duties with updated wording.
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
    RAISE EXCEPTION 'Only the four controlled business groups or System Administrator can be assigned.';
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
    RAISE EXCEPTION 'Segregation of duties: a staff account may hold only one workflow group at a time.';
  END IF;

  IF v_is_business AND v_other_admin > 0 THEN
    RAISE EXCEPTION 'Segregation of duties: System Administrator cannot be combined with a business workflow group.';
  END IF;

  IF v_is_admin AND v_other_business > 0 THEN
    RAISE EXCEPTION 'Segregation of duties: System Administrator is technical only and cannot be combined with a business workflow group.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_roles_single_workflow_role
  BEFORE INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION njss_enforce_single_workflow_role();

-- -----------------------------------------------------------------------------
-- 8. Keep controlled scopes fixed.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION njss_enforce_four_group_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expected_scope TEXT;
BEGIN
  v_expected_scope := CASE NEW.name
    WHEN 'Requisition Officer' THEN 'SECTION_WIDE'
    WHEN 'Line Supervisor' THEN 'SECTION_WIDE'
    WHEN 'Registrar' THEN 'SYSTEM_WIDE'
    WHEN 'Payment/Reconciliation Officer' THEN 'SYSTEM_WIDE'
    WHEN 'System Administrator' THEN 'SYSTEM_WIDE'
    ELSE NULL
  END;

  IF v_expected_scope IS NOT NULL AND NEW.data_scope_type IS DISTINCT FROM v_expected_scope THEN
    RAISE EXCEPTION 'Controlled group "%" must use data scope %.', NEW.name, v_expected_scope;
  END IF;

  IF NEW.name IN ('Requisition Officer','Line Supervisor','Registrar','Payment/Reconciliation Officer') THEN
    IF NOT COALESCE(NEW.is_business_role, false)
       OR NOT COALESCE(NEW.is_protected, false)
       OR NOT COALESCE(NEW.is_active, false) THEN
      RAISE EXCEPTION 'Controlled business group "%" must remain active and protected.', NEW.name;
    END IF;
  END IF;

  IF NEW.name = 'System Administrator' THEN
    IF COALESCE(NEW.is_business_role, false)
       OR NOT COALESCE(NEW.is_system_role, false)
       OR NOT COALESCE(NEW.is_protected, false)
       OR NOT COALESCE(NEW.is_active, false) THEN
      RAISE EXCEPTION 'System Administrator must remain active, protected and technical-only.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_roles_four_group_scope
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE FUNCTION njss_enforce_four_group_scope();

CREATE TRIGGER trg_roles_protect_controlled
  BEFORE UPDATE OR DELETE ON roles
  FOR EACH ROW EXECUTE FUNCTION njss_protect_controlled_roles();

CREATE OR REPLACE FUNCTION njss_block_new_business_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(NEW.is_business_role, false) OR COALESCE(NEW.is_protected, false) THEN
    RAISE EXCEPTION 'New controlled business groups cannot be created. The four NJSS workflow groups are fixed.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_roles_block_new_business
  BEFORE INSERT ON roles
  FOR EACH ROW EXECUTE FUNCTION njss_block_new_business_roles();
