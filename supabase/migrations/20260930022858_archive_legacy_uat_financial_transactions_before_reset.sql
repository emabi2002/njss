-- Applied to NJSS UAT as version 20260930022858.
do $$
declare t text;
begin
 foreach t in array array[
  'ff3_headers','ff3_items','ff3_quotations','ff3_approvals','ff3_attachments',
  'ff3_commitments','commitment_transactions','ff4_headers','ff4_approvals',
  'ff4_attachments','payment_transactions','funding_authorities','funding_receipts',
  'funding_allocations','quarterly_releases','budget_release_funding_lines'
 ] loop
  execute format('insert into njss_reset_archive.legacy_financial_20260930(table_name,row_count,rows) select %L,count(*),coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from public.%I x',t,t);
 end loop;
end $$;
