-- Agency Internal Monitoring v0.1: apply ONLY to a brand-new, empty Supabase project.
-- This is an internal requisition and purchasing register, NOT an accounting / IFMS integration.
-- All application writes go through explicit permission-checked RPCs; direct client DML is denied.
create extension if not exists pgcrypto;
create schema if not exists monitor_private;
revoke all on schema monitor_private from public, anon;
grant usage on schema monitor_private to authenticated;

create table public.monitor_agency (
  id integer primary key default 1 check (id = 1),
  name text not null check(length(trim(name)) > 1),
  short_name text not null,
  postal_address text not null default '',
  physical_address text not null default '',
  phone text not null default '',
  email text not null default '',
  logo_path text,
  currency char(3) not null default 'PGK',
  duplicate_window_days integer not null default 90 check (duplicate_window_days between 7 and 1095),
  created_at timestamptz not null default now()
);
create table public.monitor_divisions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true
);
create table public.monitor_sections (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references public.monitor_divisions(id) on delete restrict,
  code text not null unique,
  name text not null,
  active boolean not null default true
);
create table public.monitor_users (
  auth_user_id uuid primary key references auth.users(id) on delete restrict,
  section_id uuid references public.monitor_sections(id) on delete restrict,
  full_name text not null,
  role text not null check (role in ('administrator','requester','reviewer','purchaser','receiver','auditor')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index monitor_users_section_idx on public.monitor_users(section_id);
create table public.monitor_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true
);
create table public.monitor_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.monitor_categories(id) on delete restrict,
  code text not null unique,
  name text not null,
  unit text not null default 'each',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.monitor_item_aliases (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.monitor_items(id) on delete cascade,
  alias text not null,
  unique(item_id,alias)
);
create index monitor_item_aliases_item_idx on public.monitor_item_aliases(item_id);
create table public.monitor_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text,
  is_active boolean not null default true
);
create table public.monitor_requisitions (
  id uuid primary key default gen_random_uuid(),
  reference text not null default ('REQ-' || upper(substr(gen_random_uuid()::text,1,12))) unique,
  section_id uuid not null references public.monitor_sections(id) on delete restrict,
  requester_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'DRAFT' check(status in ('DRAFT','SUBMITTED','NEEDS_REVIEW','APPROVED','REJECTED','CANCELLED')),
  purpose text not null,
  idempotency_key uuid not null unique,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz
);
create index monitor_requisitions_section_status_idx on public.monitor_requisitions(section_id,status,created_at desc);
create index monitor_requisitions_requester_idx on public.monitor_requisitions(requester_id);
create table public.monitor_requisition_lines (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.monitor_requisitions(id) on delete restrict,
  item_id uuid not null references public.monitor_items(id) on delete restrict,
  quantity numeric(16,3) not null check(quantity > 0),
  expected_unit_price numeric(16,2) not null check(expected_unit_price >= 0),
  created_at timestamptz not null default now()
);
create index monitor_req_lines_req_idx on public.monitor_requisition_lines(requisition_id);
create index monitor_req_lines_item_idx on public.monitor_requisition_lines(item_id);
create table public.monitor_duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  requisition_line_id uuid not null references public.monitor_requisition_lines(id) on delete restrict,
  source_type text not null check(source_type in ('REQUISITION','PURCHASE')),
  source_id uuid not null,
  matched_at timestamptz not null default now(),
  reviewer_id uuid references auth.users(id) on delete restrict,
  disposition text check(disposition in ('REVIEWED_REJECTED','JUSTIFIED_REPEAT','NOT_DUPLICATE')),
  explanation text,
  reviewed_at timestamptz,
  unique(requisition_line_id,source_type,source_id)
);
create index monitor_duplicate_reviews_line_idx on public.monitor_duplicate_reviews(requisition_line_id);
create table public.monitor_approvals (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.monitor_requisitions(id) on delete restrict,
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check(decision in ('APPROVE','REJECT')),
  reason text not null default '',
  created_at timestamptz not null default now()
);
create table public.monitor_purchases (
  id uuid primary key default gen_random_uuid(),
  purchase_reference text not null unique,
  requisition_id uuid references public.monitor_requisitions(id) on delete restrict,
  supplier_id uuid references public.monitor_suppliers(id) on delete restrict,
  entered_by uuid not null references auth.users(id) on delete restrict,
  section_id uuid not null references public.monitor_sections(id) on delete restrict,
  ordered_at date not null,
  created_at timestamptz not null default now()
);
create index monitor_purchases_requisition_idx on public.monitor_purchases(requisition_id);
create table public.monitor_purchase_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.monitor_purchases(id) on delete restrict,
  item_id uuid not null references public.monitor_items(id) on delete restrict,
  quantity numeric(16,3) not null check(quantity > 0),
  unit_price numeric(16,2) not null check(unit_price >= 0)
);
create index monitor_purchase_lines_item_idx on public.monitor_purchase_lines(item_id);
create table public.monitor_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_line_id uuid not null references public.monitor_purchase_lines(id) on delete restrict,
  received_quantity numeric(16,3) not null check(received_quantity > 0),
  received_at date not null,
  received_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index monitor_receipts_line_idx on public.monitor_receipts(purchase_line_id);
create table public.monitor_expense_evidence (
  id uuid primary key default gen_random_uuid(),
  purchase_line_id uuid not null references public.monitor_purchase_lines(id) on delete restrict,
  reported_amount numeric(16,2) not null check(reported_amount > 0),
  evidence_reference text not null,
  status text not null default 'REPORTED' check(status in ('REPORTED','VERIFIED','DISPUTED')),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  verified_by uuid references auth.users(id) on delete restrict,
  verified_at timestamptz,
  verification_note text,
  created_at timestamptz not null default now(),
  note text not null default '',
  unique(purchase_line_id, evidence_reference)
);
create index monitor_evidence_purchase_idx on public.monitor_expense_evidence(purchase_line_id);
create table public.monitor_audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- All public tables must have RLS even though the only permitted writes use RPCs.
do $$ declare rec record; begin
  for rec in select tablename from pg_tables where schemaname='public' and tablename like 'monitor_%' loop
    execute format('alter table public.%I enable row level security',rec.tablename);
    execute format('revoke all on table public.%I from public, anon, authenticated',rec.tablename);
  end loop;
end $$;

-- This function runs under database-owner privileges but returns ONLY the current authenticated user's role.
-- It never accepts a caller-selected user ID. It is not exposed as a public Data API endpoint.
create function monitor_private.current_role() returns text
language sql stable security definer set search_path = '' as $$
  select u.role from public.monitor_users u where u.auth_user_id=(select auth.uid()) and u.is_active limit 1
$$;
revoke all on function monitor_private.current_role() from public, anon;
grant execute on function monitor_private.current_role() to authenticated;

-- Match exact item codes/names and administrator-curated synonyms across catalogue rows.
-- This is a candidate warning, not a claim that an expenditure was duplicated.
create function monitor_private.normalize_item(p_text text) returns text
language sql immutable set search_path = '' as $$
 select trim(regexp_replace(lower(coalesce(p_text,'')), '[^[:alnum:]]+', ' ', 'g'))
$$;
revoke all on function monitor_private.normalize_item(text) from public, anon;
grant execute on function monitor_private.normalize_item(text) to authenticated;

create function monitor_private.same_catalogue_item(p_first uuid, p_second uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select coalesce((
   select (a.unit = b.unit and (
     a.id = b.id
     or monitor_private.normalize_item(a.code) = monitor_private.normalize_item(b.code)
     or monitor_private.normalize_item(a.name) = monitor_private.normalize_item(b.name)
     or exists (
       select 1 from public.monitor_item_aliases al
       where al.item_id in (a.id,b.id)
       and monitor_private.normalize_item(al.alias) in (
         monitor_private.normalize_item(a.name), monitor_private.normalize_item(b.name),
         monitor_private.normalize_item(a.code), monitor_private.normalize_item(b.code))
     )
     or exists (
       select 1 from public.monitor_item_aliases x
       join public.monitor_item_aliases y on x.item_id=a.id and y.item_id=b.id
       where monitor_private.normalize_item(x.alias)=monitor_private.normalize_item(y.alias)
     )
   )) from public.monitor_items a, public.monitor_items b
   where a.id=p_first and b.id=p_second
 ), false)
$$;
revoke all on function monitor_private.same_catalogue_item(uuid,uuid) from public, anon;
grant execute on function monitor_private.same_catalogue_item(uuid,uuid) to authenticated;

-- Read-only agency directory and operational reports; access limited to assigned staff.
do $$ declare rec record; begin
  for rec in select unnest(array[
    'monitor_agency','monitor_divisions','monitor_sections','monitor_users','monitor_categories',
    'monitor_items','monitor_item_aliases','monitor_suppliers','monitor_requisitions',
    'monitor_requisition_lines','monitor_duplicate_reviews','monitor_approvals','monitor_purchases',
    'monitor_purchase_lines','monitor_receipts','monitor_expense_evidence','monitor_audit_events'
  ]) as table_name loop
    execute format('grant select on public.%I to authenticated',rec.table_name);
    -- An active staff account can inspect cross-division purchase history; protect employee
    -- identity records and audit metadata separately below.
    if rec.table_name = 'monitor_users' then
      execute format('create policy staff_select on public.%I for select to authenticated using (auth_user_id = (select auth.uid()) or monitor_private.current_role() = ''administrator'')',rec.table_name);
    elsif rec.table_name = 'monitor_audit_events' then
      execute format('create policy staff_select on public.%I for select to authenticated using (actor_id = (select auth.uid()) or monitor_private.current_role() in (''administrator'',''auditor''))',rec.table_name);
    else
      execute format('create policy staff_select on public.%I for select to authenticated using (monitor_private.current_role() is not null)',rec.table_name);
    end if;
  end loop;
end $$;

-- Restrict routine execution to authenticated agency users, with separate role checks inside each function.
create function public.monitor_find_duplicates(
  p_item_id uuid,
  p_days integer default 90,
  p_exclude_requisition uuid default null
) returns table(source_type text,source_id uuid,reference text,section text,
                event_date date,quantity numeric,unit_price numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if monitor_private.current_role() is null then raise exception 'Not an active agency user' using errcode='42501'; end if;
  if p_days is null or p_days < 7 or p_days > 1095 then raise exception 'Invalid review period'; end if;
  if not exists(select 1 from public.monitor_items where id=p_item_id and is_active) then raise exception 'Unknown or disabled item'; end if;
  return query
    select 'REQUISITION'::text,r.id,r.reference,s.name,r.created_at::date,rl.quantity,rl.expected_unit_price
      from public.monitor_requisition_lines rl
      join public.monitor_requisitions r on r.id=rl.requisition_id
      join public.monitor_sections s on s.id=r.section_id
      where monitor_private.same_catalogue_item(rl.item_id,p_item_id) and r.status in ('SUBMITTED','NEEDS_REVIEW','APPROVED')
        and r.created_at >= now() - make_interval(days => p_days)
        and (p_exclude_requisition is null or r.id <> p_exclude_requisition)
    union all
    select 'PURCHASE'::text,p.id,p.purchase_reference,s.name,p.ordered_at,pl.quantity,pl.unit_price
      from public.monitor_purchase_lines pl
      join public.monitor_purchases p on p.id=pl.purchase_id
      left join public.monitor_requisitions r on r.id=p.requisition_id
      left join public.monitor_sections s on s.id=p.section_id
      where monitor_private.same_catalogue_item(pl.item_id,p_item_id) and p.ordered_at >= (current_date - p_days)
    order by 5 desc limit 50;
end $$;
revoke all on function public.monitor_find_duplicates(uuid,integer,uuid) from public, anon;
grant execute on function public.monitor_find_duplicates(uuid,integer,uuid) to authenticated;

create function public.monitor_create_requisition(
 p_section_id uuid,p_item_id uuid,p_quantity numeric,p_unit_price numeric,
 p_purpose text,p_idempotency_key uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_role text;
begin
 v_role := monitor_private.current_role();
 if v_role not in ('requester','administrator') then raise exception 'Not authorised to request' using errcode='42501'; end if;
 if p_idempotency_key is null or p_quantity <= 0 or p_unit_price < 0 or length(trim(coalesce(p_purpose,''))) < 5 then raise exception 'Invalid requisition inputs'; end if;
 if not exists(select 1 from public.monitor_items where id=p_item_id and is_active) then raise exception 'Invalid item'; end if;
 if not exists(select 1 from public.monitor_sections where id=p_section_id and active) then raise exception 'Invalid section'; end if;
 if v_role='requester' and not exists(select 1 from public.monitor_users where auth_user_id=auth.uid() and section_id=p_section_id) then
   raise exception 'Requesting officer must use assigned section' using errcode='42501'; end if;
 -- Idempotent retry by the same caller; other callers cannot reuse the key.
 select id into v_id from public.monitor_requisitions where idempotency_key=p_idempotency_key;
 if v_id is not null then
   if not exists(select 1 from public.monitor_requisitions where id=v_id and requester_id=auth.uid()) then
     raise exception 'Idempotency key belongs to another requester' using errcode='42501';
   end if;
   return v_id;
 end if;
 insert into public.monitor_requisitions(section_id,requester_id,purpose,idempotency_key)
 values (p_section_id,auth.uid(),trim(p_purpose),p_idempotency_key) returning id into v_id;
 insert into public.monitor_requisition_lines(requisition_id,item_id,quantity,expected_unit_price)
 values(v_id,p_item_id,p_quantity,p_unit_price);
 insert into public.monitor_audit_events(actor_id,action,entity_type,entity_id)
 values(auth.uid(),'CREATE_REQUISITION','requisition',v_id);
 return v_id;
end $$;
revoke all on function public.monitor_create_requisition(uuid,uuid,numeric,numeric,text,uuid) from public, anon;
grant execute on function public.monitor_create_requisition(uuid,uuid,numeric,numeric,text,uuid) to authenticated;

create function public.monitor_submit_requisition(p_requisition_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_req public.monitor_requisitions%rowtype; v_line public.monitor_requisition_lines%rowtype;
  v_dup record; v_matches integer :=0; v_days integer :=90;
begin
 if monitor_private.current_role() not in ('requester','administrator') then raise exception 'Not authorised' using errcode='42501'; end if;
 select * into v_req from public.monitor_requisitions where id=p_requisition_id for update;
 if not found or v_req.requester_id <> auth.uid() or v_req.status <> 'DRAFT' then raise exception 'Draft is not owned by requester'; end if;
 select duplicate_window_days into v_days from public.monitor_agency where id=1;
 v_days := coalesce(v_days,90);
 for v_line in select * from public.monitor_requisition_lines where requisition_id=v_req.id loop
   for v_dup in select * from public.monitor_find_duplicates(v_line.item_id,v_days,v_req.id) loop
     insert into public.monitor_duplicate_reviews(requisition_line_id,source_type,source_id)
     values(v_line.id,v_dup.source_type,v_dup.source_id) on conflict do nothing;
     v_matches := v_matches+1;
   end loop;
 end loop;
 update public.monitor_requisitions set status=case when v_matches>0 then 'NEEDS_REVIEW' else 'SUBMITTED' end, submitted_at=now() where id=v_req.id;
 insert into public.monitor_audit_events(actor_id,action,entity_type,entity_id,context)
 values(auth.uid(),'SUBMIT_REQUISITION','requisition',v_req.id,jsonb_build_object('duplicate_candidates',v_matches));
 return case when v_matches>0 then 'NEEDS_REVIEW' else 'SUBMITTED' end;
end $$;
revoke all on function public.monitor_submit_requisition(uuid) from public, anon;
grant execute on function public.monitor_submit_requisition(uuid) to authenticated;

create function public.monitor_review_requisition(p_requisition_id uuid,p_decision text,p_reason text default '') returns text
language plpgsql security definer set search_path = '' as $$
declare v_req public.monitor_requisitions%rowtype; v_new text; v_dup integer;
begin
 if monitor_private.current_role() not in ('reviewer','administrator') then raise exception 'Not authorised to approve' using errcode='42501'; end if;
 if p_decision not in ('APPROVE','REJECT') then raise exception 'Invalid decision'; end if;
 select * into v_req from public.monitor_requisitions where id=p_requisition_id for update;
 if not found or v_req.status not in ('SUBMITTED','NEEDS_REVIEW') then raise exception 'Request is not awaiting review'; end if;
 if v_req.requester_id=auth.uid() then raise exception 'Requester cannot approve their own requisition' using errcode='42501'; end if;
 select count(*) into v_dup from public.monitor_duplicate_reviews d join public.monitor_requisition_lines l on l.id=d.requisition_line_id where l.requisition_id=p_requisition_id;
 if v_dup>0 and length(trim(coalesce(p_reason,''))) < 15 then raise exception 'Provide a clear, minimum 15-character reason addressing the repeat purchase warning'; end if;
 -- Retain a review decision for every candidate; approval means a justified repeat,
 -- rejection means potential similarity was considered, not proven fraud.
 if v_dup>0 then
   update public.monitor_duplicate_reviews d
   set reviewer_id=auth.uid(),
       disposition=case when p_decision='APPROVE' then 'JUSTIFIED_REPEAT' else 'REVIEWED_REJECTED' end,
       explanation=trim(p_reason), reviewed_at=now()
   from public.monitor_requisition_lines l
   where l.id=d.requisition_line_id and l.requisition_id=p_requisition_id and d.reviewed_at is null;
 end if;
 v_new := case when p_decision='APPROVE' then 'APPROVED' else 'REJECTED' end;
 update public.monitor_requisitions set status=v_new,reviewed_at=now() where id=p_requisition_id;
 insert into public.monitor_approvals(requisition_id,reviewer_id,decision,reason) values(p_requisition_id,auth.uid(),p_decision,trim(coalesce(p_reason,'')));
 insert into public.monitor_audit_events(actor_id,action,entity_type,entity_id,context)
 values(auth.uid(),'REVIEW_REQUISITION','requisition',p_requisition_id,jsonb_build_object('decision',p_decision,'duplicate_candidates',v_dup,'reason',p_reason));
 return v_new;
end $$;
revoke all on function public.monitor_review_requisition(uuid,text,text) from public, anon;
grant execute on function public.monitor_review_requisition(uuid,text,text) to authenticated;

create function public.monitor_record_purchase(
 p_reference text,p_requisition_id uuid,p_supplier_id uuid,p_item_id uuid,
 p_quantity numeric,p_price numeric,p_ordered_at date,p_section_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_section uuid; v_approved numeric; v_already numeric;
begin
 if monitor_private.current_role() not in ('purchaser','administrator') then raise exception 'Not authorised to record purchase' using errcode='42501'; end if;
 if length(trim(coalesce(p_reference,'')))<2 or p_quantity<=0 or p_price<0 or p_ordered_at is null then raise exception 'Invalid purchase'; end if;
 if not exists(select 1 from public.monitor_items where id=p_item_id and is_active) then raise exception 'Invalid item'; end if;
 if p_supplier_id is not null and not exists(select 1 from public.monitor_suppliers where id=p_supplier_id and is_active) then raise exception 'Unknown/disabled supplier'; end if;
 if p_requisition_id is not null then
   -- Lock the requisition to serialize multiple purchasers against the same approved quantity.
   select r.section_id into v_section from public.monitor_requisitions r
   where r.id=p_requisition_id and r.status='APPROVED' for update;
   if v_section is null then raise exception 'Linked requisition must be approved'; end if;
   if p_section_id is not null and p_section_id<>v_section then raise exception 'Purchase section conflicts with approved request'; end if;
   select coalesce(sum(rl.quantity),0) into v_approved from public.monitor_requisition_lines rl
   where rl.requisition_id=p_requisition_id and rl.item_id=p_item_id;
   if v_approved<=0 then raise exception 'Purchase item not present in approved requisition'; end if;
   select coalesce(sum(pl.quantity),0) into v_already
   from public.monitor_purchases p join public.monitor_purchase_lines pl on pl.purchase_id=p.id
   where p.requisition_id=p_requisition_id and pl.item_id=p_item_id;
   if v_already+p_quantity>v_approved then raise exception 'Total purchase quantity exceeds approved requisition'; end if;
 else
   if monitor_private.current_role()<>'administrator' then raise exception 'Only an administrator may enter an unlinked historical purchase' using errcode='42501'; end if;
   v_section:=p_section_id;
   if v_section is null then raise exception 'Department/section required for historical purchase'; end if;
 end if;
 if not exists(select 1 from public.monitor_sections s join public.monitor_divisions d on d.id=s.division_id
  where s.id=v_section and s.active and d.active) then raise exception 'Unknown/disabled section'; end if;
 insert into public.monitor_purchases(purchase_reference,requisition_id,supplier_id,entered_by,ordered_at,section_id)
 values(trim(p_reference),p_requisition_id,p_supplier_id,auth.uid(),p_ordered_at,v_section) returning id into v_id;
 insert into public.monitor_purchase_lines(purchase_id,item_id,quantity,unit_price)
 values(v_id,p_item_id,p_quantity,p_price);
 insert into public.monitor_audit_events(actor_id,action,entity_type,entity_id,context)
 values(auth.uid(),'RECORD_PURCHASE','purchase',v_id,jsonb_build_object('section_id',v_section,'linked_requisition',p_requisition_id));
 return v_id;
end $$;
revoke all on function public.monitor_record_purchase(text,uuid,uuid,uuid,numeric,numeric,date,uuid) from public, anon;
grant execute on function public.monitor_record_purchase(text,uuid,uuid,uuid,numeric,numeric,date,uuid) to authenticated;

create function public.monitor_record_receipt(p_purchase_line_id uuid,p_quantity numeric,p_received_at date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_ordered numeric; v_received numeric;
begin
 if monitor_private.current_role() not in ('receiver','administrator') then raise exception 'Not authorised to record receipt' using errcode='42501'; end if;
 if p_quantity<=0 or p_received_at is null then raise exception 'Invalid receipt'; end if;
 select quantity into v_ordered from public.monitor_purchase_lines where id=p_purchase_line_id for update;
 if not found then raise exception 'Unknown purchase line'; end if;
 select coalesce(sum(received_quantity),0) into v_received from public.monitor_receipts where purchase_line_id=p_purchase_line_id;
 if v_received+p_quantity>v_ordered then raise exception 'Receipt exceeds ordered quantity'; end if;
 insert into public.monitor_receipts(purchase_line_id,received_quantity,received_at,received_by)
 values(p_purchase_line_id,p_quantity,p_received_at,auth.uid()) returning id into v_id;
 insert into public.monitor_audit_events(actor_id,action,entity_type,entity_id)
 values(auth.uid(),'RECORD_RECEIPT','receipt',v_id);
 return v_id;
end $$;
revoke all on function public.monitor_record_receipt(uuid,numeric,date) from public, anon;
grant execute on function public.monitor_record_receipt(uuid,numeric,date) to authenticated;

create function public.monitor_record_expense_evidence(p_purchase_line_id uuid,p_amount numeric,p_reference text,p_note text default '') returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
 if monitor_private.current_role() not in ('purchaser','administrator') then raise exception 'Not authorised to report expense' using errcode='42501'; end if;
 if p_amount<=0 or length(trim(coalesce(p_reference,'')))<2 then raise exception 'Invalid evidence'; end if;
 if not exists(select 1 from public.monitor_purchase_lines where id=p_purchase_line_id) then raise exception 'Unknown purchase line'; end if;
 insert into public.monitor_expense_evidence(purchase_line_id,reported_amount,evidence_reference,recorded_by,note)
 values(p_purchase_line_id,p_amount,trim(p_reference),auth.uid(),coalesce(p_note,'')) returning id into v_id;
 insert into public.monitor_audit_events(actor_id,action,entity_type,entity_id)
 values(auth.uid(),'REPORT_EXPENSE_EVIDENCE','expense_evidence',v_id);
 return v_id;
end $$;
revoke all on function public.monitor_record_expense_evidence(uuid,numeric,text,text) from public, anon;
grant execute on function public.monitor_record_expense_evidence(uuid,numeric,text,text) to authenticated;

-- Important: all data-writing tables deliberately have NO INSERT/UPDATE/DELETE client grants.
-- Only a project owner/service-side provisioning step may insert the first active administrator.
-- Never seed example users, names, agencies, documents or NJSS records in a new agency project.

-- Agency-local setup APIs. No central server; these mutate only THIS agency's isolated DB.
create function public.monitor_admin_configure_agency(
  p_name text,p_short_name text,p_address text,p_phone text,p_email text,p_window_days integer default 90,
 p_physical_address text default '',p_logo_path text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
 if monitor_private.current_role()<>'administrator' then raise exception 'Administrator only' using errcode='42501'; end if;
 if length(trim(coalesce(p_name,''))) < 3 or length(trim(coalesce(p_short_name,''))) < 2 or p_window_days not between 7 and 1095 then raise exception 'Invalid agency settings'; end if;
 if nullif(trim(coalesce(p_logo_path,'')),'') is not null and p_logo_path !~ '^https://[^[:space:]]+$' then raise exception 'Only HTTPS logo URLs are accepted'; end if;
 insert into public.monitor_agency(id,name,short_name,postal_address,physical_address,phone,email,logo_path,duplicate_window_days)
 values(1,trim(p_name),trim(p_short_name),coalesce(p_address,''),coalesce(p_physical_address,''),coalesce(p_phone,''),coalesce(p_email,''),nullif(trim(coalesce(p_logo_path,'')),''),p_window_days)
 on conflict(id) do update set name=excluded.name,short_name=excluded.short_name,postal_address=excluded.postal_address,
 phone=excluded.phone,email=excluded.email,physical_address=excluded.physical_address,logo_path=excluded.logo_path,duplicate_window_days=excluded.duplicate_window_days;
 insert into public.monitor_audit_events(actor_id,action,entity_type,context)
 values(auth.uid(),'CONFIGURE_AGENCY','agency',jsonb_build_object('short_name',p_short_name));
 return true;
end $$;
revoke all on function public.monitor_admin_configure_agency(text,text,text,text,text,integer,text,text) from public, anon;
grant execute on function public.monitor_admin_configure_agency(text,text,text,text,text,integer,text,text) to authenticated;

create function public.monitor_admin_create_division(p_code text,p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if monitor_private.current_role()<>'administrator' then raise exception 'Administrator only' using errcode='42501'; end if;
 if length(trim(coalesce(p_code,'')))<2 or length(trim(coalesce(p_name,'')))<3 then raise exception 'Division requires code and name'; end if;
 insert into public.monitor_divisions(code,name) values(upper(trim(p_code)),trim(p_name)) returning id into v_id;
 insert into public.monitor_audit_events(actor_id,action,entity_type,entity_id) values(auth.uid(),'CREATE_DIVISION','division',v_id);
 return v_id;
end $$;
revoke all on function public.monitor_admin_create_division(text,text) from public, anon;
grant execute on function public.monitor_admin_create_division(text,text) to authenticated;

create function public.monitor_admin_create_section(p_division_id uuid,p_code text,p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if monitor_private.current_role()<>'administrator' then raise exception 'Administrator only' using errcode='42501'; end if;
 if length(trim(coalesce(p_code,'')))<2 or length(trim(coalesce(p_name,'')))<3 then raise exception 'Section requires code and name'; end if;
 insert into public.monitor_sections(division_id,code,name) values(p_division_id,upper(trim(p_code)),trim(p_name)) returning id into v_id;
 insert into public.monitor_audit_events(actor_id,action,entity_type,entity_id) values(auth.uid(),'CREATE_SECTION','section',v_id);
 return v_id;
end $$;
revoke all on function public.monitor_admin_create_section(uuid,text,text) from public, anon;
grant execute on function public.monitor_admin_create_section(uuid,text,text) to authenticated;

create function public.monitor_admin_create_item(p_code text,p_name text,p_unit text default 'each',p_category_id uuid default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if monitor_private.current_role()<>'administrator' then raise exception 'Administrator only' using errcode='42501'; end if;
 if length(trim(coalesce(p_code,'')))<2 or length(trim(coalesce(p_name,'')))<3 or length(trim(coalesce(p_unit,'')))<1 then raise exception 'Item code, name and unit required'; end if;
 if p_category_id is not null and not exists(select 1 from public.monitor_categories where id=p_category_id and active) then raise exception 'Unknown expense category'; end if;
 insert into public.monitor_items(code,name,unit,category_id) values(upper(trim(p_code)),trim(p_name),trim(p_unit),p_category_id) returning id into v_id;
 insert into public.monitor_audit_events(actor_id,action,entity_type,entity_id) values(auth.uid(),'CREATE_ITEM','item',v_id);
 return v_id;
end $$;
revoke all on function public.monitor_admin_create_item(text,text,text,uuid) from public, anon;
grant execute on function public.monitor_admin_create_item(text,text,text,uuid) to authenticated;

create function public.monitor_admin_create_supplier(p_name text,p_contact text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if monitor_private.current_role()<>'administrator' then raise exception 'Administrator only' using errcode='42501'; end if;
 if length(trim(coalesce(p_name,'')))<3 then raise exception 'Supplier name required'; end if;
 insert into public.monitor_suppliers(name,contact) values(trim(p_name),coalesce(p_contact,'')) returning id into v_id;
 insert into public.monitor_audit_events(actor_id,action,entity_type,entity_id) values(auth.uid(),'CREATE_SUPPLIER','supplier',v_id);
 return v_id;
end $$;
revoke all on function public.monitor_admin_create_supplier(text,text) from public, anon;
grant execute on function public.monitor_admin_create_supplier(text,text) to authenticated;

-- Admin-only catalogue synonym management. Synonyms improve cross-item duplicate warnings.
create function public.monitor_admin_add_item_alias(p_item_id uuid,p_alias text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if monitor_private.current_role()<>'administrator' then raise exception 'Administrator only' using errcode='42501'; end if;
 if length(trim(coalesce(p_alias,'')))<3 then raise exception 'Alias too short'; end if;
 if not exists(select 1 from public.monitor_items where id=p_item_id and is_active) then raise exception 'Unknown item'; end if;
 insert into public.monitor_item_aliases(item_id,alias)
 values(p_item_id,trim(p_alias)) on conflict(item_id,alias) do update set alias=excluded.alias
 returning id into v_id;
 insert into public.monitor_audit_events(actor_id,action,entity_type,entity_id,context)
 values(auth.uid(),'ADD_ITEM_ALIAS','item',p_item_id,jsonb_build_object('alias',trim(p_alias)));
 return v_id;
end $$;
revoke all on function public.monitor_admin_add_item_alias(uuid,text) from public, anon;
grant execute on function public.monitor_admin_add_item_alias(uuid,text) to authenticated;

-- Reported amounts are not verified expenditure until separately reviewed by another officer.
create function public.monitor_verify_expense_evidence(p_evidence_id uuid,p_accept boolean,p_reason text) returns text
language plpgsql security definer set search_path='' as $$
declare v_evidence public.monitor_expense_evidence%rowtype; v_status text;
begin
 if monitor_private.current_role() not in ('reviewer','administrator') then raise exception 'Reviewer only' using errcode='42501'; end if;
 if length(trim(coalesce(p_reason,'')))<8 then raise exception 'Verification reason required'; end if;
 select * into v_evidence from public.monitor_expense_evidence where id=p_evidence_id for update;
 if not found or v_evidence.status<>'REPORTED' then raise exception 'Evidence is not pending verification'; end if;
 if v_evidence.recorded_by=auth.uid() then raise exception 'Recorded-by officer cannot verify own expense evidence' using errcode='42501'; end if;
 v_status:=case when p_accept then 'VERIFIED' else 'DISPUTED' end;
 update public.monitor_expense_evidence set status=v_status,verified_by=auth.uid(),verified_at=now(),verification_note=trim(p_reason)
 where id=p_evidence_id;
 insert into public.monitor_audit_events(actor_id,action,entity_type,entity_id,context)
 values(auth.uid(),'VERIFY_EXPENSE_EVIDENCE','expense_evidence',p_evidence_id,
 jsonb_build_object('status',v_status,'reason',trim(p_reason)));
 return v_status;
end $$;
revoke all on function public.monitor_verify_expense_evidence(uuid,boolean,text) from public, anon;
grant execute on function public.monitor_verify_expense_evidence(uuid,boolean,text) to authenticated;

-- Robust private-by-default evidence storage; new installations seed no real user files.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('monitor-evidence','monitor-evidence',false,10485760,ARRAY['application/pdf','image/jpeg','image/png'])
on conflict(id) do nothing;
-- No bucket policies added until a separate authorised upload and document-scoping design.
-- This means browser uploads/downloads to the evidence bucket are denied by default.

-- Agency-specific internal expenditure category / ledger labels (never IFMS posting codes).
create function public.monitor_admin_create_category(p_code text,p_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if monitor_private.current_role()<>'administrator' then raise exception 'Administrator only' using errcode='42501'; end if;
 if length(trim(coalesce(p_code,'')))<2 or length(trim(coalesce(p_name,'')))<3 then raise exception 'Valid category code/name required'; end if;
 insert into public.monitor_categories(code,name) values(upper(trim(p_code)),trim(p_name)) returning id into v_id;
 insert into public.monitor_audit_events(actor_id,action,entity_type,entity_id)
 values(auth.uid(),'CREATE_CATEGORY','category',v_id);
 return v_id;
end $$;
revoke all on function public.monitor_admin_create_category(text,text) from public, anon;
grant execute on function public.monitor_admin_create_category(text,text) to authenticated;

-- Staff are invited via THIS agency's Supabase Auth management process. This
-- RPC only maps an already created Auth account to a role; it cannot create logins.
create function public.monitor_admin_assign_staff(p_auth_user_id uuid,p_full_name text,p_role text,p_section_id uuid default null) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if monitor_private.current_role()<>'administrator' then raise exception 'Administrator only' using errcode='42501'; end if;
 if p_auth_user_id is null or p_auth_user_id=auth.uid() then raise exception 'Cannot assign own role or unknown staff'; end if;
 if length(trim(coalesce(p_full_name,'')))<3 or p_role not in ('administrator','requester','reviewer','purchaser','receiver','auditor') then raise exception 'Invalid staff name or role'; end if;
 if not exists(select 1 from auth.users where id=p_auth_user_id and email_confirmed_at is not null) then raise exception 'Invite and verify the user in this agency Auth project first'; end if;
 if p_role='requester' and p_section_id is null then raise exception 'Requester must belong to a section'; end if;
 if p_section_id is not null and not exists(select 1 from public.monitor_sections s join public.monitor_divisions d on d.id=s.division_id
    where s.id=p_section_id and s.active and d.active) then raise exception 'Unknown/disabled section'; end if;
 insert into public.monitor_users(auth_user_id,full_name,role,section_id,is_active)
 values(p_auth_user_id,trim(p_full_name),p_role,p_section_id,true)
 on conflict(auth_user_id) do update set full_name=excluded.full_name, role=excluded.role, section_id=excluded.section_id, is_active=true;
 insert into public.monitor_audit_events(actor_id,action,entity_type,context)
 values(auth.uid(),'ASSIGN_STAFF','user',jsonb_build_object('auth_user_id',p_auth_user_id,'role',p_role));
 return true;
end $$;
revoke all on function public.monitor_admin_assign_staff(uuid,text,text,uuid) from public, anon;
grant execute on function public.monitor_admin_assign_staff(uuid,text,text,uuid) to authenticated;

-- Accurate full-history reporting views; never compute official totals from a paginated
-- browser list. These are internal purchasing records, not IFMS/payment balances.
create view public.monitor_report_spend_by_item with (security_invoker=true) as
 select i.id as item_id,i.code as item_code,i.name as item_name,i.category_id,
        count(*)::integer as purchase_lines,
        sum(pl.quantity)::numeric(18,3) as ordered_quantity,
        sum(pl.quantity*pl.unit_price)::numeric(18,2) as order_value
 from public.monitor_purchase_lines pl
 join public.monitor_items i on i.id=pl.item_id
 group by i.id,i.code,i.name,i.category_id;
create view public.monitor_report_spend_by_section with (security_invoker=true) as
 select s.id as section_id,s.name as section_name,d.name as division_name,
        count(*)::integer as purchase_lines,
        sum(pl.quantity)::numeric(18,3) as ordered_quantity,
        sum(pl.quantity*pl.unit_price)::numeric(18,2) as order_value
 from public.monitor_purchase_lines pl
 join public.monitor_purchases p on p.id=pl.purchase_id
 join public.monitor_sections s on s.id=p.section_id
 join public.monitor_divisions d on d.id=s.division_id
 group by s.id,s.name,d.name;
create view public.monitor_report_expense_status with (security_invoker=true) as
 select status,count(*)::integer as evidence_count,
        sum(reported_amount)::numeric(18,2) as reported_amount
 from public.monitor_expense_evidence
 group by status;
grant select on public.monitor_report_spend_by_item,
 public.monitor_report_spend_by_section,public.monitor_report_expense_status to authenticated;
revoke all on public.monitor_report_spend_by_item,
 public.monitor_report_spend_by_section,public.monitor_report_expense_status from anon;

-- Additional management-analysis dimensions: internal category and supplier.
create view public.monitor_report_spend_by_category with (security_invoker=true) as
 select coalesce(c.code,'UNCLASSIFIED') as category_code,
        coalesce(c.name,'Unclassified') as category_name,
        count(*)::integer as purchase_lines,
        sum(pl.quantity * pl.unit_price)::numeric(18,2) as order_value
 from public.monitor_purchase_lines pl
 join public.monitor_items i on i.id=pl.item_id
 left join public.monitor_categories c on c.id=i.category_id
 group by coalesce(c.code,'UNCLASSIFIED'),coalesce(c.name,'Unclassified');
create view public.monitor_report_spend_by_supplier with (security_invoker=true) as
 select coalesce(s.name,'Unspecified supplier') as supplier_name,
        count(*)::integer as purchase_lines,
        sum(pl.quantity * pl.unit_price)::numeric(18,2) as order_value
 from public.monitor_purchase_lines pl
 join public.monitor_purchases p on p.id=pl.purchase_id
 left join public.monitor_suppliers s on s.id=p.supplier_id
 group by coalesce(s.name,'Unspecified supplier');
grant select on public.monitor_report_spend_by_category,public.monitor_report_spend_by_supplier to authenticated;
revoke all on public.monitor_report_spend_by_category,public.monitor_report_spend_by_supplier from anon;

-- Private evidence uploads are brokered through authenticated agency-local API routes.
-- No direct client INSERT/SELECT on the documents table and no storage.objects policies.
create table public.monitor_documents (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check(entity_type in ('requisition','purchase','expense')),
  entity_id uuid not null,
  object_path text not null unique,
  original_name text not null,
  mime_type text not null check(mime_type in ('application/pdf','image/png','image/jpeg')),
  file_size integer not null check(file_size between 1 and 8388608),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
alter table public.monitor_documents enable row level security;
revoke all on public.monitor_documents from public, anon, authenticated;
-- Only trusted server side code with service-role privileges can manage file metadata.
-- App routes perform an authenticated agency user check + per-record authorization.

-- Agency logos contain public branding only; browser writes are not allowed.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('monitor-branding','monitor-branding',true,2097152,ARRAY['image/jpeg','image/png'])
on conflict(id) do nothing;
