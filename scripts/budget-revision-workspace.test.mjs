import fs from 'node:fs'
import assert from 'node:assert/strict'

const read = (path) => fs.readFileSync(path, 'utf8')

assert.ok(fs.existsSync('supabase/migrations/055_budget_revision_workspace_notifications.sql'))
assert.ok(fs.existsSync('app/dashboard/budget/revisions/page.tsx'))
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

const config = read('lib/rbac/config.ts')
assert.ok(config.includes("code: 'budget.revisions'"))
assert.ok(config.includes("href: '/dashboard/budget/revisions'"))
assert.ok(config.includes("label: 'Budget Revision & Supplementary Budget'"))

const dropdown = read('components/NotificationsDropdown.tsx')
const notificationsPage = read('app/dashboard/notifications/page.tsx')
assert.ok(dropdown.includes("reference_type === 'BUDGET_REVISION'"))
assert.ok(notificationsPage.includes("reference_type === 'BUDGET_REVISION'"))
assert.ok(dropdown.includes('/dashboard/budget/revisions?revision='))
assert.ok(notificationsPage.includes('/dashboard/budget/revisions?revision='))

console.log('budget revision workspace regression checks passed')