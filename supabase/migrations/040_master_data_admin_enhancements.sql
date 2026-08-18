-- NJSS central master-data administration enhancements.
-- Additive migration only. Existing lookup tables are reused, not duplicated.

BEGIN;

ALTER TABLE public.budget_activity_templates
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.departments(id),
  ADD COLUMN IF NOT EXISTS section_id uuid REFERENCES public.sections(id),
  ADD COLUMN IF NOT EXISTS financial_year integer,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id);

ALTER TABLE public.units_of_measure
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.priority_levels
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.procurement_methods
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS threshold_from numeric(15,2),
  ADD COLUMN IF NOT EXISTS threshold_to numeric(15,2),
  ADD COLUMN IF NOT EXISTS currency text DEFAULT 'PGK',
  ADD COLUMN IF NOT EXISTS effective_from date,
  ADD COLUMN IF NOT EXISTS effective_to date,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.expense_items
  ADD COLUMN IF NOT EXISTS unit_of_measure_id uuid REFERENCES public.units_of_measure(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

INSERT INTO public.units_of_measure (code, name, description, sort_order, is_active)
SELECT DISTINCT
  upper(regexp_replace(default_unit, '[^A-Za-z0-9]+', '_', 'g')),
  default_unit,
  'Unit imported from existing expense items.',
  100,
  true
FROM public.expense_items
WHERE default_unit IS NOT NULL AND trim(default_unit) <> ''
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  is_active = true,
  updated_at = now();

UPDATE public.expense_items item
SET unit_of_measure_id = uom.id
FROM public.units_of_measure uom
WHERE item.unit_of_measure_id IS NULL
  AND item.default_unit IS NOT NULL
  AND lower(item.default_unit) IN (lower(uom.code), lower(uom.name));

CREATE TABLE IF NOT EXISTS public.category_expense_item_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_category_id uuid NOT NULL REFERENCES public.expense_categories(id) ON DELETE CASCADE,
  expense_item_id uuid NOT NULL REFERENCES public.expense_items(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (expense_category_id, expense_item_id)
);

INSERT INTO public.category_expense_item_mappings (expense_category_id, expense_item_id, is_active)
SELECT expense_category_id, id, COALESCE(is_active, true)
FROM public.expense_items
WHERE expense_category_id IS NOT NULL
ON CONFLICT (expense_category_id, expense_item_id) DO UPDATE SET
  is_active = EXCLUDED.is_active,
  updated_at = now();

ALTER TABLE public.category_expense_item_mappings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS category_expense_item_mappings_select ON public.category_expense_item_mappings;
CREATE POLICY category_expense_item_mappings_select ON public.category_expense_item_mappings
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS category_expense_item_mappings_manage ON public.category_expense_item_mappings;
CREATE POLICY category_expense_item_mappings_manage ON public.category_expense_item_mappings
  FOR ALL TO authenticated
  USING (
    public.fn_current_user_has_permission('masterdata.manage')
    OR public.fn_current_user_has_permission('registry.manage')
    OR public.fn_current_user_has_permission('all')
  )
  WITH CHECK (
    public.fn_current_user_has_permission('masterdata.manage')
    OR public.fn_current_user_has_permission('registry.manage')
    OR public.fn_current_user_has_permission('all')
  );

GRANT SELECT ON public.category_expense_item_mappings TO authenticated;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES ('latest_database_migration', '040_master_data_admin_enhancements', 'Latest applied NJSS migration identifier.')
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value,
    description = EXCLUDED.description,
    updated_at = now();

COMMIT;
