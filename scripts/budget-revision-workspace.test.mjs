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

const workspaceService = read('lib/budget-revision-workspace.ts')
for (const token of [
  'getBudgetRevisionWorkQueue',
  'getEligibleLineSupervisors',
  'getApprovedBudgetSummary',
  'getApprovedBudgetCandidates',
  'createBudgetRevisionRequest',
  "operation: 'create-budget-revision-request'",
]) assert.ok(workspaceService.includes(token), `workspace service missing ${token}`)

assert.ok(fs.existsSync('app/dashboard/budget/revisions/page.tsx'))
assert.ok(fs.existsSync('app/dashboard/budget/revisions/BudgetRevisionRequestDialog.tsx'))
assert.ok(fs.existsSync('app/dashboard/budget/revisions/BudgetRevisionQueue.tsx'))
const workspacePage = read('app/dashboard/budget/revisions/page.tsx')
const requestDialog = read('app/dashboard/budget/revisions/BudgetRevisionRequestDialog.tsx')
for (const label of [
  'Budget Revision & Supplementary Budget',
  'Initiate Budget Change',
  'Awaiting Registrar Action',
  'My Revision Requests',
]) assert.ok(workspacePage.includes(label), `workspace page missing ${label}`)
for (const label of [
  'Budget Year', 'Department', 'Section / Division', 'Current Approved Budget',
  'Change Type', 'Indicative Change Amount', 'Reason / Justification',
  'Authority Reference', 'Effective Date', 'Supporting Reference',
  'Instruction to Line Supervisor', 'Responsible Line Supervisor',
]) assert.ok(requestDialog.includes(label), `request dialog missing ${label}`)
assert.ok(requestDialog.includes('No active Line Supervisor is assigned to this section'), 'request dialog must block missing supervisor configuration')
assert.ok(workspacePage.includes('roles.includes("Registrar")') || workspacePage.includes("roles.includes('Registrar')"), 'workspace must explicitly identify Registrar role')
assert.ok(workspacePage.includes('roles.includes("Line Supervisor")') || workspacePage.includes("roles.includes('Line Supervisor')"), 'workspace must explicitly identify Line Supervisor role')
assert.ok(workspacePage.includes('/dashboard/budget-template?submission='), 'supervisor queue must open the exact revision submission in Budget Preparation')

const budgetTemplatePage = read('app/dashboard/budget-template/page.tsx')
assert.ok(budgetTemplatePage.includes('new URLSearchParams(window.location.search)'), 'Budget Preparation must read deep-link query parameters')
assert.ok(budgetTemplatePage.includes('params.get("submission")') || budgetTemplatePage.includes("params.get('submission')"), 'Budget Preparation must open the exact submission supplied by the workspace')
assert.ok(budgetTemplatePage.includes('/dashboard/budget/revisions?parent=${selected.id}&action=request'), 'Request Budget Change must route to the dedicated workspace with the approved parent')
assert.ok(!budgetTemplatePage.includes('<BudgetRevisionDialog'), 'Budget Preparation must not retain a second inline revision-request workflow')

const dropdown = read('components/NotificationsDropdown.tsx')
const notificationsPage = read('app/dashboard/notifications/page.tsx')
assert.ok(dropdown.includes("reference_type === 'BUDGET_REVISION'"))
assert.ok(notificationsPage.includes("reference_type === 'BUDGET_REVISION'"))
assert.ok(dropdown.includes('/dashboard/budget/revisions?revision='))
assert.ok(notificationsPage.includes('/dashboard/budget/revisions?revision='))
assert.ok(dropdown.includes('useRealtimeNotifications(profile?.id)'), 'notification dropdown must filter by NJSS users.id profile, not auth user id')
assert.ok(notificationsPage.includes('useRealtimeNotifications(profile?.id)'), 'notifications page must filter by NJSS users.id profile, not auth user id')
assert.ok(!dropdown.includes('useRealtimeNotifications(user?.id)'), 'notification dropdown must not pass auth.uid to notifications.user_id filter')
assert.ok(!notificationsPage.includes('useRealtimeNotifications(user?.id)'), 'notifications page must not pass auth.uid to notifications.user_id filter')

console.log('budget revision workspace regression checks passed')
