-- Task 14 National UAT runtime hardening.
-- Forward-only corrections proven during the cloud rebuild:
--   1. UUID-safe funding allocation selection for budget releases.
--   2. Revision cloning reuses the 12 monthly rows auto-created by the line trigger.
--   3. Budget workflow maintenance context is enabled before validation/recalculation.

CREATE OR REPLACE FUNCTION public.njss_create_budget_release(
  p_budget_allocation_id UUID,
  p_financial_year INTEGER,
  p_quarter INTEGER,
  p_released_amount NUMERIC,
  p_release_date DATE DEFAULT NULL,
  p_funding_lines JSONB DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS quarterly_releases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_budget budget_allocations;
  v_row quarterly_releases;
  v_actor UUID := fn_current_app_user_id();
  v_funded NUMERIC;
  v_released NUMERIC;
  v_approved_remaining NUMERIC;
  v_funded_remaining NUMERIC;
  v_max_releasable NUMERIC;
  v_lines_total NUMERIC;
  v_line_count INTEGER;
  v_single_funding_allocation UUID;
  v_bad_line RECORD;
BEGIN
  PERFORM njss_require_permission('budget.release');

  IF p_released_amount IS NULL OR p_released_amount <= 0 THEN
    RAISE EXCEPTION 'Release amount must be greater than zero. Requested amount: K%', COALESCE(p_released_amount, 0);
  END IF;
  IF p_quarter NOT BETWEEN 1 AND 4 THEN
    RAISE EXCEPTION 'Quarter must be between 1 and 4. Requested quarter: %', p_quarter;
  END IF;
  IF p_funding_lines IS NULL OR jsonb_typeof(p_funding_lines) <> 'array' OR jsonb_array_length(p_funding_lines) = 0 THEN
    RAISE EXCEPTION 'Budget release requires at least one funding attribution line.';
  END IF;

  SELECT * INTO v_budget
  FROM budget_allocations
  WHERE id = p_budget_allocation_id AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved budget allocation not found'; END IF;
  IF v_budget.financial_year <> p_financial_year THEN
    RAISE EXCEPTION 'Release FY% does not match budget allocation FY%.', p_financial_year, v_budget.financial_year;
  END IF;

  SELECT COUNT(*), COALESCE(SUM(amount), 0), (array_agg(funding_allocation_id))[1]
  INTO v_line_count, v_lines_total, v_single_funding_allocation
  FROM jsonb_to_recordset(p_funding_lines) AS x(funding_allocation_id UUID, amount NUMERIC);

  IF v_line_count = 0 OR ABS(v_lines_total - p_released_amount) > 0.001 THEN
    RAISE EXCEPTION 'Release amount K% must equal funding line total K%.', p_released_amount, COALESCE(v_lines_total, 0);
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_funded
  FROM funding_allocations
  WHERE budget_allocation_id = v_budget.id AND status = 'APPROVED';

  SELECT COALESCE(SUM(released_amount), 0) INTO v_released
  FROM quarterly_releases
  WHERE budget_allocation_id = v_budget.id;

  v_approved_remaining := v_budget.revised_budget - v_released;
  v_funded_remaining := v_funded - v_released;
  v_max_releasable := LEAST(v_approved_remaining, v_funded_remaining);

  IF p_released_amount > v_max_releasable + 0.001 THEN
    IF v_funded_remaining <= v_approved_remaining THEN
      RAISE EXCEPTION 'Release exceeds remaining funded amount. Funded: K%; Previously Released: K%; Maximum Additional Release: K%.', v_funded, v_released, GREATEST(v_max_releasable, 0);
    ELSE
      RAISE EXCEPTION 'Release exceeds remaining approved budget. Approved Budget: K%; Previously Released: K%; Maximum Additional Release: K%.', v_budget.revised_budget, v_released, GREATEST(v_max_releasable, 0);
    END IF;
  END IF;

  SELECT x.funding_allocation_id, x.amount, fa.allocation_number, fa.allocated_amount,
         COALESCE((SELECT SUM(brfl.amount) FROM budget_release_funding_lines brfl WHERE brfl.funding_allocation_id = fa.id), 0) AS already_released
  INTO v_bad_line
  FROM jsonb_to_recordset(p_funding_lines) AS x(funding_allocation_id UUID, amount NUMERIC)
  LEFT JOIN funding_allocations fa ON fa.id = x.funding_allocation_id
  WHERE x.amount IS NULL OR x.amount <= 0
     OR fa.id IS NULL
     OR fa.status <> 'APPROVED'
     OR fa.budget_allocation_id <> v_budget.id
     OR x.amount > (fa.allocated_amount - COALESCE((SELECT SUM(brfl.amount) FROM budget_release_funding_lines brfl WHERE brfl.funding_allocation_id = fa.id), 0)) + 0.001
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'Invalid funding release line for allocation %. Requested K%; allocated K%; already released K%.',
      v_bad_line.funding_allocation_id,
      COALESCE(v_bad_line.amount, 0),
      COALESCE(v_bad_line.allocated_amount, 0),
      COALESCE(v_bad_line.already_released, 0);
  END IF;

  INSERT INTO quarterly_releases (
    budget_allocation_id, financial_year, quarter, release_date, released_amount,
    funding_allocation_id, created_by, notes
  ) VALUES (
    v_budget.id, p_financial_year, p_quarter, COALESCE(p_release_date, CURRENT_DATE), p_released_amount,
    CASE WHEN v_line_count = 1 THEN v_single_funding_allocation ELSE NULL END, v_actor, p_notes
  )
  RETURNING * INTO v_row;

  INSERT INTO budget_release_funding_lines (quarterly_release_id, funding_allocation_id, amount, created_by)
  SELECT v_row.id, x.funding_allocation_id, x.amount, v_actor
  FROM jsonb_to_recordset(p_funding_lines) AS x(funding_allocation_id UUID, amount NUMERIC);

  PERFORM log_audit_event(
    v_actor, p_user_email, COALESCE(p_user_email, 'System'),
    'BUDGET_RELEASE_CREATED', 'QUARTERLY_RELEASE', v_row.id, v_row.release_number,
    NULL, to_jsonb(v_row),
    jsonb_build_object(
      'amount', v_row.released_amount,
      'funded', v_funded,
      'previously_released', v_released,
      'maximum_additional_release', v_max_releasable,
      'funding_lines', p_funding_lines
    ),
    NULL
  );
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.njss_create_budget_revision_base(
  p_parent_submission_id UUID,
  p_revision_type TEXT,
  p_reason TEXT,
  p_authority_reference TEXT DEFAULT NULL,
  p_effective_date DATE DEFAULT CURRENT_DATE,
  p_supporting_reference TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_parent divisional_budget_submissions;
  v_division budget_divisions;
  v_user_id UUID := fn_current_app_user_id();
  v_actor_email TEXT;
  v_submission_id UUID;
  v_revision_id UUID;
  v_revision_number TEXT;
  v_next_version INTEGER;
  v_source RECORD;
  v_new_line_id UUID;
  v_source_allocation budget_allocations;
  v_month_count INTEGER;
BEGIN
  SELECT email INTO v_actor_email FROM users WHERE id = v_user_id;
  v_actor_email := COALESCE(v_actor_email, p_user_email);

  IF NOT (
    COALESCE(fn_current_user_has_permission('budget.revision.create'), false)
    OR COALESCE(fn_current_user_has_permission('all'), false)
  ) THEN
    RAISE EXCEPTION 'Permission denied: budget.revision.create is required.';
  END IF;

  SELECT * INTO v_parent
  FROM divisional_budget_submissions
  WHERE id = p_parent_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved parent budget submission not found.'; END IF;
  IF v_parent.status <> 'APPROVED' OR v_parent.is_locked IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'A budget revision can only be created from an approved and locked budget version.';
  END IF;
  IF v_parent.superseded_by_id IS NOT NULL THEN
    RAISE EXCEPTION 'This approved version is historical/superseded and cannot start another revision.';
  END IF;

  SELECT * INTO v_division FROM budget_divisions WHERE id = v_parent.division_id;
  IF NOT fn_current_user_data_scope_allows(v_division.department_id, v_division.section_id, v_user_id, NULL, NULL) THEN
    RAISE EXCEPTION 'Budget revision is outside the current user data scope.';
  END IF;
  IF UPPER(COALESCE(p_revision_type, '')) NOT IN ('VIREMENT','SUPPLEMENTARY','REDUCTION','RECLASSIFICATION','REFORECAST') THEN
    RAISE EXCEPTION 'Unsupported budget revision type.';
  END IF;
  IF COALESCE(TRIM(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Budget revision reason/justification is required.';
  END IF;
  IF UPPER(p_revision_type) = 'SUPPLEMENTARY' AND COALESCE(TRIM(p_authority_reference), '') = '' THEN
    RAISE EXCEPTION 'Supplementary authority reference is required.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM budget_revisions
    WHERE parent_submission_id = v_parent.id
      AND status IN ('DRAFT','SUBMITTED','RETURNED','RESUBMITTED','REVIEWED')
  ) THEN
    RAISE EXCEPTION 'An active revision already exists for this approved budget version.';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_next_version
  FROM divisional_budget_submissions
  WHERE cycle_id = v_parent.cycle_id AND division_id = v_parent.division_id;

  INSERT INTO divisional_budget_submissions (
    cycle_id,budget_year,department_id,division_id,cost_centre,version,parent_submission_id,superseded_by_id,
    budget_ceiling,ceiling_exception_approved,ceiling_exception_reference,prepared_by,prepared_by_email,date_prepared,
    status,validation_status,validation_messages,line_count,total_proposed_budget,total_monthly_allocation,
    unallocated_variance,is_locked,notes
  ) VALUES (
    v_parent.cycle_id,v_parent.budget_year,v_parent.department_id,v_parent.division_id,v_parent.cost_centre,
    v_next_version,v_parent.id,NULL,v_parent.budget_ceiling,v_parent.ceiling_exception_approved,
    v_parent.ceiling_exception_reference,v_actor_email,v_actor_email,CURRENT_DATE,'DRAFT','PENDING','[]'::jsonb,
    0,0,0,0,false,'Budget revision created from approved submission ' || COALESCE(v_parent.submission_number,v_parent.id::TEXT)
  ) RETURNING id INTO v_submission_id;

  PERFORM pg_advisory_xact_lock(hashtext('njss-budget-revision-' || v_parent.budget_year::TEXT));
  SELECT 'REV-' || v_parent.budget_year || '-' || LPAD((COALESCE(MAX(NULLIF(SPLIT_PART(revision_number,'-',3),'')::INTEGER),0)+1)::TEXT,5,'0')
  INTO v_revision_number
  FROM budget_revisions
  WHERE budget_year = v_parent.budget_year
    AND revision_number ~ ('^REV-' || v_parent.budget_year || '-[0-9]+$');

  INSERT INTO budget_revisions (
    revision_number,parent_submission_id,revision_submission_id,budget_year,division_id,revision_type,reason,
    authority_reference,effective_date,status,requested_by,requested_by_email,supporting_reference
  ) VALUES (
    v_revision_number,v_parent.id,v_submission_id,v_parent.budget_year,v_parent.division_id,UPPER(p_revision_type),
    TRIM(p_reason),NULLIF(TRIM(p_authority_reference),''),COALESCE(p_effective_date,CURRENT_DATE),'DRAFT',
    v_user_id,v_actor_email,NULLIF(TRIM(p_supporting_reference),'')
  ) RETURNING id INTO v_revision_id;

  FOR v_source IN
    SELECT * FROM divisional_budget_lines
    WHERE submission_id = v_parent.id
    ORDER BY line_number,id
  LOOP
    INSERT INTO divisional_budget_lines (
      submission_id,line_number,activity_reference,expense_ledger_id,line_item_description,business_justification,
      expected_output,location_destination_provider,beneficiary_custodian_officer,start_date,end_date,quantity,
      unit_of_measure,unit_cost,frequency_periods,other_costs,priority,funding_source_id,procurement_method,
      responsible_officer,supporting_reference,comments,priority_level_id,procurement_method_id,unit_of_measure_id,
      responsible_officer_id
    ) VALUES (
      v_submission_id,v_source.line_number,v_source.activity_reference,v_source.expense_ledger_id,
      v_source.line_item_description,v_source.business_justification,v_source.expected_output,
      v_source.location_destination_provider,v_source.beneficiary_custodian_officer,v_source.start_date,v_source.end_date,
      v_source.quantity,v_source.unit_of_measure,v_source.unit_cost,v_source.frequency_periods,v_source.other_costs,
      v_source.priority,v_source.funding_source_id,v_source.procurement_method,v_source.responsible_officer,
      v_source.supporting_reference,v_source.comments,v_source.priority_level_id,v_source.procurement_method_id,
      v_source.unit_of_measure_id,v_source.responsible_officer_id
    ) RETURNING id INTO v_new_line_id;

    UPDATE budget_monthly_allocations target
    SET month_name = source.month_name,
        amount = source.amount,
        updated_at = now()
    FROM budget_monthly_allocations source
    WHERE target.budget_line_id = v_new_line_id
      AND source.budget_line_id = v_source.id
      AND target.month_number = source.month_number;
    GET DIAGNOSTICS v_month_count = ROW_COUNT;
    IF v_month_count <> 12 THEN
      RAISE EXCEPTION 'Revision monthly clone expected 12 rows but updated % for source line %', v_month_count, v_source.id;
    END IF;

    SELECT * INTO v_source_allocation
    FROM budget_allocations
    WHERE source_budget_line_id = v_source.id AND is_active = true
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 1;

    INSERT INTO budget_revision_lines (
      budget_revision_id,source_budget_allocation_id,source_budget_line_id,revision_budget_line_id,
      original_budget,current_revised_budget,proposed_revised_budget,adjustment_amount
    ) VALUES (
      v_revision_id,v_source_allocation.id,v_source.id,v_new_line_id,
      COALESCE(v_source_allocation.original_budget,v_source.annual_estimate,0),
      COALESCE(v_source_allocation.revised_budget,v_source.annual_estimate,0),
      COALESCE(v_source_allocation.revised_budget,v_source.annual_estimate,0),0
    );
  END LOOP;

  PERFORM recalc_divisional_budget_submission_totals(v_submission_id);
  PERFORM log_audit_event(
    v_user_id,v_actor_email,COALESCE(v_actor_email,'System'),'BUDGET_REVISION_CREATE','BUDGET_REVISION',
    v_revision_id,v_revision_number,
    jsonb_build_object('parent_submission_id',v_parent.id,'parent_version',v_parent.version),
    jsonb_build_object('revision_submission_id',v_submission_id,'version',v_next_version,'type',UPPER(p_revision_type)),
    jsonb_build_object('reason',p_reason,'authority_reference',p_authority_reference),
    jsonb_build_object('source_submission_number',v_parent.submission_number)
  );
  RETURN jsonb_build_object(
    'revision_id',v_revision_id,
    'revision_submission_id',v_submission_id,
    'revision_number',v_revision_number,
    'version',v_next_version
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_divisional_budget_submission(
  p_submission_id UUID,
  p_action TEXT,
  p_comments TEXT DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS divisional_budget_submissions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old public.divisional_budget_submissions;
  v_new_status VARCHAR(40);
  v_out public.divisional_budget_submissions;
  v_user_id UUID;
  v_actor_email TEXT;
  v_actor_label TEXT;
BEGIN
  SELECT * INTO v_old
  FROM public.divisional_budget_submissions
  WHERE id = p_submission_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Budget submission not found'; END IF;

  v_user_id := public.fn_current_app_user_id();
  IF v_user_id IS NULL AND COALESCE(trim(p_user_email),'') <> '' THEN
    SELECT id INTO v_user_id
    FROM public.users
    WHERE lower(email) = lower(trim(p_user_email)) AND is_active = true
    LIMIT 1;
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT u.email, COALESCE(NULLIF(trim(u.full_name),''),u.email)
    INTO v_actor_email,v_actor_label
    FROM public.users u
    WHERE u.id = v_user_id AND u.is_active = true;
  END IF;
  v_actor_email := COALESCE(v_actor_email,NULLIF(trim(p_user_email),''));
  v_actor_label := COALESCE(v_actor_label,v_actor_email);

  IF UPPER(p_action)='SUBMIT' AND v_old.status NOT IN ('DRAFT') THEN RAISE EXCEPTION 'Only DRAFT budgets can be submitted'; END IF;
  IF UPPER(p_action)='RESUBMIT' AND v_old.status NOT IN ('RETURNED') THEN RAISE EXCEPTION 'Only RETURNED budgets can be resubmitted'; END IF;
  IF UPPER(p_action)='RETURN' AND v_old.status NOT IN ('SUBMITTED','RESUBMITTED') THEN RAISE EXCEPTION 'Only submitted budgets can be returned'; END IF;
  IF UPPER(p_action)='RETURN' AND COALESCE(trim(p_comments),'')='' THEN RAISE EXCEPTION 'Return comments/reason are required'; END IF;
  IF UPPER(p_action)='REVIEW' AND v_old.status NOT IN ('SUBMITTED','RESUBMITTED') THEN RAISE EXCEPTION 'Only SUBMITTED or RESUBMITTED budgets can be reviewed'; END IF;
  IF UPPER(p_action)='APPROVE' AND v_old.status<>'REVIEWED' THEN RAISE EXCEPTION 'Only REVIEWED budgets can be approved'; END IF;

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
  IF v_new_status IS NULL THEN RAISE EXCEPTION 'Unsupported budget workflow action: %', p_action; END IF;

  -- Validation recalculates submission totals. REVIEWED submissions are locked, so
  -- the sanctioned workflow maintenance context must be active before validation.
  PERFORM set_config('njss.budget_workflow','on',true);

  IF UPPER(p_action) IN ('SUBMIT','RESUBMIT','APPROVE') THEN
    PERFORM public.validate_divisional_budget_submission(p_submission_id);
    SELECT * INTO v_old
    FROM public.divisional_budget_submissions
    WHERE id = p_submission_id
    FOR UPDATE;
  END IF;

  UPDATE public.divisional_budget_submissions
  SET status = v_new_status,
      validation_status = CASE WHEN ABS(COALESCE(unallocated_variance,0)) <= 0.009 THEN 'VALID' ELSE 'VARIANCE' END,
      is_locked = v_new_status IN ('SUBMITTED','RESUBMITTED','REVIEWED','APPROVED','ARCHIVED'),
      submitted_by = CASE WHEN UPPER(p_action) IN ('SUBMIT','RESUBMIT') THEN COALESCE(v_user_id,submitted_by) ELSE submitted_by END,
      reviewed_by = CASE WHEN UPPER(p_action)='REVIEW' THEN COALESCE(v_actor_label,reviewed_by) ELSE reviewed_by END,
      approved_by = CASE WHEN UPPER(p_action)='APPROVE' THEN COALESCE(v_actor_label,approved_by) ELSE approved_by END,
      rejected_by = CASE WHEN UPPER(p_action)='REJECT' THEN COALESCE(v_user_id,rejected_by) ELSE rejected_by END,
      submitted_at = CASE WHEN UPPER(p_action) IN ('SUBMIT','RESUBMIT') THEN NOW() ELSE submitted_at END,
      reviewed_at = CASE WHEN UPPER(p_action)='REVIEW' THEN NOW() ELSE reviewed_at END,
      approved_at = CASE WHEN UPPER(p_action)='APPROVE' THEN NOW() ELSE approved_at END,
      rejected_at = CASE WHEN UPPER(p_action)='REJECT' THEN NOW() ELSE rejected_at END,
      return_reason = CASE WHEN UPPER(p_action)='RETURN' THEN p_comments ELSE return_reason END,
      approval_comments = CASE WHEN UPPER(p_action) IN ('REVIEW','APPROVE','REJECT') THEN p_comments ELSE approval_comments END,
      updated_at = NOW()
  WHERE id = p_submission_id
  RETURNING * INTO v_out;

  IF UPPER(p_action)='APPROVE' THEN
    INSERT INTO public.budget_activation_batches(
      submission_id,financial_year,department_id,budget_division_id,status,
      approved_line_count,approved_total,mapped_line_count,unmapped_line_count,
      activation_total,variance,validation_snapshot,created_at,updated_at
    )
    SELECT s.id,s.budget_year,s.department_id,s.division_id,'DRAFT_MAPPING',
           COUNT(l.id),COALESCE(SUM(l.annual_estimate),0),0,COUNT(l.id),0,
           COALESCE(SUM(l.annual_estimate),0),
           jsonb_build_object(
             'approval_status',s.status,
             'approved_at',s.approved_at,
             'approved_total',COALESCE(SUM(l.annual_estimate),0),
             'approved_line_count',COUNT(l.id)
           ),
           NOW(),NOW()
    FROM public.divisional_budget_submissions s
    JOIN public.divisional_budget_lines l ON l.submission_id = s.id
    WHERE s.id = p_submission_id
    GROUP BY s.id,s.budget_year,s.department_id,s.division_id,s.status,s.approved_at
    ON CONFLICT(submission_id) DO UPDATE SET
      financial_year = EXCLUDED.financial_year,
      department_id = EXCLUDED.department_id,
      budget_division_id = EXCLUDED.budget_division_id,
      status = CASE WHEN public.budget_activation_batches.status='ACTIVATED' THEN 'ACTIVATED' ELSE 'DRAFT_MAPPING' END,
      approved_line_count = EXCLUDED.approved_line_count,
      approved_total = EXCLUDED.approved_total,
      mapped_line_count = CASE WHEN public.budget_activation_batches.status='ACTIVATED' THEN public.budget_activation_batches.mapped_line_count ELSE 0 END,
      unmapped_line_count = CASE WHEN public.budget_activation_batches.status='ACTIVATED' THEN public.budget_activation_batches.unmapped_line_count ELSE EXCLUDED.unmapped_line_count END,
      activation_total = CASE WHEN public.budget_activation_batches.status='ACTIVATED' THEN public.budget_activation_batches.activation_total ELSE 0 END,
      variance = CASE WHEN public.budget_activation_batches.status='ACTIVATED' THEN public.budget_activation_batches.variance ELSE EXCLUDED.approved_total END,
      validation_snapshot = CASE WHEN public.budget_activation_batches.status='ACTIVATED' THEN public.budget_activation_batches.validation_snapshot ELSE EXCLUDED.validation_snapshot END,
      updated_at = NOW();
  END IF;

  INSERT INTO public.budget_workflow_history(
    submission_id,from_status,to_status,action,comments,changed_by,changed_by_email
  ) VALUES (
    p_submission_id,v_old.status,v_new_status,UPPER(p_action),p_comments,v_user_id,v_actor_email
  );

  PERFORM public.log_audit_event(
    v_user_id,v_actor_email,COALESCE(v_actor_label,v_actor_email,'System'),
    'BUDGET_' || UPPER(p_action),'BUDGET_SUBMISSION',p_submission_id,v_out.submission_number,
    jsonb_build_object('status',v_old.status),jsonb_build_object('status',v_new_status),
    jsonb_build_object('old_status',v_old.status,'new_status',v_new_status,'activation_required',UPPER(p_action)='APPROVE'),
    NULL
  );
  RETURN v_out;
END;
$$;
