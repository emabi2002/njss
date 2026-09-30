-- Manual signed approval precedes capture; the Registrar separately approves
-- the submitted electronic version. Existing LOCKED records remain locked.
ALTER TABLE public.division_budgets DROP CONSTRAINT IF EXISTS division_budgets_status_check;
ALTER TABLE public.division_budgets ALTER COLUMN status TYPE varchar(40);
ALTER TABLE public.division_budgets ADD CONSTRAINT division_budgets_status_check
  CHECK (status IN ('DRAFT','RETURNED','PENDING_REGISTRAR_APPROVAL','LOCKED'));
ALTER TABLE public.division_budgets
  ADD COLUMN IF NOT EXISTS review_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_document_id uuid REFERENCES public.budget_documents(id),
  ADD COLUMN IF NOT EXISTS submitted_fingerprint text,
  ADD COLUMN IF NOT EXISTS returned_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_reason text,
  ADD COLUMN IF NOT EXISTS approved_document_id uuid REFERENCES public.budget_documents(id),
  ADD COLUMN IF NOT EXISTS approved_fingerprint text;

INSERT INTO public.permissions(code,module_code,menu_code,action,label,description,is_active)
VALUES ('budget.registrar.approve','budget','budget.template','approve',
        'Registrar electronic budget approval','Review and approve submitted Division budgets',true)
ON CONFLICT (code) DO UPDATE SET is_active = true;

DELETE FROM public.role_permissions rp USING public.roles r
WHERE rp.role_id = r.id AND r.name = 'Budget Officer'
  AND rp.permission IN ('budget.lock','budget.registrar.approve');

INSERT INTO public.role_permissions(role_id,permission,is_allowed)
SELECT id,'budget.registrar.approve',true FROM public.roles WHERE name = 'Registrar'
ON CONFLICT (role_id,permission) DO UPDATE SET is_allowed = true;

-- The old lock RPC must not remain an alternate approval path.
REVOKE EXECUTE ON FUNCTION public.lock_division_budget(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.njss_division_budget_fingerprint(p_budget_id uuid, p_document_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT md5(p_document_id::text || ':' || COALESCE(
    string_agg(l.section_id::text || '/' || l.expense_ledger_id::text || '/' ||
      l.original_amount::text, '|'
      ORDER BY l.section_id, l.expense_ledger_id), ''))
  FROM public.division_budget_lines l WHERE l.division_budget_id = p_budget_id
$$;
REVOKE ALL ON FUNCTION public.njss_division_budget_fingerprint(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.njss_require_registrar_budget_approver()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.user_roles ur ON ur.user_id = u.id
    JOIN public.roles r ON r.id = ur.role_id
    WHERE u.id = auth.uid() AND u.is_active = true
      AND r.name = 'Registrar' AND r.is_active = true
  ) THEN RAISE EXCEPTION 'Active Registrar role required'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.njss_require_registrar_budget_approver() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_division_budget(p_division_budget_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_budget public.division_budgets%ROWTYPE;
  v_document_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.capture');
  SELECT * INTO v_budget FROM public.division_budgets
   WHERE id = p_division_budget_id FOR UPDATE;
  IF NOT FOUND OR v_budget.status NOT IN ('DRAFT','RETURNED') THEN
    RAISE EXCEPTION 'Division budget is not editable';
  END IF;
  IF v_budget.approval_date IS NULL THEN
    RAISE EXCEPTION 'Manual Registrar approval date is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.departments d JOIN public.court_locations cl
      ON cl.id = d.court_location_id
    WHERE d.id = v_budget.division_id AND cl.name = 'Waigani Headquarters'
      AND d.is_active = true
  ) THEN RAISE EXCEPTION 'Head Office Division required'; END IF;
  SELECT id INTO v_document_id FROM public.budget_documents
    WHERE division_budget_id = p_division_budget_id
      AND financial_year = v_budget.financial_year
      AND related_entity_type = 'DIVISION_BUDGET'
      AND related_entity_id = p_division_budget_id
      AND document_type = 'OFFICIAL_APPROVED_BUDGET'
    ORDER BY uploaded_at DESC, id DESC LIMIT 1;
  IF v_document_id IS NULL THEN
    RAISE EXCEPTION 'Signed or stamped document for this Division is required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.division_budget_lines WHERE division_budget_id = p_division_budget_id
  ) THEN RAISE EXCEPTION 'At least one ledger amount is required'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.division_budget_lines l
    LEFT JOIN public.sections s ON s.id = l.section_id
    LEFT JOIN public.expense_ledger e ON e.id = l.expense_ledger_id
    LEFT JOIN public.expense_ledger p ON p.id = e.parent_ledger_id
    WHERE l.division_budget_id = p_division_budget_id
      AND (s.department_id IS DISTINCT FROM v_budget.division_id
       OR s.is_active IS DISTINCT FROM true
       OR e.is_active IS DISTINCT FROM true OR e.is_posting IS DISTINCT FROM true
       OR p.is_active IS DISTINCT FROM true OR p.is_posting IS DISTINCT FROM false)
  ) THEN RAISE EXCEPTION 'Budget line has an invalid allocation or ledger category'; END IF;

  UPDATE public.division_budgets SET
    status = 'PENDING_REGISTRAR_APPROVAL',
    review_version = review_version + 1,
    submitted_by = auth.uid(), submitted_at = now(),
    submitted_document_id = v_document_id,
    submitted_fingerprint = public.njss_division_budget_fingerprint(p_division_budget_id,v_document_id),
    returned_by = NULL, returned_at = NULL, return_reason = NULL
  WHERE id = p_division_budget_id;
END $$;

CREATE OR REPLACE FUNCTION public.return_division_budget(
  p_division_budget_id uuid, p_expected_version integer, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE v_budget public.division_budgets%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.registrar.approve');
  PERFORM public.njss_require_registrar_budget_approver();
  SELECT * INTO v_budget FROM public.division_budgets WHERE id=p_division_budget_id FOR UPDATE;
  IF NOT FOUND OR v_budget.status <> 'PENDING_REGISTRAR_APPROVAL'
     OR p_expected_version <> v_budget.review_version THEN
    RAISE EXCEPTION 'Submitted review version is no longer current';
  END IF;
  IF v_budget.entered_by = auth.uid() OR v_budget.submitted_by = auth.uid() THEN
    RAISE EXCEPTION 'Receiving officer cannot review own submission';
  END IF;
  IF nullif(btrim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Return reason required'; END IF;
  UPDATE public.division_budgets
    SET status='RETURNED', returned_by=auth.uid(), returned_at=now(),
        return_reason=btrim(p_reason)
    WHERE id=p_division_budget_id;
END $$;

CREATE OR REPLACE FUNCTION public.approve_division_budget(
  p_division_budget_id uuid, p_expected_version integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_budget public.division_budgets%ROWTYPE;
  v_latest_document uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.registrar.approve');
  PERFORM public.njss_require_registrar_budget_approver();
  SELECT * INTO v_budget FROM public.division_budgets WHERE id=p_division_budget_id FOR UPDATE;
  IF NOT FOUND OR v_budget.status <> 'PENDING_REGISTRAR_APPROVAL'
     OR p_expected_version <> v_budget.review_version THEN
    RAISE EXCEPTION 'Submitted review version is no longer current';
  END IF;
  IF v_budget.entered_by = auth.uid() OR v_budget.submitted_by = auth.uid() THEN
    RAISE EXCEPTION 'Receiving officer cannot approve own submission';
  END IF;
  SELECT id INTO v_latest_document FROM public.budget_documents
   WHERE division_budget_id=p_division_budget_id AND related_entity_type='DIVISION_BUDGET'
     AND related_entity_id=p_division_budget_id AND document_type='OFFICIAL_APPROVED_BUDGET'
   ORDER BY uploaded_at DESC, id DESC LIMIT 1;
  IF v_latest_document IS DISTINCT FROM v_budget.submitted_document_id
    OR public.njss_division_budget_fingerprint(p_division_budget_id,v_latest_document)
       IS DISTINCT FROM v_budget.submitted_fingerprint THEN
    RAISE EXCEPTION 'Budget lines or signed document changed after submission';
  END IF;
  UPDATE public.division_budgets
    SET status='LOCKED', locked_by=auth.uid(), locked_at=now(),
        approved_document_id=v_latest_document,
        approved_fingerprint=v_budget.submitted_fingerprint
    WHERE id=p_division_budget_id;
  UPDATE public.annual_budget_cycles c SET status=CASE
    WHEN EXISTS (SELECT 1 FROM public.division_budgets d
      WHERE d.annual_budget_cycle_id=c.id AND d.status <> 'LOCKED')
      THEN 'PREPARATION' ELSE 'READY_FOR_ACTIVATION' END
    WHERE c.id=v_budget.annual_budget_cycle_id AND c.status NOT IN ('ACTIVE','CLOSED');
END $$;

REVOKE ALL ON FUNCTION public.submit_division_budget(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.return_division_budget(uuid,integer,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_division_budget(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_division_budget(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_division_budget(uuid,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_division_budget(uuid,integer) TO authenticated;

-- Permit editing only drafts and returned submissions.
CREATE OR REPLACE FUNCTION public.update_division_budget_draft_header(
  p_division_budget_id uuid,
  p_reference_number text DEFAULT NULL,
  p_approval_date date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.capture');

  UPDATE public.division_budgets
  SET reference_number = NULLIF(trim(p_reference_number), ''),
      approval_date = p_approval_date,
      updated_at = now()
  WHERE id = p_division_budget_id
    AND status IN ('DRAFT','RETURNED');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Division budget not found or is no longer editable';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_division_budget_line(
  p_division_budget_id uuid,
  p_section_id uuid,
  p_expense_ledger_id uuid,
  p_original_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_division_id uuid;
  v_status text;
  v_line_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.capture');

  IF p_original_amount IS NULL OR p_original_amount < 0 THEN
    RAISE EXCEPTION 'Budget amount cannot be negative';
  END IF;

  SELECT division_id, status
  INTO v_division_id, v_status
  FROM public.division_budgets
  WHERE id = p_division_budget_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Division budget not found';
  END IF;
  IF v_status NOT IN ('DRAFT','RETURNED') THEN
    RAISE EXCEPTION 'Submitted or approved Division budgets are immutable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sections s
    WHERE s.id = p_section_id
      AND s.department_id = v_division_id
      AND coalesce(s.is_active, true) = true
  ) THEN
    RAISE EXCEPTION 'Selected Section does not belong to this Division';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.expense_ledger l
    WHERE l.id = p_expense_ledger_id
      AND l.is_active = true
      AND l.is_posting = true
  ) THEN
    RAISE EXCEPTION 'Selected ledger is not an active posting ledger';
  END IF;

  IF p_original_amount = 0 THEN
    DELETE FROM public.division_budget_lines
    WHERE division_budget_id = p_division_budget_id
      AND section_id = p_section_id
      AND expense_ledger_id = p_expense_ledger_id
    RETURNING id INTO v_line_id;
    RETURN v_line_id;
  END IF;

  INSERT INTO public.division_budget_lines (
    division_budget_id,
    section_id,
    expense_ledger_id,
    original_amount
  ) VALUES (
    p_division_budget_id,
    p_section_id,
    p_expense_ledger_id,
    round(p_original_amount, 2)
  )
  ON CONFLICT (division_budget_id, section_id, expense_ledger_id) DO UPDATE
    SET original_amount = EXCLUDED.original_amount,
        updated_at = now()
  RETURNING id INTO v_line_id;

  RETURN v_line_id;
END;
$function$;
