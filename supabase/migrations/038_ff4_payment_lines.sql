-- NJSS FF4 structured payment/invoice line worksheet support.
-- Additive migration only. Existing FF4 workflow remains controlled by njss_create_ff4 / njss_transition_ff4.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ff4_payment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ff4_header_id uuid NOT NULL REFERENCES public.ff4_headers(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  source text NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('FF3_ITEM','SELECTED_QUOTE','INVOICE','MANUAL')),
  reference text,
  description text NOT NULL,
  quantity numeric(14,2) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit text,
  unit_price numeric(15,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  gross_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (gross_amount >= 0),
  tax_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  deduction_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (deduction_amount >= 0),
  net_amount numeric(15,2) NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ff4_header_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_ff4_payment_lines_header ON public.ff4_payment_lines(ff4_header_id, line_number);

ALTER TABLE public.ff4_payment_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ff4_payment_lines_select ON public.ff4_payment_lines;
CREATE POLICY ff4_payment_lines_select ON public.ff4_payment_lines
  FOR SELECT TO authenticated
  USING (
    public.fn_current_user_has_permission('ff4.view')
    OR public.fn_current_user_has_permission('ff4.create')
    OR public.fn_current_user_has_permission('ff4.verify')
    OR public.fn_current_user_has_permission('ff4.approve')
    OR public.fn_current_user_has_permission('ff4.process')
    OR public.fn_current_user_has_permission('audit.view')
    OR public.fn_current_user_has_permission('all')
  );

DROP POLICY IF EXISTS ff4_payment_lines_no_direct_insert ON public.ff4_payment_lines;
CREATE POLICY ff4_payment_lines_no_direct_insert ON public.ff4_payment_lines FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS ff4_payment_lines_no_direct_update ON public.ff4_payment_lines;
CREATE POLICY ff4_payment_lines_no_direct_update ON public.ff4_payment_lines FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS ff4_payment_lines_no_direct_delete ON public.ff4_payment_lines;
CREATE POLICY ff4_payment_lines_no_direct_delete ON public.ff4_payment_lines FOR DELETE TO authenticated USING (false);

CREATE OR REPLACE FUNCTION public.njss_save_ff4_payment_lines(
  p_ff4_id uuid,
  p_lines jsonb,
  p_user_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_actor uuid := public.fn_current_app_user_id();
  v_ff4 public.ff4_headers%ROWTYPE;
  v_count integer := 0;
BEGIN
  PERFORM public.njss_require_permission('ff4.create');

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authenticated NJSS user profile is required';
  END IF;

  SELECT * INTO v_ff4 FROM public.ff4_headers WHERE id = p_ff4_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FF4 not found';
  END IF;

  IF v_ff4.status NOT IN ('DRAFT','SUBMITTED') THEN
    RAISE EXCEPTION 'Payment worksheet lines can only be saved while FF4 is draft or newly submitted. Current status: %', v_ff4.status;
  END IF;

  IF v_ff4.created_by IS NOT NULL AND v_ff4.created_by <> v_actor AND NOT public.fn_current_user_has_permission('all') THEN
    RAISE EXCEPTION 'Only the creator can save payment worksheet lines for this FF4';
  END IF;

  DELETE FROM public.ff4_payment_lines WHERE ff4_header_id = p_ff4_id;

  INSERT INTO public.ff4_payment_lines (
    ff4_header_id,
    line_number,
    source,
    reference,
    description,
    quantity,
    unit,
    unit_price,
    gross_amount,
    tax_amount,
    deduction_amount,
    net_amount,
    notes,
    created_by
  )
  SELECT
    p_ff4_id,
    COALESCE((line.value->>'line_number')::integer, ordinality::integer),
    COALESCE(NULLIF(line.value->>'source', ''), 'MANUAL'),
    NULLIF(line.value->>'reference', ''),
    COALESCE(NULLIF(line.value->>'description', ''), 'Payment line'),
    COALESCE((line.value->>'quantity')::numeric, 0),
    NULLIF(line.value->>'unit', ''),
    COALESCE((line.value->>'unit_price')::numeric, 0),
    COALESCE((line.value->>'gross_amount')::numeric, COALESCE((line.value->>'quantity')::numeric, 0) * COALESCE((line.value->>'unit_price')::numeric, 0)),
    COALESCE((line.value->>'tax_amount')::numeric, 0),
    COALESCE((line.value->>'deduction_amount')::numeric, 0),
    COALESCE((line.value->>'net_amount')::numeric, COALESCE((line.value->>'gross_amount')::numeric, 0) - COALESCE((line.value->>'tax_amount')::numeric, 0) - COALESCE((line.value->>'deduction_amount')::numeric, 0)),
    NULLIF(line.value->>'notes', ''),
    v_actor
  FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS line(value, ordinality)
  WHERE COALESCE(NULLIF(line.value->>'description', ''), NULLIF(line.value->>'reference', '')) IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM public.log_audit_event(
    v_actor,
    p_user_email,
    COALESCE(p_user_email, 'System'),
    'FF4_PAYMENT_LINES_SAVED',
    'FF4',
    p_ff4_id,
    v_ff4.ff4_number,
    NULL,
    jsonb_build_object('line_count', v_count),
    jsonb_build_object('line_count', v_count),
    jsonb_build_object('phase', 'FF4_PAYMENT_LINES')
  );

  RETURN jsonb_build_object('ff4_id', p_ff4_id, 'line_count', v_count);
END;
$fn$;

REVOKE INSERT, UPDATE, DELETE ON public.ff4_payment_lines FROM anon, authenticated;
GRANT SELECT ON public.ff4_payment_lines TO authenticated;
REVOKE ALL ON FUNCTION public.njss_save_ff4_payment_lines(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.njss_save_ff4_payment_lines(uuid, jsonb, text) TO authenticated;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES ('latest_database_migration', '038_ff4_payment_lines', 'Latest applied NJSS migration identifier.')
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value,
    description = EXCLUDED.description,
    updated_at = now();

COMMIT;
