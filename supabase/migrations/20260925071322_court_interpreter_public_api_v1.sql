-- Narrow public Data API facade over the private court_interpreter schema.
-- All views use the caller's privileges and preserve the underlying RLS.
create or replace view public.ci_membership with (security_invoker = true) as
select auth_user_id, app_role, is_active
from court_interpreter.memberships;

create or replace view public.ci_locations with (security_invoker = true) as
select id, name, code, is_active from public.court_locations;

create or replace view public.ci_languages with (security_invoker = true) as
select id, name, iso_code, is_active from court_interpreter.languages;

create or replace view public.ci_judges with (security_invoker = true) as
select id, first_name, last_name, is_active from court_interpreter.judges;

create or replace view public.ci_courtrooms with (security_invoker = true) as
select id, court_location_id, name, is_active from court_interpreter.courtrooms;

create or replace view public.ci_contacts with (security_invoker = true) as
select id, first_name, last_name, contact_type_id, engagement_type_id,
       court_location_id, phone_number, email, is_active
from court_interpreter.contacts;

create or replace view public.ci_contact_languages with (security_invoker = true) as
select contact_id, language_id from court_interpreter.contact_languages;

create or replace view public.ci_sittings with (security_invoker = true) as
select id, sitting_date, start_time, end_time, court_location_id,
       courtroom_id, language_id, is_deleted
from court_interpreter.court_sittings;

create or replace view public.ci_sitting_judges with (security_invoker = true) as
select sitting_id, judge_id from court_interpreter.sitting_judges;

create or replace view public.ci_sitting_contacts with (security_invoker = true) as
select sitting_id, contact_id, contact_type_id, language_id
from court_interpreter.sitting_contacts;

revoke all on public.ci_membership, public.ci_locations, public.ci_languages,
  public.ci_judges, public.ci_courtrooms, public.ci_contacts,
  public.ci_contact_languages, public.ci_sittings, public.ci_sitting_judges,
  public.ci_sitting_contacts from public, anon, authenticated;
grant select on public.ci_membership, public.ci_locations, public.ci_languages,
  public.ci_judges, public.ci_courtrooms, public.ci_contacts,
  public.ci_contact_languages, public.ci_sittings, public.ci_sitting_judges,
  public.ci_sitting_contacts to authenticated;

create or replace function public.ci_add_language(p_name text, p_iso_code text default null)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare v_id uuid;
begin
  insert into court_interpreter.languages(name, iso_code)
  values (btrim(p_name), nullif(btrim(p_iso_code), '')) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.ci_add_judge(p_first_name text, p_last_name text)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare v_id uuid;
begin
  insert into court_interpreter.judges(first_name, last_name)
  values (btrim(p_first_name), btrim(p_last_name)) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.ci_add_courtroom(p_court_location_id uuid, p_name text)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare v_id uuid;
begin
  insert into court_interpreter.courtrooms(court_location_id, name)
  values (p_court_location_id, btrim(p_name)) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.ci_add_contact(
  p_first_name text, p_last_name text, p_contact_type_id smallint,
  p_engagement_type_id smallint, p_court_location_id uuid,
  p_phone_number text default null, p_email text default null,
  p_language_id uuid default null
)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare v_id uuid;
begin
  if (p_contact_type_id = 1 and p_language_id is null)
     or (p_contact_type_id = 2 and p_language_id is not null) then
    raise exception 'Interpreter requires a language; attendant must not have one';
  end if;
  insert into court_interpreter.contacts(
    first_name, last_name, contact_type_id, engagement_type_id,
    court_location_id, phone_number, email
  ) values (
    btrim(p_first_name), btrim(p_last_name), p_contact_type_id,
    p_engagement_type_id, p_court_location_id,
    nullif(btrim(p_phone_number), ''), nullif(btrim(p_email), '')
  ) returning id into v_id;
  if p_language_id is not null then
    insert into court_interpreter.contact_languages(contact_id, language_id)
    values (v_id, p_language_id);
  end if;
  return v_id;
end; $$;

-- One judge, one interpreter and one attendant are required for the first
-- release. Date-scoped transaction locks serialize competing bookings.
create or replace function public.ci_add_sitting(
  p_sitting_date date, p_start_time time, p_end_time time,
  p_courtroom_id uuid, p_language_id uuid, p_judge_id uuid,
  p_interpreter_id uuid, p_attendant_id uuid
)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare v_id uuid; v_location_id uuid;
begin
  if not exists (
    select 1 from court_interpreter.memberships m
    where m.auth_user_id = (select auth.uid()) and m.is_active
      and m.app_role in ('admin','scheduler')
  ) then
    raise exception 'Court scheduler access required';
  end if;
  if p_sitting_date is null or p_start_time is null or p_end_time is null
     or p_start_time >= p_end_time then
    raise exception 'Provide a date and a valid time interval';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_sitting_date::text, 0));
  select r.court_location_id into v_location_id
    from court_interpreter.courtrooms r
    where r.id = p_courtroom_id and r.is_active;
  if v_location_id is null
     or not exists (select 1 from court_interpreter.languages l
                    where l.id = p_language_id and l.is_active)
     or not exists (select 1 from court_interpreter.judges j
                    where j.id = p_judge_id and j.is_active)
     or not exists (select 1 from court_interpreter.contacts c
                    join court_interpreter.contact_languages cl on cl.contact_id = c.id
                    where c.id = p_interpreter_id and c.contact_type_id = 1
                      and c.is_active and cl.language_id = p_language_id)
     or not exists (select 1 from court_interpreter.contacts c
                    where c.id = p_attendant_id and c.contact_type_id = 2
                      and c.is_active) then
    raise exception 'Select an active room, language, judge, interpreter and attendant';
  end if;
  if exists (
    select 1 from court_interpreter.court_sittings s
    where s.sitting_date = p_sitting_date and not s.is_deleted
      and s.start_time < p_end_time and p_start_time < s.end_time
      and (s.courtroom_id = p_courtroom_id
        or exists (select 1 from court_interpreter.sitting_judges sj
                   where sj.sitting_id = s.id and sj.judge_id = p_judge_id)
        or exists (select 1 from court_interpreter.sitting_contacts sc
                   where sc.sitting_id = s.id and sc.contact_id in
                     (p_interpreter_id, p_attendant_id)))
  ) then
    raise exception 'A selected room or person is already assigned at this time';
  end if;
  insert into court_interpreter.court_sittings(
    sitting_date, start_time, end_time, court_location_id, courtroom_id, language_id
  ) values (
    p_sitting_date, p_start_time, p_end_time, v_location_id,
    p_courtroom_id, p_language_id
  ) returning id into v_id;
  insert into court_interpreter.sitting_judges(sitting_id, judge_id)
    values (v_id, p_judge_id);
  insert into court_interpreter.sitting_contacts(
    sitting_id, contact_id, contact_type_id, language_id
  ) values (v_id, p_interpreter_id, 1, p_language_id),
           (v_id, p_attendant_id, 2, null);
  return v_id;
end; $$;

revoke all on function public.ci_add_language(text,text),
  public.ci_add_judge(text,text), public.ci_add_courtroom(uuid,text),
  public.ci_add_contact(text,text,smallint,smallint,uuid,text,text,uuid),
  public.ci_add_sitting(date,time,time,uuid,uuid,uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.ci_add_language(text,text),
  public.ci_add_judge(text,text), public.ci_add_courtroom(uuid,text),
  public.ci_add_contact(text,text,smallint,smallint,uuid,text,text,uuid),
  public.ci_add_sitting(date,time,time,uuid,uuid,uuid,uuid,uuid)
  to authenticated;
