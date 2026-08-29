import assert from 'node:assert/strict'
import {
  buildNationalMasterPlan,
  RETAINED_USER_ASSIGNMENTS,
} from './seed-master.ts'

const plan = buildNationalMasterPlan()

assert.equal(plan.provinces.length, 22)
assert.equal(plan.locations.length, 28)
assert.ok(plan.departments.length >= 180, `expected national functional departments, got ${plan.departments.length}`)
assert.ok(plan.sections.length >= 400, `expected national functional sections, got ${plan.sections.length}`)
assert.ok(plan.costCentres.length >= 190 && plan.costCentres.length <= 250, `expected controlled budget-owning cost centres, got ${plan.costCentres.length}`)
assert.equal(plan.budgetDivisions.length, plan.costCentres.length)

for (const collection of [plan.provinces, plan.locations, plan.departments, plan.sections, plan.costCentres, plan.budgetDivisions]) {
  assert.equal(new Set(collection.map((item) => item.id)).size, collection.length, 'deterministic IDs must be unique per collection')
  assert.equal(new Set(collection.map((item) => item.code)).size, collection.length, 'business codes must be unique per collection')
}

for (const item of [...plan.departments, ...plan.sections, ...plan.costCentres, ...plan.budgetDivisions]) {
  assert.ok(item.code.length <= 20, `code exceeds live varchar(20): ${item.code}`)
}

for (const department of plan.departments) {
  assert.ok(plan.locations.some((location) => location.id === department.courtLocationId), `department ${department.code} has no court location`)
}
for (const section of plan.sections) {
  assert.ok(plan.departments.some((department) => department.id === section.departmentId), `section ${section.code} has no department`)
}
for (const costCentre of plan.costCentres) {
  const department = plan.departments.find((item) => item.id === costCentre.departmentId)
  const section = plan.sections.find((item) => item.id === costCentre.sectionId)
  assert.ok(department, `cost centre ${costCentre.code} missing department`)
  assert.ok(section, `cost centre ${costCentre.code} missing section`)
  assert.equal(section.departmentId, department.id, `cost centre ${costCentre.code} crosses department boundaries`)
}
for (const division of plan.budgetDivisions) {
  const costCentre = plan.costCentres.find((item) => item.id === division.costCentreId)
  assert.ok(costCentre, `budget division ${division.code} missing cost centre`)
  assert.equal(division.departmentId, costCentre.departmentId)
  assert.equal(division.sectionId, costCentre.sectionId)
  assert.equal(division.costCentreCode, costCentre.code)
}

assert.equal(RETAINED_USER_ASSIGNMENTS.length, 7)
const expectedAssignments = new Map([
  ['73302177-32a5-4433-bd9e-d370af2abe83', 'NCD-WGN-ICT-SYS'],
  ['7a2fe5c9-7da2-42ae-8d3f-6d02266ff26a', 'NCD-WGN-ICT-HLP'],
  ['7343951c-b3ec-47e3-a177-5fb12c68c3aa', 'NCD-WGN-REG-RAD'],
  ['843dd453-59b4-4436-b85f-3f4a35954e5b', 'NCD-WGN-REG-CIV'],
  ['a7a7aeb9-082d-4ed0-a4a7-07ba92f24f00', 'NCD-WGN-HR-HRA'],
  ['87075d67-26d8-4144-993d-56a2b244e76c', 'NCD-WGN-PRO-OPS'],
  ['4883e82e-316e-4681-853b-0a412f2644a8', 'NCD-WGN-FIN-REC'],
])
for (const assignment of RETAINED_USER_ASSIGNMENTS) {
  assert.equal(assignment.sectionCode, expectedAssignments.get(assignment.userId), `unexpected mapping for ${assignment.userId}`)
  const section = plan.sections.find((item) => item.code === assignment.sectionCode)
  assert.ok(section, `retained-user target section ${assignment.sectionCode} not generated`)
  assert.equal(assignment.departmentCode, section.code.split('-').slice(0, -1).join('-'))
}

const lineSupervisorAssignment = RETAINED_USER_ASSIGNMENTS.find((item) => item.userId === 'a7a7aeb9-082d-4ed0-a4a7-07ba92f24f00')
const hrDepartment = plan.departments.find((item) => item.code === 'NCD-WGN-HR')
const hrBudgetDivision = plan.budgetDivisions.find((item) => item.departmentId === hrDepartment?.id)
const lineSupervisorSection = plan.sections.find((item) => item.code === lineSupervisorAssignment?.sectionCode)
assert.ok(hrBudgetDivision && lineSupervisorSection, 'HR revision ownership fixtures must exist')
assert.equal(hrBudgetDivision.sectionId, lineSupervisorSection.id, 'HR budget division must match the retained Line Supervisor section for revision workflow controls')

const branchLibraries = new Set(
  plan.departments.filter((item) => item.functionCode === 'LIB').map((item) => item.courtLocationCode),
)
for (const required of ['NCD-WGN', 'MOR-LAE', 'MAD-MAD', 'WNB-KIM', 'ENG-WAB', 'WHP-MHG', 'EHP-GOR']) {
  assert.ok(branchLibraries.has(required), `expected library structure at ${required}`)
}
for (const unexpected of ['HEL-TAR', 'CEN-KWL', 'ARB-BUK']) {
  assert.ok(!branchLibraries.has(unexpected), `library should not be automatically created at ${unexpected}`)
}

console.log(`national master seed generator checks passed: ${plan.departments.length} departments, ${plan.sections.length} sections, ${plan.costCentres.length} cost centres`)
