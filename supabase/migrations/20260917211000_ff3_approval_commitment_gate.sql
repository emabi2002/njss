-- =============================================================================
-- NJSS PHASE 3 HARDENING — FINAL APPROVAL IS THE COMMITMENT GATE
-- Keeps managerial review open while blocked, but requires a sufficient exact
-- FY + Division + Section + Ledger position before final APPROVE can commit.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Compatibility allocation resolver.
--    Never repurpose or rewrite a legacy allocation. Reuse only allocations
--    created explicitly as the simplified Head Office accounting bridge.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_resolve_simplified_ff3_allocation(p_ff3_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ff3 public.ff3_headers%ROWTYPE;
  v_mapping public.finance_posting_mappings%ROWTYPE;
  v_specific_count integer := 0;
  v_mapping_count integer := 0;
  v_allocation_id uuid;
  v_actor uuid := public.fn_current_app_user_id();
BEGIN
  SELECT * INTO v_ff3
  FROM public.ff3_headers
  WHERE id = p_ff3_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'FF3 not found'; END IF;
  IF v_ff3.expense_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Simplified FF3 Ledger is required';
  END IF;

  SELECT COUNT(*) INTO v_specific_count
  FROM public.finance_posting_mappings fpm
  WHERE fpm.financial_year = v_ff3.financial_year
    AND fpm.expense_ledger_id = v_ff3.expense_ledger_id
    AND fpm.department_id = v_ff3.department_id
    AND fpm.section_id = v_ff3.section_id
    AND fpm.is_active = true
    AND (v_ff3.cost_centre_id IS NULL OR fpm.cost_centre_id = v_ff3.cost_centre_id);

  IF v_specific_count > 0 THEN
    v_mapping_count := v_specific_count;
    IF v_mapping_count = 1 THEN
      SELECT * INTO v_mapping
      FROM public.finance_posting_mappings fpm
      WHERE fpm.financial_year = v_ff3.financial_year
        AND fpm.expense_ledger_id = v_ff3.expense_ledger_id
        AND fpm.department_id = v_ff3.department_id
        AND fpm.section_id = v_ff3.section_id
        AND fpm.is_active = true
        AND (v_ff3.cost_centre_id IS NULL OR fpm.cost_centre_id = v_ff3.cost_centre_id)
      ORDER BY fpm.created_at DESC, fpm.id
      LIMIT 1;
    END IF;
  ELSE
    SELECT COUNT(*) INTO v_mapping_count
    FROM public.finance_posting_mappings fpm
    WHERE fpm.financial_year IS NULL
      AND fpm.expense_ledger_id = v_ff3.expense_ledger_id
      AND fpm.department_id = v_ff3.department_id
      AND fpm.section_id = v_ff3.section_id
      AND fpm.is_active = true
      AND (v_ff3.cost_centre_id IS NULL OR fpm.cost_centre_id = v_ff3.cost_centre_id);

    IF v_mapping_count = 1 THEN
      SELECT * INTO v_mapping
      FROM public.finance_posting_mappings fpm
      WHERE fpm.financial_year IS NULL
        AND fpm.expense_ledger_id = v_ff3.expense_ledger_id
        AND fpm.department_id = v_ff3.department_id
        AND fpm.section_id = v_ff3.section_id
        AND fpm.is_active = true
        AND (v_ff3.cost_centre_id IS NULL OR fpm.cost_centre_id = v_ff3.cost_centre_id)
      ORDER BY fpm.created_at DESC, fpm.id
      LIMIT 1;
    END IF;
  END IF;

  IF v_mapping_count <> 1 OR v_mapping.id IS NULL THEN
    RAISE EXCEPTION 'A single active finance posting mapping is required before commitment';
  END IF;

  -- Reuse only our own compatibility bridge. A pre-existing legacy allocation
  -- may have the same accounting dimensions but remains historically untouched.
  SELECT ba.id INTO v_allocation_id
  FROM public.budget_allocations ba
  WHERE ba.is_active = true
    AND ba.financial_year = v_ff3.financial_year
    AND ba.department_id = v_ff3.department_id
    AND ba.section_id = v_ff3.section_id
    AND ba.expense_code_registry_id = v_mapping.expense_code_registry_id
    AND ba.account_id = v_mapping.chart_of_account_id
    AND ba.cost_centre_id = v_mapping.cost_centre_id
    AND ba.source_module = 'HEAD_OFFICE_SIMPLIFIED'
  ORDER BY ba.created_at, ba.id
  LIMIT 1
  FOR UPDATE;

  IF v_allocation_id IS NULL THEN
    INSERT INTO public.budget_allocations (
      financial_year, department_id, section_id, account_id,
      original_budget, supplemental_budget, revised_budget, is_active,
      cost_centre_id, expense_code_registry_id, source_module, created_by, updated_at
    ) VALUES (
      v_ff3.financial_year,
      v_ff3.department_id,
      v_ff3.section_id,
      v_mapping.chart_of_account_id,
      0,
      0,
      GREATEST(COALESCE(v_ff3.budget_current_approved_snapshot, 0), 0),
      true,
      v_mapping.cost_centre_id,
      v_mapping.expense_code_registry_id,
      'HEAD_OFFICE_SIMPLIFIED',
      v_actor,
      now()
    )
    RETURNING id INTO v_allocation_id;
  ELSE
    UPDATE public.budget_allocations
    SET revised_budget = GREATEST(COALESCE(v_ff3.budget_current_approved_snapshot, 0), 0),
        updated_at = now()
    WHERE id = v_allocation_id;
  END IF;

  UPDATE public.ff3_headers
  SET budget_allocation_id = v_allocation_id,
      expense_code_registry_id = v_mapping.expense_code_registry_id,
      cost_centre_id = v_mapping.cost_centre_id,
      budget_mapping_status = 'RESOLVED',
      updated_at = now()
  WHERE id = p_ff3_id;

  RETURN v_allocation_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_resolve_simplified_ff3_allocation(uuid)
  FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Final effective FF3 transition.
--    SUBMIT and endorsements continue while budget-blocked. APPROVE is both the
--    final managerial decision and the atomic financial commitment gate.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_transition_ff3(
  p_ff3_id uuid,
  p_action text,
  p_comments text DEFAULT NULL,
  p_user_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ff3 public.ff3_headers%ROWTYPE;
  v_old public.ff3_headers%ROWTYPE;
  v_actor uuid := public.fn_current_app_user_id();
  v_next_status text;
  v_budget_result jsonb;
  v_budget_status text;
  v_commit_result jsonb;
  v_commitment_count integer;
BEGIN
  p_action := upper(COALESCE(p_action, ''));

  SELECT * INTO v_ff3
  FROM public.ff3_headers
  WHERE id = p_ff3_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FF3 not found'; END IF;

  -- Existing pre-Phase-3 rows remain on the deployed legacy workflow.
  IF v_ff3.expense_ledger_id IS NULL THEN
    RETURN public.njss_transition_ff3_legacy(p_ff3_id, p_action, p_comments, p_user_email);
  END IF;

  IF p_action NOT IN ('SUBMIT','ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD','APPROVE','REJECT','CANCEL','RETURN') THEN
    RAISE EXCEPTION 'Invalid FF3 workflow action: %', p_action;
  END IF;

  PERFORM public.njss_require_permission(CASE
    WHEN p_action = 'SUBMIT' THEN 'ff3.submit'
    WHEN p_action IN ('ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD','RETURN') THEN 'ff3.endorse'
    WHEN p_action = 'APPROVE' THEN 'ff3.approve'
    WHEN p_action = 'REJECT' THEN 'ff3.reject'
    WHEN p_action = 'CANCEL' THEN 'ff3.cancel'
  END);

  v_old := v_ff3;
  IF COALESCE(v_ff3.total_estimated_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'FF3 amount must be greater than zero.';
  END IF;

  IF p_action = 'SUBMIT' THEN
    IF v_ff3.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Only DRAFT FF3 can be submitted. Current status: %', v_ff3.status;
    END IF;
    v_next_status := 'SUBMITTED';

  ELSIF p_action = 'ENDORSE_SUPERVISOR' THEN
    IF v_ff3.status <> 'SUBMITTED' THEN
      RAISE EXCEPTION 'Only SUBMITTED FF3 can receive supervisor endorsement. Current status: %', v_ff3.status;
    END IF;
    v_next_status := 'ENDORSED_SUPERVISOR';

  ELSIF p_action = 'ENDORSE_SECTION_HEAD' THEN
    IF v_ff3.status <> 'ENDORSED_SUPERVISOR' THEN
      RAISE EXCEPTION 'Only supervisor-endorsed FF3 can receive section-head endorsement. Current status: %', v_ff3.status;
    END IF;
    v_next_status := 'ENDORSED_SECTION_HEAD';

  ELSIF p_action = 'REJECT' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN
      RAISE EXCEPTION 'Only pending FF3 can be rejected. Current status: %', v_ff3.status;
    END IF;
    IF COALESCE(trim(p_comments), '') = '' THEN RAISE EXCEPTION 'Rejection reason is required.'; END IF;
    v_next_status := 'REJECTED';

  ELSIF p_action = 'RETURN' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN
      RAISE EXCEPTION 'Only pending FF3 can be returned. Current status: %', v_ff3.status;
    END IF;
    IF COALESCE(trim(p_comments), '') = '' THEN RAISE EXCEPTION 'Return reason is required.'; END IF;
    v_next_status := 'RETURNED';

  ELSIF p_action = 'CANCEL' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN
      RAISE EXCEPTION 'Use commitment cancellation after approval. Current FF3 status: %', v_ff3.status;
    END IF;
    IF COALESCE(trim(p_comments), '') = '' THEN RAISE EXCEPTION 'Cancellation reason is required.'; END IF;
    v_next_status := 'CANCELLED';

  ELSIF p_action = 'APPROVE' THEN
    IF v_ff3.status <> 'ENDORSED_SECTION_HEAD' THEN
      RAISE EXCEPTION 'Only section-head-endorsed FF3 can be finally approved. Current status: %', v_ff3.status;
    END IF;

    IF public.fn_check_segregation_of_duties(
      'FF3',
      COALESCE(v_ff3.created_by, v_ff3.requesting_officer_id),
      COALESCE(v_ff3.supervisor_endorsed_by, v_ff3.section_head_endorsed_by),
      NULL,
      v_actor
    ) IS FALSE THEN
      RAISE EXCEPTION 'Segregation of duties prevents the same user from creating/endorsing/approving this FF3.';
    END IF;

    SELECT COUNT(*) INTO v_commitment_count
    FROM public.ff3_commitments
    WHERE ff3_header_id = p_ff3_id
      AND status <> 'CANCELLED';
    IF v_commitment_count > 0 THEN
      RAISE EXCEPTION 'Duplicate original commitment blocked. A commitment already exists for this FF3.';
    END IF;

    -- Serialize all final commitment attempts sharing this active Division budget,
    -- then perform the authoritative balance check while the lock is held.
    PERFORM 1
    FROM public.division_budgets db
    JOIN public.annual_budget_cycles c ON c.id = db.annual_budget_cycle_id
    WHERE c.financial_year = v_ff3.financial_year
      AND c.status = 'ACTIVE'
      AND db.division_id = v_ff3.department_id
      AND db.status = 'LOCKED'
    FOR UPDATE OF db;

    v_budget_result := public.njss_evaluate_ff3_budget(p_ff3_id);
    v_budget_status := COALESCE(v_budget_result->>'status', 'NOT_CHECKED');

    IF v_budget_status <> 'SUFFICIENT' THEN
      IF v_budget_status = 'INSUFFICIENT_BUDGET_BLOCKED' THEN
        RAISE EXCEPTION 'Insufficient approved budget. Managerial review is complete but financial approval cannot proceed until supplementary budget or Registrar-approved reallocation clears the shortfall.';
      ELSIF v_budget_status = 'POSTING_MAPPING_REQUIRED' THEN
        RAISE EXCEPTION 'Budget is available, but Finance must configure one valid posting mapping before final approval can create the commitment.';
      ELSE
        RAISE EXCEPTION 'No active approved Head Office budget exists for this Financial Year / Division / Section / Ledger.';
      END IF;
    END IF;

    UPDATE public.ff3_headers
    SET status = 'APPROVED',
        approved_date = now(),
        approved_by = v_actor,
        updated_at = now()
    WHERE id = p_ff3_id
    RETURNING * INTO v_ff3;

    v_commit_result := public.njss_commit_simplified_ff3(p_ff3_id, p_comments);
    IF NOT COALESCE((v_commit_result->>'committed')::boolean, false) THEN
      RAISE EXCEPTION 'Budget position changed before commitment could be created. Recheck the FF3 budget position and approve again.';
    END IF;

    SELECT * INTO v_ff3 FROM public.ff3_headers WHERE id = p_ff3_id;

    INSERT INTO public.ff3_approvals (
      ff3_header_id, approver_id, approval_level, action_taken, comments, action_date
    ) VALUES (
      p_ff3_id, v_actor, 'APPROVE', 'APPROVED', p_comments, now()
    );

    PERFORM public.log_audit_event(
      v_actor,
      p_user_email,
      COALESCE(p_user_email, 'System'),
      'FF3_APPROVED_COMMITMENT_CREATED',
      'FF3',
      p_ff3_id,
      v_ff3.ff3_number,
      to_jsonb(v_old),
      to_jsonb(v_ff3),
      jsonb_build_object(
        'old_status', v_old.status,
        'new_status', v_ff3.status,
        'budget_control_status', v_ff3.budget_control_status,
        'reason', p_comments
      ),
      jsonb_build_object('phase', 'SIMPLIFIED_HEAD_OFFICE_BUDGET')
    );

    RETURN v_commit_result || jsonb_build_object('managerial_approval_recorded', true);
  END IF;

  UPDATE public.ff3_headers
  SET status = v_next_status,
      submitted_date = CASE WHEN p_action = 'SUBMIT' THEN now() ELSE submitted_date END,
      supervisor_endorsed_date = CASE WHEN p_action = 'ENDORSE_SUPERVISOR' THEN now() ELSE supervisor_endorsed_date END,
      supervisor_endorsed_by = CASE WHEN p_action = 'ENDORSE_SUPERVISOR' THEN v_actor ELSE supervisor_endorsed_by END,
      section_head_endorsed_date = CASE WHEN p_action = 'ENDORSE_SECTION_HEAD' THEN now() ELSE section_head_endorsed_date END,
      section_head_endorsed_by = CASE WHEN p_action = 'ENDORSE_SECTION_HEAD' THEN v_actor ELSE section_head_endorsed_by END,
      rejection_reason = CASE WHEN p_action = 'REJECT' THEN p_comments ELSE rejection_reason END,
      returned_reason = CASE WHEN p_action = 'RETURN' THEN p_comments ELSE returned_reason END,
      cancellation_reason = CASE WHEN p_action = 'CANCEL' THEN p_comments ELSE cancellation_reason END,
      cancelled_by = CASE WHEN p_action = 'CANCEL' THEN v_actor ELSE cancelled_by END,
      cancelled_at = CASE WHEN p_action = 'CANCEL' THEN now() ELSE cancelled_at END,
      updated_at = now()
  WHERE id = p_ff3_id
  RETURNING * INTO v_ff3;

  IF p_action IN ('SUBMIT','ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD') THEN
    v_budget_result := public.njss_evaluate_ff3_budget(p_ff3_id);
    SELECT * INTO v_ff3 FROM public.ff3_headers WHERE id = p_ff3_id;
  ELSE
    v_budget_result := NULL;
  END IF;

  INSERT INTO public.ff3_approvals (
    ff3_header_id, approver_id, approval_level, action_taken, comments, action_date
  ) VALUES (
    p_ff3_id,
    v_actor,
    p_action,
    CASE WHEN p_action IN ('REJECT','CANCEL','RETURN') THEN v_next_status ELSE 'ENDORSED' END,
    p_comments,
    now()
  );

  PERFORM public.log_audit_event(
    v_actor,
    p_user_email,
    COALESCE(p_user_email, 'System'),
    'FF3_' || p_action,
    'FF3',
    p_ff3_id,
    v_ff3.ff3_number,
    to_jsonb(v_old),
    to_jsonb(v_ff3),
    jsonb_build_object(
      'old_status', v_old.status,
      'new_status', v_next_status,
      'budget_control_status', v_ff3.budget_control_status,
      'budget_position', v_budget_result,
      'reason', p_comments
    ),
    jsonb_build_object('phase', 'SIMPLIFIED_HEAD_OFFICE_BUDGET')
  );

  RETURN jsonb_build_object(
    'header', to_jsonb(v_ff3),
    'commitment', NULL,
    'financial_position_after', v_budget_result
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_transition_ff3(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_transition_ff3(uuid, text, text, text)
  TO authenticated;
