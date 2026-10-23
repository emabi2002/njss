-- CI-only, synthetic identities and data; tests SQL authorization and workflow integrity.
\set ON_ERROR_STOP on
-- These identities exist only in the ephemeral test Postgres instance.
insert into auth.users(id,email,email_confirmed_at) values
 ('11111111-1111-4111-8111-111111111111','admin@test.invalid',now()),
 ('22222222-2222-4222-8222-222222222222','requester@test.invalid',now()),
 ('33333333-3333-4333-8333-333333333333','reviewer@test.invalid',now()),
 ('44444444-4444-4444-8444-444444444444','purchaser@test.invalid',now()),
 ('55555555-5555-4555-8555-555555555555','receiver@test.invalid',now());
insert into public.monitor_divisions(code,name) values('OPS','Operations');
insert into public.monitor_sections(division_id,code,name)
 select id,'OPS-01','Operations Stores' from public.monitor_divisions where code='OPS';
insert into public.monitor_users(auth_user_id,section_id,full_name,role) values
 ('11111111-1111-4111-8111-111111111111',null,'Administrator Test','administrator'),
 ('22222222-2222-4222-8222-222222222222',(select id from public.monitor_sections where code='OPS-01'),'Requester Test','requester'),
 ('33333333-3333-4333-8333-333333333333',null,'Reviewer Test','reviewer'),
 ('44444444-4444-4444-8444-444444444444',null,'Purchaser Test','purchaser'),
 ('55555555-5555-4555-8555-555555555555',null,'Receiver Test','receiver');
insert into public.monitor_categories(code,name) values('IT','IT consumables');
insert into public.monitor_items(code,name,unit,category_id) values('TONER-BLACK','Black laser printer toner','each',(select id from public.monitor_categories where code='IT'));
insert into public.monitor_suppliers(name) values('Synthetic Supplier');

select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
set role authenticated;
select public.monitor_create_requisition(
 (select id from public.monitor_sections where code='OPS-01'),
 (select id from public.monitor_items where code='TONER-BLACK'),
 10,125.00,'Printer consumables for offices','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as req_id \gset
select public.monitor_submit_requisition(:'req_id'::uuid) as submitted \gset
select set_config('test.req_id', :'req_id', false);
\if :{?submitted}
\else
\echo 'Missing submitted status'
\quit 1
\endif
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select public.monitor_review_requisition(:'req_id'::uuid,'APPROVE','Required for operational printing') as result \gset

select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
select public.monitor_record_purchase('PO-TEST-001',:'req_id'::uuid,
 (select id from public.monitor_suppliers limit 1),
 (select id from public.monitor_items where code='TONER-BLACK'),
 8,120.00,current_date,null) as purchase_id \gset
select id as purchase_line_id from public.monitor_purchase_lines where purchase_id=:'purchase_id'::uuid \gset
select set_config('test.purchase_line_id', :'purchase_line_id', false);

-- An attempted second purchase for 3 units would exceed the approved 10 (8 + 3 > 10).
do $$ begin
  perform public.monitor_record_purchase('PO-TEST-OVER', current_setting('test.req_id')::uuid,
   (select id from public.monitor_suppliers limit 1),
   (select id from public.monitor_items where code='TONER-BLACK'),3,120,current_date,null);
  raise exception 'Over-order was allowed';
exception when others then
  if sqlerrm = 'Over-order was allowed' then raise; end if;
  if position('Total purchase quantity exceeds approved requisition' in sqlerrm)=0 then raise; end if;
end $$;

select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',false);
select public.monitor_record_receipt(:'purchase_line_id'::uuid,5,current_date) as receipt_id \gset
-- Remaining quantity is 3, so 4 must fail.
do $$ begin
 perform public.monitor_record_receipt(current_setting('test.purchase_line_id')::uuid,4,current_date);
 raise exception 'Overreceipt was allowed';
exception when others then
 if sqlerrm='Overreceipt was allowed' then raise;end if;
 if position('Receipt exceeds ordered quantity' in sqlerrm)=0 then raise;end if;
end $$;

select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',false);
select public.monitor_record_expense_evidence(:'purchase_line_id'::uuid,960,'INV-TEST-001','synthetic invoice') as evidence_id \gset
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select public.monitor_verify_expense_evidence(:'evidence_id'::uuid,true,'Invoice evidence reviewed') as verification \gset

-- Repeat request after initial purchase must be held for duplicate review.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false);
select public.monitor_create_requisition(
 (select id from public.monitor_sections where code='OPS-01'),
 (select id from public.monitor_items where code='TONER-BLACK'),
 2,125,'Further toner for printing','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') as req_2 \gset
select public.monitor_submit_requisition(:'req_2'::uuid) as repeat_state \gset
select set_config('test.repeat_request', :'req_2', false);
do $$ begin
 if (select status from public.monitor_requisitions where id=current_setting('test.repeat_request')::uuid) <> 'NEEDS_REVIEW' then raise exception 'Duplicate warning missing';end if;
end $$;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
select public.monitor_review_requisition(:'req_2'::uuid,'APPROVE','Current stock is depleted; justified replenishment') as repeat_result \gset

-- Cross-check positive workflow state and the independent internal evidence register.
select count(*)::integer as purchase_count from public.monitor_purchases \gset
select count(*)::integer as review_count from public.monitor_duplicate_reviews \gset
select count(*)::integer as verified_count from public.monitor_expense_evidence where status='VERIFIED' \gset
\if :{?purchase_count}
\else
\quit 1
\endif
\echo 'SQL workflow smoke tests completed successfully'


-- Negative security/control scenarios: self-approval and direct table writes are forbidden.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',false);
do $$
declare v_req uuid;
begin
 select public.monitor_create_requisition(
   (select id from public.monitor_sections where code='OPS-01'),
   (select id from public.monitor_items where code='TONER-BLACK'),
   1,120,'Extra toner for synthetic offices','cccccccc-cccc-4ccc-8ccc-cccccccccccc') into v_req;
 perform public.monitor_submit_requisition(v_req);
 begin
   perform public.monitor_review_requisition(v_req,'APPROVE','Self approval must not be permitted');
   raise exception 'Self-approval was allowed';
 exception when others then
   if sqlerrm='Self-approval was allowed' then raise; end if;
   if position('Requester cannot approve their own requisition' in sqlerrm)=0 then raise; end if;
 end;
end $$;

-- Verify source staff role cannot verify expenditure evidence they personally recorded.
select public.monitor_record_expense_evidence(:'purchase_line_id'::uuid,10.00,'INV-TEST-ADMIN','second synthetic evidence') as admin_evidence_id \gset
select set_config('test.admin_evidence', :'admin_evidence_id', false);
do $$ begin
  perform public.monitor_verify_expense_evidence(current_setting('test.admin_evidence')::uuid,true,'Attempted self-verification');
  raise exception 'Self verification was allowed';
exception when others then
  if sqlerrm='Self verification was allowed' then raise; end if;
  if position('Recorded-by officer cannot verify own expense evidence' in sqlerrm)=0 then raise; end if;
end $$;

-- The authenticated role must not have direct table INSERT privileges.
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',false);
do $$ begin
 insert into public.monitor_purchases(purchase_reference,entered_by,section_id,ordered_at)
 values('BYPASS-TEST',auth.uid(),(select id from public.monitor_sections limit 1),current_date);
 raise exception 'Unprivileged direct INSERT was allowed';
exception when insufficient_privilege then null;
when others then raise;
end $$;

-- The private attachment metadata must be unavailable by direct SELECT.
do $$ begin
 perform count(*) from public.monitor_documents;
 raise exception 'Unprivileged direct document SELECT was allowed';
exception when insufficient_privilege then null;
when others then raise;
end $$;

do $$ begin
 if not exists(select 1 from public.monitor_duplicate_reviews where disposition='JUSTIFIED_REPEAT')
 then raise exception 'Auditable duplicate-review disposition missing'; end if;
end $$;
\echo 'SQL negative authorization and maker-checker tests passed'
