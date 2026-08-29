import fs from 'node:fs'
import assert from 'node:assert/strict'

const migrationPath = 'supabase/migrations/067_supplier_workflow_status_alignment.sql'
assert.ok(fs.existsSync(migrationPath), `missing ${migrationPath}`)
const sql = fs.readFileSync(migrationPath, 'utf8')

for (const token of [
  'DROP CONSTRAINT IF EXISTS chk_suppliers_simple_status',
  'chk_suppliers_phase3_status',
  "'DRAFT'",
  "'PENDING_VERIFICATION'",
  "'VERIFIED'",
  "'APPROVED'",
  "'REJECTED'",
  "'SUSPENDED'",
  "'INACTIVE'",
]) assert.ok(sql.includes(token), `supplier workflow migration missing ${token}`)

assert.ok(!/UPDATE\s+public\.suppliers/i.test(sql), 'status-alignment migration must not rewrite supplier records')
assert.ok(!/TRUNCATE/i.test(sql), 'status-alignment migration must not truncate data')
console.log('supplier workflow schema alignment checks passed')
