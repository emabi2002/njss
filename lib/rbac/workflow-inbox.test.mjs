import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const routePath = 'app/api/workflow/tasks/route.ts'
const pagePath = 'app/dashboard/tasks/page.tsx'
const dropdownPath = 'components/NotificationsDropdown.tsx'
const migrationPath = 'supabase/migrations/20260830054500_workflow_task_inbox.sql'

assert.equal(existsSync(routePath), true, 'Workflow task API route must exist')
assert.equal(existsSync(pagePath), true, 'My Tasks / Approvals page must exist')
assert.equal(existsSync(migrationPath), true, 'Workflow inbox RBAC/menu migration must exist')

const route = readFileSync(routePath, 'utf8')
const page = readFileSync(pagePath, 'utf8')
const dropdown = readFileSync(dropdownPath, 'utf8')
const migration = readFileSync(migrationPath, 'utf8')

assert.match(route, /getServerAccessContext/, 'Task inbox must authenticate through server RBAC context')
assert.match(route, /workflow\.tasks\.view/, 'Task inbox must require its own view permission')
assert.match(route, /resolveManagementReportScope/, 'Task inbox must reuse the enforced organisational scope resolver')
assert.match(route, /SUBMITTED[\s\S]*ff3\.endorse/, 'Submitted FF3 must become an endorsement task')
assert.match(route, /ENDORSED_SUPERVISOR[\s\S]*ff3\.endorse/, 'Supervisor-endorsed FF3 must remain in the endorsement chain')
assert.match(route, /ENDORSED_SECTION_HEAD[\s\S]*ff3\.approve/, 'Section-head-endorsed FF3 must become a Registrar approval task')
assert.match(route, /SUBMITTED[\s\S]*ff4\.verify/, 'Submitted FF4 must become a verification task')
assert.match(route, /VERIFIED[\s\S]*ff4\.approve/, 'Verified FF4 must become an approval task')
assert.match(route, /APPROVED[\s\S]*ff4\.process/, 'Approved FF4 must become a processing task')
assert.match(route, /PROCESSED[\s\S]*ff4\.process/, 'Processed FF4 must become a payment task')
assert.match(route, /PAID[\s\S]*ff4\.reconcile/, 'Paid FF4 must become a reconciliation task')
assert.match(route, /scope\.mode === 'SECTION'/, 'Section-scoped users must be filtered server-side before tasks are returned')
assert.match(route, /context\.permissions\.includes\('all'\)/, 'System Administrator must receive system-wide oversight')
assert.match(route, /actionRequired/, 'API must distinguish work the current user can act on')
assert.match(route, /systemWide/, 'API must expose a separate Administrator oversight queue')
assert.match(route, /summary/, 'API must support lightweight header task counts')

assert.match(page, /Action Required by Me/, 'Inbox must have an Action Required by Me view')
assert.match(page, /System-wide Pending Work/, 'Administrator inbox must have a system-wide oversight view')
assert.match(page, /Province/, 'Inbox must support Province filtering')
assert.match(page, /Department/, 'Inbox must support Department filtering')
assert.match(page, /Section/, 'Inbox must support Section filtering')
assert.match(page, /Age/, 'Inbox must expose ageing filters/indicators')
assert.match(page, /Today/, 'Inbox must distinguish current-day work')
assert.match(page, /Over 5 days/, 'Inbox must visibly flag aged work')
assert.match(page, /\/dashboard\/ff3\//, 'FF3 tasks must link directly to the transaction')
assert.match(page, /\/dashboard\/ff4\//, 'FF4 tasks must link directly to the transaction')

assert.match(dropdown, /\/api\/workflow\/tasks\?summary=1/, 'Notification dropdown must load workflow task counts')
assert.match(dropdown, /\/dashboard\/tasks/, 'Notification area must provide a direct My Tasks link')

assert.match(migration, /workflow\.tasks\.view/, 'Migration must register the workflow task permission')
assert.match(migration, /Requisition Officer/, 'Requisition Officer must receive task inbox access')
assert.match(migration, /Line Supervisor/, 'Line Supervisor must receive task inbox access')
assert.match(migration, /Registrar/, 'Registrar must receive task inbox access')
assert.match(migration, /Payment\/Reconciliation Officer/, 'Payment/Reconciliation Officer must receive task inbox access')
assert.match(migration, /My Tasks/, 'Migration must add the My Tasks navigation entry')

console.log('Role-aware workflow inbox contract passed')
