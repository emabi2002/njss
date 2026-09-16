-- =============================================================================
-- NJSS CANONICAL BUDGET POSITION ACCESS
-- Expose the canonical position through a permission-checked RPC so authorised
-- budget users do not depend on unrelated FF3/FF4 table-level RLS visibility.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_current_budget_position(
  p_financial_year integer
)
RETURNS SETOF public.v_current_budget_position
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT (
    public.fn_current_user_has_permission('budget.view')
    OR public.fn_current_user_has_permission('budget.supplementary.enter')
    OR public.fn_current_user_has_permission('budget.reallocation.request')
    OR public.fn_current_user_has_permission('budget.reallocation.approve')
    OR public.fn_current_user_has_permission('budget.reallocation.execute')
    OR public.fn_current_user_has_permission('budget.report.view')
    OR public.fn_current_user_has_permission('all')
  ) THEN
    RAISE EXCEPTION 'Permission denied: budget position';
  END IF;

  RETURN QUERY
  SELECT bp.*
  FROM public.v_current_budget_position bp
  WHERE bp.financial_year = p_financial_year
  ORDER BY bp.division_name, bp.section_name, bp.finance_code;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_current_budget_position(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_budget_position(integer) TO authenticated;

-- The view remains an internal canonical source. Authenticated clients use the
-- permission-checked RPC above so backend visibility is stable across modules.
REVOKE SELECT ON public.v_current_budget_position FROM authenticated;
