import assert from 'node:assert/strict'
import fs from 'node:fs'
import pg from 'pg'

// This test creates fixtures only in an isolated CI database, never in NJSS.
const connectionString = process.env.NJSS_TEST_DATABASE_URL
assert.ok(connectionString, 'NJSS_TEST_DATABASE_URL must identify the isolated test database')
const target = new URL(connectionString)
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname), 'refuse a non-local database')
assert.equal(target.pathname, '/njss_rpc_test', 'refuse any database other than njss_rpc_test')
const client = new pg.Client({ connectionString })
await client.connect()

const wrapper = fs.readFileSync(new URL('../supabase/hotfixes/20260903204909_budget_transition_legacy_owner_compatibility.sql', import.meta.url), 'utf8')
const actor = '11111111-1111-1111-1111-111111111111'
const other = '22222222-2222-2222-2222-222222222222'
const inside = '33333333-3333-3333-3333-333333333333'
const outside = '44444444-4444-4444-4444-444444444444'
const section = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const otherSection = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

async function expectDenial(id, expected) {
  await client.query('SAVEPOINT expected_denial')
  let failure
  try {
    await client.query('select public.transition_divisional_budget_submission($1, $2, null, $3)', [id, 'SUBMIT', 'spoofed@example.test'])
  } catch (error) {
    failure = error
  }
  await client.query('ROLLBACK TO SAVEPOINT expected_denial')
  assert.ok(failure, 'the unauthorized call must be rejected')
  assert.match(failure.message, expected)
}

try {
  for (const ownerType of ['varchar', 'uuid']) {
    await client.query('BEGIN')
    try {
      await client.query(`
        CREATE ROLE anon NOLOGIN;
        CREATE ROLE authenticated NOLOGIN;
        CREATE SCHEMA auth;
        CREATE TABLE public.users (id uuid PRIMARY KEY, email text, is_active boolean, section_id uuid);
        CREATE TABLE public.budget_divisions (id uuid PRIMARY KEY, section_id uuid);
        CREATE TABLE public.divisional_budget_submissions (
          id uuid PRIMARY KEY, department_id uuid, division_id uuid,
          prepared_by ${ownerType}, submitted_by uuid
        );
        CREATE TABLE public.transition_calls (submission_id uuid, action text, actor_email text);
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
          $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        CREATE FUNCTION public.fn_current_app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
          $$ SELECT id FROM public.users WHERE id=auth.uid() AND is_active $$;
        CREATE FUNCTION public.njss_require_permission(permission text) RETURNS void LANGUAGE plpgsql AS
          $$ BEGIN IF permission IS DISTINCT FROM current_setting('test.permission',true) THEN
            RAISE EXCEPTION 'Permission denied'; END IF; END $$;
        CREATE FUNCTION public.fn_current_user_data_scope_allows(uuid,uuid,uuid,uuid,uuid)
          RETURNS boolean LANGUAGE sql STABLE AS $$
            SELECT coalesce($2=(SELECT section_id FROM public.users WHERE id=auth.uid())
              OR $3=auth.uid() OR $4=auth.uid() OR $5=auth.uid(),false)
          $$;
        CREATE FUNCTION public.transition_divisional_budget_submission_internal(uuid,text,text,text)
          RETURNS public.divisional_budget_submissions LANGUAGE plpgsql AS $$
          DECLARE result public.divisional_budget_submissions;
          BEGIN
            INSERT INTO public.transition_calls VALUES ($1,$2,$4);
            SELECT * INTO result FROM public.divisional_budget_submissions WHERE id=$1;
            RETURN result;
          END $$;
      `)
      await client.query('INSERT INTO public.users VALUES ($1,$2,true,$3)', [actor, 'actor@example.test', section])
      await client.query('INSERT INTO public.budget_divisions VALUES ($1,$1),($2,$2)', [section, otherSection])
      const owner = ownerType === 'varchar' ? 'Legacy Supervisor' : other
      await client.query('INSERT INTO public.divisional_budget_submissions VALUES ($1,null,$2,$3,null),($4,null,$5,$3,null)', [inside, section, owner, outside, otherSection])
      await client.query(wrapper)

      await client.query("select set_config('request.jwt.claim.sub','',true)")
      await expectDenial(inside, /Authentication required/)
      await client.query("select set_config('request.jwt.claim.sub',$1,true),set_config('test.permission','wrong.permission',true)", [actor])
      await expectDenial(inside, /Permission denied/)
      await client.query("select set_config('test.permission','budget.template.submit',true)")
      await expectDenial(outside, /outside the current user organisational scope/)
      assert.equal(Number((await client.query('SELECT count(*) FROM public.transition_calls')).rows[0].count), 0)

      const result = await client.query('SELECT (public.transition_divisional_budget_submission($1,$2,null,$3)).id', [inside, 'SUBMIT', 'spoofed@example.test'])
      assert.equal(result.rows[0].id, inside)
      assert.deepEqual((await client.query('SELECT * FROM public.transition_calls')).rows, [{submission_id: inside, action: 'SUBMIT', actor_email: 'actor@example.test'}])

      // UUID-valued ownership still works; display names never become identities.
      await client.query('UPDATE public.divisional_budget_submissions SET prepared_by=$1 WHERE id=$2', [actor, outside])
      await client.query('SELECT public.transition_divisional_budget_submission($1,$2,null,null)', [outside, 'SUBMIT'])
      assert.equal(Number((await client.query('SELECT count(*) FROM public.transition_calls')).rows[0].count), 2)
      console.log(`budget RPC runtime checks passed with prepared_by ${ownerType}`)
    } finally {
      await client.query('ROLLBACK')
    }
  }
} finally {
  await client.end()
}
