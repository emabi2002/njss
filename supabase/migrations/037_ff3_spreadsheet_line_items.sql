-- NJSS FF3 spreadsheet line-item support.
-- Additive migration only. Existing FF3 workflow and header-level budget allocation are preserved.

BEGIN;

ALTER TABLE public.ff3_items
  ADD COLUMN IF NOT EXISTS item_code varchar(80),
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

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES ('latest_database_migration', '037_ff3_spreadsheet_line_items', 'Latest applied NJSS migration identifier.')
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value,
    description = EXCLUDED.description,
    updated_at = now();

COMMIT;
