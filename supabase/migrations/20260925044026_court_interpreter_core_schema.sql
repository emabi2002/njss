-- CourtInterpretor core schema in the existing NJSS PostgreSQL database.
-- Shares auth.users and public.court_locations. Does not migrate SQL Server data.
-- Keep this schema off the Data API until the client integration is ready.

create schema court_interpreter;
revoke all on schema court_interpreter from public, anon;
grant usage on schema court_interpreter to authenticated, service_role;

create table court_interpreter.memberships (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  app_role text not null check (app_role in ('admin','scheduler','viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table court_interpreter.contact_types (
  id smallint primary key,
  name text not null unique,
  requires_languages boolean not null default false,
  allows_languages boolean not null default false
);
insert into court_interpreter.contact_types(id,name,requires_languages,allows_languages)
values (1,'Interpreter',true,true),(2,'Attendant',false,false);

create table court_interpreter.engagement_types (
  id smallint primary key,
  name text not null unique,
  requires_njss_id boolean not null default false,
  requires_bank_account boolean not null default false
);
-- The SQL Server lookup flags are not in the repository; set them after source verification.
insert into court_interpreter.engagement_types(id,name)
values (1,'Casual'),(2,'Hired'),(3,'NJSS Staff'),(4,'Hired NJSS Staff');

create table court_interpreter.languages (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  iso_code text,
  is_extinct boolean not null default false,
  is_active boolean not null default true
);

create table court_interpreter.banks (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true
);

create table court_interpreter.judges (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (length(btrim(first_name)) > 0),
  last_name text not null check (length(btrim(last_name)) > 0),
  is_active boolean not null default true
);

create table court_interpreter.courtrooms (
  id uuid primary key default gen_random_uuid(),
  court_location_id uuid not null references public.court_locations(id) on delete restrict,
  name text not null check (length(btrim(name)) > 0),
  is_active boolean not null default true,
  unique (court_location_id,name),
  unique (id,court_location_id)
);

create table court_interpreter.contacts (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (length(btrim(first_name)) > 0),
  last_name text not null check (length(btrim(last_name)) > 0),
  sex text not null default 'Unknown' check (sex in ('Male','Female','Other','Unknown')),
  phone_number text,
  email text,
  address_line_1 text,
  address_line_2 text,
  date_of_birth date,
  contact_type_id smallint not null references court_interpreter.contact_types(id),
  engagement_type_id smallint not null references court_interpreter.engagement_types(id),
  njss_staff_id text,
  country_name text,
  province_id uuid references public.provinces(id) on delete restrict,
  district_name text,
  court_location_id uuid not null references public.court_locations(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,contact_type_id)
);
create index contacts_registry_idx on court_interpreter.contacts(court_location_id) where is_active;
create index contacts_type_idx on court_interpreter.contacts(contact_type_id) where is_active;

create table court_interpreter.contact_languages (
  contact_id uuid not null references court_interpreter.contacts(id) on delete cascade,
  language_id uuid not null references court_interpreter.languages(id) on delete restrict,
  primary key(contact_id,language_id)
);

create table court_interpreter.contact_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references court_interpreter.contacts(id) on delete cascade,
  bank_id uuid not null references court_interpreter.banks(id) on delete restrict,
  account_name text not null,
  account_number text not null,
  is_active boolean not null default true,
  unique (contact_id,bank_id,account_number)
);

create table court_interpreter.court_sittings (
  id uuid primary key default gen_random_uuid(),
  sitting_date date not null,
  start_time time not null,
  end_time time not null,
  court_location_id uuid not null references public.court_locations(id) on delete restrict,
  courtroom_id uuid not null,
  language_id uuid not null references court_interpreter.languages(id) on delete restrict,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sitting_time_order check (start_time < end_time),
  constraint sitting_room_location_fk foreign key (courtroom_id,court_location_id)
    references court_interpreter.courtrooms(id,court_location_id)
);
create index sitting_date_idx on court_interpreter.court_sittings(sitting_date,courtroom_id) where not is_deleted;

create table court_interpreter.sitting_judges (
  sitting_id uuid not null references court_interpreter.court_sittings(id) on delete cascade,
  judge_id uuid not null references court_interpreter.judges(id) on delete restrict,
  primary key (sitting_id,judge_id)
);
create index sitting_judge_idx on court_interpreter.sitting_judges(judge_id);

create table court_interpreter.sitting_contacts (
  sitting_id uuid not null references court_interpreter.court_sittings(id) on delete cascade,
  contact_id uuid not null,
  contact_type_id smallint not null check (contact_type_id in (1,2)),
  language_id uuid references court_interpreter.languages(id) on delete restrict,
  primary key (sitting_id,contact_id),
  foreign key (contact_id,contact_type_id) references court_interpreter.contacts(id,contact_type_id) on delete restrict,
  foreign key (contact_id,language_id) references court_interpreter.contact_languages(contact_id,language_id) on delete restrict,
  constraint interpreter_language_check check (
    (contact_type_id=1 and language_id is not null) or
    (contact_type_id=2 and language_id is null)
  )
);
create index sitting_contact_idx on court_interpreter.sitting_contacts(contact_id);

-- At inception only current, active NJSS System Administrators become members.
insert into court_interpreter.memberships(auth_user_id,app_role)
select distinct u.auth_user_id,'admin'
from public.users u
join public.user_roles ur on ur.user_id=u.id
join public.roles r on r.id=ur.role_id
join auth.users au on au.id=u.auth_user_id
where u.is_active and r.is_active and r.name='System Administrator'
  and u.auth_user_id is not null;

-- No anonymous access. Future roles are not automatically granted table privileges.
revoke all on all tables in schema court_interpreter from public, anon;
grant select,insert,update,delete on all tables in schema court_interpreter to authenticated;
grant all on all tables in schema court_interpreter to service_role;

alter table court_interpreter.memberships enable row level security;
create policy memberships_read on court_interpreter.memberships for select to authenticated
  using (auth_user_id=(select auth.uid()) or public.njss_current_user_has_role('System Administrator'));
create policy memberships_admin_insert on court_interpreter.memberships for insert to authenticated
  with check (public.njss_current_user_has_role('System Administrator'));
create policy memberships_admin_update on court_interpreter.memberships for update to authenticated
  using (public.njss_current_user_has_role('System Administrator'))
  with check (public.njss_current_user_has_role('System Administrator'));
create policy memberships_admin_delete on court_interpreter.memberships for delete to authenticated
  using (public.njss_current_user_has_role('System Administrator'));

-- Every table is protected before the schema is exposed on the Data API.
-- Membership SELECT above allows a user to read only their own membership.
do $$
declare t text;
declare tables text[] := array[
  'contact_types','engagement_types','languages','banks','judges','courtrooms',
  'contacts','contact_languages','contact_bank_accounts',
  'court_sittings','sitting_judges','sitting_contacts'];
declare can_read text := 'exists (select 1 from court_interpreter.memberships m where m.auth_user_id=(select auth.uid()) and m.is_active)';
declare can_write text := 'exists (select 1 from court_interpreter.memberships m where m.auth_user_id=(select auth.uid()) and m.is_active and m.app_role in (''admin'',''scheduler''))';
declare admin_only text := 'exists (select 1 from court_interpreter.memberships m where m.auth_user_id=(select auth.uid()) and m.is_active and m.app_role=''admin'')';
begin
  foreach t in array tables loop
    execute format('alter table court_interpreter.%I enable row level security',t);
    execute format('create policy ci_read on court_interpreter.%I for select to authenticated using (%s)',t,
      case when t='contact_bank_accounts' then admin_only else can_read end);
    execute format('create policy ci_insert on court_interpreter.%I for insert to authenticated with check (%s)',t,
      case when t in ('contact_types','engagement_types','languages','banks','judges','courtrooms','contact_bank_accounts') then admin_only else can_write end);
    execute format('create policy ci_update on court_interpreter.%I for update to authenticated using (%s) with check (%s)',t,
      case when t in ('contact_types','engagement_types','languages','banks','judges','courtrooms','contact_bank_accounts') then admin_only else can_write end,
      case when t in ('contact_types','engagement_types','languages','banks','judges','courtrooms','contact_bank_accounts') then admin_only else can_write end);
    if t in ('contact_languages','sitting_judges','sitting_contacts') then
      execute format('create policy ci_delete on court_interpreter.%I for delete to authenticated using (%s)',t,can_write);
    end if;
  end loop;
end $$;

comment on schema court_interpreter is 'CourtInterpretor module sharing NJSS Auth; not a separate Supabase project.';
comment on table court_interpreter.court_sittings is 'Judge/contact clash checks and judge parity remain application requirements; database enforces time order and room location only.';
