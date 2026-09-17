-- =============================================================================
-- NJSS PHASE 3 — FF3 BUDGET STATE AUTO-REFRESH
-- Re-evaluates pending FF3 budget-control state after a posted supplementary
-- adjustment or executed reallocation. Workflow status is never changed here.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.njss_refresh_pending_ff3_for_budget_key(
  p_financial_year integer,
  p_division_id uuid,
  p_section_id uuid,
  p_expense_ledger_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_ff3 record;
  v_count integer := 0;
BEGIN
  IF p_financial_year IS NULL
     OR p_division_id IS NULL
     OR p_section_id IS NULL
     OR p_expense_ledger_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_ff3 IN
    SELECT f.id
    FROM public.ff3_headers f
    WHERE f.financial_year = p_financial_year
      AND f.department_id = p_division_id
      AND f.section_id = p_section_id
      AND f.status IN ('SUBMITTED','ENDORSED_SUPERVISOR','ENDORSED_SECTION_HEAD')
      AND f.expense_code_registry_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.expense_ledger el
        WHERE el.id = p_expense_ledger_id
          AND el.expense_code_registry_id = f.expense_code_registry_id
          AND el.is_active = true
          AND el.is_posting = true
      )
    FOR UPDATE OF f
  LOOP
    PERFORM public.njss_refresh_ff3_budget_state(v_ff3.id);
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.njss_ff3_refresh_after_supplementary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_division_id uuid;
BEGIN
  IF NEW.status = 'POSTED'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT db.division_id
      INTO v_division_id
    FROM public.division_budgets db
    WHERE db.id = NEW.division_budget_id;

    PERFORM public.njss_refresh_pending_ff3_for_budget_key(
      NEW.financial_year,
      v_division_id,
      NEW.section_id,
      NEW.expense_ledger_id
    );
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.njss_ff3_refresh_after_reallocation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
  v_source_division_id uuid;
  v_destination_division_id uuid;
BEGIN
  IF NEW.status = 'EXECUTED'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT db.division_id
      INTO v_source_division_id
    FROM public.division_budgets db
    WHERE db.id = NEW.source_division_budget_id;

    SELECT db.division_id
      INTO v_destination_division_id
    FROM public.division_budgets db
    WHERE db.id = NEW.destination_division_budget_id;

    PERFORM public.njss_refresh_pending_ff3_for_budget_key(
      NEW.financial_year,
      v_source_division_id,
      NEW.source_section_id,
      NEW.source_expense_ledger_id
    );

    PERFORM public.njss_refresh_pending_ff3_for_budget_key(
      NEW.financial_year,
      v_destination_division_id,
      NEW.destination_section_id,
      NEW.destination_expense_ledger_id
    );
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_ff3_refresh_after_supplementary
  ON public.budget_supplementary_adjustments;
CREATE TRIGGER trg_ff3_refresh_after_supplementary
AFTER INSERT OR UPDATE OF status ON public.budget_supplementary_adjustments
FOR EACH ROW
EXECUTE FUNCTION public.njss_ff3_refresh_after_supplementary();

DROP TRIGGER IF EXISTS trg_ff3_refresh_after_reallocation
  ON public.budget_reallocations;
CREATE TRIGGER trg_ff3_refresh_after_reallocation
AFTER INSERT OR UPDATE OF status ON public.budget_reallocations
FOR EACH ROW
EXECUTE FUNCTION public.njss_ff3_refresh_after_reallocation();

REVOKE EXECUTE ON FUNCTION public.njss_refresh_pending_ff3_for_budget_key(integer, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_ff3_refresh_after_supplementary()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.njss_ff3_refresh_after_reallocation()
  FROM PUBLIC, anon, authenticated;
