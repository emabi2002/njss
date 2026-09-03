import assert from 'node:assert/strict'
import fs from 'node:fs'
import pg from 'pg'

// Destructive commands below target synthetic localhost fixtures ONLY.
const connectionString = process.env.NJSS_TEST_DATABASE_URL
assert.ok(connectionString, 'NJSS_TEST_DATABASE_URL must identify the isolated test database')
const target = new URL(connectionString)
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname), 'refuse a non-local database')
assert.equal(target.pathname, '/njss_rpc_test', 'refuse any database other than njss_rpc_test')
const directory = new URL('../supabase/hotfixes/', import.meta.url)
const files = fs.readdirSync(directory).filter(name => name.endsWith('client_table_privileges_lockdown.sql'))
assert.equal(files.length, 1, 'exactly one client privilege hotfix must exist')
const sql = fs.readFileSync(new URL(files[0], directory), 'utf8')
const liveAssertion = fs.readFileSync(new URL('../supabase/tests/client_table_privileges_live.sql', import.meta.url), 'utf8')
const client = new pg.Client({ connectionString })
await client.connect()
async function denied(query) {
  await client.query('SAVEPOINT denial')
  let error
  try { await client.query(query) } catch (caught) { error = caught }
  await client.query('ROLLBACK TO SAVEPOINT denial')
  assert.equal(error?.code, '42501', 'client operation must fail with insufficient_privilege')
}

try {
  await client.query('BEGIN')
  await client.query(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA njss_private;
    CREATE TABLE public.privilege_fixture (id integer PRIMARY KEY, value integer);
    CREATE TABLE public.readonly_fixture (id integer PRIMARY KEY);
    CREATE TABLE njss_private.control_fixture (id integer);
    GRANT USAGE ON SCHEMA public, njss_private TO anon, authenticated, service_role;
    GRANT ALL ON public.privilege_fixture TO PUBLIC, anon, authenticated, service_role;
    GRANT SELECT, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.readonly_fixture TO authenticated;
    GRANT ALL ON public.readonly_fixture TO service_role;
    GRANT ALL ON njss_private.control_fixture TO authenticated;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
      GRANT ALL ON TABLES TO authenticated, service_role;
    CREATE FUNCTION public.fixture_increment() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN NEW.value := NEW.value + 1; RETURN NEW; END $$;
    CREATE TRIGGER fixture_trigger BEFORE INSERT ON public.privilege_fixture
      FOR EACH ROW EXECUTE FUNCTION public.fixture_increment();
  `)
  // Red characterization: the original broad grants are observable in Postgres.
  const before = await client.query("SELECT has_table_privilege('authenticated','public.privilege_fixture','TRUNCATE') AS unsafe")
  assert.equal(before.rows[0].unsafe, true)
  await client.query(sql)
  await client.query(sql) // safe idempotent replay
  await client.query(liveAssertion)
  await client.query('CREATE TABLE public.future_fixture (id integer)')
  await client.query(liveAssertion) // future postgres-owned public tables also safe
  const scope = await client.query(`SELECT
    has_table_privilege('authenticated','njss_private.control_fixture','TRUNCATE') AS untouched,
    has_table_privilege('authenticated','public.readonly_fixture','UPDATE') AS readonly,
    has_table_privilege('authenticated','public.future_fixture','INSERT') AS future_insert,
    has_table_privilege('service_role','public.future_fixture','TRUNCATE') AS service_admin`)
  assert.deepEqual(scope.rows[0], { untouched: true, readonly: false, future_insert: true, service_admin: true })
  await client.query('SET LOCAL ROLE authenticated')
  await denied('TRUNCATE public.privilege_fixture')
  await denied('TRUNCATE public.future_fixture')
  await denied('INSERT INTO public.readonly_fixture VALUES (1)')
  await client.query('INSERT INTO public.privilege_fixture VALUES (1, 40)')
  const inserted = await client.query('SELECT value FROM public.privilege_fixture WHERE id = 1')
  assert.equal(inserted.rows[0].value, 41, 'existing triggers must continue to run for client DML')
  await client.query('UPDATE public.privilege_fixture SET value = 42 WHERE id = 1')
  const updated = await client.query('SELECT value FROM public.privilege_fixture WHERE id = 1')
  assert.equal(updated.rows[0].value, 42)
  assert.equal((await client.query('DELETE FROM public.privilege_fixture WHERE id = 1')).rowCount, 1)
  await client.query('SET LOCAL ROLE anon')
  await denied('TRUNCATE public.privilege_fixture')
  await client.query('RESET ROLE')
  console.log('Client non-row privileges denied; DML, existing triggers, service access and other schemas preserved')
} finally {
  await client.query('ROLLBACK')
  await client.end()
}
