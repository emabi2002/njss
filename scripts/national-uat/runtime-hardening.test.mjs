import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync(new URL('../../supabase/migrations/068_task14_uat_runtime_hardening.sql', import.meta.url), 'utf8')

assert.match(sql, /create\s+or\s+replace\s+function\s+public\.njss_create_budget_release/i)
assert.doesNotMatch(sql, /min\s*\(\s*funding_allocation_id\s*\)/i, 'budget release must not use MIN(uuid)')
assert.match(sql, /array_agg\s*\(\s*funding_allocation_id\s*\)\s*\)\s*\[1\]/i, 'budget release must use a UUID-safe single-allocation selector')

assert.match(sql, /create\s+or\s+replace\s+function\s+public\.njss_create_budget_revision_base/i)
assert.doesNotMatch(
  sql,
  /insert\s+into\s+(?:public\.)?budget_monthly_allocations\s*\(\s*budget_line_id\s*,\s*month_number/is,
  'revision cloning must not duplicate monthly rows auto-created by the budget-line trigger',
)
assert.match(
  sql,
  /update\s+(?:public\.)?budget_monthly_allocations\s+target[\s\S]*?get\s+diagnostics\s+v_month_count\s*=\s*row_count[\s\S]*?v_month_count\s*<>\s*12/i,
  'revision cloning must update and reconcile exactly 12 trigger-created monthly rows',
)

assert.match(sql, /create\s+or\s+replace\s+function\s+public\.transition_divisional_budget_submission/i)
const workflowContextIndex = sql.search(/perform\s+set_config\s*\(\s*'njss\.budget_workflow'\s*,\s*'on'\s*,\s*true\s*\)/i)
const validationIndex = sql.search(/perform\s+public\.validate_divisional_budget_submission\s*\(\s*p_submission_id\s*\)/i)
assert.ok(workflowContextIndex >= 0, 'budget workflow maintenance context must be enabled')
assert.ok(validationIndex >= 0, 'budget workflow must still validate the submission')
assert.ok(workflowContextIndex < validationIndex, 'budget workflow context must be enabled before validation/recalculation of locked submissions')

console.log('Task 14 runtime SQL hardening migration contract checks passed')
