import fs from 'node:fs'
import assert from 'node:assert/strict'

const migrationPath = 'supabase/migrations/20260917010000_simplified_head_office_budget_foundation.sql'

assert.equal(fs.existsSync(migrationPath), true, 'Simplified Head Office budget migration must exist')
const sql = fs.readFileSync(migrationPath, 'utf8')

for (const name of ['annual_budget_cycles', 'division_budgets', 'division_budget_lines', 'budget_documents']) {
  assert.match(sql, new RegExp(`create table(?: if not exists)? public\\.${name}`, 'i'), `${name} must be created`)
}

assert.match(sql, /financial_year\s+integer\s+not\s+null\s+unique/i, 'Annual budget cycles must be unique by financial year')
assert.match(sql, /unique\s*\(annual_budget_cycle_id\s*,\s*division_id\)/i, 'One Division budget per cycle is required')
assert.match(sql, /unique\s*\(division_budget_id\s*,\s*section_id\s*,\s*expense_ledger_id\)/i, 'One original Section/Ledger line per Division budget is required')
assert.match(sql, /njss-budget-documents/i, 'Private budget document bucket must be declared')
assert.match(sql, /values\s*\(\s*'njss-budget-documents'\s*,\s*'njss-budget-documents'\s*,\s*false\s*\)/i, 'Budget document bucket must be private')
assert.match(sql, /create or replace function public\.create_or_get_head_office_budget_cycle/i)
assert.match(sql, /create or replace function public\.create_or_get_division_budget/i)
assert.match(sql, /create or replace function public\.upsert_division_budget_line/i)
assert.match(sql, /create or replace function public\.lock_division_budget/i)
assert.match(sql, /create or replace function public\.activate_annual_budget/i)
assert.match(sql, /budget\.capture/i)
assert.match(sql, /budget\.lock/i)
assert.match(sql, /budget\.activate/i)
assert.match(sql, /budget\.documents\.manage/i)
assert.match(sql, /status\s*=\s*'LOCKED'/i, 'Lock RPC must transition the Division to LOCKED')
assert.match(sql, /status\s*=\s*'ACTIVE'/i, 'Activation RPC must transition the cycle to ACTIVE')
assert.match(sql, /OFFICIAL_APPROVED_BUDGET/i, 'Division lock must require the official approved budget document')
assert.match(sql, /REGISTRAR_ACTIVATION_AUTHORITY/i, 'Activation must require Registrar Office authority evidence')
assert.match(sql, /enable row level security/i, 'New budget tables must use RLS')
assert.match(sql, /revoke\s+(insert|update|delete|all)/i, 'Direct client mutation privileges must be revoked')
assert.match(sql, /set search_path = public, auth/i, 'SECURITY DEFINER functions must pin search_path')

console.log('Simplified budget foundation migration contract passed')
