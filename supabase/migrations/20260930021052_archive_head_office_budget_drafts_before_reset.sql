-- Applied to NJSS Supabase as live version 20260930021052.
-- Private, recoverable copy of the new Head Office budget drafts before reset.
create schema if not exists njss_reset_archive;
revoke all on schema njss_reset_archive from public, anon, authenticated;
create table njss_reset_archive.head_office_budget_20260930 (
 id integer primary key check (id=1),
 captured_at timestamptz not null default now(),
 annual_budget_cycles jsonb not null,
 division_budgets jsonb not null,
 division_budget_lines jsonb not null,
 budget_documents jsonb not null
);
revoke all on njss_reset_archive.head_office_budget_20260930 from public, anon, authenticated;
insert into njss_reset_archive.head_office_budget_20260930
(id,annual_budget_cycles,division_budgets,division_budget_lines,budget_documents)
select 1,
(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.annual_budget_cycles t),
(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.division_budgets t),
(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.division_budget_lines t),
(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from public.budget_documents t);
