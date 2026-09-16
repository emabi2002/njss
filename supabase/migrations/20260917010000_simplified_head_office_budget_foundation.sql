-- =============================================================================
-- NJSS SIMPLIFIED HEAD OFFICE BUDGET FOUNDATION
-- Additive migration for the approved Head Office budget redesign.
-- Existing legacy budget, FF3, FF4, commitment and payment tables are preserved.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Core annual budget capture tables
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.annual_budget_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year integer NOT NULL UNIQUE CHECK (financial_year BETWEEN 2000 AND 2200),
  status varchar(32) NOT NULL DEFAULT 'PREPARATION'
    CHECK (status IN ('PREPARATION', 'READY_FOR_ACTIVATION', 'ACTIVE', 'CLOSED')),
  activation_authority_document_id uuid NULL,
  activated_by uuid NULL REFERENCES auth.users(id),
  activated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.division_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  annual_budget_cycle_id uuid NOT NULL REFERENCES public.annual_budget_cycles(id) ON DELETE RESTRICT,
  financial_year integer NOT NULL CHECK (financial_year BETWEEN 2000 AND 2200),
  division_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE RESTRICT,
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'LOCKED')),
  reference_number varchar(120) NULL,
  approval_date date NULL,
  entered_by uuid NULL REFERENCES auth.users(id),
  locked_by uuid NULL REFERENCES auth.users(id),
  locked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (annual_budget_cycle_id, division_id)
);

CREATE TABLE IF NOT EXISTS public.division_budget_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  division_budget_id uuid NOT NULL REFERENCES public.division_budgets(id) ON DELETE CASCADE,
  section_id uuid NOT NULL REFERENCES public.sections(id) ON DELETE RESTRICT,
  expense_ledger_id uuid NOT NULL REFERENCES public.expense_ledger(id) ON DELETE RESTRICT,
  original_amount numeric(18,2) NOT NULL DEFAULT 0 CHECK (original_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (division_budget_id, section_id, expense_ledger_id)
);

CREATE TABLE IF NOT EXISTS public.budget_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year integer NOT NULL CHECK (financial_year BETWEEN 2000 AND 2200),
  division_budget_id uuid NULL REFERENCES public.division_budgets(id) ON DELETE RESTRICT,
  related_entity_type varchar(64) NOT NULL CHECK (
    related_entity_type IN (
      'DIVISION_BUDGET',
      'ANNUAL_BUDGET_CYCLE',
      'SUPPLEMENTARY',
      'REALLOCATION',
      'OTHER'
    )
  ),
  related_entity_id uuid NULL,
  document_type varchar(64) NOT NULL CHECK (
    document_type IN (
      'WORKING_SPREADSHEET',
      'OFFICIAL_APPROVED_BUDGET',
      'REGISTRAR_ACTIVATION_AUTHORITY',
      'SUPPLEMENTARY_AUTHORITY',
      'REGISTRAR_REALLOCATION_AUTHORITY',
      'OTHER'
    )
  ),
  reference_number varchar(160) NULL,
  document_date date NULL,
  description text NULL,
  storage_bucket varchar(100) NOT NULL DEFAULT 'njss-budget-documents',
  storage_path text NOT NULL,
  original_filename text NOT NULL,
  mime_type varchar(180) NULL,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  supersedes_document_id uuid NULL REFERENCES public.budget_documents(id) ON DELETE RESTRICT,
  uploaded_by uuid NULL REFERENCES auth.users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'annual_budget_cycles_activation_authority_document_id_fkey'
      AND conrelid = 'public.annual_budget_cycles'::regclass
  ) THEN
    ALTER TABLE public.annual_budget_cycles
      ADD CONSTRAINT annual_budget_cycles_activation_authority_document_id_fkey
      FOREIGN KEY (activation_authority_document_id)
      REFERENCES public.budget_documents(id)
      ON DELETE RESTRICT;
  END IF;
END
$fk$;

CREATE INDEX IF NOT EXISTS idx_division_budgets_year_division
  ON public.division_budgets(financial_year, division_id);
CREATE INDEX IF NOT EXISTS idx_division_budget_lines_section_ledger
  ON public.division_budget_lines(section_id, expense_ledger_id);
CREATE INDEX IF NOT EXISTS idx_budget_documents_division_type
  ON public.budget_documents(division_budget_id, document_type);
CREATE INDEX IF NOT EXISTS idx_budget_documents_related_entity
  ON public.budget_documents(related_entity_type, related_entity_id, document_type);

-- -----------------------------------------------------------------------------
-- 2. Private budget-document storage bucket
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('njss-budget-documents', 'njss-budget-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- -----------------------------------------------------------------------------
-- 3. Simplified business permissions and Budget Officer role activation
-- -----------------------------------------------------------------------------
INSERT INTO public.permissions (code, module_code, menu_code, action, label, description, is_active)
VALUES
  ('budget.capture', 'budget', 'budget.template', 'edit', 'Capture annual budget', 'Create and amend Head Office annual budget drafts', true),
  ('budget.lock', 'budget', 'budget.template', 'approve', 'Lock Division budget', 'Lock a Division budget after documentary verification', true),
  ('budget.activate', 'budget', 'budget.control', 'approve', 'Activate annual budget', 'Activate the annual Head Office budget following Registrar Office authority', true),
  ('budget.documents.manage', 'budget', 'budget.template', 'manage', 'Manage budget documents', 'Upload and register controlled budget documentary evidence', true)
ON CONFLICT (code) DO UPDATE SET
  module_code = EXCLUDED.module_code,
  menu_code = EXCLUDED.menu_code,
  action = EXCLUDED.action,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_active = true;

UPDATE public.roles
SET is_active = true,
    is_business_role = true,
    updated_at = now()
WHERE name = 'Budget Officer';

INSERT INTO public.role_permissions (role_id, permission, is_allowed)
SELECT r.id, p.permission, true
FROM public.roles r
CROSS JOIN (
  VALUES
    ('budget.view'::varchar),
    ('budget.capture'::varchar),
    ('budget.lock'::varchar),
    ('budget.activate'::varchar),
    ('budget.documents.manage'::varchar),
    ('budget.export'::varchar)
) AS p(permission)
WHERE r.name = 'Budget Officer'
ON CONFLICT (role_id, permission) DO UPDATE SET is_allowed = true;

UPDATE public.menu_items
SET label = 'Annual Budget',
    required_permissions = ARRAY[
      'budget.view',
      'budget.capture',
      'budget.lock',
      'budget.documents.manage'
    ],
    updated_at = now()
WHERE code = 'budget.template';

-- -----------------------------------------------------------------------------
-- 4. Updated-at and immutability triggers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.njss_head_office_budget_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.njss_protect_locked_division_budget_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $function$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status
  FROM public.division_budgets
  WHERE id = COALESCE(OLD.division_budget_id, NEW.division_budget_id);

  IF v_status = 'LOCKED' THEN
    RAISE EXCEPTION 'Locked original budget lines are immutable';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.njss_protect_locked_division_budget_header()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $function$
BEGIN
  IF OLD.status = 'LOCKED' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.financial_year IS DISTINCT FROM OLD.financial_year
       OR NEW.division_id IS DISTINCT FROM OLD.division_id
       OR NEW.annual_budget_cycle_id IS DISTINCT FROM OLD.annual_budget_cycle_id
       OR NEW.reference_number IS DISTINCT FROM OLD.reference_number
       OR NEW.approval_date IS DISTINCT FROM OLD.approval_date THEN
      RAISE EXCEPTION 'Locked Division budget header is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_annual_budget_cycles_touch_updated_at ON public.annual_budget_cycles;
CREATE TRIGGER trg_annual_budget_cycles_touch_updated_at
BEFORE UPDATE ON public.annual_budget_cycles
FOR EACH ROW EXECUTE FUNCTION public.njss_head_office_budget_touch_updated_at();

DROP TRIGGER IF EXISTS trg_division_budgets_touch_updated_at ON public.division_budgets;
CREATE TRIGGER trg_division_budgets_touch_updated_at
BEFORE UPDATE ON public.division_budgets
FOR EACH ROW EXECUTE FUNCTION public.njss_head_office_budget_touch_updated_at();

DROP TRIGGER IF EXISTS trg_division_budget_lines_touch_updated_at ON public.division_budget_lines;
CREATE TRIGGER trg_division_budget_lines_touch_updated_at
BEFORE UPDATE ON public.division_budget_lines
FOR EACH ROW EXECUTE FUNCTION public.njss_head_office_budget_touch_updated_at();

DROP TRIGGER IF EXISTS trg_division_budget_lines_protect_locked ON public.division_budget_lines;
CREATE TRIGGER trg_division_budget_lines_protect_locked
BEFORE UPDATE OR DELETE ON public.division_budget_lines
FOR EACH ROW EXECUTE FUNCTION public.njss_protect_locked_division_budget_line();

DROP TRIGGER IF EXISTS trg_division_budget_header_protect_locked ON public.division_budgets;
CREATE TRIGGER trg_division_budget_header_protect_locked
BEFORE UPDATE ON public.division_budgets
FOR EACH ROW EXECUTE FUNCTION public.njss_protect_locked_division_budget_header();

REVOKE EXECUTE ON FUNCTION public.njss_head_office_budget_touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_protect_locked_division_budget_line() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_protect_locked_division_budget_header() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 5. Secured write RPCs
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_or_get_head_office_budget_cycle(
  p_financial_year integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_cycle_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.capture');

  IF p_financial_year < 2000 OR p_financial_year > 2200 THEN
    RAISE EXCEPTION 'Invalid financial year';
  END IF;

  INSERT INTO public.annual_budget_cycles (financial_year, status)
  VALUES (p_financial_year, 'PREPARATION')
  ON CONFLICT (financial_year) DO UPDATE SET financial_year = EXCLUDED.financial_year
  RETURNING id INTO v_cycle_id;

  -- Snapshot every active Head Office Division into the cycle. This prevents a
  -- cycle becoming ready merely because only one Division was entered.
  INSERT INTO public.division_budgets (
    annual_budget_cycle_id,
    financial_year,
    division_id,
    status,
    entered_by
  )
  SELECT
    v_cycle_id,
    p_financial_year,
    d.id,
    'DRAFT',
    auth.uid()
  FROM public.departments d
  JOIN public.court_locations cl ON cl.id = d.court_location_id
  WHERE coalesce(d.is_active, true) = true
    AND coalesce(cl.is_active, true) = true
    AND cl.location_type = 'HEADQUARTERS'
  ON CONFLICT (annual_budget_cycle_id, division_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM public.division_budgets
    WHERE annual_budget_cycle_id = v_cycle_id
  ) THEN
    RAISE EXCEPTION 'No active Head Office Divisions are configured';
  END IF;

  RETURN v_cycle_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_or_get_division_budget(
  p_financial_year integer,
  p_division_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_cycle_id uuid;
  v_budget_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.capture');

  v_cycle_id := public.create_or_get_head_office_budget_cycle(p_financial_year);

  IF NOT EXISTS (
    SELECT 1
    FROM public.departments d
    JOIN public.court_locations cl ON cl.id = d.court_location_id
    WHERE d.id = p_division_id
      AND coalesce(d.is_active, true) = true
      AND coalesce(cl.is_active, true) = true
      AND cl.location_type = 'HEADQUARTERS'
  ) THEN
    RAISE EXCEPTION 'Selected Division is not an active Head Office Division';
  END IF;

  INSERT INTO public.division_budgets (
    annual_budget_cycle_id,
    financial_year,
    division_id,
    status,
    entered_by
  ) VALUES (
    v_cycle_id,
    p_financial_year,
    p_division_id,
    'DRAFT',
    auth.uid()
  )
  ON CONFLICT (annual_budget_cycle_id, division_id) DO UPDATE
    SET annual_budget_cycle_id = EXCLUDED.annual_budget_cycle_id
  RETURNING id INTO v_budget_id;

  RETURN v_budget_id;
END;
$function$;

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
    AND status = 'DRAFT';

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
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Locked Division budgets are immutable';
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

CREATE OR REPLACE FUNCTION public.register_budget_document(
  p_financial_year integer,
  p_division_budget_id uuid,
  p_related_entity_type text,
  p_related_entity_id uuid,
  p_document_type text,
  p_reference_number text,
  p_document_date date,
  p_description text,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_supersedes_document_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_document_id uuid;
  v_version integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.documents.manage');

  IF p_storage_path IS NULL OR trim(p_storage_path) = '' THEN
    RAISE EXCEPTION 'Storage path is required';
  END IF;
  IF p_original_filename IS NULL OR trim(p_original_filename) = '' THEN
    RAISE EXCEPTION 'Original filename is required';
  END IF;

  IF p_document_type = 'OFFICIAL_APPROVED_BUDGET' THEN
    IF p_division_budget_id IS NULL OR p_related_entity_type <> 'DIVISION_BUDGET' THEN
      RAISE EXCEPTION 'Official approved budget documents must be linked to a Division budget';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.division_budgets
      WHERE id = p_division_budget_id
        AND financial_year = p_financial_year
    ) THEN
      RAISE EXCEPTION 'Division budget/document financial year mismatch';
    END IF;
  ELSIF p_document_type = 'REGISTRAR_ACTIVATION_AUTHORITY' THEN
    IF p_related_entity_type <> 'ANNUAL_BUDGET_CYCLE' OR p_related_entity_id IS NULL THEN
      RAISE EXCEPTION 'Activation authority must be linked to an annual budget cycle';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.annual_budget_cycles
      WHERE id = p_related_entity_id
        AND financial_year = p_financial_year
    ) THEN
      RAISE EXCEPTION 'Annual cycle/document financial year mismatch';
    END IF;
  END IF;

  SELECT coalesce(max(version_number), 0) + 1
  INTO v_version
  FROM public.budget_documents
  WHERE financial_year = p_financial_year
    AND related_entity_type = p_related_entity_type
    AND related_entity_id IS NOT DISTINCT FROM p_related_entity_id
    AND document_type = p_document_type;

  INSERT INTO public.budget_documents (
    financial_year,
    division_budget_id,
    related_entity_type,
    related_entity_id,
    document_type,
    reference_number,
    document_date,
    description,
    storage_bucket,
    storage_path,
    original_filename,
    mime_type,
    version_number,
    supersedes_document_id,
    uploaded_by
  ) VALUES (
    p_financial_year,
    p_division_budget_id,
    p_related_entity_type,
    p_related_entity_id,
    p_document_type,
    NULLIF(trim(p_reference_number), ''),
    p_document_date,
    NULLIF(trim(p_description), ''),
    'njss-budget-documents',
    p_storage_path,
    p_original_filename,
    p_mime_type,
    v_version,
    p_supersedes_document_id,
    auth.uid()
  )
  RETURNING id INTO v_document_id;

  RETURN v_document_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lock_division_budget(
  p_division_budget_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_cycle_id uuid;
  v_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.lock');

  SELECT annual_budget_cycle_id, status
  INTO v_cycle_id, v_status
  FROM public.division_budgets
  WHERE id = p_division_budget_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Division budget not found';
  END IF;
  IF v_status = 'LOCKED' THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.budget_documents
    WHERE division_budget_id = p_division_budget_id
      AND related_entity_type = 'DIVISION_BUDGET'
      AND related_entity_id = p_division_budget_id
      AND document_type = 'OFFICIAL_APPROVED_BUDGET'
  ) THEN
    RAISE EXCEPTION 'Official Registrar-approved budget document is required before lock';
  END IF;

  UPDATE public.division_budgets
  SET status = 'LOCKED',
      locked_by = auth.uid(),
      locked_at = now(),
      updated_at = now()
  WHERE id = p_division_budget_id;

  UPDATE public.annual_budget_cycles c
  SET status = CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.division_budgets d
      WHERE d.annual_budget_cycle_id = c.id
        AND d.status <> 'LOCKED'
    ) THEN 'PREPARATION'
    ELSE 'READY_FOR_ACTIVATION'
  END,
  updated_at = now()
  WHERE c.id = v_cycle_id
    AND c.status NOT IN ('ACTIVE', 'CLOSED');
END;
$function$;

CREATE OR REPLACE FUNCTION public.activate_annual_budget(
  p_cycle_id uuid,
  p_authority_document_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  v_status text;
  v_financial_year integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  PERFORM public.njss_require_permission('budget.activate');

  SELECT status, financial_year
  INTO v_status, v_financial_year
  FROM public.annual_budget_cycles
  WHERE id = p_cycle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Annual budget cycle not found';
  END IF;
  IF v_status <> 'READY_FOR_ACTIVATION' THEN
    RAISE EXCEPTION 'All required Divisions must be locked before activation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.division_budgets
    WHERE annual_budget_cycle_id = p_cycle_id
      AND status <> 'LOCKED'
  ) THEN
    RAISE EXCEPTION 'All required Divisions must be locked before activation';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.budget_documents d
    WHERE d.id = p_authority_document_id
      AND d.financial_year = v_financial_year
      AND d.related_entity_type = 'ANNUAL_BUDGET_CYCLE'
      AND d.related_entity_id = p_cycle_id
      AND d.document_type = 'REGISTRAR_ACTIVATION_AUTHORITY'
  ) THEN
    RAISE EXCEPTION 'Registrar activation authority document is required';
  END IF;

  UPDATE public.annual_budget_cycles
  SET status = 'ACTIVE',
      activation_authority_document_id = p_authority_document_id,
      activated_by = auth.uid(),
      activated_at = now(),
      updated_at = now()
  WHERE id = p_cycle_id;
END;
$function$;

-- Remove PostgreSQL's inherited PUBLIC EXECUTE and expose only the intended
-- authenticated wrappers. Each wrapper independently checks authentication and
-- the required NJSS permission.
REVOKE EXECUTE ON FUNCTION public.create_or_get_head_office_budget_cycle(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_or_get_head_office_budget_cycle(integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_or_get_division_budget(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_or_get_division_budget(integer, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.update_division_budget_draft_header(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_division_budget_draft_header(uuid, text, date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.upsert_division_budget_line(uuid, uuid, uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_division_budget_line(uuid, uuid, uuid, numeric) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.register_budget_document(integer, uuid, text, uuid, text, text, date, text, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_budget_document(integer, uuid, text, uuid, text, text, date, text, text, text, text, uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.lock_division_budget(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_division_budget(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.activate_annual_budget(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activate_annual_budget(uuid, uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. Table RLS and direct-client privilege model
-- -----------------------------------------------------------------------------
ALTER TABLE public.annual_budget_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.division_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.division_budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS annual_budget_cycles_read_authorized ON public.annual_budget_cycles;
CREATE POLICY annual_budget_cycles_read_authorized ON public.annual_budget_cycles
FOR SELECT TO authenticated
USING (
  public.fn_current_user_has_permission('budget.view')
  OR public.fn_current_user_has_permission('budget.capture')
  OR public.fn_current_user_has_permission('budget.lock')
  OR public.fn_current_user_has_permission('budget.activate')
  OR public.fn_current_user_has_permission('all')
);

DROP POLICY IF EXISTS division_budgets_read_authorized ON public.division_budgets;
CREATE POLICY division_budgets_read_authorized ON public.division_budgets
FOR SELECT TO authenticated
USING (
  public.fn_current_user_has_permission('budget.view')
  OR public.fn_current_user_has_permission('budget.capture')
  OR public.fn_current_user_has_permission('budget.lock')
  OR public.fn_current_user_has_permission('all')
);

DROP POLICY IF EXISTS division_budget_lines_read_authorized ON public.division_budget_lines;
CREATE POLICY division_budget_lines_read_authorized ON public.division_budget_lines
FOR SELECT TO authenticated
USING (
  public.fn_current_user_has_permission('budget.view')
  OR public.fn_current_user_has_permission('budget.capture')
  OR public.fn_current_user_has_permission('budget.lock')
  OR public.fn_current_user_has_permission('all')
);

DROP POLICY IF EXISTS budget_documents_read_authorized ON public.budget_documents;
CREATE POLICY budget_documents_read_authorized ON public.budget_documents
FOR SELECT TO authenticated
USING (
  public.fn_current_user_has_permission('budget.view')
  OR public.fn_current_user_has_permission('budget.documents.manage')
  OR public.fn_current_user_has_permission('budget.lock')
  OR public.fn_current_user_has_permission('budget.activate')
  OR public.fn_current_user_has_permission('all')
);

GRANT SELECT ON public.annual_budget_cycles, public.division_budgets, public.division_budget_lines, public.budget_documents TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.annual_budget_cycles FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.division_budgets FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.division_budget_lines FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.budget_documents FROM anon, authenticated;
REVOKE ALL ON public.annual_budget_cycles, public.division_budgets, public.division_budget_lines, public.budget_documents FROM anon;

-- -----------------------------------------------------------------------------
-- 7. Private storage-object policies
-- -----------------------------------------------------------------------------
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
    OR public.fn_current_user_has_permission('all')
  )
);

DROP POLICY IF EXISTS budget_documents_storage_insert ON storage.objects;
CREATE POLICY budget_documents_storage_insert ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'njss-budget-documents'
  AND (
    public.fn_current_user_has_permission('budget.documents.manage')
    OR public.fn_current_user_has_permission('all')
  )
);

-- No authenticated UPDATE or DELETE policy is intentionally created for the
-- controlled budget bucket. Corrected documents are added as new versions.

-- -----------------------------------------------------------------------------
-- 8. Post-migration invariants
-- -----------------------------------------------------------------------------
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'njss-budget-documents'
      AND public = true
  ) THEN
    RAISE EXCEPTION 'Budget document bucket must remain private';
  END IF;

  IF has_table_privilege('authenticated', 'public.division_budget_lines', 'INSERT')
     OR has_table_privilege('authenticated', 'public.division_budget_lines', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.division_budget_lines', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated users must not directly mutate original budget lines';
  END IF;

  IF has_function_privilege('anon', 'public.lock_division_budget(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous users must not execute Division lock';
  END IF;

  IF has_function_privilege('anon', 'public.activate_annual_budget(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Anonymous users must not execute annual budget activation';
  END IF;
END
$verify$;
