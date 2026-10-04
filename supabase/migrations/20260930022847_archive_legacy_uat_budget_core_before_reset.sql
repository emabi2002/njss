-- Applied to NJSS UAT as version 20260930022847.
create table njss_reset_archive.legacy_financial_20260930 (
 table_name text primary key,
 captured_at timestamptz not null default now(),
 row_count bigint not null,
 rows jsonb not null
);
revoke all on njss_reset_archive.legacy_financial_20260930 from public, anon, authenticated;
do $$
declare t text;
begin
 foreach t in array array[
  'budget_cycles','budget_periods','budget_division_ceilings','divisional_budget_submissions',
  'divisional_budget_lines','budget_monthly_allocations','budget_workflow_history',
  'budget_line_attachments','budget_activation_batches','budget_activation_lines',
  'budget_activation_line_snapshots','budget_allocations','budget_revisions','budget_revision_lines'
 ] loop
  execute format('insert into njss_reset_archive.legacy_financial_20260930(table_name,row_count,rows) select %L,count(*),coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from public.%I x',t,t);
 end loop;
end $$;
