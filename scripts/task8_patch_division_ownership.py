from pathlib import Path

p = Path('supabase/migrations/055_budget_revision_workspace_notifications.sql')
s = p.read_text()

marker = "REVOKE ALL ON FUNCTION public.njss_create_budget_revision_notification(UUID,TEXT,UUID,TEXT,TEXT,TEXT) FROM PUBLIC, authenticated;\n\n-- -----------------------------------------------------------------------------\n-- 4. Eligible Line Supervisors for one selected division/section.\n-- -----------------------------------------------------------------------------"
insert = '''REVOKE ALL ON FUNCTION public.njss_create_budget_revision_notification(UUID,TEXT,UUID,TEXT,TEXT,TEXT) FROM PUBLIC, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Resolve the organisational owner of a budget division and protect assigned
--    Line Supervisor access. Current NJSS approved budgets are often division-
--    level records with section_id NULL, so matching falls back to the active
--    organisational department with the same code (for example HR -> HR).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_budget_revision_supervisor_matches(
  p_division_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_matches BOOLEAN := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM budget_divisions bd
    JOIN users u ON u.id = p_user_id AND u.is_active = true
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
                 AND r.name = 'Line Supervisor'
                 AND r.is_active = true
    LEFT JOIN departments d ON d.is_active = true AND d.code = bd.code
    WHERE bd.id = p_division_id
      AND (
        (bd.section_id IS NOT NULL AND u.section_id = bd.section_id)
        OR (
          bd.section_id IS NULL
          AND u.department_id = COALESCE(d.id, bd.department_id)
        )
      )
  ) INTO v_matches;
  RETURN COALESCE(v_matches, false);
END;
$$;
REVOKE ALL ON FUNCTION public.njss_budget_revision_supervisor_matches(UUID,UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.njss_budget_revision_supervisor_matches(UUID,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.njss_budget_revision_assigned_access(p_revision_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := fn_current_app_user_id();
  v_allowed BOOLEAN := false;
BEGIN
  IF v_user_id IS NULL THEN RETURN false; END IF;
  SELECT EXISTS (
    SELECT 1
    FROM budget_revisions br
    WHERE br.id = p_revision_id
      AND br.assigned_line_supervisor_id = v_user_id
      AND public.njss_budget_revision_supervisor_matches(br.division_id, v_user_id)
      AND (
        COALESCE(fn_current_user_has_permission('budget.revision.view'), false)
        OR COALESCE(fn_current_user_has_permission('budget.revision.edit'), false)
        OR COALESCE(fn_current_user_has_permission('budget.revision.submit'), false)
        OR COALESCE(fn_current_user_has_permission('budget.revision.report'), false)
      )
  ) INTO v_allowed;
  RETURN COALESCE(v_allowed, false);
END;
$$;
REVOKE ALL ON FUNCTION public.njss_budget_revision_assigned_access(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.njss_budget_revision_assigned_access(UUID) TO authenticated;

DROP POLICY IF EXISTS budget_revisions_select_assigned_supervisor ON budget_revisions;
CREATE POLICY budget_revisions_select_assigned_supervisor ON budget_revisions
FOR SELECT TO authenticated
USING (public.njss_budget_revision_assigned_access(id));

DROP POLICY IF EXISTS budget_revision_lines_select_assigned_supervisor ON budget_revision_lines;
CREATE POLICY budget_revision_lines_select_assigned_supervisor ON budget_revision_lines
FOR SELECT TO authenticated
USING (public.njss_budget_revision_assigned_access(budget_revision_id));

-- -----------------------------------------------------------------------------
-- 5. Eligible Line Supervisors for one selected division/section.
-- -----------------------------------------------------------------------------'''
if marker not in s:
    raise SystemExit('notification helper marker not found')
s = s.replace(marker, insert, 1)

old = "    AND u.section_id = v_division.section_id\n  ORDER BY u.full_name::TEXT NULLS LAST, u.email::TEXT;"
new = "    AND public.njss_budget_revision_supervisor_matches(v_division.id, u.id)\n  ORDER BY u.full_name::TEXT NULLS LAST, u.email::TEXT;"
if old not in s:
    raise SystemExit('eligible supervisor section matcher not found')
s = s.replace(old, new, 1)

old = "  IF v_supervisor.section_id IS DISTINCT FROM v_division.section_id THEN\n    RAISE EXCEPTION 'The selected Line Supervisor does not belong to the budget section being revised.';\n  END IF;"
new = "  IF NOT public.njss_budget_revision_supervisor_matches(v_division.id, v_supervisor.id) THEN\n    RAISE EXCEPTION 'The selected Line Supervisor is not assigned to the organisational unit represented by this budget division.';\n  END IF;"
if old not in s:
    raise SystemExit('request supervisor validation block not found')
s = s.replace(old, new, 1)

old = "  IF NOT fn_current_user_data_scope_allows(v_division.department_id, v_division.section_id, NULL, NULL, NULL) THEN\n    RAISE EXCEPTION 'Budget revision edit is outside the current user organisational scope.';\n  END IF;"
new = "  IF NOT public.njss_budget_revision_supervisor_matches(v_division.id, v_user_id) THEN\n    RAISE EXCEPTION 'Budget revision edit is outside the assigned Line Supervisor organisational unit.';\n  END IF;"
if old not in s:
    raise SystemExit('edit guard scope block not found')
s = s.replace(old, new, 1)

marker = "ALTER FUNCTION public.njss_transition_budget_revision(UUID,TEXT,TEXT,TEXT)\n  RENAME TO njss_transition_budget_revision_workspace_base;\nREVOKE ALL ON FUNCTION public.njss_transition_budget_revision_workspace_base(UUID,TEXT,TEXT,TEXT) FROM PUBLIC, authenticated;"
replacement = marker + '''

CREATE OR REPLACE FUNCTION public.njss_transition_budget_revision_workspace_base(
  p_revision_id UUID,
  p_action TEXT,
  p_comments TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := fn_current_app_user_id();
  v_revision budget_revisions%ROWTYPE;
  v_division budget_divisions%ROWTYPE;
  v_action TEXT := UPPER(COALESCE(p_action, ''));
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authenticated NJSS user profile is required.'; END IF;
  SELECT * INTO v_revision FROM budget_revisions WHERE id = p_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget revision not found.'; END IF;
  SELECT * INTO v_division FROM budget_divisions WHERE id = v_revision.division_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget revision division was not found.'; END IF;

  IF v_action IN ('SUBMIT','RESUBMIT') THEN
    IF NOT public.njss_budget_revision_supervisor_matches(v_revision.division_id, v_user_id) THEN
      RAISE EXCEPTION 'Budget revision is outside the assigned Line Supervisor organisational unit.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = v_user_id AND r.name = 'Line Supervisor' AND r.is_active = true
    ) THEN
      RAISE EXCEPTION 'Only the Line Supervisor can submit a budget revision requested for their organisational unit.';
    END IF;
  ELSIF v_action IN ('APPROVE','RETURN','REJECT') THEN
    IF NOT fn_current_user_data_scope_allows(v_division.department_id, v_division.section_id, NULL, NULL, NULL) THEN
      RAISE EXCEPTION 'Budget revision is outside the current user organisational scope.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
      WHERE ur.user_id = v_user_id AND r.name = 'Registrar' AND r.is_active = true
    ) THEN
      RAISE EXCEPTION 'Only the Registrar can approve, return or reject a budget revision.';
    END IF;
  ELSIF v_action = 'REVIEW' THEN
    RAISE EXCEPTION 'A separate revision review action is not used. The Line Supervisor submits and the Registrar approves, returns or rejects.';
  ELSE
    RAISE EXCEPTION 'Unsupported budget revision action: %', p_action;
  END IF;

  IF v_action = 'APPROVE' AND v_revision.status NOT IN ('SUBMITTED','RESUBMITTED') THEN
    RAISE EXCEPTION 'Registrar approval requires a budget revision submitted by the Line Supervisor.';
  END IF;
  IF v_action = 'RETURN' AND COALESCE(TRIM(p_comments), '') = '' THEN
    RAISE EXCEPTION 'Return comments/reason are required.';
  END IF;
  IF v_action = 'REJECT' AND COALESCE(TRIM(p_comments), '') = '' THEN
    RAISE EXCEPTION 'Rejection comments/reason are required.';
  END IF;

  PERFORM set_config('njss.budget_revision_workflow', 'on', true);
  IF v_action = 'APPROVE' THEN
    PERFORM public.njss_transition_budget_revision_base(p_revision_id, 'REVIEW', 'Registrar final approval review', p_user_email);
    RETURN public.njss_transition_budget_revision_base(p_revision_id, 'APPROVE', p_comments, p_user_email);
  END IF;
  RETURN public.njss_transition_budget_revision_base(p_revision_id, p_action, p_comments, p_user_email);
END;
$$;
REVOKE ALL ON FUNCTION public.njss_transition_budget_revision_workspace_base(UUID,TEXT,TEXT,TEXT) FROM PUBLIC, authenticated;'''
if marker not in s:
    raise SystemExit('workspace base rename marker not found')
s = s.replace(marker, replacement, 1)

old = "  bd.department_id,\n  d.name AS department_name,"
new = "  CASE WHEN bd.section_id IS NULL THEN COALESCE(owner_d.id, bd.department_id) ELSE bd.department_id END AS department_id,\n  d.name AS department_name,"
if old not in s:
    raise SystemExit('work queue department projection not found')
s = s.replace(old, new, 1)

old = "LEFT JOIN departments d ON d.id = bd.department_id\nLEFT JOIN sections s ON s.id = bd.section_id"
new = "LEFT JOIN departments owner_d ON owner_d.is_active = true AND owner_d.code = bd.code\nLEFT JOIN departments d ON d.id = CASE WHEN bd.section_id IS NULL THEN COALESCE(owner_d.id, bd.department_id) ELSE bd.department_id END\nLEFT JOIN sections s ON s.id = bd.section_id"
if old not in s:
    raise SystemExit('work queue department join not found')
s = s.replace(old, new, 1)

old = "  br.division_id, bd.code, bd.name, bd.department_id, d.name, bd.section_id,\n  s.name, br.created_at, br.assigned_at, br.approved_at;"
new = "  br.division_id, bd.code, bd.name, bd.department_id, owner_d.id, d.name, bd.section_id,\n  s.name, br.created_at, br.assigned_at, br.approved_at;"
if old not in s:
    raise SystemExit('work queue group by not found')
s = s.replace(old, new, 1)

p.write_text(s)
