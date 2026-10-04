-- Applied to NJSS Supabase as live version 20260930021112.
-- Guarded reset of empty new budget workspace; does not touch legacy budgets, FF3 or FF4.
do $$
begin
 if (select count(*) from njss_reset_archive.head_office_budget_20260930 where id=1 and jsonb_array_length(annual_budget_cycles)=2 and jsonb_array_length(division_budgets)=30) <> 1
 or (select count(*) from public.annual_budget_cycles where status='PREPARATION') <> 2
 or (select count(*) from public.division_budgets where status='DRAFT') <> 30
 or (select count(*) from public.division_budget_lines) <> 0
 or (select count(*) from public.budget_documents) <> 0
 or (select count(*) from public.budget_reallocations) <> 0
 or (select count(*) from public.budget_supplementary_adjustments) <> 0 then
  raise exception 'New budget state changed; abort reset';
 end if;
end $$;
delete from public.division_budgets;
delete from public.annual_budget_cycles;
