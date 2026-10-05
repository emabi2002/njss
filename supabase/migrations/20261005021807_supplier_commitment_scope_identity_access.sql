-- The invoker supplier/commitment views evaluate ff3_commitments_select_phase6.
-- Its posting-identity fallback needs the allocation creator to enforce ownership.
-- Keep all legacy budget amounts and client writes revoked.
GRANT SELECT (created_by) ON public.budget_allocations TO authenticated;
