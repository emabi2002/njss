-- =============================================================================
-- NJSS 047 — FOUR-GROUP MEMBERSHIP GUARDS
-- Enforces organisational prerequisites independently of the browser/API.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_user_roles_require_group_section ON user_roles;
DROP TRIGGER IF EXISTS trg_users_keep_section_for_scoped_group ON users;

CREATE OR REPLACE FUNCTION njss_require_section_for_scoped_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role_name TEXT;
  v_section_id UUID;
BEGIN
  SELECT name INTO v_role_name
  FROM roles
  WHERE id = NEW.role_id;

  IF v_role_name IN ('Requisition Officer', 'Line Supervisor') THEN
    SELECT section_id INTO v_section_id
    FROM users
    WHERE id = NEW.user_id;

    IF v_section_id IS NULL THEN
      RAISE EXCEPTION '% must be assigned to a section before the group can be assigned.', v_role_name;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_roles_require_group_section
  BEFORE INSERT OR UPDATE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION njss_require_section_for_scoped_group();

CREATE OR REPLACE FUNCTION njss_keep_section_for_scoped_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role_name TEXT;
BEGIN
  IF NEW.section_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT r.name INTO v_role_name
  FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = NEW.id
    AND r.is_active = true
    AND r.name IN ('Requisition Officer', 'Line Supervisor')
  LIMIT 1;

  IF v_role_name IS NOT NULL THEN
    RAISE EXCEPTION '% must be assigned to a section while that group remains active.', v_role_name;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_keep_section_for_scoped_group
  BEFORE UPDATE OF section_id ON users
  FOR EACH ROW EXECUTE FUNCTION njss_keep_section_for_scoped_group();
