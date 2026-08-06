-- NJSS Budget Template Workflow RPC Unification
-- Removes overloaded transition_divisional_budget_submission signatures so Supabase RPC resolves unambiguously.

DROP FUNCTION IF EXISTS transition_divisional_budget_submission(UUID, VARCHAR, TEXT, VARCHAR);
DROP FUNCTION IF EXISTS transition_divisional_budget_submission(UUID, TEXT, TEXT, TEXT);

CREATE FUNCTION transition_divisional_budget_submission(
    p_submission_id UUID,
    p_action TEXT,
    p_comments TEXT DEFAULT NULL,
    p_user_email TEXT DEFAULT NULL
) RETURNS divisional_budget_submissions AS $$
DECLARE
    v_old divisional_budget_submissions;
    v_new_status VARCHAR(40);
    v_line_count INTEGER;
    v_out divisional_budget_submissions;
BEGIN
    SELECT * INTO v_old FROM divisional_budget_submissions WHERE id = p_submission_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Budget submission not found';
    END IF;

    SELECT COUNT(*) INTO v_line_count FROM divisional_budget_lines WHERE submission_id = p_submission_id;

    v_new_status := CASE UPPER(p_action)
        WHEN 'SUBMIT' THEN 'SUBMITTED'
        WHEN 'RESUBMIT' THEN 'RESUBMITTED'
        WHEN 'RETURN' THEN 'RETURNED'
        WHEN 'REVIEW' THEN 'REVIEWED'
        WHEN 'APPROVE' THEN 'APPROVED'
        WHEN 'REJECT' THEN 'REJECTED'
        WHEN 'ARCHIVE' THEN 'ARCHIVED'
        ELSE NULL
    END;

    IF v_new_status IS NULL THEN
        RAISE EXCEPTION 'Unsupported budget workflow action: %', p_action;
    END IF;

    IF UPPER(p_action) IN ('SUBMIT', 'RESUBMIT') THEN
        IF v_line_count = 0 THEN
            RAISE EXCEPTION 'Add at least one budget line before submission';
        END IF;
        PERFORM recalc_divisional_budget_submission_totals(p_submission_id);
        SELECT * INTO v_old FROM divisional_budget_submissions WHERE id = p_submission_id FOR UPDATE;
        IF ABS(COALESCE(v_old.unallocated_variance, 0)) > 0.009 THEN
            RAISE EXCEPTION 'Monthly allocations must equal annual estimates before submission';
        END IF;
    END IF;

    -- Existing NJSS guard triggers require this transaction-local flag for status changes.
    PERFORM set_config('njss.budget_workflow', 'on', true);

    UPDATE divisional_budget_submissions
    SET status = v_new_status,
        validation_status = CASE WHEN ABS(COALESCE(unallocated_variance, 0)) <= 0.009 THEN 'VALID' ELSE 'VARIANCE' END,
        is_locked = v_new_status IN ('SUBMITTED', 'RESUBMITTED', 'REVIEWED', 'APPROVED', 'ARCHIVED'),
        submitted_at = CASE WHEN UPPER(p_action) IN ('SUBMIT', 'RESUBMIT') THEN NOW() ELSE submitted_at END,
        reviewed_at = CASE WHEN UPPER(p_action) = 'REVIEW' THEN NOW() ELSE reviewed_at END,
        approved_at = CASE WHEN UPPER(p_action) = 'APPROVE' THEN NOW() ELSE approved_at END,
        rejected_at = CASE WHEN UPPER(p_action) = 'REJECT' THEN NOW() ELSE rejected_at END,
        return_reason = CASE WHEN UPPER(p_action) = 'RETURN' THEN p_comments ELSE return_reason END,
        approval_comments = CASE WHEN UPPER(p_action) IN ('REVIEW', 'APPROVE', 'REJECT') THEN p_comments ELSE approval_comments END,
        updated_at = NOW()
    WHERE id = p_submission_id
    RETURNING * INTO v_out;

    INSERT INTO budget_workflow_history (submission_id, from_status, to_status, action, comments, changed_by_email)
    VALUES (p_submission_id, v_old.status, v_new_status, UPPER(p_action), p_comments, p_user_email);

    PERFORM log_audit_event(NULL, p_user_email, COALESCE(p_user_email, 'System'), UPPER(p_action), 'BUDGET_SUBMISSION', p_submission_id, v_out.submission_number,
        jsonb_build_object('status', v_old.status), jsonb_build_object('status', v_new_status),
        jsonb_build_object('old_status', v_old.status, 'new_status', v_new_status), NULL);

    RETURN v_out;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION transition_divisional_budget_submission(UUID, TEXT, TEXT, TEXT) TO anon, authenticated;
