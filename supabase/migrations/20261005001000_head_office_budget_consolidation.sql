-- Retire legacy operational budgets without deleting financial identities or audit history.
-- Only the annual Head Office model provides approved spending limits.
CREATE OR REPLACE FUNCTION public.njss_calculate_ff3_budget(p_financial_year integer, p_department_id uuid, p_section_id uuid, p_expense_ledger_id uuid, p_cost_centre_id uuid, p_amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cycle_id uuid;
  v_division_budget_id uuid;
  v_position_exists boolean := false;
  v_original numeric := 0;
  v_supplementary numeric := 0;
  v_realloc_in numeric := 0;
  v_realloc_out numeric := 0;
  v_current numeric := 0;
  v_commitments numeric := 0;
  v_actuals numeric := 0;
  v_available numeric := 0;
  v_shortfall numeric := 0;
  v_mapping_count integer := 0;
  v_specific_count integer := 0;
  v_status text := 'NOT_CHECKED';
BEGIN
  IF p_financial_year IS NULL OR p_department_id IS NULL OR p_section_id IS NULL OR p_expense_ledger_id IS NULL THEN
    RAISE EXCEPTION 'Financial Year, Division, Section and Ledger are required for FF3 budget evaluation';
  END IF;
  IF COALESCE(p_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'FF3 amount must be greater than zero';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sections s
    WHERE s.id = p_section_id
      AND s.department_id = p_department_id
      AND COALESCE(s.is_active, true) = true
  ) THEN
    RAISE EXCEPTION 'Selected Section does not belong to the FF3 Division';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.expense_ledger el
    WHERE el.id = p_expense_ledger_id
      AND el.is_active = true
      AND el.is_posting = true
  ) THEN
    RAISE EXCEPTION 'Selected Ledger is not an active posting ledger';
  END IF;

  SELECT c.id, db.id
    INTO v_cycle_id, v_division_budget_id
  FROM public.annual_budget_cycles c
  JOIN public.division_budgets db ON db.annual_budget_cycle_id = c.id
  WHERE c.financial_year = p_financial_year
    AND c.status = 'ACTIVE'
    AND db.financial_year = p_financial_year
    AND db.division_id = p_department_id
    AND db.status = 'LOCKED'
  LIMIT 1;

  IF v_cycle_id IS NULL OR v_division_budget_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'NO_ACTIVE_BUDGET',
      'position_exists', false,
      'financial_year', p_financial_year,
      'department_id', p_department_id,
      'section_id', p_section_id,
      'expense_ledger_id', p_expense_ledger_id,
      'requested', p_amount,
      'original_budget', 0,
      'supplementary_adjustments', 0,
      'reallocations_in', 0,
      'reallocations_out', 0,
      'current_approved_budget', 0,
      'outstanding_commitments', 0,
      'actual_expenditure', 0,
      'available_budget', 0,
      'shortfall', p_amount,
      'posting_mapping_count', 0
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.division_budget_lines l
    WHERE l.division_budget_id = v_division_budget_id
      AND l.section_id = p_section_id
      AND l.expense_ledger_id = p_expense_ledger_id
    UNION ALL
    SELECT 1
    FROM public.budget_supplementary_adjustments sa
    WHERE sa.annual_budget_cycle_id = v_cycle_id
      AND sa.division_budget_id = v_division_budget_id
      AND sa.section_id = p_section_id
      AND sa.expense_ledger_id = p_expense_ledger_id
      AND sa.status = 'POSTED'
    UNION ALL
    SELECT 1
    FROM public.budget_reallocations br
    WHERE br.annual_budget_cycle_id = v_cycle_id
      AND br.status = 'EXECUTED'
      AND (
        (br.source_division_budget_id = v_division_budget_id
         AND br.source_section_id = p_section_id
         AND br.source_expense_ledger_id = p_expense_ledger_id)
        OR
        (br.destination_division_budget_id = v_division_budget_id
         AND br.destination_section_id = p_section_id
         AND br.destination_expense_ledger_id = p_expense_ledger_id)
      )
    LIMIT 1
  ) INTO v_position_exists;

  IF NOT v_position_exists THEN
    RETURN jsonb_build_object(
      'status', 'NO_ACTIVE_BUDGET',
      'position_exists', false,
      'annual_budget_cycle_id', v_cycle_id,
      'division_budget_id', v_division_budget_id,
      'financial_year', p_financial_year,
      'department_id', p_department_id,
      'section_id', p_section_id,
      'expense_ledger_id', p_expense_ledger_id,
      'requested', p_amount,
      'original_budget', 0,
      'supplementary_adjustments', 0,
      'reallocations_in', 0,
      'reallocations_out', 0,
      'current_approved_budget', 0,
      'outstanding_commitments', 0,
      'actual_expenditure', 0,
      'available_budget', 0,
      'shortfall', p_amount,
      'posting_mapping_count', 0
    );
  END IF;

  SELECT COALESCE(SUM(l.original_amount), 0)
    INTO v_original
  FROM public.division_budget_lines l
  WHERE l.division_budget_id = v_division_budget_id
    AND l.section_id = p_section_id
    AND l.expense_ledger_id = p_expense_ledger_id;

  SELECT COALESCE(SUM(sa.adjustment_amount), 0)
    INTO v_supplementary
  FROM public.budget_supplementary_adjustments sa
  WHERE sa.annual_budget_cycle_id = v_cycle_id
    AND sa.division_budget_id = v_division_budget_id
    AND sa.section_id = p_section_id
    AND sa.expense_ledger_id = p_expense_ledger_id
    AND sa.status = 'POSTED';

  SELECT COALESCE(SUM(br.transfer_amount), 0)
    INTO v_realloc_in
  FROM public.budget_reallocations br
  WHERE br.annual_budget_cycle_id = v_cycle_id
    AND br.destination_division_budget_id = v_division_budget_id
    AND br.destination_section_id = p_section_id
    AND br.destination_expense_ledger_id = p_expense_ledger_id
    AND br.status = 'EXECUTED';

  SELECT COALESCE(SUM(br.transfer_amount), 0)
    INTO v_realloc_out
  FROM public.budget_reallocations br
  WHERE br.annual_budget_cycle_id = v_cycle_id
    AND br.source_division_budget_id = v_division_budget_id
    AND br.source_section_id = p_section_id
    AND br.source_expense_ledger_id = p_expense_ledger_id
    AND br.status = 'EXECUTED';

  v_current := v_original + v_supplementary + v_realloc_in - v_realloc_out;

  SELECT COALESCE(SUM(COALESCE(fc.outstanding_amount, fc.remaining_balance, 0)), 0)
    INTO v_commitments
  FROM public.ff3_commitments fc
  JOIN public.budget_allocations ba ON ba.id = fc.budget_allocation_id
  LEFT JOIN public.ff3_headers posted_ff3 ON posted_ff3.id=fc.ff3_header_id
  WHERE fc.financial_year = p_financial_year
    AND COALESCE(fc.status, '') NOT IN ('CANCELLED', 'CLOSED', 'REVERSED')
    AND ba.financial_year = p_financial_year
    AND ba.department_id = p_department_id
    AND ba.section_id = p_section_id
    AND (
      -- Recorded annual Ledger identity survives technical mapping changes.
      (posted_ff3.expense_ledger_id=p_expense_ledger_id
        AND posted_ff3.financial_year=p_financial_year
        AND posted_ff3.department_id=p_department_id AND posted_ff3.section_id=p_section_id)
      OR (posted_ff3.expense_ledger_id IS NULL AND EXISTS (
        SELECT 1 FROM public.finance_posting_mappings fpm
        WHERE fpm.expense_code_registry_id=ba.expense_code_registry_id
          AND fpm.expense_ledger_id=p_expense_ledger_id
          AND fpm.department_id=p_department_id AND fpm.section_id=p_section_id
          AND fpm.is_active=true AND (fpm.financial_year=p_financial_year OR fpm.financial_year IS NULL)
      ))
    );

  SELECT COALESCE(SUM(
      CASE WHEN upper(COALESCE(pt.transaction_type, '')) = 'REVERSAL'
           THEN -abs(pt.amount) ELSE pt.amount END
    ), 0)
    INTO v_actuals
  FROM public.payment_transactions pt
  JOIN public.budget_allocations ba ON ba.id = pt.budget_allocation_id
  LEFT JOIN public.ff3_commitments posted_commitment ON posted_commitment.id=pt.commitment_id
  LEFT JOIN public.ff3_headers posted_ff3 ON posted_ff3.id=posted_commitment.ff3_header_id
  WHERE pt.financial_year = p_financial_year
    AND pt.status IN ('POSTED', 'RECONCILED')
    AND ba.financial_year = p_financial_year
    AND ba.department_id = p_department_id
    AND ba.section_id = p_section_id
    AND (
      -- Recorded annual Ledger identity survives technical mapping changes.
      (posted_ff3.expense_ledger_id=p_expense_ledger_id
        AND posted_ff3.financial_year=p_financial_year
        AND posted_ff3.department_id=p_department_id AND posted_ff3.section_id=p_section_id)
      OR (posted_ff3.expense_ledger_id IS NULL AND EXISTS (
        SELECT 1 FROM public.finance_posting_mappings fpm
        WHERE fpm.expense_code_registry_id=ba.expense_code_registry_id
          AND fpm.expense_ledger_id=p_expense_ledger_id
          AND fpm.department_id=p_department_id AND fpm.section_id=p_section_id
          AND fpm.is_active=true AND (fpm.financial_year=p_financial_year OR fpm.financial_year IS NULL)
      ))
    );

  v_available := v_current - v_commitments - v_actuals;
  v_shortfall := GREATEST(COALESCE(p_amount, 0) - v_available, 0);

  SELECT COUNT(*)
    INTO v_specific_count
  FROM public.finance_posting_mappings fpm
  WHERE fpm.financial_year = p_financial_year
    AND fpm.expense_ledger_id = p_expense_ledger_id
    AND fpm.department_id = p_department_id
    AND fpm.section_id = p_section_id
    AND fpm.is_active = true
    AND (p_cost_centre_id IS NULL OR fpm.cost_centre_id = p_cost_centre_id);

  IF v_specific_count > 0 THEN
    v_mapping_count := v_specific_count;
  ELSE
    SELECT COUNT(*)
      INTO v_mapping_count
    FROM public.finance_posting_mappings fpm
    WHERE fpm.financial_year IS NULL
      AND fpm.expense_ledger_id = p_expense_ledger_id
      AND fpm.department_id = p_department_id
      AND fpm.section_id = p_section_id
      AND fpm.is_active = true
      AND (p_cost_centre_id IS NULL OR fpm.cost_centre_id = p_cost_centre_id);
  END IF;

  IF COALESCE(p_amount, 0) > v_available + 0.001 THEN
    v_status := 'INSUFFICIENT_BUDGET_BLOCKED';
  ELSIF v_mapping_count <> 1 THEN
    v_status := 'POSTING_MAPPING_REQUIRED';
  ELSE
    v_status := 'SUFFICIENT';
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'position_exists', true,
    'annual_budget_cycle_id', v_cycle_id,
    'division_budget_id', v_division_budget_id,
    'financial_year', p_financial_year,
    'department_id', p_department_id,
    'section_id', p_section_id,
    'expense_ledger_id', p_expense_ledger_id,
    'requested', p_amount,
    'original_budget', v_original,
    'supplementary_adjustments', v_supplementary,
    'reallocations_in', v_realloc_in,
    'reallocations_out', v_realloc_out,
    'current_approved_budget', v_current,
    'outstanding_commitments', v_commitments,
    'actual_expenditure', v_actuals,
    'available_budget', v_available,
    'shortfall', v_shortfall,
    'posting_mapping_count', v_mapping_count
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.njss_calculate_ff3_budget(integer,uuid,uuid,uuid,uuid,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_current_budget_position(
 p_financial_year integer, p_division_id uuid DEFAULT NULL,
 p_section_id uuid DEFAULT NULL, p_expense_ledger_id uuid DEFAULT NULL
)
RETURNS TABLE(annual_budget_cycle_id uuid, financial_year integer, division_budget_id uuid,
 division_id uuid, section_id uuid, expense_ledger_id uuid, original_budget numeric,
 supplementary_adjustments numeric, reallocations_in numeric, reallocations_out numeric,
 current_approved_budget numeric, outstanding_commitments numeric,
 actual_expenditure numeric, available_budget numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.auth_user_id=auth.uid()
   AND u.is_active=true AND u.must_change_password=false) THEN
   RAISE EXCEPTION 'Active user with completed password setup required';
 END IF;
 IF NOT (public.fn_current_user_has_permission('budget.view')
   OR public.fn_current_user_has_permission('reports.view')
   OR public.fn_current_user_has_permission('budget.supplementary.enter')
   OR public.fn_current_user_has_permission('budget.reallocation.request')
   OR public.fn_current_user_has_permission('budget.reallocation.approve')
   OR public.fn_current_user_has_permission('budget.reallocation.execute')
   OR public.fn_current_user_has_permission('all')) THEN RAISE EXCEPTION 'Permission denied'; END IF;
 RETURN QUERY
WITH event_dimensions AS (
   SELECT c.id cycle_id,c.financial_year fy,db.id db_id,db.division_id dept_id,dbl.section_id sec_id,dbl.expense_ledger_id ledger_id
   FROM public.annual_budget_cycles c JOIN public.division_budgets db ON db.annual_budget_cycle_id=c.id JOIN public.division_budget_lines dbl ON dbl.division_budget_id=db.id
   WHERE c.financial_year=p_financial_year AND c.status='ACTIVE' AND db.status='LOCKED'
   UNION
   SELECT sa.annual_budget_cycle_id,sa.financial_year,sa.division_budget_id,db.division_id,sa.section_id,sa.expense_ledger_id
   FROM public.budget_supplementary_adjustments sa JOIN public.division_budgets db ON db.id=sa.division_budget_id JOIN public.annual_budget_cycles c ON c.id=sa.annual_budget_cycle_id
   WHERE sa.financial_year=p_financial_year AND sa.status='POSTED' AND c.status='ACTIVE' AND db.status='LOCKED'
   UNION
   SELECT br.annual_budget_cycle_id,br.financial_year,br.source_division_budget_id,db.division_id,br.source_section_id,br.source_expense_ledger_id
   FROM public.budget_reallocations br JOIN public.division_budgets db ON db.id=br.source_division_budget_id JOIN public.annual_budget_cycles c ON c.id=br.annual_budget_cycle_id
   WHERE br.financial_year=p_financial_year AND br.status='EXECUTED' AND c.status='ACTIVE' AND db.status='LOCKED'
   UNION
   SELECT br.annual_budget_cycle_id,br.financial_year,br.destination_division_budget_id,db.division_id,br.destination_section_id,br.destination_expense_ledger_id
   FROM public.budget_reallocations br JOIN public.division_budgets db ON db.id=br.destination_division_budget_id JOIN public.annual_budget_cycles c ON c.id=br.annual_budget_cycle_id
   WHERE br.financial_year=p_financial_year AND br.status='EXECUTED' AND c.status='ACTIVE' AND db.status='LOCKED'
 ),
 scoped_dimensions AS (
  SELECT e.* FROM event_dimensions e
  JOIN public.departments dep ON dep.id=e.dept_id AND dep.is_active=true
  JOIN public.court_locations loc ON loc.id=dep.court_location_id
    AND loc.location_type='HEADQUARTERS' AND loc.is_active=true
  JOIN public.sections sec ON sec.id=e.sec_id AND sec.department_id=dep.id AND sec.is_active=true
  JOIN public.expense_ledger el ON el.id=e.ledger_id AND el.is_active=true AND el.is_posting=true
  WHERE (p_division_id IS NULL OR e.dept_id=p_division_id)
    AND (p_section_id IS NULL OR e.sec_id=p_section_id)
    AND (p_expense_ledger_id IS NULL OR e.ledger_id=p_expense_ledger_id)
    AND public.fn_current_user_data_scope_allows(e.dept_id,e.sec_id,NULL,NULL,NULL)
 )
 SELECT e.cycle_id,e.fy,e.db_id,e.dept_id,e.sec_id,e.ledger_id,
   (b.position->>'original_budget')::numeric,
   (b.position->>'supplementary_adjustments')::numeric,
   (b.position->>'reallocations_in')::numeric,
   (b.position->>'reallocations_out')::numeric,
   (b.position->>'current_approved_budget')::numeric,
   (b.position->>'outstanding_commitments')::numeric,
   (b.position->>'actual_expenditure')::numeric,
   (b.position->>'available_budget')::numeric
 FROM scoped_dimensions e
 CROSS JOIN LATERAL (SELECT public.njss_calculate_ff3_budget(e.fy,e.dept_id,e.sec_id,e.ledger_id,NULL,1) position) b
 ORDER BY e.dept_id,e.sec_id,e.ledger_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_current_budget_position(integer,uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_budget_position(integer,uuid,uuid,uuid) TO authenticated;

-- Existing allocations are posting identities for FF3/FF4, not client-editable budgets.
REVOKE ALL ON public.budget_allocations FROM PUBLIC, anon, authenticated;
GRANT SELECT (id,financial_year,department_id,section_id,cost_centre_id,
 expense_code_registry_id,account_id,funding_source_id,source_module,is_active)
 ON public.budget_allocations TO authenticated;

DO $retire$
DECLARE r record;
BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
  'transition_divisional_budget_submission','transition_divisional_budget_submission_internal',
  'create_budget_submission_revision','consolidate_approved_excel_budgets',
  'njss_create_budget_revision_request','njss_transition_budget_revision',
  'njss_create_budget_revision','njss_create_budget_release','njss_commit_ff3','njss_commit_ff3_internal',
  'njss_create_funding_authority','njss_transition_funding_authority',
  'njss_create_funding_receipt','njss_transition_funding_receipt',
  'njss_allocate_funding','njss_approve_funding_allocation',
  'njss_prepare_budget_activation','njss_submit_budget_activation','njss_activate_approved_budget',
  'njss_budget_activation_mapping_worklist','njss_commit_budget_import_batch',
  'njss_validate_budget_import_batch','njss_spread_budget_line_allocation',
  'njss_recalc_budget_submission','njss_validate_budget_submission',
  'recalc_divisional_budget_submission_totals','generate_divisional_budget_submission_number',
  'generate_divisional_budget_line_number'
 ]) LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',r.signature);
 END LOOP;
 FOR r IN SELECT c.oid::regclass AS relation FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname=ANY(ARRAY[
  'annual_activity_plans','annual_plan_activities','annual_plan_headers','annual_plan_lines','budget_cycles','budget_periods','budget_divisions',
  'budget_division_ceilings','divisional_budget_submissions','divisional_budget_lines',
  'budget_monthly_allocations','budget_submission_attachments','budget_workflow_history',
  'budget_revisions','budget_revision_lines','budget_revision_history',
  'budget_activation_batches','budget_activation_lines','budget_activation_line_snapshots',
  'budget_activation_validations','budget_import_batches','budget_import_rows','budget_import_staging','budget_line_attachments','budget_consolidations',
  'funding_authorities','funding_receipts','funding_allocations','quarterly_releases',
  'budget_release_funding_lines','department_budget_consolidations',
  'v_department_financial_position','v_section_financial_position','v_expense_code_financial_position','v_ledger_utilisation','v_management_financial_summary','v_authoritative_budget_position','v_budget_by_code','v_budget_by_department',
  'v_budget_revision_history_report','v_budget_activation_queue','v_budget_approved_lines','v_budget_control','v_budget_dashboard','v_budget_import_validation','v_budget_monthly_cashflow','v_budget_revision_position','v_budget_revision_work_queue','v_budget_submission_summary','v_budget_template_lines','v_budget_validation_summary','v_department_consolidated_budget','v_department_consolidated_budget_monthly','v_releases_by_code','v_funding_source_financial_position','v_funding_source_report','v_funding_authority_register','v_funding_receipt_register',
  'v_funding_allocation_register','v_quarterly_expenditure_summary','v_cost_centre_financial_position'
 ]) LOOP
  EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated',r.relation);
 END LOOP;
END;
$retire$;

UPDATE public.menu_items SET is_active=false,updated_at=now()
 WHERE code IN ('budget.revisions','budget.funding','budget.plans');
UPDATE public.menu_items SET label='Annual Budget',
 required_permissions=ARRAY['budget.view','budget.capture','budget.registrar.approve','budget.documents.manage']::varchar[],
 updated_at=now() WHERE code='budget.template';
UPDATE public.menu_items SET label='Annual Activation',
 required_permissions=ARRAY['budget.view','budget.activate','budget.documents.manage']::varchar[],
 updated_at=now() WHERE code='budget.activation';
UPDATE public.menu_items SET label='Budget Position',
 required_permissions=ARRAY['budget.view']::varchar[],updated_at=now() WHERE code='budget.control';

-- Retired capabilities should not be re-enabled through the permission editor.
UPDATE public.role_permissions SET is_allowed=false WHERE permission LIKE 'budget.revision.%'
 OR permission LIKE 'budget.template%' OR permission LIKE 'funding.%'
 OR permission IN ('budget.release','budget.consolidate','consolidation.run',
   'budget.activation.prepare','budget.activation.submit','budget.activation.authorize');
UPDATE public.permissions SET is_active=false WHERE code LIKE 'budget.revision.%'
 OR code LIKE 'budget.template%' OR code LIKE 'funding.%'
 OR code IN ('budget.release','budget.consolidate','consolidation.run',
   'budget.activation.prepare','budget.activation.submit','budget.activation.authorize');


-- Scope draft/preparation reads too: permission-only original policies remain
-- permissive, while these restrictive policies apply to every authenticated read.
CREATE OR REPLACE FUNCTION public.njss_head_office_budget_read_scope(p_division_id uuid,p_section_id uuid DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public,pg_temp
AS $scope$
 SELECT EXISTS(SELECT 1 FROM public.users u WHERE u.auth_user_id=auth.uid()
   AND u.is_active=true AND u.must_change_password=false)
 AND (p_division_id IS NULL OR EXISTS(
   SELECT 1 FROM public.departments d JOIN public.court_locations l ON l.id=d.court_location_id
   WHERE d.id=p_division_id AND d.is_active=true AND l.is_active=true
     AND l.location_type='HEADQUARTERS'
     AND (p_section_id IS NULL OR EXISTS(SELECT 1 FROM public.sections s
       WHERE s.id=p_section_id AND s.department_id=d.id AND s.is_active=true))))
 AND (public.fn_current_user_data_scope_allows(p_division_id,p_section_id,NULL,NULL,NULL)
   OR (p_division_id IS NOT NULL AND p_section_id IS NULL AND EXISTS(
     SELECT 1 FROM public.sections s WHERE s.department_id=p_division_id AND s.is_active=true
       AND public.fn_current_user_data_scope_allows(p_division_id,s.id,NULL,NULL,NULL))));
$scope$;
REVOKE ALL ON FUNCTION public.njss_head_office_budget_read_scope(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.njss_head_office_budget_read_scope(uuid,uuid) TO authenticated;

DROP POLICY IF EXISTS division_budgets_head_office_scope ON public.division_budgets;
CREATE POLICY division_budgets_head_office_scope ON public.division_budgets AS RESTRICTIVE
FOR SELECT TO authenticated USING(public.njss_head_office_budget_read_scope(division_id));
DROP POLICY IF EXISTS division_budget_lines_head_office_scope ON public.division_budget_lines;
CREATE POLICY division_budget_lines_head_office_scope ON public.division_budget_lines AS RESTRICTIVE
FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.division_budgets b
 WHERE b.id=division_budget_id AND public.njss_head_office_budget_read_scope(b.division_id,section_id)));
DROP POLICY IF EXISTS budget_documents_head_office_scope ON public.budget_documents;
CREATE POLICY budget_documents_head_office_scope ON public.budget_documents AS RESTRICTIVE
FOR SELECT TO authenticated USING(
 (division_budget_id IS NULL AND public.njss_head_office_budget_read_scope(NULL)) OR
 EXISTS(SELECT 1 FROM public.division_budgets b WHERE b.id=division_budget_id
   AND public.njss_head_office_budget_read_scope(b.division_id)));
DROP POLICY IF EXISTS supplementary_head_office_scope ON public.budget_supplementary_adjustments;
CREATE POLICY supplementary_head_office_scope ON public.budget_supplementary_adjustments AS RESTRICTIVE
FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.division_budgets b
 WHERE b.id=division_budget_id AND public.njss_head_office_budget_read_scope(b.division_id,section_id)));
DROP POLICY IF EXISTS reallocation_head_office_scope ON public.budget_reallocations;
CREATE POLICY reallocation_head_office_scope ON public.budget_reallocations AS RESTRICTIVE
FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.division_budgets b
 WHERE (b.id=source_division_budget_id AND public.njss_head_office_budget_read_scope(b.division_id,source_section_id))
 OR (b.id=destination_division_budget_id AND public.njss_head_office_budget_read_scope(b.division_id,destination_section_id))));
-- Existing commitment adjustments must use annual limits, under the FF3 Division lock.
CREATE OR REPLACE FUNCTION public.njss_adjust_commitment(p_commitment_id uuid, p_action text, p_amount numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_user_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_commitment ff3_commitments;
  v_old ff3_commitments;
  v_budget budget_allocations;
  v_ff3 ff3_headers;
  v_actor UUID := fn_current_app_user_id();
  v_type TEXT;
  v_amount NUMERIC;
  v_position_before JSONB;
  v_position_after JSONB;
  v_available NUMERIC;
  v_shortfall NUMERIC;
  v_previous NUMERIC;
  v_new NUMERIC;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.users u
    WHERE u.auth_user_id=auth.uid() AND u.is_active=true AND u.must_change_password=false) THEN
    RAISE EXCEPTION 'Active user with completed password setup required';
  END IF;
  IF p_action NOT IN ('INCREASE','DECREASE','CANCEL','RELEASE_UNUSED_BALANCE') THEN
    RAISE EXCEPTION 'Invalid commitment action: %', p_action;
  END IF;
  PERFORM njss_require_permission(CASE
    WHEN p_action = 'INCREASE' OR p_action = 'DECREASE' THEN 'commitment.adjust'
    WHEN p_action = 'CANCEL' THEN 'commitment.cancel'
    ELSE 'commitment.release'
  END);
  IF COALESCE(TRIM(p_reason), '') = '' THEN RAISE EXCEPTION 'Reason is required for commitment %. ', p_action; END IF;

  -- Lock in the same order as annual FF3 commitment creation: header, Division, commitment.
  SELECT * INTO v_commitment FROM ff3_commitments WHERE id=p_commitment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commitment not found'; END IF;
  SELECT * INTO v_ff3 FROM ff3_headers WHERE id=v_commitment.ff3_header_id FOR UPDATE;
  IF NOT FOUND OR NOT public.njss_head_office_budget_read_scope(v_ff3.department_id,v_ff3.section_id) THEN
    RAISE EXCEPTION 'Commitment is outside the authorized Head Office scope';
  END IF;
  PERFORM db.id FROM public.division_budgets db JOIN public.annual_budget_cycles c ON c.id=db.annual_budget_cycle_id
    WHERE c.financial_year=v_ff3.financial_year AND c.status='ACTIVE'
      AND db.division_id=v_ff3.department_id AND db.status='LOCKED' FOR UPDATE OF db;
  SELECT * INTO v_commitment FROM ff3_commitments WHERE id = p_commitment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Commitment not found'; END IF;
  v_old := v_commitment;
  IF v_commitment.status IN ('CANCELLED','REVERSED','CLOSED') THEN RAISE EXCEPTION 'Cancel already cancelled commitment blocked.'; END IF;
  IF v_commitment.budget_allocation_id IS NULL THEN RAISE EXCEPTION 'Commitment is not linked to an exact budget allocation.'; END IF;

  IF fn_check_segregation_of_duties('COMMITMENT_ADJUSTMENT', v_commitment.created_by, NULL, v_commitment.approved_by, v_actor) IS FALSE THEN
    RAISE EXCEPTION 'Segregation of duties prevents the same user from requesting/approving this commitment adjustment.';
  END IF;

  SELECT * INTO v_budget FROM budget_allocations WHERE id = v_commitment.budget_allocation_id FOR UPDATE;
  IF v_ff3.expense_ledger_id IS NOT NULL THEN
    v_position_before := public.njss_calculate_ff3_budget(v_ff3.financial_year,v_ff3.department_id,
      v_ff3.section_id,v_ff3.expense_ledger_id,v_ff3.cost_centre_id,GREATEST(COALESCE(p_amount,1),1));
  ELSE
    -- Historical commitments may be reduced/cancelled, but cannot consume new annual funds.
    v_position_before := jsonb_build_object('status','NO_ACTIVE_BUDGET','position_exists',false,'available_budget',0);
  END IF;
  v_available := (v_position_before->>'available_budget')::NUMERIC;
  v_previous := COALESCE(v_commitment.current_committed_amount, v_commitment.committed_amount, 0);

  IF p_action = 'INCREASE' THEN
    IF COALESCE((v_position_before->>'position_exists')::boolean,false)=false THEN
      RAISE EXCEPTION 'An active annual Head Office budget is required for commitment increases';
    END IF;
    IF COALESCE((v_position_before->>'posting_mapping_count')::integer,0)<>1
      OR v_budget.financial_year IS DISTINCT FROM v_ff3.financial_year
      OR v_budget.department_id IS DISTINCT FROM v_ff3.department_id
      OR v_budget.section_id IS DISTINCT FROM v_ff3.section_id
      OR NOT EXISTS(SELECT 1 FROM public.finance_posting_mappings m
        WHERE m.expense_code_registry_id=v_budget.expense_code_registry_id
          AND m.expense_ledger_id=v_ff3.expense_ledger_id
          AND m.department_id=v_ff3.department_id AND m.section_id=v_ff3.section_id
          AND m.is_active=true AND (m.financial_year=v_ff3.financial_year OR m.financial_year IS NULL)) THEN
      RAISE EXCEPTION 'Valid annual financial posting linkage is required for commitment increases';
    END IF;
    v_type := 'INCREASE';
    v_amount := COALESCE(p_amount, 0);
    IF v_amount <= 0 THEN RAISE EXCEPTION 'Commitment increase amount must be greater than zero.'; END IF;
    IF v_amount > v_available + 0.001 THEN
      v_shortfall := v_amount - v_available;
      RAISE EXCEPTION 'Insufficient available budget for commitment increase. Available: K%, Requested: K%, Shortfall: K%.', v_available, v_amount, v_shortfall;
    END IF;
    v_new := v_previous + v_amount;
  ELSIF p_action = 'DECREASE' THEN
    v_type := 'DECREASE';
    v_amount := COALESCE(p_amount, 0);
    IF v_amount <= 0 THEN RAISE EXCEPTION 'Commitment decrease amount must be greater than zero.'; END IF;
    IF v_previous - v_amount < COALESCE(v_commitment.paid_amount, 0) - 0.001 THEN
      RAISE EXCEPTION 'Commitment decrease below paid amount blocked. Current: K%, Paid: K%, Requested decrease: K%.', v_previous, COALESCE(v_commitment.paid_amount,0), v_amount;
    END IF;
    v_new := v_previous - v_amount;
  ELSE
    v_type := CASE WHEN p_action = 'CANCEL' THEN 'CANCELLATION' ELSE 'RELEASE_UNUSED_BALANCE' END;
    v_amount := COALESCE(v_commitment.outstanding_amount, GREATEST(v_previous - COALESCE(v_commitment.paid_amount,0),0));
    IF v_amount <= 0 THEN RAISE EXCEPTION 'No outstanding commitment balance is available to release.'; END IF;
    v_new := v_previous - v_amount;
  END IF;

  INSERT INTO commitment_transactions (
    commitment_id, ff3_header_id, budget_allocation_id, transaction_type, amount,
    transaction_date, reason_code, reason, reference, previous_balance, new_balance,
    approved_by, created_by
  ) VALUES (
    v_commitment.id, v_commitment.ff3_header_id, v_commitment.budget_allocation_id, v_type, v_amount,
    CURRENT_DATE, p_action, p_reason, p_reference, v_previous, v_new, v_actor, v_actor
  );

  v_commitment := njss_sync_commitment_balances(v_commitment.id);
  IF p_action = 'CANCEL' THEN
    UPDATE ff3_commitments
    SET status = 'CANCELLED', cancelled_by = v_actor, cancellation_reason = p_reason, updated_at = NOW()
    WHERE id = p_commitment_id
    RETURNING * INTO v_commitment;
    UPDATE ff3_headers
    SET status = 'CANCELLED', cancelled_by = v_actor, cancellation_reason = p_reason, cancelled_at = NOW(), updated_at = NOW()
    WHERE id = v_commitment.ff3_header_id;
  END IF;

  v_position_after := CASE WHEN v_ff3.expense_ledger_id IS NOT NULL THEN
    public.njss_calculate_ff3_budget(v_ff3.financial_year,v_ff3.department_id,
      v_ff3.section_id,v_ff3.expense_ledger_id,v_ff3.cost_centre_id,1)
    ELSE v_position_before END;
  PERFORM log_audit_event(v_actor, p_user_email, COALESCE(p_user_email, 'System'), 'COMMITMENT_' || p_action, 'COMMITMENT', v_commitment.id, v_commitment.commitment_number, to_jsonb(v_old), to_jsonb(v_commitment), jsonb_build_object('transaction_type', v_type, 'amount', v_amount, 'old_amount', v_previous, 'new_amount', v_new, 'reason', p_reason, 'reference', p_reference, 'financial_position_before', v_position_before, 'financial_position_after', v_position_after), NULL);
  RETURN jsonb_build_object('commitment', to_jsonb(v_commitment), 'financial_position_before', v_position_before, 'financial_position_after', v_position_after);
END;
$function$;
CREATE OR REPLACE FUNCTION public.njss_transition_ff3(p_ff3_id uuid, p_action text, p_comments text DEFAULT NULL::text, p_user_email text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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

  IF NOT public.njss_head_office_budget_read_scope(v_ff3.department_id,v_ff3.section_id) THEN
    RAISE EXCEPTION 'FF3 is outside the authorized Head Office scope';
  END IF;
  -- Historical requests cannot create new commitments against the retired budget.
  IF v_ff3.expense_ledger_id IS NULL THEN
    IF p_action NOT IN ('CANCEL','REJECT','RETURN') THEN
      RAISE EXCEPTION 'Legacy budget workflow is retired; use an annual Head Office Ledger for this FF3';
    END IF;
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

REVOKE ALL ON FUNCTION public.njss_adjust_commitment(uuid,text,numeric,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.njss_adjust_commitment(uuid,text,numeric,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.njss_transition_ff3(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.njss_transition_ff3(uuid,text,text,text) TO authenticated;

-- Storage reads must follow the same registered-document scope as table reads.
DROP POLICY IF EXISTS budget_documents_head_office_storage_scope ON storage.objects;
CREATE POLICY budget_documents_head_office_storage_scope ON storage.objects AS RESTRICTIVE
FOR SELECT TO authenticated USING(bucket_id<>'njss-budget-documents' OR EXISTS(
 SELECT 1 FROM public.budget_documents d WHERE d.storage_bucket=bucket_id AND d.storage_path=name));

-- Posted financial dimensions are an audit identity, not editable form fields.
CREATE OR REPLACE FUNCTION public.njss_guard_committed_ff3_budget_key()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $guard$
BEGIN
 IF EXISTS(SELECT 1 FROM public.ff3_commitments c WHERE c.ff3_header_id=OLD.id) THEN
   IF TG_OP='DELETE' THEN
     RAISE EXCEPTION 'Committed FF3 annual budget identity cannot be changed or deleted';
   ELSIF (NEW.financial_year,NEW.department_id,NEW.section_id,NEW.expense_ledger_id)
     IS DISTINCT FROM (OLD.financial_year,OLD.department_id,OLD.section_id,OLD.expense_ledger_id) THEN
     RAISE EXCEPTION 'Committed FF3 annual budget identity cannot be changed or deleted';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.njss_guard_committed_ff3_budget_key() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS njss_guard_committed_ff3_budget_key ON public.ff3_headers;
CREATE TRIGGER njss_guard_committed_ff3_budget_key BEFORE UPDATE OR DELETE ON public.ff3_headers
FOR EACH ROW EXECUTE FUNCTION public.njss_guard_committed_ff3_budget_key();

CREATE OR REPLACE FUNCTION public.njss_guard_commitment_posting_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp
AS $guard$
BEGIN
 IF (NEW.ff3_header_id,NEW.budget_allocation_id,NEW.financial_year)
   IS DISTINCT FROM (OLD.ff3_header_id,OLD.budget_allocation_id,OLD.financial_year) THEN
   RAISE EXCEPTION 'Commitment financial posting identity cannot be changed';
 END IF;
 RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.njss_guard_commitment_posting_identity() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS njss_guard_commitment_posting_identity ON public.ff3_commitments;
CREATE TRIGGER njss_guard_commitment_posting_identity BEFORE UPDATE ON public.ff3_commitments
FOR EACH ROW EXECUTE FUNCTION public.njss_guard_commitment_posting_identity();
