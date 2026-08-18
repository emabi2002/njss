-- NJSS Budget Preparation lookup registers.
-- Additive migration only. Makes worksheet reference fields database-backed.

BEGIN;

CREATE TABLE IF NOT EXISTS public.budget_activity_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  default_line_item_description text,
  default_business_justification text,
  default_output text,
  default_unit_of_measure_id uuid,
  default_priority_level_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.budget_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.budget_expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expense_ledger
  ADD COLUMN IF NOT EXISTS budget_class_id uuid REFERENCES public.budget_classes(id),
  ADD COLUMN IF NOT EXISTS budget_expense_category_id uuid REFERENCES public.budget_expense_categories(id);

INSERT INTO public.budget_classes (code, name, description, sort_order)
VALUES
  ('OPERATIONAL', 'Operational', 'Operational recurrent budget expenditure.', 10),
  ('CAPITAL', 'Capital', 'Capital acquisition or investment expenditure.', 20)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = true,
  updated_at = now();

INSERT INTO public.budget_expense_categories (code, name, description, sort_order)
SELECT DISTINCT
  upper(regexp_replace(coalesce(nullif(expense_category, ''), 'GENERAL'), '[^A-Za-z0-9]+', '_', 'g')),
  coalesce(nullif(expense_category, ''), 'General'),
  'Budget preparation expense category imported from the finance ledger.',
  100
FROM public.expense_ledger
WHERE coalesce(nullif(expense_category, ''), 'General') IS NOT NULL
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = true,
  updated_at = now();

UPDATE public.expense_ledger ledger
SET budget_class_id = cls.id
FROM public.budget_classes cls
WHERE ledger.budget_class_id IS NULL
  AND upper(regexp_replace(coalesce(nullif(ledger.budget_class, ''), 'OPERATIONAL'), '[^A-Za-z0-9]+', '_', 'g')) = cls.code;

UPDATE public.expense_ledger ledger
SET budget_expense_category_id = cat.id
FROM public.budget_expense_categories cat
WHERE ledger.budget_expense_category_id IS NULL
  AND upper(regexp_replace(coalesce(nullif(ledger.expense_category, ''), 'GENERAL'), '[^A-Za-z0-9]+', '_', 'g')) = cat.code;

INSERT INTO public.budget_activity_templates (code, name, description, default_line_item_description, default_business_justification, sort_order)
VALUES
  ('GENERAL_ACTIVITY', 'General activity', 'General divisional budget activity.', 'General divisional activity', 'Required for approved divisional operations.', 10),
  ('TRAVEL_ACTIVITY', 'Travel activity', 'Official travel and transport activity.', 'Official travel / transport', 'Required to deliver approved official duties.', 20),
  ('SUPPLIES_ACTIVITY', 'Supplies and services activity', 'Office supplies, equipment, and service activity.', 'Supplies / services procurement', 'Required to maintain court and registry operations.', 30),
  ('MAINTENANCE_ACTIVITY', 'Maintenance activity', 'Building, equipment, utilities, and maintenance activity.', 'Maintenance / utilities activity', 'Required to sustain operational facilities and assets.', 40)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  default_line_item_description = EXCLUDED.default_line_item_description,
  default_business_justification = EXCLUDED.default_business_justification,
  is_active = true,
  updated_at = now();

ALTER TABLE public.budget_activity_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_expense_categories ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['budget_activity_templates','budget_classes','budget_expense_categories'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)', t || '_select', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_manage', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.fn_current_user_has_permission(''masterdata.manage'') OR public.fn_current_user_has_permission(''registry.manage'') OR public.fn_current_user_has_permission(''budget.template.approve'') OR public.fn_current_user_has_permission(''all'')) WITH CHECK (public.fn_current_user_has_permission(''masterdata.manage'') OR public.fn_current_user_has_permission(''registry.manage'') OR public.fn_current_user_has_permission(''budget.template.approve'') OR public.fn_current_user_has_permission(''all''))', t || '_manage', t);
  END LOOP;
END $$;

GRANT SELECT ON public.budget_activity_templates TO authenticated;
GRANT SELECT ON public.budget_classes TO authenticated;
GRANT SELECT ON public.budget_expense_categories TO authenticated;

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

INSERT INTO public.system_settings (setting_key, setting_value, description)
VALUES ('latest_database_migration', '039_budget_template_lookup_registers', 'Latest applied NJSS migration identifier.')
ON CONFLICT (setting_key) DO UPDATE
SET setting_value = EXCLUDED.setting_value,
    description = EXCLUDED.description,
    updated_at = now();

COMMIT;
