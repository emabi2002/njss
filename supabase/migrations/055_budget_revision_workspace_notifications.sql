-- =============================================================================
-- NJSS 055 — BUDGET REVISION WORKSPACE, ASSIGNMENT AND NOTIFICATIONS
-- Adds the operational front door for the hardened revision engine from 051-054.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Explicit assignment/request metadata.
-- -----------------------------------------------------------------------------
ALTER TABLE budget_revisions
  ADD COLUMN IF NOT EXISTS assigned_line_supervisor_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS request_instruction TEXT,
  ADD COLUMN IF NOT EXISTS requested_change_amount NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;

ALTER TABLE budget_revisions
  DROP CONSTRAINT IF EXISTS chk_budget_revisions_requested_change_amount;
ALTER TABLE budget_revisions
  ADD CONSTRAINT chk_budget_revisions_requested_change_amount
  CHECK (requested_change_amount IS NULL OR requested_change_amount >= 0) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_budget_revisions_assigned_supervisor
  ON budget_revisions(assigned_line_supervisor_id, status);

-- -----------------------------------------------------------------------------
-- 2. Notifications: map NJSS users.id recipients to auth.uid() via auth_user_id.
--    Remove any historical permissive policies before installing the exact rules.
-- -----------------------------------------------------------------------------
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
DROP POLICY IF EXISTS "System can insert notifications" ON notifications;
DROP POLICY IF EXISTS notifications_select_own ON notifications;
DROP POLICY IF EXISTS notifications_update_own ON notifications;

REVOKE INSERT, DELETE ON notifications FROM authenticated;
GRANT SELECT, UPDATE ON notifications TO authenticated;

CREATE POLICY notifications_select_own ON notifications
FOR SELECT TO authenticated
USING (
  user_id IS NULL
  OR EXISTS (
    SELECT 1
    FROM users
    WHERE users.id = notifications.user_id
      AND users.auth_user_id = auth.uid()
      AND users.is_active = true
  )
);

CREATE POLICY notifications_update_own ON notifications
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM users
    WHERE users.id = notifications.user_id
      AND users.auth_user_id = auth.uid()
      AND users.is_active = true
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM users
    WHERE users.id = notifications.user_id
      AND users.auth_user_id = auth.uid()
      AND users.is_active = true
  )
);

CREATE OR REPLACE FUNCTION public.njss_guard_notification_read_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.notification_type IS DISTINCT FROM OLD.notification_type
     OR NEW.title IS DISTINCT FROM OLD.title
     OR NEW.message IS DISTINCT FROM OLD.message
     OR NEW.reference_type IS DISTINCT FROM OLD.reference_type
     OR NEW.reference_id IS DISTINCT FROM OLD.reference_id
     OR NEW.is_email_sent IS DISTINCT FROM OLD.is_email_sent
     OR NEW.priority IS DISTINCT FROM OLD.priority
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Notifications are immutable except for read status.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_read_update_guard ON notifications;
CREATE TRIGGER trg_notifications_read_update_guard
  BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION public.njss_guard_notification_read_update();
REVOKE ALL ON FUNCTION public.njss_guard_notification_read_update() FROM PUBLIC, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Internal, idempotent budget-revision notification helper.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_create_budget_revision_notification(
  p_revision_id UUID,
  p_notification_type TEXT,
  p_recipient_user_id UUID,
  p_title TEXT,
  p_message TEXT,
  p_priority TEXT DEFAULT 'HIGH'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_notification_id UUID;
BEGIN
  IF p_recipient_user_id IS NULL THEN
    RAISE EXCEPTION 'Budget revision notification recipient is required.';
  END IF;

  SELECT n.id INTO v_notification_id
  FROM notifications n
  WHERE n.user_id = p_recipient_user_id
    AND n.notification_type = p_notification_type
    AND n.reference_type = 'BUDGET_REVISION'
    AND n.reference_id = p_revision_id::TEXT
  ORDER BY n.created_at DESC
  LIMIT 1;

  IF v_notification_id IS NOT NULL THEN
    RETURN v_notification_id;
  END IF;

  INSERT INTO notifications (
    user_id, notification_type, title, message, reference_type, reference_id,
    is_read, is_email_sent, priority
  ) VALUES (
    p_recipient_user_id,
    p_notification_type,
    LEFT(COALESCE(p_title, 'Budget Revision'), 200),
    COALESCE(p_message, ''),
    'BUDGET_REVISION',
    p_revision_id::TEXT,
    false,
    false,
    COALESCE(NULLIF(UPPER(p_priority), ''), 'HIGH')
  )
  RETURNING id INTO v_notification_id;

  RETURN v_notification_id;
END;
$$;
REVOKE ALL ON FUNCTION public.njss_create_budget_revision_notification(UUID,TEXT,UUID,TEXT,TEXT,TEXT) FROM PUBLIC, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Eligible Line Supervisors for one selected division/section.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_get_eligible_line_supervisors(p_division_id UUID)
RETURNS TABLE (
  user_id UUID,
  full_name TEXT,
  email TEXT,
  department_id UUID,
  section_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := fn_current_app_user_id();
  v_division budget_divisions%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated NJSS user profile is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_user_id
      AND r.name = 'Registrar'
      AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'Only the Registrar can select a Line Supervisor for a budget revision request.';
  END IF;

  IF NOT COALESCE(fn_current_user_has_permission('budget.revision.create'), false) THEN
    RAISE EXCEPTION 'Permission denied: budget.revision.create is required.';
  END IF;

  SELECT * INTO v_division FROM budget_divisions WHERE id = p_division_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget division not found.';
  END IF;

  IF NOT fn_current_user_data_scope_allows(
    v_division.department_id, v_division.section_id, NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Budget division is outside the current user organisational scope.';
  END IF;

  RETURN QUERY
  SELECT DISTINCT u.id, u.full_name::TEXT, u.email::TEXT, u.department_id, u.section_id
  FROM users u
  JOIN user_roles ur ON ur.user_id = u.id
  JOIN roles r ON r.id = ur.role_id
  WHERE u.is_active = true
    AND r.name = 'Line Supervisor'
    AND r.is_active = true
    AND u.section_id = v_division.section_id
  ORDER BY u.full_name::TEXT NULLS LAST, u.email::TEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.njss_get_eligible_line_supervisors(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.njss_get_eligible_line_supervisors(UUID) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. Registrar request wrapper. Assignment and first notification are atomic.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_create_budget_revision_request(
  p_parent_submission_id UUID,
  p_revision_type TEXT,
  p_reason TEXT,
  p_authority_reference TEXT DEFAULT NULL,
  p_effective_date DATE DEFAULT CURRENT_DATE,
  p_supporting_reference TEXT DEFAULT NULL,
  p_assigned_line_supervisor_id UUID DEFAULT NULL,
  p_request_instruction TEXT DEFAULT NULL,
  p_requested_change_amount NUMERIC DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := fn_current_app_user_id();
  v_parent divisional_budget_submissions%ROWTYPE;
  v_division budget_divisions%ROWTYPE;
  v_supervisor users%ROWTYPE;
  v_payload JSONB;
  v_revision_id UUID;
  v_revision_number TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated NJSS user profile is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_user_id AND r.name = 'Registrar' AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'Only the Registrar can initiate a budget revision or supplementary budget request.';
  END IF;

  IF NOT COALESCE(fn_current_user_has_permission('budget.revision.create'), false) THEN
    RAISE EXCEPTION 'Permission denied: budget.revision.create is required.';
  END IF;

  SELECT * INTO v_parent
  FROM divisional_budget_submissions
  WHERE id = p_parent_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved parent budget submission not found.';
  END IF;
  IF v_parent.status <> 'APPROVED'
     OR v_parent.is_locked IS DISTINCT FROM true
     OR v_parent.superseded_by_id IS NOT NULL THEN
    RAISE EXCEPTION 'Budget change requests require the current approved, locked and unsuperseded budget version.';
  END IF;

  SELECT * INTO v_division FROM budget_divisions WHERE id = v_parent.division_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget division for the approved parent submission was not found.';
  END IF;
  IF NOT fn_current_user_data_scope_allows(v_division.department_id, v_division.section_id, NULL, NULL, NULL) THEN
    RAISE EXCEPTION 'Budget revision request is outside the current user organisational scope.';
  END IF;

  IF p_assigned_line_supervisor_id IS NULL THEN
    RAISE EXCEPTION 'A responsible Line Supervisor must be assigned before requesting a budget change.';
  END IF;

  SELECT * INTO v_supervisor
  FROM users
  WHERE id = p_assigned_line_supervisor_id
    AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected Line Supervisor is not an active NJSS user.';
  END IF;

  IF v_supervisor.section_id IS DISTINCT FROM v_division.section_id THEN
    RAISE EXCEPTION 'The selected Line Supervisor does not belong to the budget section being revised.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_supervisor.id
      AND r.name = 'Line Supervisor'
      AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'The selected user does not have the active Line Supervisor role.';
  END IF;

  IF p_requested_change_amount IS NOT NULL AND p_requested_change_amount < 0 THEN
    RAISE EXCEPTION 'Indicative requested change amount cannot be negative.';
  END IF;

  -- Existing hardened creator remains the authority for approved-parent, scope,
  -- effective-year, lineage and revision-type validation.
  v_payload := public.njss_create_budget_revision(
    p_parent_submission_id,
    p_revision_type,
    p_reason,
    p_authority_reference,
    p_effective_date,
    p_supporting_reference,
    p_user_email
  );

  v_revision_id := (v_payload->>'revision_id')::UUID;
  v_revision_number := v_payload->>'revision_number';

  UPDATE budget_revisions
  SET assigned_line_supervisor_id = v_supervisor.id,
      request_instruction = NULLIF(TRIM(p_request_instruction), ''),
      requested_change_amount = p_requested_change_amount,
      assigned_at = NOW(),
      updated_at = NOW()
  WHERE id = v_revision_id;

  PERFORM public.njss_create_budget_revision_notification(
    v_revision_id,
    'BUDGET_REVISION_REQUESTED',
    v_supervisor.id,
    'Budget Revision Request — ' || COALESCE(v_division.name, v_division.code, 'Section'),
    'Registrar requested ' || REPLACE(UPPER(p_revision_type), '_', ' ') ||
      ' for FY' || v_parent.budget_year || '. ' || COALESCE(NULLIF(TRIM(p_request_instruction), ''), 'Review the section budget and submit the proposed changes.'),
    'HIGH'
  );

  RETURN v_payload || jsonb_build_object(
    'assigned_line_supervisor_id', v_supervisor.id,
    'assigned_line_supervisor_name', v_supervisor.full_name,
    'request_instruction', NULLIF(TRIM(p_request_instruction), ''),
    'requested_change_amount', p_requested_change_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.njss_create_budget_revision_request(UUID,TEXT,TEXT,TEXT,DATE,TEXT,UUID,TEXT,NUMERIC,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.njss_create_budget_revision_request(UUID,TEXT,TEXT,TEXT,DATE,TEXT,UUID,TEXT,NUMERIC,TEXT) TO authenticated;

-- The operational UI/API must use the assigned request wrapper from this point.
REVOKE EXECUTE ON FUNCTION public.njss_create_budget_revision(UUID,TEXT,TEXT,TEXT,DATE,TEXT,TEXT) FROM authenticated;

-- -----------------------------------------------------------------------------
-- 6. Assignment-aware edit guard: only the assigned Line Supervisor can edit.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_assert_budget_revision_editable(p_submission_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id UUID := fn_current_app_user_id();
  v_revision budget_revisions%ROWTYPE;
  v_division budget_divisions%ROWTYPE;
BEGIN
  SELECT * INTO v_revision
  FROM budget_revisions br
  WHERE br.revision_submission_id = p_submission_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_division FROM budget_divisions WHERE id = v_revision.division_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget revision division was not found.'; END IF;

  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authenticated NJSS user profile is required.'; END IF;

  IF COALESCE(current_setting('njss.budget_revision_create', true), '') = 'on'
     OR COALESCE(current_setting('njss.budget_revision_workflow', true), '') = 'on' THEN
    RETURN;
  END IF;

  IF v_revision.assigned_line_supervisor_id IS NULL THEN
    RAISE EXCEPTION 'Budget revision has no assigned Line Supervisor.';
  END IF;
  IF v_revision.assigned_line_supervisor_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'Only the assigned Line Supervisor can prepare or edit this budget revision.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
    WHERE ur.user_id = v_user_id AND r.name = 'Line Supervisor' AND r.is_active = true
  ) THEN
    RAISE EXCEPTION 'Only an active Line Supervisor can prepare or edit a requested budget revision.';
  END IF;

  IF v_revision.status NOT IN ('DRAFT','RETURNED') THEN
    RAISE EXCEPTION 'Budget revision lines can only be edited while the revision is DRAFT or RETURNED. Current status: %.', v_revision.status;
  END IF;

  IF NOT COALESCE(fn_current_user_has_permission('budget.revision.edit'), false) THEN
    RAISE EXCEPTION 'Permission denied: budget.revision.edit is required to modify revision lines.';
  END IF;

  IF NOT fn_current_user_data_scope_allows(v_division.department_id, v_division.section_id, NULL, NULL, NULL) THEN
    RAISE EXCEPTION 'Budget revision edit is outside the current user organisational scope.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.njss_assert_budget_revision_editable(UUID) FROM PUBLIC, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Wrap transitions for assigned submitter + database-side notifications.
-- -----------------------------------------------------------------------------
ALTER FUNCTION public.njss_transition_budget_revision(UUID,TEXT,TEXT,TEXT)
  RENAME TO njss_transition_budget_revision_workspace_base;
REVOKE ALL ON FUNCTION public.njss_transition_budget_revision_workspace_base(UUID,TEXT,TEXT,TEXT) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.njss_transition_budget_revision(
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
  v_action TEXT := UPPER(COALESCE(p_action, ''));
  v_payload JSONB;
  v_recipient UUID;
  v_type TEXT;
  v_title TEXT;
  v_message TEXT;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authenticated NJSS user profile is required.'; END IF;

  SELECT * INTO v_revision FROM budget_revisions WHERE id = p_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget revision not found.'; END IF;

  IF v_action IN ('SUBMIT','RESUBMIT') THEN
    IF v_revision.assigned_line_supervisor_id IS NULL THEN
      RAISE EXCEPTION 'Budget revision has no assigned Line Supervisor.';
    END IF;
    IF v_revision.assigned_line_supervisor_id IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'Only the assigned Line Supervisor can submit this budget revision.';
    END IF;
  END IF;

  v_payload := public.njss_transition_budget_revision_workspace_base(
    p_revision_id, p_action, p_comments, p_user_email
  );

  IF v_action = 'SUBMIT' THEN
    v_recipient := v_revision.requested_by;
    v_type := 'BUDGET_REVISION_SUBMITTED';
    v_title := 'Budget Revision Submitted — ' || v_revision.revision_number;
    v_message := 'The assigned Line Supervisor submitted the requested budget revision for Registrar action.';
  ELSIF v_action = 'RESUBMIT' THEN
    v_recipient := v_revision.requested_by;
    v_type := 'BUDGET_REVISION_RESUBMITTED';
    v_title := 'Budget Revision Resubmitted — ' || v_revision.revision_number;
    v_message := 'The assigned Line Supervisor resubmitted the returned budget revision for Registrar action.';
  ELSIF v_action = 'RETURN' THEN
    v_recipient := v_revision.assigned_line_supervisor_id;
    v_type := 'BUDGET_REVISION_RETURNED';
    v_title := 'Budget Revision Returned — ' || v_revision.revision_number;
    v_message := 'Registrar returned the budget revision for amendment. ' || COALESCE(NULLIF(TRIM(p_comments), ''), 'Review the Registrar comments and resubmit.');
  ELSIF v_action = 'APPROVE' THEN
    v_recipient := v_revision.assigned_line_supervisor_id;
    v_type := 'BUDGET_REVISION_APPROVED';
    v_title := 'Budget Revision Approved — ' || v_revision.revision_number;
    v_message := 'Registrar approved the budget revision. The approved revision is now the current authoritative budget version.';
  ELSIF v_action = 'REJECT' THEN
    v_recipient := v_revision.assigned_line_supervisor_id;
    v_type := 'BUDGET_REVISION_REJECTED';
    v_title := 'Budget Revision Rejected — ' || v_revision.revision_number;
    v_message := 'Registrar rejected the budget revision. ' || COALESCE(NULLIF(TRIM(p_comments), ''), 'See the revision record for details.');
  END IF;

  IF v_type IS NOT NULL AND v_recipient IS NOT NULL THEN
    PERFORM public.njss_create_budget_revision_notification(
      p_revision_id, v_type, v_recipient, v_title, v_message,
      CASE WHEN v_action IN ('RETURN','REJECT') THEN 'HIGH' ELSE 'MEDIUM' END
    );
  END IF;

  RETURN v_payload;
END;
$$;
REVOKE ALL ON FUNCTION public.njss_transition_budget_revision(UUID,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.njss_transition_budget_revision(UUID,TEXT,TEXT,TEXT) TO authenticated;

-- -----------------------------------------------------------------------------
-- 8. Work queue. Underlying revision RLS/data scope remains authoritative.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_budget_revision_work_queue
WITH (security_invoker = true) AS
SELECT
  br.id AS revision_id,
  br.revision_number,
  br.revision_type,
  br.status,
  br.reason,
  br.authority_reference,
  br.supporting_reference,
  br.effective_date,
  br.request_instruction,
  br.requested_change_amount,
  br.requested_by,
  requester.full_name AS requested_by_name,
  requester.email AS requested_by_email,
  br.assigned_line_supervisor_id,
  supervisor.full_name AS assigned_line_supervisor_name,
  supervisor.email AS assigned_line_supervisor_email,
  br.parent_submission_id,
  parent_s.submission_number AS parent_submission_number,
  parent_s.version AS parent_version,
  br.revision_submission_id,
  revision_s.submission_number AS revision_submission_number,
  revision_s.version AS revision_version,
  br.budget_year,
  br.division_id,
  bd.code AS division_code,
  bd.name AS division_name,
  bd.department_id,
  d.name AS department_name,
  bd.section_id,
  s.name AS section_name,
  CASE
    WHEN br.status IN ('DRAFT','RETURNED') THEN 'SUPERVISOR_ACTION'
    WHEN br.status IN ('SUBMITTED','RESUBMITTED') THEN 'REGISTRAR_ACTION'
    ELSE 'COMPLETED'
  END AS queue_state,
  COALESCE(SUM(brl.original_budget), 0)::NUMERIC(15,2) AS original_budget,
  COALESCE(SUM(brl.current_revised_budget), 0)::NUMERIC(15,2) AS current_revised_budget,
  COALESCE(SUM(COALESCE(brl.proposed_revised_budget, brl.current_revised_budget)), 0)::NUMERIC(15,2) AS proposed_revised_budget,
  COALESCE(SUM(COALESCE(brl.actual_expenditure_at_approval, brl.actual_expenditure_at_submission, 0)), 0)::NUMERIC(15,2) AS actual_expenditure,
  COALESCE(SUM(COALESCE(brl.outstanding_commitment_at_approval, brl.outstanding_commitment_at_submission, 0)), 0)::NUMERIC(15,2) AS outstanding_commitment,
  COALESCE(SUM(COALESCE(brl.protected_minimum_at_approval, brl.protected_minimum_at_submission, 0)), 0)::NUMERIC(15,2) AS protected_minimum,
  br.created_at,
  br.assigned_at,
  br.approved_at
FROM budget_revisions br
JOIN budget_divisions bd ON bd.id = br.division_id
LEFT JOIN departments d ON d.id = bd.department_id
LEFT JOIN sections s ON s.id = bd.section_id
LEFT JOIN users requester ON requester.id = br.requested_by
LEFT JOIN users supervisor ON supervisor.id = br.assigned_line_supervisor_id
LEFT JOIN divisional_budget_submissions parent_s ON parent_s.id = br.parent_submission_id
LEFT JOIN divisional_budget_submissions revision_s ON revision_s.id = br.revision_submission_id
LEFT JOIN budget_revision_lines brl ON brl.budget_revision_id = br.id
GROUP BY
  br.id, br.revision_number, br.revision_type, br.status, br.reason,
  br.authority_reference, br.supporting_reference, br.effective_date,
  br.request_instruction, br.requested_change_amount, br.requested_by,
  requester.full_name, requester.email, br.assigned_line_supervisor_id,
  supervisor.full_name, supervisor.email, br.parent_submission_id,
  parent_s.submission_number, parent_s.version, br.revision_submission_id,
  revision_s.submission_number, revision_s.version, br.budget_year,
  br.division_id, bd.code, bd.name, bd.department_id, d.name, bd.section_id,
  s.name, br.created_at, br.assigned_at, br.approved_at;

GRANT SELECT ON public.v_budget_revision_work_queue TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. Runtime navigation: visible to either workflow role according to permission.
-- -----------------------------------------------------------------------------
INSERT INTO menu_items (
  code, module_code, parent_code, label, href, icon, sort_order,
  required_permissions, is_active
) VALUES (
  'budget.revisions', 'budget', NULL, 'Budget Revision & Supplementary Budget',
  '/dashboard/budget/revisions', 'ClipboardList', 23,
  ARRAY[
    'budget.revision.view','budget.revision.create','budget.revision.edit',
    'budget.revision.submit','budget.revision.approve','budget.revision.return',
    'budget.revision.reject','budget.revision.report'
  ], true
)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  parent_code = EXCLUDED.parent_code,
  label = EXCLUDED.label,
  href = EXCLUDED.href,
  icon = EXCLUDED.icon,
  sort_order = EXCLUDED.sort_order,
  required_permissions = EXCLUDED.required_permissions,
  is_active = true,
  updated_at = NOW();

DO $$
BEGIN
  IF to_regprocedure('public.njss_backup_refresh_change_triggers()') IS NOT NULL THEN
    PERFORM public.njss_backup_refresh_change_triggers();
  END IF;
END $$;

COMMIT;
