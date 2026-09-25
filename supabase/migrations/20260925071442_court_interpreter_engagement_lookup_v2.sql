create or replace view public.ci_engagement_types with (security_invoker = true) as
select id, name from court_interpreter.engagement_types;
revoke all on public.ci_engagement_types from public, anon, authenticated;
grant select on public.ci_engagement_types to authenticated;
