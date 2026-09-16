-- =============================================================================
-- NJSS SIMPLIFIED HEAD OFFICE BUDGET — ADJUSTMENTS AND REALLOCATIONS
-- Additive Phase 2 migration. Existing legacy budget/FF3/FF4 data is preserved.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Controlled financial-event tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.budget_supplementary_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_number varchar(64) NOT NULL UNIQUE,
  annual_budget_cycle_id uuid NOT NULL REFERENCES public.annual_budget_cycles(id) ON DELETE RESTRICT,
  financial_year integer NOT NULL CHECK (financial_year BETWEEN 2000 AND 2200),
  division_budget_id uuid NOT NULL REFERENCES public.division_budgets(id) ON DELETE RESTRICT,
  section_id uuid NOT NULL REFERENCES public.sections(id) ON DELETE RESTRICT,
  expense_ledger_id uuid NOT NULL REFERENCES public.expense_ledger(id) ON DELETE RESTRICT,
  adjustment_amount numeric(18,2) NOT NULL CHECK (adjustment_amount <> 0),
  reason text NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','POSTED')),
  authority_document_id uuid NULL REFERENCES public.budget_documents(id) ON DELETE RESTRICT,
  entered_by uuid NOT NULL REFERENCES auth.users(id),
  entered_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid NULL REFERENCES auth.users(id),
  posted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.budget_reallocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reallocation_number varchar(64) NOT NULL UNIQUE,
  annual_budget_cycle_id uuid NOT NULL REFERENCES public.annual_budget_cycles(id) ON DELETE RESTRICT,
  financial_year integer NOT NULL CHECK (financial_year BETWEEN 2000 AND 2200),
  status varchar(32) NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED','REGISTRAR_APPROVED','REJECTED','EXECUTED')),
  requesting_division_id uuid NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  source_division_budget_id uuid NOT NULL REFERENCES public.division_budgets(id) ON DELETE RESTRICT,
  source_section_id uuid NOT NULL REFERENCES public.sections(id) ON DELETE RESTRICT,
  source_expense_ledger_id uuid NOT NULL REFERENCES public.expense_ledger(id) ON DELETE RESTRICT,
  destination_division_budget_id uuid NOT NULL REFERENCES public.division_budgets(id) ON DELETE RESTRICT,
  destination_section_id uuid NOT NULL REFERENCES public.sections(id) ON DELETE RESTRICT,
  destination_expense_ledger_id uuid NOT NULL REFERENCES public.expense_ledger(id) ON DELETE RESTRICT,
  transfer_amount numeric(18,2) NOT NULL CHECK (transfer_amount > 0),
  reason text NOT NULL,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  registrar_approved_by uuid NULL REFERENCES auth.users(id),
  registrar_approved_at timestamptz NULL,
  registrar_authority_document_id uuid NULL REFERENCES public.budget_documents(id) ON DELETE RESTRICT,
  rejected_by uuid NULL REFERENCES auth.users(id),
  rejected_at timestamptz NULL,
  rejection_reason text NULL,
  executed_by uuid NULL REFERENCES auth.users(id),
  executed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    source_division_budget_id <> destination_division_budget_id
    OR source_section_id <> destination_section_id
    OR source_expense_ledger_id <> destination_expense_ledger_id
  )
);

CREATE INDEX IF NOT EXISTS idx_budget_supplementary_position
  ON public.budget_supplementary_adjustments(financial_year, division_budget_id, section_id, expense_ledger_id, status);
CREATE INDEX IF NOT EXISTS idx_budget_realloc_source
  ON public.budget_reallocations(financial_year, source_division_budget_id, source_section_id, source_expense_ledger_id, status);
CREATE INDEX IF NOT EXISTS idx_budget_realloc_destination
  ON public.budget_reallocations(financial_year, destination_division_budget_id, destination_section_id, destination_expense_ledger_id, status);
CREATE INDEX IF NOT EXISTS idx_budget_realloc_status
  ON public.budget_reallocations(financial_year, status);

-- -----------------------------------------------------------------------------
-- 2. Permissions and role grants
-- -----------------------------------------------------------------------------
INSERT INTO public.permissions (code, module_code, menu_code, action, label, description, is_active)
VALUES
  ('budget.supplementary.enter', 'budget', 'budget.control', 'edit', 'Enter supplementary budget', 'Capture and post approved supplementary budget adjustments', true),
  ('budget.reallocation.request', 'budget', 'budget.control', 'create', 'Request budget reallocation', 'Request transfer of available budget between Head Office budget lines', true),
  ('budget.reallocation.approve', 'budget', 'budget.control', 'approve', 'Approve budget reallocation', 'Registrar-only authority to approve Head Office budget reallocations', true),
  ('budget.reallocation.execute', 'budget', 'budget.control', 'edit', 'Execute budget reallocation', 'Budget Officer execution of Registrar-approved budget reallocations', true)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  menu_code = EXCLUDED.menu_code,
  action = EXCLUDED.action,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active = true;

INSERT INTO public.role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.permission, true
FROM public.roles r
CROSS JOIN (VALUES
  ('budget.supplementary.enter'::varchar),
  ('budget.reallocation.execute'::varchar)
) AS p(permission)
WHERE r.name = 'Budget Officer' AND r.is_active = true
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

-- Registrar approval is intentionally granted only to the Registrar business role.
INSERT INTO public.role_permissions (role_id, permission, is_allowed)
SELECT r.id, 'budget.reallocation.approve', true
FROM public.roles r
WHERE r.name = 'Registrar' AND r.is_active = true
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

-- Remove any accidental normal role grant of this new permission from non-Registrar roles.
DELETE FROM public.role_permissions rp
USING public.roles r
WHERE rp.role_id = r.id
  AND rp.permission = 'budget.reallocation.approve'
  AND r.name <> 'Registrar';

-- Request permission is deliberately not auto-granted because production currently has
-- no canonical Division Director role. It can be assigned to the approved Director role
-- through Access Control once that business role is configured.

-- -----------------------------------------------------------------------------
-- 3. Number generators and immutable posted-event guards
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_next_supplementary_number(p_financial_year integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_next bigint;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(transaction_number, '^SUP-[0-9]{4}-', ''), '')::bigint), 0) + 1
  INTO v_next
  FROM public.budget_supplementary_adjustments
  WHERE financial_year = p_financial_year;
  RETURN format('SUP-%s-%s', p_financial_year, lpad(v_next::text, 6, '0'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.njss_next_reallocation_number(p_financial_year integer)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_next bigint;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(reallocation_number, '^REL-[0-9]{4}-', ''), '')::bigint), 0) + 1
  INTO v_next
  FROM public.budget_reallocations
  WHERE financial_year = p_financial_year;
  RETURN format('REL-%s-%s', p_financial_year, lpad(v_next::text, 6, '0'));
END;
$function$;

CREATE OR REPLACE FUNCTION public.njss_protect_posted_supplementary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted supplementary adjustments are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted supplementary adjustments are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.njss_protect_executed_reallocation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'EXECUTED' THEN
    RAISE EXCEPTION 'Executed budget reallocations are immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'EXECUTED' THEN
    RAISE EXCEPTION 'Executed budget reallocations are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS trg_budget_supplementary_protect_posted ON public.budget_supplementary_adjustments;
CREATE TRIGGER trg_budget_supplementary_protect_posted
BEFORE UPDATE OR DELETE ON public.budget_supplementary_adjustments
FOR EACH ROW EXECUTE FUNCTION public.njss_protect_posted_supplementary();

DROP TRIGGER IF EXISTS trg_budget_reallocation_protect_executed ON public.budget_reallocations;
CREATE TRIGGER trg_budget_reallocation_protect_executed
BEFORE UPDATE OR DELETE ON public.budget_reallocations
FOR EACH ROW EXECUTE FUNCTION public.njss_protect_executed_reallocation();

REVOKE EXECUTE ON FUNCTION public.njss_next_supplementary_number(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_next_reallocation_number(integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_protect_posted_supplementary() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_protect_executed_reallocation() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Authoritative current-budget-position function
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_current_budget_position(
  p_financial_year integer,
  p_division_id uuid DEFAULT NULL,
  p_section_id uuid DEFAULT NULL,
  p_expense_ledger_id uuid DEFAULT NULL
)
RETURNS TABLE (
  annual_budget_cycle_id uuid,
  financial_year integer,
  division_budget_id uuid,
  division_id uuid,
  section_id uuid,
  expense_ledger_id uuid,
  original_budget numeric,
  supplementary_adjustments numeric,
  reallocations_in numeric,
  reallocations_out numeric,
  current_approved_budget numeric,
  outstanding_commitments numeric,
  actual_expenditure numeric,
  available_budget numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.view');

  RETURN QUERY
  WITH base AS (
    SELECT
      c.id AS cycle_id,
      c.financial_year AS fy,
      db.id AS db_id,
      db.division_id AS dept_id,
      dbl.section_id AS sec_id,
      dbl.expense_ledger_id AS ledger_id,
      dbl.original_amount::numeric AS original_amount
    FROM public.annual_budget_cycles c
    JOIN public.division_budgets db ON db.annual_budget_cycle_id = c.id
    JOIN public.division_budget_lines dbl ON dbl.division_budget_id = db.id
    WHERE c.financial_year = p_financial_year
      AND c.status = 'ACTIVE'
      AND db.status = 'LOCKED'
      AND (p_division_id IS NULL OR db.division_id = p_division_id)
      AND (p_section_id IS NULL OR dbl.section_id = p_section_id)
      AND (p_expense_ledger_id IS NULL OR dbl.expense_ledger_id = p_expense_ledger_id)
  ), position AS (
    SELECT b.*,
      COALESCE((
        SELECT SUM(sa.adjustment_amount)
        FROM public.budget_supplementary_adjustments sa
        WHERE sa.annual_budget_cycle_id = b.cycle_id
          AND sa.division_budget_id = b.db_id
          AND sa.section_id = b.sec_id
          AND sa.expense_ledger_id = b.ledger_id
          AND sa.status = 'POSTED'
      ), 0)::numeric AS supplementary,
      COALESCE((
        SELECT SUM(br.transfer_amount)
        FROM public.budget_reallocations br
        WHERE br.annual_budget_cycle_id = b.cycle_id
          AND br.destination_division_budget_id = b.db_id
          AND br.destination_section_id = b.sec_id
          AND br.destination_expense_ledger_id = b.ledger_id
          AND br.status = 'EXECUTED'
      ), 0)::numeric AS realloc_in,
      COALESCE((
        SELECT SUM(br.transfer_amount)
        FROM public.budget_reallocations br
        WHERE br.annual_budget_cycle_id = b.cycle_id
          AND br.source_division_budget_id = b.db_id
          AND br.source_section_id = b.sec_id
          AND br.source_expense_ledger_id = b.ledger_id
          AND br.status = 'EXECUTED'
      ), 0)::numeric AS realloc_out,
      COALESCE((
        SELECT SUM(COALESCE(fc.outstanding_amount, fc.remaining_balance, 0))
        FROM public.ff3_commitments fc
        JOIN public.budget_allocations ba ON ba.id = fc.budget_allocation_id
        WHERE fc.financial_year = b.fy
          AND COALESCE(fc.status, '') NOT IN ('CANCELLED','CLOSED')
          AND ba.financial_year = b.fy
          AND ba.department_id = b.dept_id
          AND ba.section_id = b.sec_id
          AND EXISTS (
            SELECT 1 FROM public.finance_posting_mappings fpm
            WHERE fpm.financial_year = b.fy
              AND fpm.department_id = b.dept_id
              AND fpm.section_id = b.sec_id
              AND fpm.expense_ledger_id = b.ledger_id
              AND fpm.expense_code_registry_id = ba.expense_code_registry_id
              AND fpm.is_active = true
          )
      ), 0)::numeric AS commitments,
      COALESCE((
        SELECT SUM(CASE WHEN upper(COALESCE(pt.transaction_type,'')) = 'REVERSAL'
                        THEN -abs(pt.amount) ELSE pt.amount END)
        FROM public.payment_transactions pt
        JOIN public.budget_allocations ba ON ba.id = pt.budget_allocation_id
        WHERE pt.financial_year = b.fy
          AND pt.status IN ('POSTED','RECONCILED')
          AND ba.financial_year = b.fy
          AND ba.department_id = b.dept_id
          AND ba.section_id = b.sec_id
          AND EXISTS (
            SELECT 1 FROM public.finance_posting_mappings fpm
            WHERE fpm.financial_year = b.fy
              AND fpm.department_id = b.dept_id
              AND fpm.section_id = b.sec_id
              AND fpm.expense_ledger_id = b.ledger_id
              AND fpm.expense_code_registry_id = ba.expense_code_registry_id
              AND fpm.is_active = true
          )
      ), 0)::numeric AS actuals
    FROM base b
  )
  SELECT
    p.cycle_id,
    p.fy,
    p.db_id,
    p.dept_id,
    p.sec_id,
    p.ledger_id,
    p.original_amount,
    p.supplementary,
    p.realloc_in,
    p.realloc_out,
    (p.original_amount + p.supplementary + p.realloc_in - p.realloc_out)::numeric,
    p.commitments,
    p.actuals,
    (p.original_amount + p.supplementary + p.realloc_in - p.realloc_out - p.commitments - p.actuals)::numeric
  FROM position p;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 5. Supplementary draft and posting RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_budget_supplementary_draft(
  p_financial_year integer,
  p_division_budget_id uuid,
  p_section_id uuid,
  p_expense_ledger_id uuid,
  p_adjustment_amount numeric,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_id uuid;
  v_cycle_id uuid;
  v_division_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.supplementary.enter');
  IF NOT public.njss_current_user_has_role('Budget Officer') THEN
    RAISE EXCEPTION 'Only the Budget Officer may enter supplementary budgets';
  END IF;
  IF p_adjustment_amount IS NULL OR p_adjustment_amount = 0 THEN
    RAISE EXCEPTION 'Supplementary adjustment amount must be non-zero';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;

  SELECT db.annual_budget_cycle_id, db.division_id
    INTO v_cycle_id, v_division_id
  FROM public.division_budgets db
  JOIN public.annual_budget_cycles c ON c.id = db.annual_budget_cycle_id
  WHERE db.id = p_division_budget_id
    AND db.financial_year = p_financial_year
    AND db.status = 'LOCKED'
    AND c.status = 'ACTIVE'
  FOR UPDATE OF db;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplementary adjustment requires an active locked Division budget'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.sections s WHERE s.id = p_section_id AND s.department_id = v_division_id AND COALESCE(s.is_active,true)) THEN
    RAISE EXCEPTION 'Selected Section does not belong to the Division';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.division_budget_lines l WHERE l.division_budget_id = p_division_budget_id AND l.section_id = p_section_id AND l.expense_ledger_id = p_expense_ledger_id) THEN
    RAISE EXCEPTION 'Selected budget line does not exist in the approved original budget';
  END IF;

  INSERT INTO public.budget_supplementary_adjustments(
    transaction_number, annual_budget_cycle_id, financial_year, division_budget_id,
    section_id, expense_ledger_id, adjustment_amount, reason, status, entered_by
  ) VALUES (
    public.njss_next_supplementary_number(p_financial_year), v_cycle_id, p_financial_year,
    p_division_budget_id, p_section_id, p_expense_ledger_id, p_adjustment_amount,
    trim(p_reason), 'DRAFT', auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_budget_supplementary_draft(
  p_adjustment_id uuid,
  p_adjustment_amount numeric,
  p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.supplementary.enter');
  IF NOT public.njss_current_user_has_role('Budget Officer') THEN
    RAISE EXCEPTION 'Only the Budget Officer may enter supplementary budgets';
  END IF;
  IF p_adjustment_amount IS NULL OR p_adjustment_amount = 0 THEN RAISE EXCEPTION 'Supplementary adjustment amount must be non-zero'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;

  UPDATE public.budget_supplementary_adjustments
  SET adjustment_amount = p_adjustment_amount, reason = trim(p_reason), updated_at = now()
  WHERE id = p_adjustment_id AND status = 'DRAFT';
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplementary draft not found or already posted'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_budget_supplementary_adjustment(
  p_adjustment_id uuid,
  p_authority_document_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_row public.budget_supplementary_adjustments%ROWTYPE;
  v_available numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.supplementary.enter');
  IF NOT public.njss_current_user_has_role('Budget Officer') THEN
    RAISE EXCEPTION 'Only the Budget Officer may post supplementary budgets';
  END IF;

  SELECT * INTO v_row FROM public.budget_supplementary_adjustments WHERE id = p_adjustment_id FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'DRAFT' THEN RAISE EXCEPTION 'Supplementary adjustment is not an editable draft'; END IF;

  PERFORM 1 FROM public.division_budget_lines l
  WHERE l.division_budget_id = v_row.division_budget_id
    AND l.section_id = v_row.section_id
    AND l.expense_ledger_id = v_row.expense_ledger_id
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1 FROM public.annual_budget_cycles c
    WHERE c.id = v_row.annual_budget_cycle_id AND c.status = 'ACTIVE'
  ) THEN RAISE EXCEPTION 'Supplementary adjustments may only be posted to an active annual budget'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.budget_documents d
    WHERE d.id = p_authority_document_id
      AND d.related_entity_type = 'SUPPLEMENTARY'
      AND d.related_entity_id = p_adjustment_id
      AND d.document_type = 'SUPPLEMENTARY_AUTHORITY'
      AND d.financial_year = v_row.financial_year
  ) THEN RAISE EXCEPTION 'A valid supplementary authority document is required'; END IF;

  IF v_row.adjustment_amount < 0 THEN
    SELECT p.available_budget INTO v_available
    FROM public.get_current_budget_position(v_row.financial_year, NULL, v_row.section_id, v_row.expense_ledger_id) p
    WHERE p.division_budget_id = v_row.division_budget_id;
    IF v_available IS NULL OR v_available + v_row.adjustment_amount < 0 THEN
      RAISE EXCEPTION 'Approved reduction would reduce the budget below protected commitments or actual expenditure';
    END IF;
  END IF;

  UPDATE public.budget_supplementary_adjustments
  SET status='POSTED', authority_document_id=p_authority_document_id,
      posted_by=auth.uid(), posted_at=now(), updated_at=now()
  WHERE id=p_adjustment_id;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 6. Reallocation request / Registrar approval / Budget Officer execution
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_budget_reallocation(
  p_financial_year integer,
  p_requesting_division_id uuid,
  p_source_division_budget_id uuid,
  p_source_section_id uuid,
  p_source_expense_ledger_id uuid,
  p_destination_division_budget_id uuid,
  p_destination_section_id uuid,
  p_destination_expense_ledger_id uuid,
  p_transfer_amount numeric,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_id uuid;
  v_source_cycle uuid;
  v_destination_cycle uuid;
  v_source_division uuid;
  v_destination_division uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.reallocation.request');
  IF p_transfer_amount IS NULL OR p_transfer_amount <= 0 THEN RAISE EXCEPTION 'Transfer amount must be greater than zero'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Reason is required'; END IF;
  IF p_source_division_budget_id = p_destination_division_budget_id
     AND p_source_section_id = p_destination_section_id
     AND p_source_expense_ledger_id = p_destination_expense_ledger_id THEN
    RAISE EXCEPTION 'Source and destination budget keys must be different';
  END IF;

  SELECT db.annual_budget_cycle_id, db.division_id INTO v_source_cycle, v_source_division
  FROM public.division_budgets db JOIN public.annual_budget_cycles c ON c.id=db.annual_budget_cycle_id
  WHERE db.id=p_source_division_budget_id AND db.financial_year=p_financial_year AND db.status='LOCKED' AND c.status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Source must belong to the active locked annual budget'; END IF;

  SELECT db.annual_budget_cycle_id, db.division_id INTO v_destination_cycle, v_destination_division
  FROM public.division_budgets db JOIN public.annual_budget_cycles c ON c.id=db.annual_budget_cycle_id
  WHERE db.id=p_destination_division_budget_id AND db.financial_year=p_financial_year AND db.status='LOCKED' AND c.status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Destination must belong to the active locked annual budget'; END IF;
  IF v_source_cycle <> v_destination_cycle THEN RAISE EXCEPTION 'Reallocation source and destination must be in the same annual budget cycle'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.sections WHERE id=p_source_section_id AND department_id=v_source_division AND COALESCE(is_active,true))
     OR NOT EXISTS (SELECT 1 FROM public.division_budget_lines WHERE division_budget_id=p_source_division_budget_id AND section_id=p_source_section_id AND expense_ledger_id=p_source_expense_ledger_id) THEN
    RAISE EXCEPTION 'Invalid source budget key';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sections WHERE id=p_destination_section_id AND department_id=v_destination_division AND COALESCE(is_active,true))
     OR NOT EXISTS (SELECT 1 FROM public.division_budget_lines WHERE division_budget_id=p_destination_division_budget_id AND section_id=p_destination_section_id AND expense_ledger_id=p_destination_expense_ledger_id) THEN
    RAISE EXCEPTION 'Invalid destination budget key';
  END IF;

  INSERT INTO public.budget_reallocations(
    reallocation_number, annual_budget_cycle_id, financial_year, status, requesting_division_id,
    source_division_budget_id, source_section_id, source_expense_ledger_id,
    destination_division_budget_id, destination_section_id, destination_expense_ledger_id,
    transfer_amount, reason, requested_by
  ) VALUES (
    public.njss_next_reallocation_number(p_financial_year), v_source_cycle, p_financial_year, 'REQUESTED', p_requesting_division_id,
    p_source_division_budget_id, p_source_section_id, p_source_expense_ledger_id,
    p_destination_division_budget_id, p_destination_section_id, p_destination_expense_ledger_id,
    p_transfer_amount, trim(p_reason), auth.uid()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_budget_reallocation(p_reallocation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.reallocation.approve');
  IF NOT public.njss_current_user_has_role('Registrar') THEN
    RAISE EXCEPTION 'Only the Registrar may approve budget reallocations';
  END IF;
  UPDATE public.budget_reallocations
  SET status='REGISTRAR_APPROVED', registrar_approved_by=auth.uid(), registrar_approved_at=now(), updated_at=now()
  WHERE id=p_reallocation_id AND status='REQUESTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Reallocation is not pending Registrar approval'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_budget_reallocation(p_reallocation_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.reallocation.approve');
  IF NOT public.njss_current_user_has_role('Registrar') THEN
    RAISE EXCEPTION 'Only the Registrar may reject budget reallocations';
  END IF;
  IF NULLIF(trim(p_reason),'') IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
  UPDATE public.budget_reallocations
  SET status='REJECTED', rejected_by=auth.uid(), rejected_at=now(), rejection_reason=trim(p_reason), updated_at=now()
  WHERE id=p_reallocation_id AND status='REQUESTED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Reallocation is not pending Registrar decision'; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.execute_budget_reallocation(
  p_reallocation_id uuid,
  p_authority_document_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_row public.budget_reallocations%ROWTYPE;
  v_available numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  PERFORM public.njss_require_permission('budget.reallocation.execute');
  IF NOT public.njss_current_user_has_role('Budget Officer') THEN
    RAISE EXCEPTION 'Only the Budget Officer may execute budget reallocations';
  END IF;

  SELECT * INTO v_row FROM public.budget_reallocations WHERE id=p_reallocation_id FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'REGISTRAR_APPROVED' THEN
    RAISE EXCEPTION 'Only Registrar-approved reallocations may be executed';
  END IF;

  -- Lock both original lines in deterministic order to serialize competing transfers.
  PERFORM 1 FROM public.division_budget_lines l
  WHERE (l.division_budget_id=v_row.source_division_budget_id AND l.section_id=v_row.source_section_id AND l.expense_ledger_id=v_row.source_expense_ledger_id)
     OR (l.division_budget_id=v_row.destination_division_budget_id AND l.section_id=v_row.destination_section_id AND l.expense_ledger_id=v_row.destination_expense_ledger_id)
  ORDER BY l.id
  FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM public.annual_budget_cycles c WHERE c.id=v_row.annual_budget_cycle_id AND c.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'Reallocation requires an active annual budget';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.budget_documents d
    WHERE d.id=p_authority_document_id
      AND d.related_entity_type='REALLOCATION'
      AND d.related_entity_id=p_reallocation_id
      AND d.document_type = 'REGISTRAR_REALLOCATION_AUTHORITY'
      AND d.financial_year=v_row.financial_year
  ) THEN RAISE EXCEPTION 'Registrar reallocation authority correspondence is required'; END IF;

  SELECT p.available_budget INTO v_available
  FROM public.get_current_budget_position(v_row.financial_year, NULL, v_row.source_section_id, v_row.source_expense_ledger_id) p
  WHERE p.division_budget_id=v_row.source_division_budget_id;

  IF v_available IS NULL THEN RAISE EXCEPTION 'Source budget position is unavailable'; END IF;
  IF v_row.transfer_amount > v_available THEN
    RAISE EXCEPTION 'Reallocation amount exceeds source available budget';
  END IF;

  UPDATE public.budget_reallocations
  SET status='EXECUTED', registrar_authority_document_id=p_authority_document_id,
      executed_by=auth.uid(), executed_at=now(), updated_at=now()
  WHERE id=p_reallocation_id;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 7. RLS, table privileges and RPC exposure
-- -----------------------------------------------------------------------------
ALTER TABLE public.budget_supplementary_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_reallocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budget_supplementary_read_authorized ON public.budget_supplementary_adjustments;
CREATE POLICY budget_supplementary_read_authorized ON public.budget_supplementary_adjustments
FOR SELECT TO authenticated
USING (public.fn_current_user_has_permission('budget.view') OR public.fn_current_user_has_permission('all'));

DROP POLICY IF EXISTS budget_reallocations_read_authorized ON public.budget_reallocations;
CREATE POLICY budget_reallocations_read_authorized ON public.budget_reallocations
FOR SELECT TO authenticated
USING (public.fn_current_user_has_permission('budget.view') OR public.fn_current_user_has_permission('budget.reallocation.request') OR public.fn_current_user_has_permission('budget.reallocation.approve') OR public.fn_current_user_has_permission('budget.reallocation.execute') OR public.fn_current_user_has_permission('all'));

REVOKE ALL ON TABLE public.budget_supplementary_adjustments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.budget_reallocations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.budget_supplementary_adjustments TO authenticated;
GRANT SELECT ON TABLE public.budget_reallocations TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_current_budget_position(integer, uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_budget_supplementary_draft(integer, uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_budget_supplementary_draft(uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.post_budget_supplementary_adjustment(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_budget_reallocation(integer, uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_budget_reallocation(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reject_budget_reallocation(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.execute_budget_reallocation(uuid, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_current_budget_position(integer, uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_budget_supplementary_draft(integer, uuid, uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_budget_supplementary_draft(uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_budget_supplementary_adjustment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_budget_reallocation(integer, uuid, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_budget_reallocation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_budget_reallocation(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.execute_budget_reallocation(uuid, uuid) TO authenticated;
