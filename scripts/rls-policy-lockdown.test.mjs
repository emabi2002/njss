import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationPath = path.join(root, 'supabase', 'migrations', '20260904013000_rls_and_legacy_policy_lockdown.sql')
const cleanupPath = path.join(root, 'supabase', 'migrations', '20260904013100_budget_legacy_policy_cleanup.sql')
const preflightPath = path.join(root, 'supabase', 'tests', 'hard10_policy_trigger_preflight.sql')
const hard10aPath = path.join(root, 'supabase', 'hotfixes', '20260905082346_hard10a_uat_supervisor_delegation.sql')

assert.ok(fs.existsSync(migrationPath), 'HARD-10 RLS lockdown migration must exist')
assert.ok(fs.existsSync(cleanupPath), 'HARD-10 ancillary budget policy cleanup migration must exist')
assert.ok(fs.existsSync(preflightPath), 'HARD-10 live policy/trigger actor preflight must exist')
assert.ok(fs.existsSync(hard10aPath), 'HARD-10A UAT supervisor reconciliation hotfix must exist')

const sql = fs.readFileSync(migrationPath, 'utf8').toLowerCase()
const cleanup = fs.readFileSync(cleanupPath, 'utf8').toLowerCase()
const preflight = fs.readFileSync(preflightPath, 'utf8').toLowerCase()
const hard10a = fs.readFileSync(hard10aPath, 'utf8').toLowerCase()
const combined = `${sql}\n${cleanup}`

const rlsTables = [
  'activity_templates','annual_plan_lines','approval_limits','budget_consolidations','budget_cycles',
  'budget_divisions','budget_periods','budget_release_funding_lines','budget_workflow_history',
  'chart_of_accounts','cost_centres','divisional_budget_lines','documents','expense_categories',
  'expense_items','financial_years','funding_sources','payee_types','payment_methods','priority_levels',
  'procurement_methods','projects','provinces','rbac_data_scope_types','role_migration_map_041',
  'role_migration_map_045','segregation_rules','units_of_measure','urgency_levels','workflow_statuses',
]

for (const table of rlsTables) {
  assert.ok(sql.includes(`alter table public.${table} enable row level security`), `RLS not enabled for ${table}`)
}

for (const unsafePolicy of [
  'divisional_budget_submissions_read',
  'divisional_budget_submissions_insert',
  'divisional_budget_submissions_update',
  'divisional_budget_submissions_delete',
  'divisional_budget_lines_read',
  'divisional_budget_lines_insert',
  'divisional_budget_lines_update',
  'divisional_budget_lines_delete',
  'budget_workflow_history_read',
  'budget_workflow_history_insert',
  'budget_import_batches_read',
  'budget_import_batches_insert',
  'budget_import_batches_update',
  'budget_import_batches_delete',
  'budget_import_staging_read',
  'budget_import_staging_insert',
  'budget_import_staging_update',
  'budget_import_staging_delete',
  'budget_line_attachments_read',
  'budget_monthly_allocations_read',
]) {
  assert.ok(combined.includes(`drop policy if exists ${unsafePolicy}`), `unsafe legacy policy not removed: ${unsafePolicy}`)
}

// Legacy permissive policies on the ancillary budget tables are OR-combined by
// PostgreSQL. Every superseded policy must be retired, not merely accompanied by
// a stricter hard10_* policy.
for (const residualPolicy of [
  'budget_monthly_allocations_select_phase6',
  'budget_division_ceilings_insert',
  'budget_division_ceilings_update',
  'budget_division_ceilings_delete',
  'budget_reference_values_insert',
  'budget_reference_values_update',
  'budget_reference_values_delete',
  'expense_ledger_insert',
  'expense_ledger_update',
  'expense_ledger_delete',
  'expense_ledger_select_phase6',
]) {
  assert.ok(cleanup.includes(`drop policy if exists ${residualPolicy}`), `superseded ancillary policy not removed: ${residualPolicy}`)
}

function policyBlock(source, name) {
  const match = source.match(new RegExp(`create\\s+policy\\s+${name}\\b[\\s\\S]*?;`, 'i'))
  assert.ok(match, `required policy missing: ${name}`)
  return match[0]
}

const submissionRead = policyBlock(sql, 'hard10_budget_submission_read')
const submissionInsert = policyBlock(sql, 'hard10_budget_submission_insert')
const submissionUpdate = policyBlock(sql, 'hard10_budget_submission_update')
const submissionDelete = policyBlock(sql, 'hard10_budget_submission_delete')
const lineRead = policyBlock(sql, 'hard10_budget_line_read')
const lineInsert = policyBlock(sql, 'hard10_budget_line_insert')
const lineUpdate = policyBlock(sql, 'hard10_budget_line_update')
const lineDelete = policyBlock(sql, 'hard10_budget_line_delete')
const expenseLedgerRead = policyBlock(cleanup, 'hard10_expense_ledger_read')

// Direct table mutation is preparation/edit authority only. Submit/review/approve
// remain guarded SECURITY DEFINER workflow RPC actions and must not become generic
// row-write authority.
assert.ok(submissionInsert.includes("budget.template.create"), 'submission INSERT must require budget.template.create')
assert.ok(submissionUpdate.includes("budget.template.edit"), 'submission UPDATE must require budget.template.edit')
assert.ok(submissionDelete.includes("budget.template.edit"), 'submission DELETE must require budget.template.edit')
assert.ok(lineInsert.includes("budget.template.create") || lineInsert.includes("budget.template.edit"), 'line INSERT must require preparation authority')
assert.ok(lineUpdate.includes("budget.template.edit"), 'line UPDATE must require budget.template.edit')
assert.ok(lineDelete.includes("budget.template.edit"), 'line DELETE must require budget.template.edit')

for (const [label, block] of [
  ['submission insert', submissionInsert],
  ['submission update', submissionUpdate],
  ['submission delete', submissionDelete],
  ['line insert', lineInsert],
  ['line update', lineUpdate],
  ['line delete', lineDelete],
]) {
  for (const forbidden of ['budget.template.submit', 'budget.template.review', 'budget.template.approve', 'budget.module.review', 'budget.module.approve']) {
    assert.ok(!block.includes(forbidden), `${label} must not grant direct mutation through ${forbidden}`)
  }
}

// Normal direct edits only exist before workflow lock, with RETURNED explicitly
// preserved for correction/resubmission.
assert.ok(submissionInsert.includes("status = 'draft'"), 'direct submission INSERT must create DRAFT rows only')
assert.ok(submissionUpdate.includes("status in ('draft','returned')") || submissionUpdate.includes("status in ('draft', 'returned')"), 'direct submission UPDATE must be limited to DRAFT/RETURNED')
assert.ok(submissionDelete.includes("status in ('draft','returned')") || submissionDelete.includes("status in ('draft', 'returned')"), 'direct submission DELETE must be limited to DRAFT/RETURNED')
assert.ok(lineUpdate.includes("s.status in ('draft','returned')") || lineUpdate.includes("s.status in ('draft', 'returned')"), 'line UPDATE must inherit DRAFT/RETURNED parent state')
assert.ok(lineDelete.includes("s.status in ('draft','returned')") || lineDelete.includes("s.status in ('draft', 'returned')"), 'line DELETE must inherit DRAFT/RETURNED parent state')

// Budget rows are organisational records. Passing submitted_by/created_by into
// the generic scope helper would grant cross-section ownership override.
assert.ok(!submissionRead.includes('submitted_by'), 'budget submission read scope must not bypass section scope through submitted_by ownership')
assert.ok(!submissionUpdate.includes('submitted_by'), 'budget submission update scope must not bypass section scope through submitted_by ownership')
assert.ok(!lineRead.includes('s.submitted_by'), 'budget line read scope must not inherit cross-section submitted_by ownership override')
assert.ok(!lineUpdate.includes('s.submitted_by'), 'budget line update scope must not inherit cross-section submitted_by ownership override')

// Reference-data reads may be broad within budget/report roles, but must never
// fall back to any-authenticated access.
assert.ok(
  ['budget.template.view','budget.report.view','budget.module.view','budget.view','reports.view','all'].some(permission => expenseLedgerRead.includes(permission)),
  'expense ledger read must require an explicit budget/report permission',
)
assert.ok(!/^create\s+policy[\s\S]*using\s*\(\s*auth\.uid\(\)\s+is\s+not\s+null\s*\)\s*;$/i.test(expenseLedgerRead.trim()), 'expense ledger read must not allow every authenticated user')

// Identity and parentage are immutable through direct table updates. Workflow
// RPCs may change controlled actor/status fields under njss.budget_workflow.
assert.ok(sql.includes('create or replace function public.njss_hard10_guard_budget_submission_identity()'), 'submission identity guard function must exist')
assert.ok(sql.includes('create trigger trg_hard10_budget_submission_identity'), 'submission identity guard trigger must exist')
for (const protectedField of ['new.division_id is distinct from old.division_id', 'new.department_id is distinct from old.department_id', 'new.submitted_by is distinct from old.submitted_by']) {
  assert.ok(sql.includes(protectedField), `submission identity guard must protect ${protectedField.split(' ')[0]}`)
}
assert.ok(sql.includes('create or replace function public.njss_hard10_guard_budget_line_parent()'), 'budget line parent guard function must exist')
assert.ok(sql.includes('new.submission_id is distinct from old.submission_id'), 'budget lines must not be moved between submissions directly')
assert.ok(sql.includes('create trigger trg_hard10_budget_line_parent'), 'budget line parent guard trigger must exist')
assert.ok(sql.includes('create or replace function public.njss_hard10_guard_monthly_allocation_parent()'), 'monthly allocation parent guard function must exist')
assert.ok(sql.includes('new.budget_line_id is distinct from old.budget_line_id'), 'monthly allocations must not be moved between budget lines directly')

// Live preflight must detect UAT/production actor-data drift rather than forcing
// permissive policy exceptions for invalid assignments.
assert.ok(preflight.includes('assigned_line_supervisor_id'), 'preflight must inspect assigned Line Supervisors')
assert.ok(preflight.includes('njss_budget_revision_supervisor_matches'), 'preflight must verify assigned supervisor organisational match')
assert.ok(preflight.includes('fn_current_user_data_scope_allows'), 'preflight must exercise effective organisational scope')

// HARD-10A: the national UAT supervisor must keep a stable home section. Any
// cross-location responsibility is an explicit user-level delegation, not a
// temporary rewrite of users.department_id/users.section_id and not a role-wide
// scope relaxation.
assert.ok(hard10a.includes('create or replace function public.njss_budget_revision_supervisor_matches'), 'HARD-10A must harden the canonical supervisor matcher')
assert.ok(hard10a.includes('user_data_scopes'), 'HARD-10A must recognize explicit user-level delegated scope')
assert.ok(hard10a.includes("scope_type = 'department_wide'"), 'HARD-10A delegated assignment must be DEPARTMENT_WIDE, not SYSTEM_WIDE')
assert.ok(hard10a.includes('department_ids'), 'HARD-10A must use the explicit delegated department list')
assert.ok(hard10a.includes("dataset_version = 'njss-national-uat-2026-v1'"), 'HARD-10A must bind the data correction to the certified UAT dataset')
assert.ok(hard10a.includes('uat_seed_entities'), 'HARD-10A delegated scope must be registered as UAT provenance')
assert.ok(hard10a.includes("'user_data_scopes'"), 'HARD-10A provenance must identify the delegated-scope table')
assert.ok(!/update\s+(public\.)?users\s+set[\s\S]{0,200}(department_id|section_id)/i.test(hard10a), 'HARD-10A must never relocate a user to manufacture assignment eligibility')
assert.ok(!hard10a.includes("scope_type = 'system_wide'"), 'HARD-10A must not grant the UAT supervisor system-wide delegated scope')
assert.ok(hard10a.includes("r.name = 'line supervisor'"), 'HARD-10A matcher must still require the active Line Supervisor role')

assert.ok(combined.includes("masterdata.manage"), 'master-data mutations must require masterdata.manage')
assert.ok(combined.includes("registry.manage"), 'registry mutations must require registry.manage where applicable')
assert.ok(combined.includes("budget.template.view"), 'budget reads must require budget.template.view/budget permission')
assert.ok(combined.includes('fn_current_user_data_scope_allows'), 'transactional budget rows must enforce data scope')
assert.ok(combined.includes('auth.uid() is not null'), 'RLS policies must require an authenticated identity')
assert.ok(cleanup.includes('revoke execute on function public.njss_is_budget_contributor()'), 'obsolete any-authenticated budget contributor helper must be retired')
assert.ok(cleanup.includes("a policy still depends on njss_is_budget_contributor()"), 'cleanup must fail if a legacy contributor policy survives')
assert.ok(!combined.includes('to anon'), 'HARD-10 migrations must not grant table access to anon')
assert.ok(!/for\s+all\s+to\s+authenticated\s+using\s*\(\s*true\s*\)/i.test(combined), 'no authenticated allow-all mutation policy is permitted')

console.log('RLS and legacy policy lockdown checks passed')
