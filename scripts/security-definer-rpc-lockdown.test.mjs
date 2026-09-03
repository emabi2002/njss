import assert from 'node:assert/strict'
import fs from 'node:fs'

const migrationPath = new URL(
  '../supabase/migrations/20260904020000_security_definer_rpc_lockdown.sql',
  import.meta.url,
)

assert.ok(
  fs.existsSync(migrationPath),
  'SECURITY DEFINER RPC lockdown migration must exist',
)

const sql = fs.readFileSync(migrationPath, 'utf8')

for (const fn of [
  'njss_set_role_permissions',
  'log_audit_event',
  'njss_backup_full_snapshot',
]) {
  assert.match(
    sql,
    new RegExp(`REVOKE[\\s\\S]{0,180}${fn}[\\s\\S]{0,180}FROM PUBLIC`, 'i'),
    `${fn} must not remain executable through PUBLIC`,
  )
  assert.match(
    sql,
    new RegExp(`GRANT EXECUTE[\\s\\S]{0,180}${fn}[\\s\\S]{0,180}TO service_role`, 'i'),
    `${fn} must retain only trusted service-role execution where required`,
  )
}

assert.match(
  sql,
  /transition_divisional_budget_submission_unchecked_20260904/i,
  'legacy budget transition implementation must be moved behind a guarded wrapper',
)
assert.match(sql, /budget\.template\.submit/)
assert.match(sql, /budget\.template\.review/)
assert.match(sql, /budget\.template\.approve/)
assert.match(sql, /budget\.module\.admin/)
assert.match(
  sql,
  /fn_current_app_user_id\(\)[\s\S]{0,500}Authentication required/i,
  'budget transition wrapper must require a real authenticated NJSS actor',
)

assert.match(
  sql,
  /consolidate_approved_excel_budgets_unchecked_20260904/i,
  'budget consolidation implementation must be moved behind a guarded wrapper',
)
assert.match(sql, /budget\.consolidate/)

assert.match(
  sql,
  /REVOKE EXECUTE ON FUNCTION public\.fn_user_has_permission\(uuid, text\) FROM PUBLIC, anon, authenticated/i,
  'arbitrary-user permission probe must not be directly callable by clients',
)
assert.match(
  sql,
  /REVOKE EXECUTE ON FUNCTION public\.njss_require_permission\(text\) FROM PUBLIC, anon/i,
  'permission guard helper must not be exposed anonymously',
)

console.log('SECURITY DEFINER RPC lockdown regression checks passed')
