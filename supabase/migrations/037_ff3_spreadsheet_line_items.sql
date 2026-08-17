-- NJSS FF3 spreadsheet line-item and structured quotation-line support.
-- Additive migration only. Existing FF3 workflow and header-level budget allocation are preserved.

BEGIN;

ALTER TABLE public.ff3_items
  ADD COLUMN IF NOT EXISTS item_code varchar(80),
  ADD COLUMN IF NOT EXISTS source_quotation_id uuid REFERENCES public.ff3_quotations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_quotation_line_id uuid,
  ADD COLUMN IF NOT EXISTS line_notes text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ff3_items_quantity_positive'
  ) THEN
    ALTER TABLE public.ff3_items
      ADD CONSTRAINT ff3_items_quantity_positive CHECK (quantity > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ff3_items_unit_price_non_negative'
  ) THEN
    ALTER TABLE public.ff3_items
      ADD CONSTRAINT ff3_items_unit_price_non_negative CHECK (estimated_unit_price IS NULL OR estimated_unit_price >= 0);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_ff3_items_header_line_number
  ON public.ff3_items(ff3_header_id, line_number);

CREATE INDEX IF NOT EXISTS idx_ff3_items_source_quotation
  ON public.ff3_items(source_quotation_id);

CREATE TABLE IF NOT EXISTS public.ff3_quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES public.ff3_quotations(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  item_code varchar(80),
  item_description text NOT NULL,
  specifications text,
  quantity numeric(10,2) NOT NULL CHECK (quantity > 0),
  unit_of_measure_id uuid REFERENCES public.units_of_measure(id),
  quoted_unit_price numeric(15,2) NOT NULL DEFAULT 0 CHECK (quoted_unit_price >= 0),
  quoted_total numeric(15,2) GENERATED ALWAYS AS (quantity * quoted_unit_price) STORED,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quotation_id, line_number)
);

ALTER TABLE public.ff3_quotation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ff3_quotation_items_select ON public.ff3_quotation_items;
CREATE POLICY ff3_quotation_items_select ON public.ff3_quotation_items
  FOR SELECT TO authenticated
  USING (
    public.fn_user_has_permission(auth.uid(), 'ff3.view')
    OR public.fn_user_has_permission(auth.uid(), 'ff3.create')
    OR public.fn_user_has_permission(auth.uid(), 'ff3.approve')
    OR public.fn_user_has_permission(auth.uid(), 'all')
  );

DROP POLICY IF EXISTS ff3_quotation_items_manage_draft ON public.ff3_quotation_items;
CREATE POLICY ff3_quotation_items_manage_draft ON public.ff3_quotation_items
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.ff3_quotations q
      JOIN public.ff3_headers h ON h.id = q.ff3_header_id
      WHERE q.id = quotation_id
        AND h.status IN ('DRAFT','RETURNED')
    )
    AND (
      public.fn_user_has_permission(auth.uid(), 'ff3.create')
      OR public.fn_user_has_permission(auth.uid(), 'ff3.edit')
      OR public.fn_user_has_permission(auth.uid(), 'all')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.ff3_quotations q
      JOIN public.ff3_headers h ON h.id = q.ff3_header_id
      WHERE q.id = quotation_id
        AND h.status IN ('DRAFT','RETURNED')
    )
    AND (
      public.fn_user_has_permission(auth.uid(), 'ff3.create')
      OR public.fn_user_has_permission(auth.uid(), 'ff3.edit')
      OR public.fn_user_has_permission(auth.uid(), 'all')
    )
  );

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES ('latest_database_migration', '037_ff3_spreadsheet_line_items', 'Latest applied NJSS migration identifier.')
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value,
    description = EXCLUDED.description,
    updated_at = now();

COMMIT;
