import assert from 'node:assert/strict'
import fs from 'node:fs'
import pg from 'pg'

const connectionString = process.env.NJSS_TEST_DATABASE_URL
assert.ok(connectionString, 'isolated PostgreSQL database required')
const target = new URL(connectionString)
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname))
assert.equal(target.pathname, '/njss_rpc_test', 'refuse live databases')
const supplierSource = fs.readFileSync('supabase/migrations/025_simplify_supplier_reference_module.sql', 'utf8')
const policySource = fs.readFileSync('supabase/migrations/029_phase6_security_and_uat_readiness.sql', 'utf8')
const views = ['v_supplier_register', 'v_supplier_commitment_position'].map(name => supplierSource.match(new RegExp(`CREATE OR REPLACE VIEW ${name} AS[\\s\\S]*?;`))[0])
const policy = policySource.match(/CREATE POLICY ff3_commitments_select_phase6[\s\S]*?;/)[0]
const migrationName = fs.readdirSync('supabase/migrations').find(name => name.endsWith('_supplier_commitment_scope_identity_access.sql'))
assert.ok(migrationName, 'Scope identity repair migration must exist')
const migration = fs.readFileSync(`supabase/migrations/${migrationName}`, 'utf8')
const client = new pg.Client({ connectionString })
await client.connect()
async function denied(sql) {
  await client.query('SAVEPOINT expected_denial')
  let error
  try { await client.query(sql) } catch (caught) { error = caught }
  await client.query('ROLLBACK TO SAVEPOINT expected_denial')
  assert.equal(error?.code, '42501', 'expected insufficient_privilege')
}
try {
  await client.query('BEGIN')
  await client.query(`
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE TABLE suppliers(id uuid PRIMARY KEY,supplier_code text,supplier_name text,legal_name text,trading_name text,
      supplier_type text,ipa_registration_number text,tin text,primary_contact_name text,phone text,email text,
      physical_address text,address text,province text,country text,is_active boolean,created_at timestamptz,updated_at timestamptz);
    CREATE TABLE budget_allocations(id uuid PRIMARY KEY,department_id uuid,section_id uuid,created_by uuid,original_budget numeric);
    CREATE TABLE ff3_headers(id uuid PRIMARY KEY,ff3_number text,department_id uuid,section_id uuid,created_by uuid,
      requesting_officer_id uuid,cost_centre_id uuid,expense_code_registry_id uuid,funding_source_id uuid);
    CREATE TABLE ff3_commitments(id uuid PRIMARY KEY,supplier_id uuid,ff3_header_id uuid,budget_allocation_id uuid,
      commitment_number text,financial_year integer,status text,outstanding_amount numeric,current_committed_amount numeric,
      committed_amount numeric,original_committed_amount numeric,paid_amount numeric);
    CREATE TABLE departments(id uuid,name text);
    CREATE TABLE sections(id uuid,name text);
    CREATE TABLE cost_centres(id uuid,code text);
    CREATE TABLE expense_code_registry(id uuid,full_expense_code text);
    CREATE TABLE funding_sources(id uuid,name text);
    CREATE FUNCTION fn_current_user_has_permission(text) RETURNS boolean LANGUAGE sql AS $$ SELECT $1='commitment.view' $$;
    CREATE FUNCTION fn_current_user_data_scope_allows(uuid,uuid,uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$
      SELECT $3=current_setting('test.actor')::uuid OR $4=current_setting('test.actor')::uuid $$;
    ALTER TABLE ff3_commitments ENABLE ROW LEVEL SECURITY;
    GRANT SELECT ON suppliers,ff3_headers,ff3_commitments,departments,sections,cost_centres,expense_code_registry,funding_sources TO authenticated;
    GRANT SELECT(id,department_id,section_id) ON budget_allocations TO authenticated;
    INSERT INTO suppliers(id,supplier_name,is_active) VALUES ('00000000-0000-0000-0000-000000000001','Test supplier',true);
    INSERT INTO budget_allocations(id,created_by,original_budget) VALUES
      ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021',999999),
      ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000022',999999);
    INSERT INTO ff3_commitments(id,supplier_id,budget_allocation_id,status,paid_amount,outstanding_amount) VALUES
      ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','COMMITTED',30,70),
      ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000012','COMMITTED',900,100);
    SELECT set_config('test.actor','00000000-0000-0000-0000-000000000021',true);
  `)
  await client.query(policy)
  for (const view of views) await client.query(view)
  await client.query(`
    ALTER VIEW v_supplier_register SET (security_invoker=true);
    ALTER VIEW v_supplier_commitment_position SET (security_invoker=true);
    GRANT SELECT ON v_supplier_register,v_supplier_commitment_position TO authenticated;
    SET LOCAL ROLE authenticated;
  `)
  await denied('SELECT * FROM v_supplier_register')
  await denied('SELECT * FROM v_supplier_commitment_position')
  await client.query('RESET ROLE')
  await client.query(migration)
  await client.query('SET LOCAL ROLE authenticated')
  const register = (await client.query('SELECT * FROM v_supplier_register')).rows
  assert.equal(register.length, 1)
  assert.equal(Number(register[0].total_spend), 30, 'Other users commitments must remain hidden')
  assert.equal(Number(register[0].outstanding_commitment_value), 70)
  assert.equal((await client.query('SELECT * FROM v_supplier_commitment_position')).rowCount, 1)
  await denied('SELECT original_budget FROM budget_allocations')
  await denied('UPDATE budget_allocations SET created_by=NULL')
  await client.query('RESET ROLE; SET LOCAL ROLE anon')
  await denied('SELECT created_by FROM budget_allocations')
  console.log('Supplier register and transaction views load with ownership scope; legacy amounts, writes and anonymous reads remain denied')
} finally {
  await client.query('ROLLBACK')
  await client.end()
}
