-- Non-posting master ledger headings for the Head Office annual budget.
-- The source four-digit codes require a separate finance-code review; retain
-- existing UAT posting IDs so historical references remain stable.
ALTER TABLE public.expense_ledger
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 100;

ALTER TABLE public.sections
  ADD COLUMN IF NOT EXISTS budget_scope varchar(20) NOT NULL DEFAULT 'SECTION';

ALTER TABLE public.sections DROP CONSTRAINT IF EXISTS sections_budget_scope_check;
ALTER TABLE public.sections ADD CONSTRAINT sections_budget_scope_check
  CHECK (budget_scope IN ('SECTION', 'DIVISION_WIDE'));

INSERT INTO public.sections (department_id, code, name, budget_scope, is_active)
SELECT d.id, d.code || '-DIV', 'Division-wide', 'DIVISION_WIDE', true
FROM public.departments d
JOIN public.court_locations cl ON cl.id = d.court_location_id
WHERE cl.name = 'Waigani Headquarters'
  AND d.is_active IS TRUE
ON CONFLICT (code) DO NOTHING;

DO $validate_division_wide$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.departments d
    JOIN public.court_locations cl ON cl.id = d.court_location_id
    LEFT JOIN public.sections s ON s.department_id = d.id
      AND s.budget_scope = 'DIVISION_WIDE' AND s.is_active = true
    WHERE cl.name = 'Waigani Headquarters' AND d.is_active = true
    GROUP BY d.id HAVING count(s.id) <> 1
  ) THEN
    RAISE EXCEPTION 'Each Head Office Division must have exactly one Division-wide section';
  END IF;
END $validate_division_wide$;

CREATE UNIQUE INDEX IF NOT EXISTS sections_one_division_wide_per_department
  ON public.sections (department_id) WHERE budget_scope = 'DIVISION_WIDE';

ALTER TABLE public.expense_ledger DROP CONSTRAINT IF EXISTS expense_ledger_master_no_parent;
ALTER TABLE public.expense_ledger ADD CONSTRAINT expense_ledger_master_no_parent
  CHECK (NOT (is_posting = false AND parent_ledger_id IS NOT NULL));

INSERT INTO public.expense_ledger
  (ledger_number, finance_code, standard_description, budget_class, expense_category,
   is_posting, is_active, sort_order)
VALUES
  ('UAT-M-PERSONNEL','M-PERSONNEL','Personnel and Leave','Operational','Personnel',false,true,10),
  ('UAT-MASTER-TRAVEL-DOM','M-TRAVEL-DOM','Travel & Subsistence (Domestic)','Operational','Travel',false,true,20),
  ('UAT-MASTER-TRAVEL-INT','M-TRAVEL-INT','Travel & Subsistence (International)','Operational','Travel',false,true,30),
  ('UAT-MASTER-OFFICE','M-OFFICE-SUP','Office Materials and Supplies','Operational','Supplies',false,true,40),
  ('UAT-M-OPERATIONS','M-OPERATIONS','Operational Materials and Services','Operational','Operations',false,true,50),
  ('UAT-M-TRANSPORT','M-TRANSPORT','Transport and Fuel','Operational','Transport',false,true,60),
  ('UAT-MASTER-CONSULT','M-CONSULT','Consultancy','Operational','Consultancy',false,true,70),
  ('UAT-M-TRAINING','M-TRAINING','Training','Operational','Training',false,true,80),
  ('UAT-M-UTILITIES','M-UTILITIES','Utilities','Operational','Utilities',false,true,90),
  ('UAT-M-RENTAL','M-RENTAL','Rental of Property','Operational','Rental',false,true,100),
  ('UAT-MASTER-MAINT','M-MAINT','Routine Maintenance','Operational','Maintenance',false,true,110),
  ('UAT-M-MEMBERSHIP','M-MEMBERSHIP','Membership and Contributions','Operational','Membership',false,true,120),
  ('UAT-M-LEAVE','M-LEAVE','Recreational Leave','Operational','Personnel',false,true,125),
  ('UAT-M-FURNITURE','M-FURNITURE','Furniture and Office Equipment','Capital','Capital',false,true,130),
  ('UAT-M-PLANT','M-PLANT','Plant, Equipment and Machinery','Capital','Capital',false,true,140),
  ('UAT-M-SUBSTANTIAL','M-SUBSTANTIAL','Substantial and Specific Maintenance','Capital','Capital',false,true,150),
  ('UAT-M-CONSTRUCTION','M-CONSTRUCTION','Construction, Renovation and Improvement','Capital','Capital',false,true,160),
  ('UAT-M-MOTOR','M-MOTOR-VEHICLE','Motor Vehicles','Capital','Capital',false,true,170),
  ('UAT-M-ICTPROJECT','M-ICT-PROJECT','ICT Projects','Capital','Capital',false,true,180)
ON CONFLICT (finance_code) DO NOTHING;

WITH category (child_code, master_code) AS (
  VALUES
    ('211-01','M-PERSONNEL'),('211-02','M-PERSONNEL'),
    ('212-01','M-PERSONNEL'),('213-01','M-PERSONNEL'),
    ('214-01','M-LEAVE'),('215-01','M-PERSONNEL'),
    ('221-01','M-TRAVEL-DOM'),('221-02','M-TRAVEL-DOM'),
    ('221-03','M-TRAVEL-DOM'),
    ('222-01','M-TRAVEL-INT'),('222-02','M-TRAVEL-INT'),
    ('223-01','M-OFFICE-SUP'),('223-02','M-OFFICE-SUP'),
    ('223-03','M-OFFICE-SUP'),
    ('224-01','M-OPERATIONS'),('224-02','M-OPERATIONS'),
    ('224-03','M-OPERATIONS'),
    ('225-01','M-TRANSPORT'),('225-02','M-TRANSPORT'),
    ('225-03','M-TRANSPORT'),
    ('226-01','M-CONSULT'),('226-02','M-CONSULT'),
    ('227-01','M-OPERATIONS'),('227-02','M-OPERATIONS'),
    ('227-03','M-OPERATIONS'),('227-04','M-OPERATIONS'),
    ('228-01','M-TRAINING'),('228-02','M-TRAINING'),
    ('231-01','M-UTILITIES'),('231-02','M-UTILITIES'),
    ('231-03','M-UTILITIES'),
    ('232-01','M-RENTAL'),('232-02','M-RENTAL'),
    ('233-01','M-MAINT'),('233-02','M-MAINT'),
    ('233-03','M-MAINT'),
    ('251-01','M-MEMBERSHIP'),('251-02','M-MEMBERSHIP'),
    ('271-01','M-FURNITURE'),('271-02','M-FURNITURE'),
    ('271-03','M-PLANT'),('271-04','M-PLANT')
)
UPDATE public.expense_ledger child
SET parent_ledger_id = p.id, parent_finance_code = p.finance_code
FROM category c
JOIN public.expense_ledger p ON p.finance_code = c.master_code AND p.is_posting = false
WHERE child.finance_code = c.child_code AND child.is_posting = true
  AND (child.parent_ledger_id IS DISTINCT FROM p.id);

CREATE INDEX IF NOT EXISTS idx_expense_ledger_active_parent
  ON public.expense_ledger(parent_ledger_id, sort_order)
  WHERE is_active = true;
