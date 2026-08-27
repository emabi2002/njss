import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')

assert.ok(fs.existsSync('supabase/migrations/055_budget_revision_workspace_notifications.sql'))
assert.ok(fs.existsSync('lib/budget-revision-workspace.ts'))

const migration = read('supabase/migrations/055_budget_revision_workspace_notifications.sql')
for (const token of [
  'assigned_line_supervisor_id',
  'request_instruction',
  'requested_change_amount',
  'v_budget_revision_work_queue',
  'njss_create_budget_revision_request',
  'njss_get_eligible_line_supervisors',
  'BUDGET_REVISION_REQUESTED',
  'BUDGET_REVISION_SUBMITTED',
  'BUDGET_REVISION_RESUBMITTED',
  'BUDGET_REVISION_RETURNED',
  'BUDGET_REVISION_APPROVED',
  'BUDGET_REVISION_REJECTED',
  'users.auth_user_id = auth.uid()',
]) assert.ok(migration.includes(token), `missing ${token}`)

assert.match(migration, /ALTER TABLE notifications ENABLE ROW LEVEL SECURITY/i)
assert.match(migration, /REVOKE INSERT, DELETE ON notifications FROM authenticated/i)
assert.match(migration, /REVOKE EXECUTE ON FUNCTION public\.njss_create_budget_revision\(/i)
assert.ok(!/SELECT DISTINCT[\s\S]*ORDER BY COALESCE\(u\.full_name, u\.email\)/i.test(migration), 'eligible supervisor query must use PostgreSQL-valid DISTINCT ordering')

const config = read('lib/rbac/config.ts')
assert.ok(config.includes("code: 'budget.revisions'"))
assert.ok(config.includes("href: '/dashboard/budget/revisions'"))
assert.ok(config.includes("label: 'Budget Revision & Supplementary Budget'"))

const budgetRoute = read('app/api/workflows/budget/route.ts')
assert.ok(budgetRoute.includes('p_restricted_department_id: input.restricted_department_id || null'), 'Task 8 must preserve funding-authority department restriction input')
assert.ok(budgetRoute.includes("Invalid funding receipt workflow request"), 'Task 8 must preserve funding-receipt validation error semantics')
assert.ok(budgetRoute.includes("operation === 'create-budget-revision-request'"), 'assigned revision request operation must be registered')
assert.ok(budgetRoute.includes("supabase.rpc('njss_create_budget_revision_request'"), 'assigned request API must call the workspace RPC')

assert.ok(fs.existsSync('app/dashboard/budget/revisions/page.tsx'))

const dropdown = read('components/NotificationsDropdown.tsx')
const notificationsPage = read('app/dashboard/notifications/page.tsx')
assert.ok(dropdown.includes("reference_type === 'BUDGET_REVISION'"))
assert.ok(notificationsPage.includes("reference_type === 'BUDGET_REVISION'"))
assert.ok(dropdown.includes('/dashboard/budget/revisions?revision='))
assert.ok(notificationsPage.includes('/dashboard/budget/revisions?revision='))

console.log('budget revision workspace regression checks passed')