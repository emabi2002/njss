-- Names and roles are needed for scheduling; contact details stay in the private schema.
drop view public.ci_contacts;
create view public.ci_contacts with (security_invoker = true) as
select id, first_name, last_name, contact_type_id, engagement_type_id,
       court_location_id, is_active
from court_interpreter.contacts;
revoke all on public.ci_contacts from public, anon, authenticated;
grant select on public.ci_contacts to authenticated;
