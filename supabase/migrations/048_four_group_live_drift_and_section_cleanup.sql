-- =============================================================================
-- NJSS 048 — FOUR-GROUP LIVE DRIFT AND SECTION CLEANUP
-- Idempotent remediation for environments where migration 041 structures were
-- applied without the role-permission helper, plus safe handling of legacy
-- section-scoped users whose section was never populated.
-- =============================================================================

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

  DELETE FROM role_permissions
  WHERE role_id = v_role_id
    AND permission <> ALL(p_permissions);

  INSERT INTO role_permissions (role_id, permission, is_allowed)
  SELECT v_role_id, perm, true
  FROM unnest(p_permissions) perm
  WHERE EXISTS (SELECT 1 FROM permissions p WHERE p.code = perm)
  ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;
END;
$$;

-- Where a user's department has exactly one active section, the section is
-- deterministic and can be backfilled without administrator judgement.
WITH single_section_departments AS (
  SELECT department_id, (array_agg(id))[1] AS section_id
  FROM sections
  WHERE is_active = true
  GROUP BY department_id
  HAVING count(*) = 1
), targets AS (
  SELECT u.id, ssd.section_id
  FROM users u
  JOIN user_roles ur ON ur.user_id = u.id
  JOIN roles r ON r.id = ur.role_id
  JOIN single_section_departments ssd ON ssd.department_id = u.department_id
  WHERE r.name IN ('Requisition Officer', 'Line Supervisor')
    AND u.section_id IS NULL
)
UPDATE users u
SET section_id = t.section_id,
    updated_at = NOW()
FROM targets t
WHERE u.id = t.id;

-- Any remaining section-scoped assignment is ambiguous. Remove the group
-- assignment rather than granting access to the wrong section. The account is
-- preserved and can be assigned after an administrator selects the section.
DO $$
DECLARE
  v_row RECORD;
BEGIN
  FOR v_row IN
    SELECT u.id AS user_id, u.email, u.full_name, r.name AS role_name
    FROM user_roles ur
    JOIN users u ON u.id = ur.user_id
    JOIN roles r ON r.id = ur.role_id
    WHERE r.name IN ('Requisition Officer', 'Line Supervisor')
      AND u.section_id IS NULL
  LOOP
    PERFORM log_audit_event(
      NULL::UUID,
      v_row.email,
      v_row.full_name,
      'USER_ROLE_QUARANTINED',
      'USER',
      v_row.user_id,
      v_row.email,
      jsonb_build_object('role', v_row.role_name),
      jsonb_build_object('role', NULL),
      jsonb_build_object('reason', 'Section assignment required before section-scoped group access'),
      jsonb_build_object('migration', '048_four_group_live_drift_and_section_cleanup')
    );
  END LOOP;
END $$;

DELETE FROM user_roles ur
USING users u, roles r
WHERE ur.user_id = u.id
  AND ur.role_id = r.id
  AND r.name IN ('Requisition Officer', 'Line Supervisor')
  AND u.section_id IS NULL;
