import fs from 'node:fs'
import assert from 'node:assert/strict'

const source = fs.readFileSync('app/dashboard/budget/activation/page.tsx', 'utf8')

assert.equal(source.includes('READY_FOR_ACTIVATION'), true, 'Activation must require the annual readiness state')
assert.equal(source.includes('REGISTRAR_ACTIVATION_AUTHORITY'), true, 'Registrar Office activation evidence must be recorded')
assert.equal(source.includes('Activate Annual Budget'), true, 'Budget Officer must have one clear annual activation action')
assert.equal(source.includes('All required Divisions must be locked'), true, 'Readiness rule must be explained in the workspace')
assert.equal(source.includes("can('budget.activate')"), true, 'Activation action must be permission-gated')
assert.equal(source.includes('registerBudgetDocument'), true, 'Activation correspondence metadata must be registered')
assert.equal(source.includes('uploadPrivateFile'), true, 'Activation correspondence must use private storage')
assert.equal(source.includes('activateAnnualBudget'), true, 'Activation must call the secured annual activation RPC wrapper')
assert.equal(source.includes('Head Office Total'), true)
assert.equal(source.includes('Division'), true)
assert.equal(source.includes('LOCKED'), true)
assert.equal(source.includes('Registrar'), true)

console.log('Simplified annual budget activation UI contract passed')
