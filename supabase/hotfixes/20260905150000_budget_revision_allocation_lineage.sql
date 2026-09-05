-- =============================================================================
-- NJSS — BUDGET REVISION OPERATIONAL ALLOCATION LINEAGE
--
-- Additive correction for the already-applied revision workflow. Do not rewrite
-- historical migrations 052/054/055. Existing operational allocations begin as
-- activated EXCEL_BUDGET baselines. Once an approved revision repoints an
-- allocation to the revision submission/line, its lineage must also become
-- BUDGET_REVISION; otherwise the operational-allocation guard interprets the
-- revision line as an activation baseline and rejects Registrar approval.
-- =============================================================================

DO $lineage_preflight$
DECLARE
  v_guard text;
  v_worker text;
BEGIN
  v_guard := pg_get_functiondef('public.njss_guard_operational_allocation_org()'::regprocedure);
  v_worker := pg_get_functiondef('public.njss_transition_budget_revision_base(uuid,text,text,text)'::regprocedure);

  IF position('OLD.source_module=''EXCEL_BUDGET''' in v_guard) = 0
     OR position('NEW.source_module IS DISTINCT FROM ''EXCEL_BUDGET''' in v_guard) = 0 THEN
    RAISE EXCEPTION 'Budget allocation guard lineage contract has drifted; review before applying revision lineage hotfix.';
  END IF;

  IF position('source_budget_submission_id=v_revision.revision_submission_id' in v_worker) = 0
     OR position('source_budget_line_id=v_line.revision_budget_line_id' in v_worker) = 0
     OR position('source_module=''BUDGET_REVISION''' in v_worker) > 0 THEN
    RAISE EXCEPTION 'Revision transition worker is not in the expected pre-hotfix lineage state.';
  END IF;
END
$lineage_preflight$;

CREATE OR REPLACE FUNCTION public.njss_transition_budget_revision_base(
  p_revision_id uuid,
  p_action text,
  p_comments text DEFAULT NULL::text,
  p_user_email text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_revision budget_revisions;
  v_submission divisional_budget_submissions;
  v_parent divisional_budget_submissions;
  v_division budget_divisions;
  v_user_id UUID := fn_current_app_user_id();
  v_actor_email TEXT;
  v_action TEXT := UPPER(COALESCE(p_action,''));
  v_permission TEXT;
  v_new_status TEXT;
  v_line RECORD;
  v_allocation budget_allocations;
  v_account_id UUID;
  v_cost_centre_id UUID;
  v_expense_code_id UUID;
  v_monthly JSONB;
  v_q1 NUMERIC(15,2); v_q2 NUMERIC(15,2); v_q3 NUMERIC(15,2); v_q4 NUMERIC(15,2);
  v_before JSONB := '{}'::jsonb; v_after JSONB := '{}'::jsonb;
BEGIN
  SELECT email INTO v_actor_email FROM users WHERE id=v_user_id;
  v_actor_email := COALESCE(v_actor_email,p_user_email);

  v_permission := CASE v_action
    WHEN 'SUBMIT' THEN 'budget.revision.submit' WHEN 'RESUBMIT' THEN 'budget.revision.submit'
    WHEN 'REVIEW' THEN 'budget.revision.review' WHEN 'RETURN' THEN 'budget.revision.return'
    WHEN 'REJECT' THEN 'budget.revision.reject' WHEN 'APPROVE' THEN 'budget.revision.approve' END;
  IF v_permission IS NULL THEN RAISE EXCEPTION 'Unsupported budget revision action: %',p_action; END IF;
  IF NOT (COALESCE(fn_current_user_has_permission(v_permission),false) OR COALESCE(fn_current_user_has_permission('all'),false)) THEN
    RAISE EXCEPTION 'Permission denied: % is required.',v_permission;
  END IF;

  SELECT * INTO v_revision FROM budget_revisions WHERE id=p_revision_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget revision not found.'; END IF;
  SELECT * INTO v_submission FROM divisional_budget_submissions WHERE id=v_revision.revision_submission_id FOR UPDATE;
  SELECT * INTO v_parent FROM divisional_budget_submissions WHERE id=v_revision.parent_submission_id FOR UPDATE;
  SELECT * INTO v_division FROM budget_divisions WHERE id=v_revision.division_id;
  IF NOT fn_current_user_data_scope_allows(v_division.department_id,v_division.section_id,v_revision.requested_by,NULL,NULL) THEN
    RAISE EXCEPTION 'Budget revision is outside the current user data scope.';
  END IF;

  v_new_status := CASE v_action WHEN 'SUBMIT' THEN 'SUBMITTED' WHEN 'RESUBMIT' THEN 'RESUBMITTED' WHEN 'REVIEW' THEN 'REVIEWED'
    WHEN 'RETURN' THEN 'RETURNED' WHEN 'REJECT' THEN 'REJECTED' WHEN 'APPROVE' THEN 'APPROVED' END;

  IF v_action='SUBMIT' AND v_revision.status<>'DRAFT' THEN RAISE EXCEPTION 'Only DRAFT revisions can be submitted.'; END IF;
  IF v_action='RESUBMIT' AND v_revision.status<>'RETURNED' THEN RAISE EXCEPTION 'Only RETURNED revisions can be resubmitted.'; END IF;
  IF v_action IN ('REVIEW','RETURN') AND v_revision.status NOT IN ('SUBMITTED','RESUBMITTED') THEN RAISE EXCEPTION '% requires a submitted revision.',v_action; END IF;
  IF v_action='RETURN' AND COALESCE(TRIM(p_comments),'')='' THEN RAISE EXCEPTION 'Return comments/reason are required.'; END IF;
  IF v_action='APPROVE' AND v_revision.status<>'REVIEWED' THEN RAISE EXCEPTION 'Only REVIEWED revisions can be approved.'; END IF;
  IF v_action='REJECT' AND v_revision.status NOT IN ('SUBMITTED','RESUBMITTED','REVIEWED') THEN RAISE EXCEPTION 'Only submitted or reviewed revisions can be rejected.'; END IF;
  IF v_parent.status<>'APPROVED' OR v_parent.is_locked IS DISTINCT FROM true OR v_parent.superseded_by_id IS NOT NULL THEN
    RAISE EXCEPTION 'The source approved version is historical/superseded or no longer current.';
  END IF;

  IF v_action IN ('SUBMIT','RESUBMIT') THEN
    PERFORM njss_validate_budget_revision(v_revision.id,'SUBMISSION');
  ELSIF v_action='APPROVE' THEN
    PERFORM 1 FROM budget_allocations ba
    WHERE ba.id IN (SELECT source_budget_allocation_id FROM budget_revision_lines WHERE budget_revision_id=v_revision.id AND source_budget_allocation_id IS NOT NULL)
    ORDER BY ba.id FOR UPDATE;

    PERFORM njss_validate_budget_revision(v_revision.id,'APPROVAL');

    FOR v_line IN
      SELECT brl.*,rl.expense_ledger_id,rl.funding_source_id,rl.line_number,rl.annual_estimate,
             d.department_id,d.section_id,d.cost_centre_code,d.cost_centre_name,el.expense_code_registry_id
      FROM budget_revision_lines brl
      JOIN divisional_budget_lines rl ON rl.id=brl.revision_budget_line_id
      JOIN budget_divisions d ON d.id=v_revision.division_id
      JOIN expense_ledger el ON el.id=rl.expense_ledger_id
      WHERE brl.budget_revision_id=v_revision.id ORDER BY rl.line_number
    LOOP
      SELECT COALESCE(jsonb_object_agg(k,amount),'{}'::jsonb) INTO v_monthly
      FROM (SELECT LOWER(month_name) k,amount FROM budget_monthly_allocations WHERE budget_line_id=v_line.revision_budget_line_id ORDER BY month_number) m;
      SELECT COALESCE(SUM(amount) FILTER (WHERE month_number BETWEEN 1 AND 3),0),
             COALESCE(SUM(amount) FILTER (WHERE month_number BETWEEN 4 AND 6),0),
             COALESCE(SUM(amount) FILTER (WHERE month_number BETWEEN 7 AND 9),0),
             COALESCE(SUM(amount) FILTER (WHERE month_number BETWEEN 10 AND 12),0)
      INTO v_q1,v_q2,v_q3,v_q4 FROM budget_monthly_allocations WHERE budget_line_id=v_line.revision_budget_line_id;

      IF v_line.source_budget_allocation_id IS NOT NULL THEN
        SELECT * INTO v_allocation FROM budget_allocations WHERE id=v_line.source_budget_allocation_id FOR UPDATE;
        v_before := v_before||jsonb_build_object(v_allocation.id::TEXT,jsonb_build_object(
          'original_budget',v_allocation.original_budget,'supplemental_budget',v_allocation.supplemental_budget,
          'revision_adjustment',v_allocation.revision_adjustment,'revised_budget',v_allocation.revised_budget));

        UPDATE budget_allocations
        SET supplemental_budget=COALESCE(supplemental_budget,0)+CASE WHEN v_revision.revision_type='SUPPLEMENTARY' THEN v_line.adjustment_amount ELSE 0 END,
            revision_adjustment=COALESCE(revision_adjustment,0)+CASE WHEN v_revision.revision_type<>'SUPPLEMENTARY' THEN v_line.adjustment_amount ELSE 0 END,
            monthly_cashflow=v_monthly,q1_planned=v_q1,q2_planned=v_q2,q3_planned=v_q3,q4_planned=v_q4,
            source_module='BUDGET_REVISION',
            source_budget_submission_id=v_revision.revision_submission_id,
            source_budget_line_id=v_line.revision_budget_line_id,
            updated_at=NOW()
        WHERE id=v_allocation.id RETURNING * INTO v_allocation;
      ELSE
        SELECT id INTO v_cost_centre_id FROM cost_centres
        WHERE is_active=true AND (code=v_line.cost_centre_code OR name=v_line.cost_centre_name)
        ORDER BY CASE WHEN code=v_line.cost_centre_code THEN 0 ELSE 1 END,created_at LIMIT 1;
        v_expense_code_id := v_line.expense_code_registry_id;
        SELECT id INTO v_account_id FROM chart_of_accounts
        WHERE is_active=true AND account_code=(SELECT finance_code FROM expense_ledger WHERE id=v_line.expense_ledger_id) LIMIT 1;
        IF v_account_id IS NULL THEN SELECT id INTO v_account_id FROM chart_of_accounts WHERE is_active=true ORDER BY account_code LIMIT 1; END IF;
        IF v_account_id IS NULL THEN RAISE EXCEPTION 'No active Chart of Accounts record is available for revision target row %.',v_line.line_number; END IF;

        INSERT INTO budget_allocations (
          financial_year,department_id,section_id,cost_centre_id,funding_source_id,account_id,expense_code_registry_id,
          source_budget_submission_id,source_budget_line_id,budget_division_id,source_module,
          original_budget,supplemental_budget,revision_adjustment,monthly_cashflow,q1_planned,q2_planned,q3_planned,q4_planned,is_active,created_by,updated_at
        ) VALUES (
          v_revision.budget_year,v_line.department_id,v_line.section_id,v_cost_centre_id,v_line.funding_source_id,v_account_id,v_expense_code_id,
          v_revision.revision_submission_id,v_line.revision_budget_line_id,v_revision.division_id,'BUDGET_REVISION',0,
          CASE WHEN v_revision.revision_type='SUPPLEMENTARY' THEN v_line.proposed_revised_budget ELSE 0 END,
          CASE WHEN v_revision.revision_type<>'SUPPLEMENTARY' THEN v_line.proposed_revised_budget ELSE 0 END,
          v_monthly,v_q1,v_q2,v_q3,v_q4,true,v_user_id,NOW()
        ) RETURNING * INTO v_allocation;
        UPDATE budget_revision_lines SET source_budget_allocation_id=v_allocation.id WHERE id=v_line.id;
      END IF;

      v_after := v_after||jsonb_build_object(v_allocation.id::TEXT,jsonb_build_object(
        'original_budget',v_allocation.original_budget,'supplemental_budget',v_allocation.supplemental_budget,
        'revision_adjustment',v_allocation.revision_adjustment,'revised_budget',v_allocation.revised_budget));
    END LOOP;
  END IF;

  PERFORM set_config('njss.budget_workflow','on',true);
  UPDATE divisional_budget_submissions
  SET status=v_new_status,is_locked=v_new_status IN ('SUBMITTED','RESUBMITTED','REVIEWED','APPROVED','ARCHIVED'),
      submitted_at=CASE WHEN v_action IN ('SUBMIT','RESUBMIT') THEN NOW() ELSE submitted_at END,
      submitted_by=CASE WHEN v_action IN ('SUBMIT','RESUBMIT') THEN v_user_id ELSE submitted_by END,
      returned_at=CASE WHEN v_action='RETURN' THEN NOW() ELSE returned_at END,
      return_reason=CASE WHEN v_action='RETURN' THEN p_comments ELSE return_reason END,
      reviewed_at=CASE WHEN v_action='REVIEW' THEN NOW() ELSE reviewed_at END,
      reviewed_by=CASE WHEN v_action='REVIEW' THEN v_actor_email ELSE reviewed_by END,
      reviewed_by_email=CASE WHEN v_action='REVIEW' THEN v_actor_email ELSE reviewed_by_email END,
      approved_at=CASE WHEN v_action='APPROVE' THEN NOW() ELSE approved_at END,
      approved_by=CASE WHEN v_action='APPROVE' THEN v_actor_email ELSE approved_by END,
      rejected_at=CASE WHEN v_action='REJECT' THEN NOW() ELSE rejected_at END,
      rejected_by=CASE WHEN v_action='REJECT' THEN v_user_id ELSE rejected_by END,
      approval_comments=CASE WHEN v_action IN ('REVIEW','APPROVE','REJECT') THEN p_comments ELSE approval_comments END,updated_at=NOW()
  WHERE id=v_revision.revision_submission_id;

  UPDATE budget_revisions SET status=v_new_status,
    approved_by=CASE WHEN v_action='APPROVE' THEN v_user_id ELSE approved_by END,
    approved_at=CASE WHEN v_action='APPROVE' THEN NOW() ELSE approved_at END,updated_at=NOW()
  WHERE id=v_revision.id;

  IF v_action='APPROVE' THEN
    UPDATE divisional_budget_submissions SET superseded_by_id=v_revision.revision_submission_id,updated_at=NOW()
    WHERE id=v_revision.parent_submission_id;
  END IF;

  INSERT INTO budget_workflow_history (submission_id,from_status,to_status,action,comments,changed_by,changed_by_email)
  VALUES (v_revision.revision_submission_id,v_revision.status,v_new_status,'REVISION_'||v_action,p_comments,v_user_id,v_actor_email);

  PERFORM log_audit_event(
    v_user_id,v_actor_email,COALESCE(v_actor_email,'System'),'BUDGET_REVISION_'||v_action,'BUDGET_REVISION',v_revision.id,v_revision.revision_number,
    jsonb_build_object('status',v_revision.status,'allocations',v_before),jsonb_build_object('status',v_new_status,'allocations',v_after),
    jsonb_build_object('parent_submission_id',v_revision.parent_submission_id,'revision_submission_id',v_revision.revision_submission_id,
      'revision_type',v_revision.revision_type,'reason',v_revision.reason,'authority_reference',v_revision.authority_reference,'comments',p_comments),
    jsonb_build_object('approval_revalidated',v_action='APPROVE')
  );

  RETURN jsonb_build_object('revision_id',v_revision.id,'revision_submission_id',v_revision.revision_submission_id,'revision_number',v_revision.revision_number,'status',v_new_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.njss_transition_budget_revision_base(uuid,text,text,text) FROM PUBLIC, anon, authenticated;
