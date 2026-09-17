-- =============================================================================
-- NJSS PHASE 3 — FF3 BLOCKED MANAGERIAL WORKFLOW
-- Allows insufficient-budget FF3s to continue through managerial review while
-- preserving a hard database barrier against financial commitment until the
-- authoritative budget position is sufficient.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.njss_transition_ff3(
  p_ff3_id uuid,
  p_action text,
  p_comments text DEFAULT NULL,
  p_user_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_ff3 public.ff3_headers%ROWTYPE;
  v_old public.ff3_headers%ROWTYPE;
  v_budget public.budget_allocations%ROWTYPE;
  v_actor uuid := public.fn_current_app_user_id();
  v_next_status text;
  v_commitment public.ff3_commitments%ROWTYPE;
  v_position_before jsonb;
  v_position_after jsonb;
  v_budget_state jsonb;
  v_budget_source text;
  v_budget_control_status text;
  v_budget_allocation_id uuid;
  v_serialization_id uuid;
  v_request numeric;
  v_commitment_count integer;
  v_active_simplified boolean := false;
BEGIN
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

  SELECT * INTO v_ff3
  FROM public.ff3_headers
  WHERE id = p_ff3_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FF3 not found'; END IF;

  v_old := v_ff3;
  v_request := COALESCE(v_ff3.total_estimated_amount, 0);
  IF v_request <= 0 THEN RAISE EXCEPTION 'FF3 amount must be greater than zero.'; END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.annual_budget_cycles c
    WHERE c.financial_year = v_ff3.financial_year
      AND c.status = 'ACTIVE'
  ) INTO v_active_simplified;

  IF p_action = 'SUBMIT' THEN
    IF v_ff3.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Only DRAFT FF3 can be submitted. Current status: %', v_ff3.status;
    END IF;

    v_budget_state := public.njss_refresh_ff3_budget_state(p_ff3_id);
    v_budget_control_status := COALESCE(v_budget_state->>'budget_control_status', 'UNASSESSED');

    IF v_budget_control_status = 'MAPPING_REQUIRED' THEN
      RAISE EXCEPTION 'FF3 budget key could not be resolved: %', COALESCE(v_budget_state->>'mapping_status', 'MAPPING_REQUIRED');
    END IF;

    -- Insufficient budget is intentionally not a workflow hard-stop. The
    -- persisted budget_control_status carries the block into management review.
    v_next_status := 'SUBMITTED';

  ELSIF p_action = 'ENDORSE_SUPERVISOR' THEN
    IF v_ff3.status <> 'SUBMITTED' THEN
      RAISE EXCEPTION 'Only SUBMITTED FF3 can receive supervisor endorsement. Current status: %', v_ff3.status;
    END IF;

    v_budget_state := public.njss_refresh_ff3_budget_state(p_ff3_id);
    IF COALESCE(v_budget_state->>'budget_control_status', 'UNASSESSED') = 'MAPPING_REQUIRED' THEN
      RAISE EXCEPTION 'FF3 budget key could not be resolved: %', COALESCE(v_budget_state->>'mapping_status', 'MAPPING_REQUIRED');
    END IF;
    v_next_status := 'ENDORSED_SUPERVISOR';

  ELSIF p_action = 'ENDORSE_SECTION_HEAD' THEN
    IF v_ff3.status <> 'ENDORSED_SUPERVISOR' THEN
      RAISE EXCEPTION 'Only supervisor-endorsed FF3 can receive section-head endorsement. Current status: %', v_ff3.status;
    END IF;

    v_budget_state := public.njss_refresh_ff3_budget_state(p_ff3_id);
    IF COALESCE(v_budget_state->>'budget_control_status', 'UNASSESSED') = 'MAPPING_REQUIRED' THEN
      RAISE EXCEPTION 'FF3 budget key could not be resolved: %', COALESCE(v_budget_state->>'mapping_status', 'MAPPING_REQUIRED');
    END IF;
    v_next_status := 'ENDORSED_SECTION_HEAD';

  ELSIF p_action = 'REJECT' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN
      RAISE EXCEPTION 'Only pending FF3 can be rejected. Current status: %', v_ff3.status;
    END IF;
    IF COALESCE(TRIM(p_comments), '') = '' THEN RAISE EXCEPTION 'Rejection reason is required.'; END IF;
    v_next_status := 'REJECTED';

  ELSIF p_action = 'RETURN' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN
      RAISE EXCEPTION 'Only pending FF3 can be returned. Current status: %', v_ff3.status;
    END IF;
    IF COALESCE(TRIM(p_comments), '') = '' THEN RAISE EXCEPTION 'Return reason is required.'; END IF;
    v_next_status := 'RETURNED';

  ELSIF p_action = 'CANCEL' THEN
    IF v_ff3.status NOT IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD') THEN
      RAISE EXCEPTION 'Use commitment cancellation after approval. Current FF3 status: %', v_ff3.status;
    END IF;
    IF COALESCE(TRIM(p_comments), '') = '' THEN RAISE EXCEPTION 'Cancellation reason is required.'; END IF;
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

    -- Serialize competing approvals on the actual ceiling authority.
    IF v_active_simplified THEN
      SELECT id INTO v_serialization_id
      FROM public.division_budgets db
      WHERE db.financial_year = v_ff3.financial_year
        AND db.division_id = v_ff3.department_id
        AND db.status = 'LOCKED'
        AND EXISTS (
          SELECT 1 FROM public.annual_budget_cycles c
          WHERE c.id = db.annual_budget_cycle_id
            AND c.status = 'ACTIVE'
        )
      FOR UPDATE;

      IF v_serialization_id IS NULL THEN
        RAISE EXCEPTION 'Active locked Division budget could not be resolved for FF3 approval.';
      END IF;
    ELSE
      -- Preserve the existing legacy commitment route and lock it before the
      -- final availability refresh so concurrent approvals cannot overdraw it.
      IF v_ff3.budget_allocation_id IS NULL THEN
        v_ff3.budget_allocation_id := public.njss_resolve_ff3_budget_allocation(p_ff3_id);
      END IF;

      SELECT * INTO v_budget
      FROM public.budget_allocations
      WHERE id = v_ff3.budget_allocation_id
        AND is_active = true
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Approved budget allocation not found'; END IF;
    END IF;

    -- This refresh happens after the serialization lock and is the authoritative
    -- final check immediately before any commitment can be created.
    v_budget_state := public.njss_refresh_ff3_budget_state(p_ff3_id);
    v_budget_source := COALESCE(v_budget_state->>'budget_control_source', CASE WHEN v_active_simplified THEN 'SIMPLIFIED' ELSE 'LEGACY' END);
    v_budget_control_status := COALESCE(v_budget_state->>'budget_control_status', 'UNASSESSED');
    v_budget_allocation_id := NULLIF(v_budget_state->>'budget_allocation_id', '')::uuid;

    IF v_budget_state->>'budget_control_status' = 'INSUFFICIENT_BUDGET_BLOCKED' THEN
      RAISE EXCEPTION 'FF3 commitment blocked by insufficient budget.';
    END IF;

    IF v_budget_control_status = 'MAPPING_REQUIRED' THEN
      RAISE EXCEPTION 'FF3 commitment blocked because the budget key is unresolved: %', COALESCE(v_budget_state->>'mapping_status', 'MAPPING_REQUIRED');
    END IF;

    IF v_budget_state->>'budget_control_status' <> 'SUFFICIENT' THEN
      RAISE EXCEPTION 'FF3 commitment blocked because the authoritative budget state is not sufficient.';
    END IF;

    -- The simplified budget owns the ceiling, while the existing allocation ID
    -- remains the compatibility route used by commitments and FF4.
    IF v_budget_allocation_id IS NULL
       OR COALESCE(v_budget_state->>'commitment_mapping_status', 'BUDGET_MAPPING_REQUIRED') <> 'RESOLVED' THEN
      RAISE EXCEPTION 'FF3 commitment routing is unresolved. Configure the approved finance posting/allocation mapping before final approval.';
    END IF;

    IF v_budget_source = 'SIMPLIFIED' THEN
      SELECT * INTO v_budget
      FROM public.budget_allocations
      WHERE id = v_budget_allocation_id
        AND is_active = true
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Approved budget allocation not found for commitment routing'; END IF;
    END IF;

    IF v_budget.financial_year <> v_ff3.financial_year THEN
      RAISE EXCEPTION 'FF3 financial year does not match the linked budget allocation.';
    END IF;

    SELECT * INTO v_ff3
    FROM public.ff3_headers
    WHERE id = p_ff3_id;

    v_position_before := CASE
      WHEN v_budget_source = 'SIMPLIFIED' THEN v_budget_state
      ELSE public.njss_budget_position_for_allocation(v_budget.id)
    END;

    UPDATE public.ff3_headers
    SET status = 'APPROVED',
        approved_date = NOW(),
        approved_by = v_actor,
        budget_allocation_id = v_budget.id,
        budget_mapping_status = 'RESOLVED',
        budget_control_status = 'SUFFICIENT',
        is_within_budget = true,
        updated_at = NOW()
    WHERE id = p_ff3_id
    RETURNING * INTO v_ff3;

    INSERT INTO public.ff3_commitments (
      ff3_header_id, budget_allocation_id, financial_year, commitment_date,
      committed_amount, original_committed_amount, current_committed_amount,
      paid_amount, outstanding_amount, status, created_by, approved_by
    ) VALUES (
      v_ff3.id, v_budget.id, v_ff3.financial_year, CURRENT_DATE,
      v_request, v_request, v_request,
      0, v_request, 'ACTIVE', COALESCE(v_ff3.created_by, v_ff3.requesting_officer_id), v_actor
    ) RETURNING * INTO v_commitment;

    INSERT INTO public.commitment_transactions (
      commitment_id, ff3_header_id, budget_allocation_id, transaction_type, amount,
      transaction_date, reason_code, reason, reference, previous_balance, new_balance,
      approved_by, created_by
    ) VALUES (
      v_commitment.id, v_ff3.id, v_budget.id, 'ORIGINAL_COMMITMENT', v_request,
      CURRENT_DATE, 'FF3_APPROVAL', COALESCE(p_comments, 'FF3 final approval and original commitment.'),
      v_ff3.ff3_number, 0, v_request, v_actor, v_actor
    );

    UPDATE public.ff3_headers
    SET status = 'COMMITTED', updated_at = NOW()
    WHERE id = p_ff3_id
    RETURNING * INTO v_ff3;

    v_commitment := public.njss_sync_commitment_balances(v_commitment.id);
    v_position_after := CASE
      WHEN v_budget_source = 'SIMPLIFIED' THEN public.njss_refresh_ff3_budget_state(p_ff3_id)
      ELSE public.njss_budget_position_for_allocation(v_budget.id)
    END;

    INSERT INTO public.ff3_approvals (
      ff3_header_id, approver_id, approval_level, action_taken, comments, action_date
    ) VALUES (
      p_ff3_id, v_actor, p_action, 'APPROVED', p_comments, NOW()
    );

    PERFORM public.log_audit_event(
      v_actor, p_user_email, COALESCE(p_user_email, 'System'),
      'FF3_APPROVED_COMMITMENT_CREATED', 'FF3', p_ff3_id, v_ff3.ff3_number,
      to_jsonb(v_old), to_jsonb(v_ff3),
      jsonb_build_object(
        'old_status', v_old.status,
        'new_status', v_ff3.status,
        'old_amount', v_old.total_estimated_amount,
        'new_amount', v_ff3.total_estimated_amount,
        'budget_control_source', v_budget_source,
        'commitment_id', v_commitment.id,
        'financial_position_before', v_position_before,
        'financial_position_after', v_position_after,
        'reason', p_comments
      ),
      NULL
    );

    PERFORM public.log_audit_event(
      v_actor, p_user_email, COALESCE(p_user_email, 'System'),
      'COMMITMENT_CREATED', 'COMMITMENT', v_commitment.id, v_commitment.commitment_number,
      NULL, to_jsonb(v_commitment),
      jsonb_build_object(
        'transaction_type', 'ORIGINAL_COMMITMENT',
        'amount', v_request,
        'budget_control_source', v_budget_source,
        'financial_position_before', v_position_before,
        'financial_position_after', v_position_after
      ),
      NULL
    );

    RETURN jsonb_build_object(
      'header', to_jsonb(v_ff3),
      'commitment', to_jsonb(v_commitment),
      'budget_state', v_budget_state,
      'financial_position_before', v_position_before,
      'financial_position_after', v_position_after
    );
  END IF;

  UPDATE public.ff3_headers
  SET status = v_next_status,
      submitted_date = CASE WHEN p_action = 'SUBMIT' THEN NOW() ELSE submitted_date END,
      supervisor_endorsed_date = CASE WHEN p_action = 'ENDORSE_SUPERVISOR' THEN NOW() ELSE supervisor_endorsed_date END,
      supervisor_endorsed_by = CASE WHEN p_action = 'ENDORSE_SUPERVISOR' THEN v_actor ELSE supervisor_endorsed_by END,
      section_head_endorsed_date = CASE WHEN p_action = 'ENDORSE_SECTION_HEAD' THEN NOW() ELSE section_head_endorsed_date END,
      section_head_endorsed_by = CASE WHEN p_action = 'ENDORSE_SECTION_HEAD' THEN v_actor ELSE section_head_endorsed_by END,
      rejection_reason = CASE WHEN p_action = 'REJECT' THEN p_comments ELSE rejection_reason END,
      returned_reason = CASE WHEN p_action = 'RETURN' THEN p_comments ELSE returned_reason END,
      cancellation_reason = CASE WHEN p_action = 'CANCEL' THEN p_comments ELSE cancellation_reason END,
      cancelled_by = CASE WHEN p_action = 'CANCEL' THEN v_actor ELSE cancelled_by END,
      cancelled_at = CASE WHEN p_action = 'CANCEL' THEN NOW() ELSE cancelled_at END,
      updated_at = NOW()
  WHERE id = p_ff3_id
  RETURNING * INTO v_ff3;

  INSERT INTO public.ff3_approvals (
    ff3_header_id, approver_id, approval_level, action_taken, comments, action_date
  ) VALUES (
    p_ff3_id,
    v_actor,
    p_action,
    CASE WHEN p_action IN ('REJECT','CANCEL','RETURN') THEN v_next_status ELSE 'ENDORSED' END,
    p_comments,
    NOW()
  );

  PERFORM public.log_audit_event(
    v_actor, p_user_email, COALESCE(p_user_email, 'System'),
    'FF3_' || p_action, 'FF3', p_ff3_id, v_ff3.ff3_number,
    to_jsonb(v_old), to_jsonb(v_ff3),
    jsonb_build_object(
      'old_status', v_old.status,
      'new_status', v_next_status,
      'budget_control_status', v_ff3.budget_control_status,
      'budget_control_source', v_ff3.budget_control_source,
      'budget_shortfall_amount', v_ff3.budget_shortfall_amount,
      'reason', p_comments
    ),
    NULL
  );

  RETURN jsonb_build_object(
    'header', to_jsonb(v_ff3),
    'commitment', NULL,
    'budget_state', CASE
      WHEN p_action IN ('SUBMIT','ENDORSE_SUPERVISOR','ENDORSE_SECTION_HEAD') THEN v_budget_state
      ELSE NULL
    END,
    'financial_position_after', CASE
      WHEN v_ff3.budget_allocation_id IS NOT NULL THEN public.njss_budget_position_for_allocation(v_ff3.budget_allocation_id)
      ELSE NULL
    END
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_transition_ff3(uuid, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.njss_transition_ff3(uuid, text, text, text)
  TO authenticated;
