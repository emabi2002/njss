import assert from 'node:assert/strict'
import fs from 'node:fs'
import pg from 'pg'

const connectionString = process.env.NJSS_TEST_DATABASE_URL
assert.ok(connectionString, 'isolated test database required')
const target = new URL(connectionString)
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname))
assert.equal(target.pathname, '/njss_rpc_test', 'refuse live databases')
const source = fs.readFileSync('supabase/migrations/20260917210000_ff3_simplified_budget_integration.sql', 'utf8')
const calculator = source.match(/CREATE OR REPLACE FUNCTION public\.njss_calculate_ff3_budget\([\s\S]*?\$function\$;/)[0]
const commitmentSource = fs.readFileSync('supabase/migrations/023_ff3_commitment_control.sql','utf8')
const signedAmount = commitmentSource.match(/CREATE OR REPLACE FUNCTION njss_commitment_signed_amount\([\s\S]*?\$\$;/)[0]
const syncBalances = commitmentSource.match(/CREATE OR REPLACE FUNCTION njss_sync_commitment_balances\([\s\S]*?\$\$;/)[0]
const migrationFile = fs.readdirSync('supabase/migrations').find(name => name.endsWith('_head_office_budget_consolidation.sql'))
const migration = fs.readFileSync(`supabase/migrations/${migrationFile}`, 'utf8')
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const client = new pg.Client({ connectionString })
await client.connect()
async function denial(sql, args = [], pattern = /permission denied/i) {
  await client.query('SAVEPOINT denied')
  let error
  try { await client.query(sql, args) } catch (caught) { error = caught }
  await client.query('ROLLBACK TO SAVEPOINT denied')
  assert.ok(error, 'operation must fail')
  assert.match(error.message, pattern)
}
try {
  await client.query('BEGIN')
  await client.query(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth; CREATE SCHEMA storage;
    CREATE TABLE storage.objects(bucket_id text,name text);
    GRANT USAGE ON SCHEMA storage TO authenticated;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION public.fn_current_user_has_permission(text) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT coalesce(current_setting('test.allowed',true),'')='true' $$;
    CREATE FUNCTION public.fn_current_user_data_scope_allows(uuid,uuid,uuid,uuid,uuid)
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT current_setting('test.scope',true)='all' OR $1::text=current_setting('test.scope',true) OR $2::text=current_setting('test.scope',true) $$;
    CREATE TABLE users(id uuid,auth_user_id uuid,is_active boolean,must_change_password boolean);
    CREATE TABLE court_locations(id uuid,location_type text,is_active boolean);
    CREATE TABLE departments(id uuid,court_location_id uuid,is_active boolean);
    CREATE TABLE sections(id uuid,department_id uuid,is_active boolean);
    CREATE TABLE expense_ledger(id uuid,is_active boolean,is_posting boolean);
    CREATE TABLE annual_budget_cycles(id uuid,financial_year integer,status text);
    CREATE TABLE division_budgets(id uuid,annual_budget_cycle_id uuid,financial_year integer,division_id uuid,status text);
    CREATE TABLE division_budget_lines(division_budget_id uuid,section_id uuid,expense_ledger_id uuid,original_amount numeric);
    CREATE TABLE budget_documents(id uuid,division_budget_id uuid,storage_bucket text,storage_path text);
    CREATE TABLE budget_supplementary_adjustments(annual_budget_cycle_id uuid,financial_year integer,division_budget_id uuid,section_id uuid,expense_ledger_id uuid,status text,adjustment_amount numeric);
    CREATE TABLE budget_reallocations(annual_budget_cycle_id uuid,financial_year integer,source_division_budget_id uuid,source_section_id uuid,source_expense_ledger_id uuid,destination_division_budget_id uuid,destination_section_id uuid,destination_expense_ledger_id uuid,status text,transfer_amount numeric);
    CREATE TABLE budget_allocations(id uuid,financial_year integer,department_id uuid,section_id uuid,cost_centre_id uuid,expense_code_registry_id uuid,account_id uuid,funding_source_id uuid,source_module text,is_active boolean,original_budget numeric);
    CREATE TABLE ff3_headers(id uuid,financial_year integer,department_id uuid,section_id uuid,expense_ledger_id uuid,cost_centre_id uuid,status text,total_estimated_amount numeric);
    CREATE TABLE ff3_commitments(id uuid,budget_allocation_id uuid,financial_year integer,status text,outstanding_amount numeric,remaining_balance numeric);
    CREATE TABLE payment_transactions(id uuid,budget_allocation_id uuid,financial_year integer,status text,transaction_type text,amount numeric,commitment_id uuid);
    CREATE TABLE finance_posting_mappings(financial_year integer,expense_ledger_id uuid,department_id uuid,section_id uuid,expense_code_registry_id uuid,is_active boolean,cost_centre_id uuid);
    CREATE TABLE menu_items(code text,is_active boolean,updated_at timestamptz,label text,required_permissions varchar[]);
    CREATE TABLE role_permissions(permission text,is_allowed boolean);
    CREATE TABLE permissions(code text,is_active boolean);
    CREATE TABLE quarterly_releases(id integer);
    CREATE FUNCTION public.njss_create_budget_release(integer) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'legacy write'::text $$;
    CREATE FUNCTION public.upsert_division_budget_line(integer) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ SELECT 'annual write'::text $$;
    GRANT ALL ON budget_allocations,quarterly_releases TO PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION public.upsert_division_budget_line(integer) TO authenticated;
  `)
  await client.query(`
    ALTER TABLE ff3_commitments ADD COLUMN ff3_header_id uuid,ADD COLUMN created_by uuid,
      ADD COLUMN approved_by uuid,ADD COLUMN current_committed_amount numeric,
      ADD COLUMN committed_amount numeric,ADD COLUMN original_committed_amount numeric,
      ADD COLUMN paid_amount numeric,ADD COLUMN commitment_number text,
      ADD COLUMN updated_at timestamptz,ADD COLUMN cancelled_by uuid,ADD COLUMN cancellation_reason text;
    ALTER TABLE ff3_headers ADD COLUMN cancelled_by uuid,ADD COLUMN cancellation_reason text,
      ADD COLUMN cancelled_at timestamptz,ADD COLUMN updated_at timestamptz;
    CREATE TABLE commitment_transactions(commitment_id uuid,ff3_header_id uuid,budget_allocation_id uuid,
      transaction_type text,amount numeric,transaction_date date,reason_code text,reason text,
      reference text,previous_balance numeric,new_balance numeric,approved_by uuid,created_by uuid);
    CREATE TABLE fixture_audit(action text);
    CREATE FUNCTION public.fn_current_app_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
    CREATE FUNCTION public.njss_require_permission(text) RETURNS void LANGUAGE plpgsql AS $$
      BEGIN IF NOT public.fn_current_user_has_permission($1) THEN RAISE EXCEPTION 'Permission denied'; END IF; END $$;
    CREATE FUNCTION public.fn_check_segregation_of_duties(text,uuid,uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION public.log_audit_event(uuid,text,text,text,text,uuid,text,jsonb,jsonb,jsonb,text)
      RETURNS void LANGUAGE sql AS $$ INSERT INTO fixture_audit VALUES($4) $$;
  `)
  await client.query(signedAmount)
  await client.query(syncBalances)
  await client.query(calculator)
  await client.query('REVOKE ALL ON FUNCTION public.njss_calculate_ff3_budget(integer,uuid,uuid,uuid,uuid,numeric) FROM PUBLIC,anon,authenticated')
  await client.query('INSERT INTO users VALUES ($1,$1,true,false)', [id(1)])
  await client.query("INSERT INTO court_locations VALUES ($1,'HEADQUARTERS',true),($2,'PROVINCIAL',true)", [id(2),id(3)])
  await client.query('INSERT INTO departments VALUES ($1,$4,true),($2,$4,true),($3,$5,true)', [id(10),id(11),id(12),id(2),id(3)])
  await client.query('INSERT INTO sections VALUES ($1,$4,true),($2,$5,true),($3,$6,true)', [id(20),id(21),id(22),id(10),id(11),id(12)])
  await client.query('INSERT INTO expense_ledger VALUES ($1,true,true),($2,true,true)', [id(30),id(31)])
  await client.query("INSERT INTO annual_budget_cycles VALUES ($1,2027,'ACTIVE')", [id(40)])
  await client.query("INSERT INTO division_budgets VALUES ($1,$4,2027,$5,'LOCKED'),($2,$4,2027,$6,'LOCKED'),($3,$4,2027,$7,'LOCKED')", [id(50),id(51),id(52),id(40),id(10),id(11),id(12)])
  await client.query('INSERT INTO division_budget_lines VALUES ($1,$4,$7,1000),($2,$5,$7,2000),($3,$6,$7,9000)', [id(50),id(51),id(52),id(20),id(21),id(22),id(30)])
  await client.query("INSERT INTO budget_supplementary_adjustments VALUES ($1,2027,$2,$3,$4,'POSTED',100),($1,2027,$2,$3,$4,'DRAFT',700)", [id(40),id(50),id(20),id(30)])
  // New destination ledger exists through an executed event, without an original line.
  await client.query("INSERT INTO budget_reallocations VALUES ($1,2027,$2,$3,$4,$2,$3,$5,'EXECUTED',50)", [id(40),id(50),id(20),id(30),id(31)])
  await client.query("INSERT INTO budget_allocations VALUES ($1,2027,$2,$3,$4,$5,null,null,'SIMPLIFIED_HEAD_OFFICE',true,999999)", [id(60),id(10),id(20),id(70),id(80)])
  // NULL-year mappings are valid, and duplicate applicable mappings must never duplicate spend.
  await client.query('INSERT INTO finance_posting_mappings VALUES (null,$1,$2,$3,$4,true,$5),(2027,$1,$2,$3,$4,true,$5)', [id(30),id(10),id(20),id(80),id(70)])
  await client.query("INSERT INTO ff3_commitments(id,budget_allocation_id,financial_year,status,outstanding_amount,remaining_balance) VALUES ($1,$4,2027,'COMMITTED',200,null),($2,$4,2027,'REVERSED',400,null),($3,$4,2027,'CLOSED',500,null)", [id(90),id(91),id(92),id(60)])
  await client.query("INSERT INTO payment_transactions(id,budget_allocation_id,financial_year,status,transaction_type,amount) VALUES ($1,$4,2027,'POSTED','PAYMENT',150),($2,$4,2027,'POSTED','REVERSAL',50),($3,$4,2027,'DRAFT','PAYMENT',600)", [id(100),id(101),id(102),id(60)])
  await client.query(`
    GRANT SELECT ON division_budgets,division_budget_lines,budget_documents,storage.objects TO authenticated;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_storage_read ON storage.objects FOR SELECT TO authenticated USING(true);
    ALTER TABLE division_budgets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE division_budget_lines ENABLE ROW LEVEL SECURITY;
    ALTER TABLE budget_documents ENABLE ROW LEVEL SECURITY;
    CREATE POLICY fixture_budget_read ON division_budgets FOR SELECT TO authenticated USING(true);
    CREATE POLICY fixture_line_read ON division_budget_lines FOR SELECT TO authenticated USING(true);
    CREATE POLICY fixture_document_read ON budget_documents FOR SELECT TO authenticated USING(true);
  `)
  await client.query('INSERT INTO ff3_headers(id,financial_year,department_id,section_id,expense_ledger_id,cost_centre_id,status,total_estimated_amount) VALUES ($1,2027,$2,$3,$4,$5,$6,200)',[id(110),id(10),id(20),id(30),id(70),'COMMITTED'])
  await client.query('UPDATE payment_transactions SET commitment_id=$1',[id(90)])
  await client.query('UPDATE ff3_commitments SET ff3_header_id=$1,current_committed_amount=200,committed_amount=200,paid_amount=0,commitment_number=$2 WHERE id=$3',[id(110),'CMT-1',id(90)])
  await client.query('INSERT INTO commitment_transactions(commitment_id,transaction_type,amount) VALUES ($1,$2,200)',[id(90),'ORIGINAL_COMMITMENT'])
  await client.query('INSERT INTO budget_documents VALUES ($1,$2,$3,$4),($5,$6,$3,$7)',[id(120),id(50),'njss-budget-documents','division-a.pdf',id(121),id(51),'division-b.pdf'])
  await client.query("INSERT INTO storage.objects VALUES ('njss-budget-documents','division-a.pdf'),('njss-budget-documents','division-b.pdf')")
  await client.query(migration)
  await client.query("select set_config('request.jwt.claim.sub',$1,true),set_config('test.allowed','true',true),set_config('test.scope','all',true)", [id(1)])
  const paymentSnapshot=(await client.query('select njss_budget_position_for_allocation($1) as result',[id(60)])).rows[0].result
  assert.equal(Number(paymentSnapshot.available_budget),750,'FF4 audit snapshots use annual positions')
  assert.equal(paymentSnapshot.released_amount,undefined,'retired quarterly limits are never returned')
  await client.query('SET LOCAL ROLE authenticated')
  const positions = (await client.query('select * from get_current_budget_position(2027)')).rows
  assert.equal(positions.length, 3, 'two HQ Divisions plus event-only ledger; no provincial row')
  const row = positions.find(r => r.division_id===id(10) && r.expense_ledger_id===id(30))
  assert.equal(Number(row.original_budget),1000, 'bridge allocation amount never supplies budget limits')
  assert.equal(Number(row.current_approved_budget),1050)
  assert.equal(Number(row.outstanding_commitments),200, 'reversed/closed commitments excluded')
  assert.equal(Number(row.actual_expenditure),100, 'payment reversal reduces actuals once')
  assert.equal(Number(row.available_budget),750)
  assert.equal(Number(positions.find(r=>r.expense_ledger_id===id(31)).available_budget),50)
  // Exercise the REAL rewritten adjustment and original ledger balance synchronizer.
  await denial('select njss_adjust_commitment($1,$2,$3,$4)',[id(90),'INCREASE',751,'too much'],/Insufficient available budget/)
  const increase = (await client.query('select njss_adjust_commitment($1,$2,$3,$4) as result',[id(90),'INCREASE',100,'approved increase'])).rows[0].result
  assert.equal(Number(increase.financial_position_after.available_budget),650, 'increase consumes annual headroom with no quarterly release')
  await client.query('select njss_adjust_commitment($1,$2,$3,$4)',[id(90),'DECREASE',100,'restore test balance'])
  assert.equal(Number((await client.query('select available_budget from get_current_budget_position(2027,$1,$2,$3)',[id(10),id(20),id(30)])).rows[0].available_budget),750)
  await client.query('RESET ROLE')
  await client.query('UPDATE finance_posting_mappings SET is_active=false')
  await client.query('SET LOCAL ROLE authenticated')
  assert.equal(Number((await client.query('select available_budget from get_current_budget_position(2027,$1,$2,$3)',[id(10),id(20),id(30)])).rows[0].available_budget),750,'technical mapping changes cannot erase annual commitments or actual expenditure')
  await denial('select njss_adjust_commitment($1,$2,$3,$4)',[id(90),'INCREASE',1,'inactive mapping'],/Valid annual financial posting linkage/)
  await client.query('RESET ROLE')
  await client.query('UPDATE finance_posting_mappings SET is_active=true,expense_code_registry_id=$1',[id(81)])
  await client.query('SET LOCAL ROLE authenticated')
  await denial('select njss_adjust_commitment($1,$2,$3,$4)',[id(90),'INCREASE',1,'replaced mapping'],/Valid annual financial posting linkage/)
  await client.query('RESET ROLE')
  await client.query('UPDATE finance_posting_mappings SET expense_code_registry_id=$1',[id(80)])
  await denial('UPDATE ff3_headers SET expense_ledger_id=null WHERE id=$1',[id(110)],/Committed FF3 annual budget identity/)
  await denial('DELETE FROM ff3_headers WHERE id=$1',[id(110)],/Committed FF3 annual budget identity/)
  await denial('UPDATE ff3_commitments SET budget_allocation_id=$1 WHERE id=$2',[id(61),id(90)],/Commitment financial posting identity/)
  await client.query('INSERT INTO ff3_headers(id,financial_year,department_id,section_id,status) VALUES ($1,2027,$2,$3,$4)',[id(111),id(10),id(20),'APPROVED'])
  await client.query('INSERT INTO ff3_commitments(id,ff3_header_id,budget_allocation_id,financial_year,status) VALUES ($1,$2,$3,2027,$4)',[id(93),id(111),id(60),'ACTIVE'])
  await client.query('SET LOCAL ROLE authenticated')
  await denial('select njss_adjust_commitment($1,$2,$3,$4)',[id(93),'INCREASE',1,'legacy'],/active annual Head Office budget/)
  await denial('select njss_transition_ff3($1,$2)',[id(111),'APPROVE'],/Legacy budget workflow is retired/)
  await denial('select njss_create_budget_release(1)')
  await denial('insert into quarterly_releases values (1)')
  await denial('update budget_allocations set original_budget=1')
  await denial('select original_budget from budget_allocations')
  assert.equal((await client.query('select id from budget_allocations')).rows.length,1, 'financial posting identities remain readable')
  assert.equal((await client.query('select upsert_division_budget_line(1) as result')).rows[0].result,'annual write')
  await client.query("select set_config('test.scope',$1,true)", [id(11)])
  assert.equal((await client.query('select * from division_budgets')).rows.length,1, 'drafts are scoped at RLS')
  assert.equal((await client.query('select * from division_budget_lines')).rows.length,1, 'draft lines are scoped at RLS')
  assert.equal((await client.query('select * from storage.objects')).rows.length,1,'document storage reads follow scoped registered documents')
  assert.equal((await client.query('select * from get_current_budget_position(2027)')).rows.length,1)
  assert.equal((await client.query('select * from get_current_budget_position(2027,$1)',[id(10)])).rows.length,0,'explicit filters cannot bypass scope')
  await client.query("select set_config('test.scope',$1,true)",[id(20)])
  assert.equal((await client.query('select * from division_budgets')).rows.length,1,'Section users can read their Division header')
  assert.equal((await client.query('select * from division_budget_lines')).rows.length,1,'Section users can read only their Section lines')
  await client.query('RESET ROLE')
  await client.query("UPDATE annual_budget_cycles SET status='PREPARATION'")
  await client.query('SET LOCAL ROLE authenticated')
  assert.equal((await client.query('select * from get_current_budget_position(2027)')).rows.length,0,'draft totals are never approved funds')
  await client.query('RESET ROLE')
  await client.query('UPDATE users SET must_change_password=true')
  await client.query('SET LOCAL ROLE authenticated')
  await denial('select * from get_current_budget_position(2027)',[],/completed password setup/)
  await client.query("select set_config('request.jwt.claim.sub','',true)")
  await denial('select * from get_current_budget_position(2027)',[],/Authentication required/)
  console.log('Head Office canonical balance, scope and legacy retirement runtime checks passed')
} finally {
  await client.query('ROLLBACK')
  await client.end()
}
