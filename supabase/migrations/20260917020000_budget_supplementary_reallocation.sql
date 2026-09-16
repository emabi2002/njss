-- =============================================================================
-- NJSS SIMPLIFIED HEAD OFFICE BUDGET — SUPPLEMENTARY + REALLOCATION
-- Additive migration. Original annual budget lines remain immutable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Financial-event tables
-- -----------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.budget_supplementary_transaction_seq;
CREATE SEQUENCE IF NOT EXISTS public.budget_reallocation_transaction_seq;

CREATE TABLE IF NOT EXISTS public.budget_supplementary_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_number varchar(40) NOT NULL UNIQUE,
  annual_budget_cycle_id uuid NOT NULL REFERENCES public.annual_budget_cycles(id) ON DELETE RESTRICT,
  financial_year integer NOT NULL CHECK (financial_year BETWEEN 2000 AND 2200),
  division_budget_id uuid NOT NULL REFERENCES public.division_budgets(id) ON DELETE RESTRICT,
  section_id uuid NOT NULL REFERENCES public.sections(id) ON DELETE RESTRICT,
  expense_ledger_id uuid NOT NULL REFERENCES public.expense_ledger(id) ON DELETE RESTRICT,
  adjustment_amount numeric(18,2) NOT NULL CHECK (adjustment_amount <> 0),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED')),
  reason text NOT NULL,
  authority_reference varchar(180) NULL,
  authority_document_id uuid NULL REFERENCES public.budget_documents(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid NULL REFERENCES auth.users(id),
  posted_at timestamptz NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.budget_reallocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reallocation_number varchar(40) NOT NULL UNIQUE,
  annual_budget_cycle_id uuid NOT NULL REFERENCES public.annual_budget_cycles(id) ON DELETE RESTRICT,
  financial_year integer NOT NULL CHECK (financial_year BETWEEN 2000 AND 2200),
  status varchar(32) NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED', 'REGISTRAR_APPROVED', 'EXECUTED', 'REJECTED', 'CANCELLED')),
  reason text NOT NULL,
  requesting_division_id uuid NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  source_division_budget_id uuid NOT NULL REFERENCES public.division_budgets(id) ON DELETE RESTRICT,
  source_section_id uuid NOT NULL REFERENCES public.sections(id) ON DELETE RESTRICT,
  source_expense_ledger_id uuid NOT NULL REFERENCES public.expense_ledger(id) ON DELETE RESTRICT,
  destination_division_budget_id uuid NOT NULL REFERENCES public.division_budgets(id) ON DELETE RESTRICT,
  destination_section_id uuid NOT NULL REFERENCES public.sections(id) ON DELETE RESTRICT,
  destination_expense_ledger_id uuid NOT NULL REFERENCES public.expense_ledger(id) ON DELETE RESTRICT,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  authority_reference varchar(180) NULL,
  authority_document_id uuid NULL REFERENCES public.budget_documents(id) ON DELETE RESTRICT,
  registrar_approved_by uuid NULL REFERENCES auth.users(id),
  registrar_approved_at timestamptz NULL,
  rejection_reason text NULL,
  rejected_by uuid NULL REFERENCES auth.users(id),
  rejected_at timestamptz NULL,
  executed_by uuid NULL REFERENCES auth.users(id),
  executed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    source_division_budget_id IS DISTINCT FROM destination_division_budget_id
    OR source_section_id IS DISTINCT FROM destination_section_id
    OR source_expense_ledger_id IS DISTINCT FROM destination_expense_ledger_id
  )
);

CREATE INDEX IF NOT EXISTS idx_budget_supplementary_position
  ON public.budget_supplementary_adjustments(financial_year, division_budget_id, section_id, expense_ledger_id, status);
CREATE INDEX IF NOT EXISTS idx_budget_supplementary_cycle_status
  ON public.budget_supplementary_adjustments(annual_budget_cycle_id, status);
CREATE INDEX IF NOT EXISTS idx_budget_reallocations_cycle_status
  ON public.budget_reallocations(annual_budget_cycle_id, status);
CREATE INDEX IF NOT EXISTS idx_budget_reallocations_source
  ON public.budget_reallocations(financial_year, source_division_budget_id, source_section_id, source_expense_ledger_id, status);
CREATE INDEX IF NOT EXISTS idx_budget_reallocations_destination
  ON public.budget_reallocations(financial_year, destination_division_budget_id, destination_section_id, destination_expense_ledger_id, status);

-- -----------------------------------------------------------------------------
-- 2. Permissions and role assignments
-- -----------------------------------------------------------------------------
INSERT INTO public.permissions (code, module_code, menu_code, action, label, description, is_active)
VALUES
  ('budget.supplementary.enter', 'budget', 'budget.template', 'edit', 'Enter supplementary budget', 'Create and post approved supplementary budget adjustments', true),
  ('budget.reallocation.request', 'budget', 'budget.template', 'create', 'Request budget reallocation', 'Request movement of available budget between Head Office budget positions', true),
  ('budget.reallocation.approve', 'budget', 'budget.template', 'approve', 'Approve budget reallocation', 'Registrar-only authority to approve or reject budget reallocations', true),
  ('budget.reallocation.execute', 'budget', 'budget.template', 'manage', 'Execute budget reallocation', 'Execute Registrar-approved budget reallocations', true)
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
CROSS JOIN (
  VALUES
    ('budget.supplementary.enter'::varchar),
    ('budget.reallocation.execute'::varchar)
) AS p(permission)
WHERE r.name = 'Budget Officer'
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

INSERT INTO public.role_permissions (role_id, permission, is_allowed)
SELECT r.id, 'budget.reallocation.approve', true
FROM public.roles r
WHERE r.name = 'Registrar'
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

-- Deliberately do not auto-assign budget.reallocation.request to Line Supervisor.
-- It must be assigned to the actual Division Director user/role through Access Control.

-- -----------------------------------------------------------------------------
-- 3. Financial-event immutability
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_protect_posted_budget_supplementary()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted supplementary budget transactions are immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted supplementary budget transactions are immutable';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.njss_protect_budget_reallocation_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('REGISTRAR_APPROVED', 'EXECUTED', 'REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Approved or terminal reallocation history is immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IN ('EXECUTED', 'REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Terminal reallocation history is immutable';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'REGISTRAR_APPROVED' THEN
    IF NEW.financial_year IS DISTINCT FROM OLD.financial_year
       OR NEW.annual_budget_cycle_id IS DISTINCT FROM OLD.annual_budget_cycle_id
       OR NEW.source_division_budget_id IS DISTINCT FROM OLD.source_division_budget_id
       OR NEW.source_section_id IS DISTINCT FROM OLD.source_section_id
       OR NEW.source_expense_ledger_id IS DISTINCT FROM OLD.source_expense_ledger_id
       OR NEW.destination_division_budget_id IS DISTINCT FROM OLD.destination_division_budget_id
       OR NEW.destination_section_id IS DISTINCT FROM OLD.destination_section_id
       OR NEW.destination_expense_ledger_id IS DISTINCT FROM OLD.destination_expense_ledger_id
       OR NEW.amount IS DISTINCT FROM OLD.amount
       OR NEW.reason IS DISTINCT FROM OLD.reason
       OR NEW.authority_reference IS DISTINCT FROM OLD.authority_reference
       OR NEW.authority_document_id IS DISTINCT FROM OLD.authority_document_id
       OR NEW.registrar_approved_by IS DISTINCT FROM OLD.registrar_approved_by
       OR NEW.registrar_approved_at IS DISTINCT FROM OLD.registrar_approved_at THEN
      RAISE EXCEPTION 'Registrar-approved reallocation terms are immutable';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS trg_budget_supplementary_protect_posted ON public.budget_supplementary_adjustments;
CREATE TRIGGER trg_budget_supplementary_protect_posted
BEFORE UPDATE OR DELETE ON public.budget_supplementary_adjustments
FOR EACH ROW EXECUTE FUNCTION public.njss_protect_posted_budget_supplementary();

DROP TRIGGER IF EXISTS trg_budget_reallocation_protect_history ON public.budget_reallocations;
CREATE TRIGGER trg_budget_reallocation_protect_history
BEFORE UPDATE OR DELETE ON public.budget_reallocations
FOR EACH ROW EXECUTE FUNCTION public.njss_protect_budget_reallocation_history();

REVOKE EXECUTE ON FUNCTION public.njss_protect_posted_budget_supplementary() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_protect_budget_reallocation_history() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 4. Authoritative budget position
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_current_budget_position
WITH (security_invoker = true)
AS
WITH position_keys AS (
  SELECT db.financial_year, db.division_id, dbl.section_id, dbl.expense_ledger_id
  FROM public.division_budget_lines dbl
  JOIN public.division_budgets db ON db.id = dbl.division_budget_id

  UNION

  SELECT s.financial_year, db.division_id, s.section_id, s.expense_ledger_id
  FROM public.budget_supplementary_adjustments s
  JOIN public.division_budgets db ON db.id = s.division_budget_id
  WHERE s.status = 'POSTED'

  UNION

  SELECT r.financial_year, sdb.division_id, r.source_section_id, r.source_expense_ledger_id
  FROM public.budget_reallocations r
  JOIN public.division_budgets sdb ON sdb.id = r.source_division_budget_id
  WHERE r.status = 'EXECUTED'

  UNION

  SELECT r.financial_year, ddb.division_id, r.destination_section_id, r.destination_expense_ledger_id
  FROM public.budget_reallocations r
  JOIN public.division_budgets ddb ON ddb.id = r.destination_division_budget_id
  WHERE r.status = 'EXECUTED'
),
originals AS (
  SELECT db.financial_year, db.division_id, dbl.section_id, dbl.expense_ledger_id,
         sum(dbl.original_amount)::numeric(18,2) AS original_budget
  FROM public.division_budget_lines dbl
  JOIN public.division_budgets db ON db.id = dbl.division_budget_id
  GROUP BY db.financial_year, db.division_id, dbl.section_id, dbl.expense_ledger_id
),
supplementary AS (
  SELECT s.financial_year, db.division_id, s.section_id, s.expense_ledger_id,
         sum(s.adjustment_amount)::numeric(18,2) AS supplementary_adjustments
  FROM public.budget_supplementary_adjustments s
  JOIN public.division_budgets db ON db.id = s.division_budget_id
  WHERE s.status = 'POSTED'
  GROUP BY s.financial_year, db.division_id, s.section_id, s.expense_ledger_id
),
reallocation_out AS (
  SELECT r.financial_year, db.division_id, r.source_section_id AS section_id,
         r.source_expense_ledger_id AS expense_ledger_id,
         sum(r.amount)::numeric(18,2) AS reallocations_out
  FROM public.budget_reallocations r
  JOIN public.division_budgets db ON db.id = r.source_division_budget_id
  WHERE r.status = 'EXECUTED'
  GROUP BY r.financial_year, db.division_id, r.source_section_id, r.source_expense_ledger_id
),
reallocation_in AS (
  SELECT r.financial_year, db.division_id, r.destination_section_id AS section_id,
         r.destination_expense_ledger_id AS expense_ledger_id,
         sum(r.amount)::numeric(18,2) AS reallocations_in
  FROM public.budget_reallocations r
  JOIN public.division_budgets db ON db.id = r.destination_division_budget_id
  WHERE r.status = 'EXECUTED'
  GROUP BY r.financial_year, db.division_id, r.destination_section_id, r.destination_expense_ledger_id
),
commitments AS (
  SELECT c.financial_year, h.department_id AS division_id, h.section_id,
         ecr.expense_ledger_id,
         sum(greatest(coalesce(c.outstanding_amount, c.remaining_balance, c.current_committed_amount, c.committed_amount, 0), 0))::numeric(18,2) AS outstanding_commitments
  FROM public.ff3_commitments c
  JOIN public.ff3_headers h ON h.id = c.ff3_header_id
  JOIN public.expense_code_registry ecr ON ecr.id = h.expense_code_registry_id
  WHERE ecr.expense_ledger_id IS NOT NULL
    AND coalesce(c.status, '') NOT IN ('CANCELLED', 'CLOSED', 'PAID', 'RELEASED')
    AND coalesce(c.outstanding_amount, c.remaining_balance, c.current_committed_amount, c.committed_amount, 0) > 0
  GROUP BY c.financial_year, h.department_id, h.section_id, ecr.expense_ledger_id
),
actuals AS (
  SELECT pt.financial_year, fh.department_id AS division_id, fh.section_id,
         ecr.expense_ledger_id,
         sum(
           CASE
             WHEN upper(coalesce(pt.transaction_type, '')) = 'REVERSAL' THEN -abs(pt.amount)
             ELSE pt.amount
           END
         )::numeric(18,2) AS actual_expenditure
  FROM public.payment_transactions pt
  JOIN public.ff4_headers fh ON fh.id = pt.ff4_header_id
  JOIN public.expense_code_registry ecr ON ecr.id = fh.expense_code_registry_id
  WHERE ecr.expense_ledger_id IS NOT NULL
    AND pt.status IN ('POSTED', 'RECONCILED')
  GROUP BY pt.financial_year, fh.department_id, fh.section_id, ecr.expense_ledger_id
)
SELECT
  k.financial_year,
  c.id AS annual_budget_cycle_id,
  c.status AS annual_cycle_status,
  (c.status = 'ACTIVE') AS is_authoritative,
  k.division_id,
  d.code AS division_code,
  d.name AS division_name,
  k.section_id,
  s.code AS section_code,
  s.name AS section_name,
  k.expense_ledger_id,
  l.ledger_number,
  l.finance_code,
  l.standard_description AS ledger_description,
  coalesce(o.original_budget, 0)::numeric(18,2) AS original_budget,
  coalesce(sa.supplementary_adjustments, 0)::numeric(18,2) AS supplementary_adjustments,
  coalesce(ri.reallocations_in, 0)::numeric(18,2) AS reallocations_in,
  coalesce(ro.reallocations_out, 0)::numeric(18,2) AS reallocations_out,
  (
    coalesce(o.original_budget, 0)
    + coalesce(sa.supplementary_adjustments, 0)
    + coalesce(ri.reallocations_in, 0)
    - coalesce(ro.reallocations_out, 0)
  )::numeric(18,2) AS current_approved_budget,
  coalesce(cm.outstanding_commitments, 0)::numeric(18,2) AS outstanding_commitments,
  coalesce(a.actual_expenditure, 0)::numeric(18,2) AS actual_expenditure,
  (
    coalesce(o.original_budget, 0)
    + coalesce(sa.supplementary_adjustments, 0)
    + coalesce(ri.reallocations_in, 0)
    - coalesce(ro.reallocations_out, 0)
    - coalesce(cm.outstanding_commitments, 0)
    - coalesce(a.actual_expenditure, 0)
  )::numeric(18,2) AS available_budget
FROM position_keys k
JOIN public.annual_budget_cycles c ON c.financial_year = k.financial_year
JOIN public.departments d ON d.id = k.division_id
JOIN public.sections s ON s.id = k.section_id
JOIN public.expense_ledger l ON l.id = k.expense_ledger_id
LEFT JOIN originals o USING (financial_year, division_id, section_id, expense_ledger_id)
LEFT JOIN supplementary sa USING (financial_year, division_id, section_id, expense_ledger_id)
LEFT JOIN reallocation_in ri USING (financial_year, division_id, section_id, expense_ledger_id)
LEFT JOIN reallocation_out ro USING (financial_year, division_id, section_id, expense_ledger_id)
LEFT JOIN commitments cm USING (financial_year, division_id, section_id, expense_ledger_id)
LEFT JOIN actuals a USING (financial_year, division_id, section_id, expense_ledger_id);

GRANT SELECT ON public.v_current_budget_position TO authenticated;
REVOKE ALL ON public.v_current_budget_position FROM anon;

-- -----------------------------------------------------------------------------
-- 5. Shared validation helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_validate_active_budget_position(
  p_financial_year integer,
  p_division_budget_id uuid,
  p_section_id uuid,
  p_expense_ledger_id uuid
)
RETURNS TABLE(
  cycle_id uuid,
  division_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  RETURN QUERY
  SELECT db.annual_budget_cycle_id, db.division_id
  FROM public.division_budgets db
  JOIN public.annual_budget_cycles c ON c.id = db.annual_budget_cycle_id
  JOIN public.sections s ON s.id = p_section_id
  JOIN public.expense_ledger l ON l.id = p_expense_ledger_id
  WHERE db.id = p_division_budget_id
    AND db.financial_year = p_financial_year
    AND db.status = 'LOCKED'
    AND c.financial_year = p_financial_year
    AND c.status = 'ACTIVE'
    AND s.department_id = db.division_id
    AND coalesce(s.is_active, true) = true
    AND l.is_active = true
    AND l.is_posting = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget position must belong to a locked Division in the ACTIVE annual budget';
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.njss_validate_active_budget_position(integer, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Supplementary budget RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_supplementary_adjustment_draft(
  p_financial_year integer,
  p_division_budget_id uuid,
  p_section_id uuid,
  p_expense_ledger_id uuid,
  p_adjustment_amount numeric,
  p_reason text,
  p_authority_reference text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_cycle_id uuid;
  v_adjustment_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.supplementary.enter');

  IF p_adjustment_amount IS NULL OR round(p_adjustment_amount, 2) = 0 THEN
    RAISE EXCEPTION 'Supplementary adjustment amount must be non-zero';
  END IF;
  IF nullif(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Supplementary adjustment reason is required';
  END IF;

  SELECT cycle_id INTO v_cycle_id
  FROM public.njss_validate_active_budget_position(
    p_financial_year,
    p_division_budget_id,
    p_section_id,
    p_expense_ledger_id
  );

  INSERT INTO public.budget_supplementary_adjustments (
    transaction_number,
    annual_budget_cycle_id,
    financial_year,
    division_budget_id,
    section_id,
    expense_ledger_id,
    adjustment_amount,
    reason,
    authority_reference,
    created_by
  ) VALUES (
    format('SUP-%s-%s', p_financial_year, lpad(nextval('public.budget_supplementary_transaction_seq')::text, 6, '0')),
    v_cycle_id,
    p_financial_year,
    p_division_budget_id,
    p_section_id,
    p_expense_ledger_id,
    round(p_adjustment_amount, 2),
    trim(p_reason),
    nullif(trim(p_authority_reference), ''),
    auth.uid()
  )
  RETURNING id INTO v_adjustment_id;

  RETURN v_adjustment_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.post_supplementary_adjustment(
  p_adjustment_id uuid,
  p_authority_document_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_adjustment public.budget_supplementary_adjustments%ROWTYPE;
  v_division_id uuid;
  v_available numeric(18,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.supplementary.enter');

  SELECT * INTO v_adjustment
  FROM public.budget_supplementary_adjustments
  WHERE id = p_adjustment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplementary adjustment not found';
  END IF;
  IF v_adjustment.status = 'POSTED' THEN
    RETURN;
  END IF;

  SELECT division_id INTO v_division_id
  FROM public.division_budgets
  WHERE id = v_adjustment.division_budget_id;

  PERFORM 1 FROM public.njss_validate_active_budget_position(
    v_adjustment.financial_year,
    v_adjustment.division_budget_id,
    v_adjustment.section_id,
    v_adjustment.expense_ledger_id
  );

  IF NOT EXISTS (
    SELECT 1
    FROM public.budget_documents d
    WHERE d.id = p_authority_document_id
      AND d.financial_year = v_adjustment.financial_year
      AND d.related_entity_type = 'SUPPLEMENTARY'
      AND d.related_entity_id = v_adjustment.id
      AND d.document_type = 'SUPPLEMENTARY_AUTHORITY'
  ) THEN
    RAISE EXCEPTION 'Approved supplementary authority document is required';
  END IF;

  IF v_adjustment.adjustment_amount < 0 THEN
    SELECT p.available_budget INTO v_available
    FROM public.v_current_budget_position p
    WHERE p.financial_year = v_adjustment.financial_year
      AND p.division_id = v_division_id
      AND p.section_id = v_adjustment.section_id
      AND p.expense_ledger_id = v_adjustment.expense_ledger_id
      AND p.annual_cycle_status = 'ACTIVE';

    v_available := coalesce(v_available, 0);
    IF abs(v_adjustment.adjustment_amount) > v_available THEN
      RAISE EXCEPTION 'Negative supplementary adjustment exceeds available budget';
    END IF;
  END IF;

  UPDATE public.budget_supplementary_adjustments
  SET status = 'POSTED',
      authority_document_id = p_authority_document_id,
      posted_by = auth.uid(),
      posted_at = now(),
      updated_at = now()
  WHERE id = v_adjustment.id;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 7. Reallocation RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_budget_reallocation(
  p_financial_year integer,
  p_source_division_budget_id uuid,
  p_source_section_id uuid,
  p_source_expense_ledger_id uuid,
  p_destination_division_budget_id uuid,
  p_destination_section_id uuid,
  p_destination_expense_ledger_id uuid,
  p_amount numeric,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_source_cycle_id uuid;
  v_destination_cycle_id uuid;
  v_source_division_id uuid;
  v_reallocation_id uuid;
  v_source_available_budget numeric(18,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.reallocation.request');

  IF p_amount IS NULL OR round(p_amount, 2) <= 0 THEN
    RAISE EXCEPTION 'Reallocation amount must be greater than zero';
  END IF;
  IF nullif(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Reallocation reason is required';
  END IF;
  IF p_source_division_budget_id = p_destination_division_budget_id
     AND p_source_section_id = p_destination_section_id
     AND p_source_expense_ledger_id = p_destination_expense_ledger_id THEN
    RAISE EXCEPTION 'Source and destination budget positions must be different';
  END IF;

  SELECT cycle_id, division_id INTO v_source_cycle_id, v_source_division_id
  FROM public.njss_validate_active_budget_position(
    p_financial_year,
    p_source_division_budget_id,
    p_source_section_id,
    p_source_expense_ledger_id
  );

  SELECT cycle_id INTO v_destination_cycle_id
  FROM public.njss_validate_active_budget_position(
    p_financial_year,
    p_destination_division_budget_id,
    p_destination_section_id,
    p_destination_expense_ledger_id
  );

  IF v_source_cycle_id <> v_destination_cycle_id THEN
    RAISE EXCEPTION 'Source and destination must belong to the same active annual budget';
  END IF;

  SELECT p.available_budget INTO v_source_available_budget
  FROM public.v_current_budget_position p
  WHERE p.financial_year = p_financial_year
    AND p.division_id = v_source_division_id
    AND p.section_id = p_source_section_id
    AND p.expense_ledger_id = p_source_expense_ledger_id
    AND p.annual_cycle_status = 'ACTIVE';

  v_source_available_budget := coalesce(v_source_available_budget, 0);
  IF round(p_amount, 2) > v_source_available_budget THEN
    RAISE EXCEPTION 'Requested reallocation exceeds source available budget';
  END IF;

  INSERT INTO public.budget_reallocations (
    reallocation_number,
    annual_budget_cycle_id,
    financial_year,
    reason,
    requesting_division_id,
    requested_by,
    source_division_budget_id,
    source_section_id,
    source_expense_ledger_id,
    destination_division_budget_id,
    destination_section_id,
    destination_expense_ledger_id,
    amount
  ) VALUES (
    format('REL-%s-%s', p_financial_year, lpad(nextval('public.budget_reallocation_transaction_seq')::text, 6, '0')),
    v_source_cycle_id,
    p_financial_year,
    trim(p_reason),
    v_source_division_id,
    auth.uid(),
    p_source_division_budget_id,
    p_source_section_id,
    p_source_expense_ledger_id,
    p_destination_division_budget_id,
    p_destination_section_id,
    p_destination_expense_ledger_id,
    round(p_amount, 2)
  )
  RETURNING id INTO v_reallocation_id;

  RETURN v_reallocation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.approve_budget_reallocation(
  p_reallocation_id uuid,
  p_authority_reference text,
  p_authority_document_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_reallocation public.budget_reallocations%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.reallocation.approve');
  IF NOT public.njss_current_user_has_role('Registrar') THEN
    RAISE EXCEPTION 'Only the Registrar may approve a budget reallocation';
  END IF;
  IF nullif(trim(p_authority_reference), '') IS NULL THEN
    RAISE EXCEPTION 'Registrar authority reference is required';
  END IF;

  SELECT * INTO v_reallocation
  FROM public.budget_reallocations
  WHERE id = p_reallocation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reallocation not found';
  END IF;
  IF v_reallocation.status <> 'REQUESTED' THEN
    RAISE EXCEPTION 'Only requested reallocations may be approved';
  END IF;

  IF p_authority_document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.budget_documents d
    WHERE d.id = p_authority_document_id
      AND d.financial_year = v_reallocation.financial_year
      AND d.related_entity_type = 'REALLOCATION'
      AND d.related_entity_id = v_reallocation.id
      AND d.document_type = 'REGISTRAR_REALLOCATION_AUTHORITY'
  ) THEN
    RAISE EXCEPTION 'Registrar reallocation authority document does not match this reallocation';
  END IF;

  UPDATE public.budget_reallocations
  SET status = 'REGISTRAR_APPROVED',
      authority_reference = trim(p_authority_reference),
      authority_document_id = p_authority_document_id,
      registrar_approved_by = auth.uid(),
      registrar_approved_at = now(),
      updated_at = now()
  WHERE id = v_reallocation.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reject_budget_reallocation(
  p_reallocation_id uuid,
  p_reason text
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
  PERFORM public.njss_require_permission('budget.reallocation.approve');
  IF NOT public.njss_current_user_has_role('Registrar') THEN
    RAISE EXCEPTION 'Only the Registrar may reject a budget reallocation';
  END IF;
  IF nullif(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Rejection reason is required';
  END IF;

  UPDATE public.budget_reallocations
  SET status = 'REJECTED',
      rejection_reason = trim(p_reason),
      rejected_by = auth.uid(),
      rejected_at = now(),
      updated_at = now()
  WHERE id = p_reallocation_id
    AND status = 'REQUESTED';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only requested reallocations may be rejected';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.execute_budget_reallocation(
  p_reallocation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_reallocation public.budget_reallocations%ROWTYPE;
  v_source_division_id uuid;
  v_source_available_budget numeric(18,2);
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.reallocation.execute');

  SELECT * INTO v_reallocation
  FROM public.budget_reallocations
  WHERE id = p_reallocation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reallocation not found';
  END IF;
  IF v_reallocation.status <> 'REGISTRAR_APPROVED' THEN
    RAISE EXCEPTION 'Reallocation requires Registrar approval before execution';
  END IF;
  IF nullif(trim(v_reallocation.authority_reference), '') IS NULL
     OR v_reallocation.registrar_approved_by IS NULL
     OR v_reallocation.registrar_approved_at IS NULL THEN
    RAISE EXCEPTION 'Registrar authority is incomplete';
  END IF;

  SELECT division_id INTO v_source_division_id
  FROM public.division_budgets
  WHERE id = v_reallocation.source_division_budget_id
  FOR UPDATE;

  PERFORM 1 FROM public.njss_validate_active_budget_position(
    v_reallocation.financial_year,
    v_reallocation.source_division_budget_id,
    v_reallocation.source_section_id,
    v_reallocation.source_expense_ledger_id
  );
  PERFORM 1 FROM public.njss_validate_active_budget_position(
    v_reallocation.financial_year,
    v_reallocation.destination_division_budget_id,
    v_reallocation.destination_section_id,
    v_reallocation.destination_expense_ledger_id
  );

  SELECT p.available_budget INTO v_source_available_budget
  FROM public.v_current_budget_position p
  WHERE p.financial_year = v_reallocation.financial_year
    AND p.division_id = v_source_division_id
    AND p.section_id = v_reallocation.source_section_id
    AND p.expense_ledger_id = v_reallocation.source_expense_ledger_id
    AND p.annual_cycle_status = 'ACTIVE';

  v_source_available_budget := coalesce(v_source_available_budget, 0);
  IF v_reallocation.amount > v_source_available_budget THEN
    RAISE EXCEPTION 'Reallocation amount exceeds source available budget';
  END IF;

  UPDATE public.budget_reallocations
  SET status = 'EXECUTED',
      executed_by = auth.uid(),
      executed_at = now(),
      updated_at = now()
  WHERE id = v_reallocation.id;
END;
$function$;

-- -----------------------------------------------------------------------------
-- 8. RPC exposure
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.create_supplementary_adjustment_draft(integer, uuid, uuid, uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supplementary_adjustment_draft(integer, uuid, uuid, uuid, numeric, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.post_supplementary_adjustment(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_supplementary_adjustment(uuid, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.request_budget_reallocation(integer, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_budget_reallocation(integer, uuid, uuid, uuid, uuid, uuid, uuid, numeric, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.approve_budget_reallocation(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_budget_reallocation(uuid, text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.reject_budget_reallocation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_budget_reallocation(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.execute_budget_reallocation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_budget_reallocation(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 9. RLS + direct-client privilege model
-- -----------------------------------------------------------------------------
ALTER TABLE public.budget_supplementary_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_reallocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS budget_supplementary_read_authorized ON public.budget_supplementary_adjustments;
CREATE POLICY budget_supplementary_read_authorized ON public.budget_supplementary_adjustments
FOR SELECT TO authenticated
USING (
  public.fn_current_user_has_permission('budget.view')
  OR public.fn_current_user_has_permission('budget.supplementary.enter')
  OR public.fn_current_user_has_permission('budget.report.view')
  OR public.fn_current_user_has_permission('all')
);

DROP POLICY IF EXISTS budget_reallocation_read_authorized ON public.budget_reallocations;
CREATE POLICY budget_reallocation_read_authorized ON public.budget_reallocations
FOR SELECT TO authenticated
USING (
  public.fn_current_user_has_permission('budget.view')
  OR public.fn_current_user_has_permission('budget.reallocation.request')
  OR public.fn_current_user_has_permission('budget.reallocation.approve')
  OR public.fn_current_user_has_permission('budget.reallocation.execute')
  OR public.fn_current_user_has_permission('budget.report.view')
  OR public.fn_current_user_has_permission('all')
);

GRANT SELECT ON public.budget_supplementary_adjustments, public.budget_reallocations TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.budget_supplementary_adjustments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.budget_reallocations FROM anon, authenticated;
REVOKE ALL ON public.budget_supplementary_adjustments, public.budget_reallocations FROM anon;
REVOKE ALL ON SEQUENCE public.budget_supplementary_transaction_seq, public.budget_reallocation_transaction_seq FROM PUBLIC, anon, authenticated;

-- Extend budget-document read/storage access to the new authorised adjustment roles.
DROP POLICY IF EXISTS budget_documents_read_authorized ON public.budget_documents;
CREATE POLICY budget_documents_read_authorized ON public.budget_documents
FOR SELECT TO authenticated
USING (
  public.fn_current_user_has_permission('budget.view')
  OR public.fn_current_user_has_permission('budget.documents.manage')
  OR public.fn_current_user_has_permission('budget.lock')
  OR public.fn_current_user_has_permission('budget.activate')
  OR public.fn_current_user_has_permission('budget.supplementary.enter')
  OR public.fn_current_user_has_permission('budget.reallocation.request')
  OR public.fn_current_user_has_permission('budget.reallocation.approve')
  OR public.fn_current_user_has_permission('budget.reallocation.execute')
  OR public.fn_current_user_has_permission('all')
);

DROP POLICY IF EXISTS budget_documents_storage_read ON storage.objects;
CREATE POLICY budget_documents_storage_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'njss-budget-documents'
  AND (
    public.fn_current_user_has_permission('budget.view')
    OR public.fn_current_user_has_permission('budget.documents.manage')
    OR public.fn_current_user_has_permission('budget.lock')
    OR public.fn_current_user_has_permission('budget.activate')
    OR public.fn_current_user_has_permission('budget.supplementary.enter')
    OR public.fn_current_user_has_permission('budget.reallocation.request')
    OR public.fn_current_user_has_permission('budget.reallocation.approve')
    OR public.fn_current_user_has_permission('budget.reallocation.execute')
    OR public.fn_current_user_has_permission('all')
  )
);

-- -----------------------------------------------------------------------------
-- 10. Post-migration invariants
-- -----------------------------------------------------------------------------
DO $verify$
BEGIN
  IF has_table_privilege('authenticated', 'public.budget_supplementary_adjustments', 'INSERT')
     OR has_table_privilege('authenticated', 'public.budget_supplementary_adjustments', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.budget_supplementary_adjustments', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated users must not directly mutate supplementary transactions';
  END IF;

  IF has_table_privilege('authenticated', 'public.budget_reallocations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.budget_reallocations', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.budget_reallocations', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated users must not directly mutate reallocations';
  END IF;

  IF has_function_privilege('anon', 'public.approve_budget_reallocation(uuid,text,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous users must not approve budget reallocations';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    JOIN public.roles r ON r.id = rp.role_id
    WHERE rp.permission = 'budget.reallocation.approve'
      AND rp.is_allowed = true
      AND r.name = 'Registrar'
  ) THEN
    RAISE EXCEPTION 'Registrar must hold budget.reallocation.approve';
  END IF;
END
$verify$;
