import fs from 'node:fs'
import assert from 'node:assert/strict'

const sql = fs.readFileSync('supabase/migrations/20260930151000_division_budget_registrar_review.sql', 'utf8')
assert.match(sql, /ALTER COLUMN status TYPE varchar\(40\)/i, 'Pending review status exceeds the old varchar(16) limit')
for (const fn of ['submit_division_budget', 'return_division_budget', 'approve_division_budget']) {
  assert.match(sql, new RegExp('function public\\.' + fn + '\\(', 'i'))
}
assert.match(sql, /PENDING_REGISTRAR_APPROVAL/)
assert.match(sql, /OFFICIAL_APPROVED_BUDGET/)
assert.match(sql, /related_entity_id\s*=\s*p_division_budget_id/i)
assert.match(sql, /budget\.registrar\.approve/)
assert.match(sql, /function public\.njss_require_registrar_budget_approver\(/i)
assert.equal((sql.match(/PERFORM public\.njss_require_registrar_budget_approver\(\)/g) || []).length, 2)
assert.match(sql, /v_budget\.entered_by\s*=\s*auth\.uid\(\)/i)
assert.match(sql, /p_expected_version\s*<>\s*v_budget\.review_version/i)
assert.match(sql, /RETURNED/)
assert.match(sql, /status\s*=\s*'LOCKED'/i)
assert.match(sql, /REVOKE EXECUTE ON FUNCTION public\.lock_division_budget/i)
console.log('Registrar electronic review contract passed')
