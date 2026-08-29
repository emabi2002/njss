import type { Client } from 'pg'
import { deterministicUuid } from './deterministic-id'
import {
  COURT_LOCATIONS,
  PROVINCES,
  PROVINCIAL_TEMPLATE,
  SUBREGISTRY_TEMPLATE,
  WAIGANI_FUNCTIONS,
  type FunctionalUnitTemplate,
  type Provenance,
} from './catalog/organisation'

const BRANCH_LIBRARY_LOCATIONS = new Set([
  'NCD-WGN',
  'MOR-LAE',
  'MAD-MAD',
  'WNB-KIM',
  'ENG-WAB',
  'WHP-MHG',
  'EHP-GOR',
])

const WAIGANI_EXTRA_SECTIONS: Record<string, readonly { code: string; name: string; provenance: 'DERIVED' | 'UAT' }[]> = {
  REG: [{ code: 'RAD', name: 'Registrar Administration', provenance: 'DERIVED' }],
  PRO: [{ code: 'OPS', name: 'Procurement Operations', provenance: 'DERIVED' }],
}

type ProvincePlan = {
  id: string
  code: string
  name: string
  provenance: 'OFFICIAL'
}

type LocationPlan = {
  id: string
  provinceId: string
  provinceCode: string
  code: string
  name: string
  town: string
  locationType: 'HEADQUARTERS' | 'NATIONAL_COURT_REGISTRY' | 'NATIONAL_COURT_SUB_REGISTRY'
  isHeadquarters: boolean
  provenance: 'OFFICIAL'
}

type DepartmentPlan = {
  id: string
  code: string
  name: string
  description: string
  courtLocationId: string
  courtLocationCode: string
  functionCode: string
  provenance: 'DERIVED' | 'UAT'
}

type SectionPlan = {
  id: string
  departmentId: string
  code: string
  name: string
  provenance: 'DERIVED' | 'UAT'
}

type CostCentrePlan = {
  id: string
  departmentId: string
  sectionId: string
  code: string
  name: string
  provenance: 'DERIVED' | 'UAT'
}

type BudgetDivisionPlan = {
  id: string
  departmentId: string
  sectionId: string
  costCentreId: string
  code: string
  name: string
  costCentreCode: string
  costCentreName: string
  sortOrder: number
  provenance: 'DERIVED' | 'UAT'
}

export type NationalMasterPlan = {
  provinces: ProvincePlan[]
  locations: LocationPlan[]
  departments: DepartmentPlan[]
  sections: SectionPlan[]
  costCentres: CostCentrePlan[]
  budgetDivisions: BudgetDivisionPlan[]
}

export type RetainedUserAssignment = {
  userId: string
  departmentCode: string
  sectionCode: string
}

export const RETAINED_USER_ASSIGNMENTS: readonly RetainedUserAssignment[] = [
  { userId: '73302177-32a5-4433-bd9e-d370af2abe83', departmentCode: 'NCD-WGN-ICT', sectionCode: 'NCD-WGN-ICT-SYS' },
  { userId: '7a2fe5c9-7da2-42ae-8d3f-6d02266ff26a', departmentCode: 'NCD-WGN-ICT', sectionCode: 'NCD-WGN-ICT-HLP' },
  { userId: '7343951c-b3ec-47e3-a177-5fb12c68c3aa', departmentCode: 'NCD-WGN-REG', sectionCode: 'NCD-WGN-REG-RAD' },
  { userId: '843dd453-59b4-4436-b85f-3f4a35954e5b', departmentCode: 'NCD-WGN-REG', sectionCode: 'NCD-WGN-REG-CIV' },
  { userId: 'a7a7aeb9-082d-4ed0-a4a7-07ba92f24f00', departmentCode: 'NCD-WGN-HR', sectionCode: 'NCD-WGN-HR-HRA' },
  { userId: '87075d67-26d8-4144-993d-56a2b244e76c', departmentCode: 'NCD-WGN-PRO', sectionCode: 'NCD-WGN-PRO-OPS' },
  { userId: '4883e82e-316e-4681-853b-0a412f2644a8', departmentCode: 'NCD-WGN-FIN', sectionCode: 'NCD-WGN-FIN-REC' },
] as const

function templatesForLocation(locationCode: string, locationType: LocationPlan['locationType']): readonly FunctionalUnitTemplate[] {
  if (locationCode === 'NCD-WGN') return WAIGANI_FUNCTIONS
  if (locationType === 'NATIONAL_COURT_SUB_REGISTRY') return SUBREGISTRY_TEMPLATE
  return PROVINCIAL_TEMPLATE.filter((unit) => unit.code !== 'LIB' || BRANCH_LIBRARY_LOCATIONS.has(locationCode))
}

function globallyUniqueCode(...parts: string[]): string {
  const code = parts.filter(Boolean).join('-').toUpperCase()
  if (code.length > 20) throw new Error(`Generated master code exceeds varchar(20): ${code}`)
  return code
}

export function buildNationalMasterPlan(): NationalMasterPlan {
  const provinces: ProvincePlan[] = PROVINCES.map((province) => ({
    id: deterministicUuid(`province:${province.code}`),
    code: province.code,
    name: province.name,
    provenance: province.provenance,
  }))
  const provinceByCode = new Map(provinces.map((province) => [province.code, province]))

  const locations: LocationPlan[] = COURT_LOCATIONS.map((location) => {
    const province = provinceByCode.get(location.provinceCode)
    if (!province) throw new Error(`Court location ${location.code} references unknown province ${location.provinceCode}`)
    return {
      id: deterministicUuid(`court-location:${location.code}`),
      provinceId: province.id,
      provinceCode: province.code,
      code: location.code,
      name: location.name,
      town: location.town,
      locationType: location.locationType,
      isHeadquarters: location.isHeadquarters,
      provenance: location.provenance,
    }
  })

  const departments: DepartmentPlan[] = []
  const sections: SectionPlan[] = []
  const costCentres: CostCentrePlan[] = []
  const budgetDivisions: BudgetDivisionPlan[] = []

  for (const location of locations) {
    const templates = templatesForLocation(location.code, location.locationType)
    for (const unit of templates) {
      const departmentCode = globallyUniqueCode(location.code, unit.code)
      const departmentId = deterministicUuid(`department:${departmentCode}`)
      const department: DepartmentPlan = {
        id: departmentId,
        code: departmentCode,
        name: `${location.town} - ${unit.name}`,
        description: `NJSS National UAT organisational unit for ${location.name}. ${unit.provenance === 'UAT' ? 'Synthetic UAT structure.' : 'Derived test structure; not represented as an approved establishment code.'}`,
        courtLocationId: location.id,
        courtLocationCode: location.code,
        functionCode: unit.code,
        provenance: unit.provenance,
      }
      departments.push(department)

      const configuredSections = [
        ...unit.sections,
        ...(location.code === 'NCD-WGN' ? (WAIGANI_EXTRA_SECTIONS[unit.code] ?? []) : []),
      ]
      if (configuredSections.length === 0) throw new Error(`Department ${departmentCode} has no sections`)

      const departmentSections: SectionPlan[] = configuredSections.map((section) => {
        const sectionCode = globallyUniqueCode(departmentCode, section.code)
        return {
          id: deterministicUuid(`section:${sectionCode}`),
          departmentId,
          code: sectionCode,
          name: section.name,
          provenance: section.provenance,
        }
      })
      sections.push(...departmentSections)

      // One budget-owning Cost Centre per functional Department. The Cost Centre is
      // anchored to the unit's primary section; detailed subsections remain available
      // for workflow/user ownership without creating a Cartesian financial structure.
      const primarySection = departmentSections[0]
      const costCentreCode = globallyUniqueCode('CC', departmentCode)
      const costCentreName = `${location.town} - ${unit.name}`
      const costCentre: CostCentrePlan = {
        id: deterministicUuid(`cost-centre:${costCentreCode}`),
        departmentId,
        sectionId: primarySection.id,
        code: costCentreCode,
        name: costCentreName,
        provenance: unit.provenance,
      }
      costCentres.push(costCentre)

      const divisionCode = globallyUniqueCode('BD', departmentCode)
      budgetDivisions.push({
        id: deterministicUuid(`budget-division:${divisionCode}`),
        departmentId,
        sectionId: primarySection.id,
        costCentreId: costCentre.id,
        code: divisionCode,
        name: `${unit.name} Budget`,
        costCentreCode,
        costCentreName,
        sortOrder: budgetDivisions.length + 1,
        provenance: unit.provenance,
      })
    }
  }

  return { provinces, locations, departments, sections, costCentres, budgetDivisions }
}

type SeedEntity = {
  tableName: string
  entityId: string
  businessCode: string
  provenance: Provenance
  sourceReference: string
}

function seedEntities(plan: NationalMasterPlan): SeedEntity[] {
  return [
    ...plan.provinces.map((item) => ({ tableName: 'provinces', entityId: item.id, businessCode: item.code, provenance: item.provenance, sourceReference: 'PNG jurisdiction catalogue used by NJSS National UAT 2026' })),
    ...plan.locations.map((item) => ({ tableName: 'court_locations', entityId: item.id, businessCode: item.code, provenance: item.provenance, sourceReference: 'PNG Judiciary court-location catalogue used by NJSS National UAT 2026' })),
    ...plan.departments.map((item) => ({ tableName: 'departments', entityId: item.id, businessCode: item.code, provenance: item.provenance, sourceReference: 'Derived NJSS UAT organisational template' })),
    ...plan.sections.map((item) => ({ tableName: 'sections', entityId: item.id, businessCode: item.code, provenance: item.provenance, sourceReference: 'Derived NJSS UAT organisational template' })),
    ...plan.costCentres.map((item) => ({ tableName: 'cost_centres', entityId: item.id, businessCode: item.code, provenance: item.provenance, sourceReference: 'Derived NJSS UAT budget-owning unit' })),
    ...plan.budgetDivisions.map((item) => ({ tableName: 'budget_divisions', entityId: item.id, businessCode: item.code, provenance: item.provenance, sourceReference: 'Derived NJSS UAT budget division' })),
  ]
}

async function upsertSeedEntity(client: Client, runId: string, entity: SeedEntity): Promise<void> {
  await client.query(
    `insert into public.uat_seed_entities (run_id, table_name, entity_id, business_code, provenance, source_reference)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (run_id, table_name, entity_id) do update set
       business_code = excluded.business_code,
       provenance = excluded.provenance,
       source_reference = excluded.source_reference`,
    [runId, entity.tableName, entity.entityId, entity.businessCode, entity.provenance, entity.sourceReference],
  )
}

export async function seedNationalOrganisation(client: Client, runId: string): Promise<NationalMasterPlan> {
  if (!runId.trim()) throw new Error('seedNationalOrganisation requires a UAT seed run ID')
  const run = await client.query<{ run_id: string }>('select run_id from public.uat_seed_runs where run_id = $1', [runId])
  if (run.rowCount !== 1) throw new Error(`UAT seed run ${runId} does not exist`)

  const plan = buildNationalMasterPlan()

  for (const province of plan.provinces) {
    await client.query(
      `insert into public.provinces (id, code, name, is_active)
       values ($1, $2, $3, true)
       on conflict (id) do update set code = excluded.code, name = excluded.name, is_active = true`,
      [province.id, province.code, province.name],
    )
  }

  for (const location of plan.locations) {
    await client.query(
      `insert into public.court_locations (id, province_id, code, name, location_type, town, is_headquarters, is_active, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, true, now())
       on conflict (id) do update set
         province_id = excluded.province_id,
         code = excluded.code,
         name = excluded.name,
         location_type = excluded.location_type,
         town = excluded.town,
         is_headquarters = excluded.is_headquarters,
         is_active = true,
         updated_at = now()`,
      [location.id, location.provinceId, location.code, location.name, location.locationType, location.town, location.isHeadquarters],
    )
  }

  for (const department of plan.departments) {
    await client.query(
      `insert into public.departments (id, code, name, description, court_location_id, is_active, updated_at)
       values ($1, $2, $3, $4, $5, true, now())
       on conflict (id) do update set
         code = excluded.code,
         name = excluded.name,
         description = excluded.description,
         court_location_id = excluded.court_location_id,
         is_active = true,
         updated_at = now()`,
      [department.id, department.code, department.name, department.description, department.courtLocationId],
    )
  }

  for (const section of plan.sections) {
    await client.query(
      `insert into public.sections (id, department_id, code, name, is_active)
       values ($1, $2, $3, $4, true)
       on conflict (id) do update set
         department_id = excluded.department_id,
         code = excluded.code,
         name = excluded.name,
         is_active = true`,
      [section.id, section.departmentId, section.code, section.name],
    )
  }

  for (const costCentre of plan.costCentres) {
    await client.query(
      `insert into public.cost_centres (id, code, name, department_id, section_id, is_active)
       values ($1, $2, $3, $4, $5, true)
       on conflict (id) do update set
         code = excluded.code,
         name = excluded.name,
         department_id = excluded.department_id,
         section_id = excluded.section_id,
         is_active = true`,
      [costCentre.id, costCentre.code, costCentre.name, costCentre.departmentId, costCentre.sectionId],
    )
  }

  for (const division of plan.budgetDivisions) {
    await client.query(
      `insert into public.budget_divisions (
         id, code, name, department_id, section_id, cost_centre_id,
         cost_centre_code, cost_centre_name, sort_order, is_active, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, now())
       on conflict (id) do update set
         code = excluded.code,
         name = excluded.name,
         department_id = excluded.department_id,
         section_id = excluded.section_id,
         cost_centre_id = excluded.cost_centre_id,
         cost_centre_code = excluded.cost_centre_code,
         cost_centre_name = excluded.cost_centre_name,
         sort_order = excluded.sort_order,
         is_active = true,
         updated_at = now()`,
      [division.id, division.code, division.name, division.departmentId, division.sectionId, division.costCentreId, division.costCentreCode, division.costCentreName, division.sortOrder],
    )
  }

  for (const entity of seedEntities(plan)) await upsertSeedEntity(client, runId, entity)

  const departmentByCode = new Map(plan.departments.map((item) => [item.code, item]))
  const sectionByCode = new Map(plan.sections.map((item) => [item.code, item]))
  for (const assignment of RETAINED_USER_ASSIGNMENTS) {
    const department = departmentByCode.get(assignment.departmentCode)
    const section = sectionByCode.get(assignment.sectionCode)
    if (!department || !section || section.departmentId !== department.id) {
      throw new Error(`Invalid retained-user target ${assignment.departmentCode} / ${assignment.sectionCode}`)
    }
    const result = await client.query(
      `update public.users
       set department_id = $1, section_id = $2, updated_at = now()
       where id = $3 and is_active is true and archived_at is null`,
      [department.id, section.id, assignment.userId],
    )
    if (result.rowCount !== 1) throw new Error(`Active retained user ${assignment.userId} could not be remapped exactly once`)
  }

  return plan
}
