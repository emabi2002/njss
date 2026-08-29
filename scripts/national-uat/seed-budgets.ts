import type { Client } from 'pg'
import { BUDGET_TIERS, MONTHLY_PROFILES, type BudgetTier, type MonthlyProfileName } from './catalog/scenarios'
import { DATASET_VERSION } from './constants'
import { setActorContext } from './db'
import { deterministicUuid } from './deterministic-id'
import { applyCanonicalFinanceMappings, type FinanceMasterPlan } from './seed-finance'
import type { NationalMasterPlan } from './seed-master'

export const BUDGET_ACTORS = Object.freeze({
  lineSupervisor: 'a7a7aeb9-082d-4ed0-a4a7-07ba92f24f00',
  reviewRegistrar: '7343951c-b3ec-47e3-a177-5fb12c68c3aa',
  approvalRegistrar: '843dd453-59b4-4436-b85f-3f4a35954e5b',
  systemAdministrator: '73302177-32a5-4433-bd9e-d370af2abe83',
  activationRegistrar: '7343951c-b3ec-47e3-a177-5fb12c68c3aa',
})

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

const TIER_BASE_PGK: Readonly<Record<BudgetTier, number>> = Object.freeze({
  H: 120_000,
  T1: 80_000,
  T2: 60_000,
  T3: 35_000,
})

export type BudgetCyclePlan = {
  id: string
  code: string
  budgetYear: number
  cycleType: 'ANNUAL'
  name: string
  status: 'OPEN'
  opensOn: string
  submissionDeadline: string
  closesOn: string
  departmentCeilingCents: number
  notes: string
}

export type BudgetCeilingPlan = {
  id: string
  cycleId: string
  divisionId: string
  ceilingCents: number
  notes: string
}

export type BudgetSubmissionPlan = {
  id: string
  code: string
  cycleId: string
  budgetYear: number
  departmentId: string
  divisionId: string
  costCentreId: string
  costCentreCode: string
  courtLocationCode: string
  tier: BudgetTier
  ceilingCents: number
  totalBudgetCents: number
}

export type BudgetLinePlan = {
  id: string
  submissionId: string
  lineNumber: number
  activityReference: string
  expenseLedgerId: string
  expenseCodeRegistryId: string
  financeCode: string
  lineItemDescription: string
  businessJustification: string
  annualCents: number
  monthlyProfile: MonthlyProfileName
  monthlyCents: number[]
}

export type MonthlyAllocationPlan = {
  id: string
  budgetLineId: string
  monthNumber: number
  monthName: string
  amountCents: number
}

export type BudgetSeedPlan = {
  financialYear: 2026
  cycles: BudgetCyclePlan[]
  ceilings: BudgetCeilingPlan[]
  submissions: BudgetSubmissionPlan[]
  lines: BudgetLinePlan[]
  monthlyAllocations: MonthlyAllocationPlan[]
  activationSubmissionIds: string[]
}

export function allocateMonthlyCents(annualCents: number, basisPoints: readonly number[]): number[] {
  if (!Number.isSafeInteger(annualCents) || annualCents < 0) throw new Error('annualCents must be a non-negative safe integer')
  if (basisPoints.length !== 12 || basisPoints.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error('monthly profile must contain 12 non-negative integer basis-point values')
  }
  if (basisPoints.reduce((sum, value) => sum + value, 0) !== 10_000) {
    throw new Error('monthly profile must total exactly 10,000 basis points')
  }

  const annual = BigInt(annualCents)
  const divisor = 10_000n
  const rows = basisPoints.map((bps, index) => {
    const numerator = annual * BigInt(bps)
    return {
      index,
      cents: numerator / divisor,
      remainder: numerator % divisor,
    }
  })
  const allocated = rows.map((row) => Number(row.cents))
  let remaining = annualCents - allocated.reduce((sum, value) => sum + value, 0)
  const ranked = [...rows].sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index
    return left.remainder > right.remainder ? -1 : 1
  })
  for (let offset = 0; offset < remaining; offset += 1) allocated[ranked[offset % ranked.length].index] += 1
  if (allocated.reduce((sum, value) => sum + value, 0) !== annualCents) throw new Error('monthly allocation failed exact-cent reconciliation')
  return allocated
}

function lineAnnualCents(tier: BudgetTier, lineIndex: number): number {
  const basePng = TIER_BASE_PGK[tier]
  const incrementPng = lineIndex * Math.max(2_500, Math.floor(basePng * 0.04))
  return (basePng + incrementPng) * 100
}

export function buildBudgetSeedPlan(
  organisation: NationalMasterPlan,
  finance: FinanceMasterPlan,
): BudgetSeedPlan {
  const financialYear = 2026 as const
  const cycleId = deterministicUuid('budget-cycle:2026:national-annual')
  const divisionById = new Map(organisation.budgetDivisions.map((division) => [division.id, division]))
  const departmentById = new Map(organisation.departments.map((department) => [department.id, department]))
  const ledgerById = new Map(finance.ledgers.map((ledger) => [ledger.id, ledger]))
  const contextsByCostCentre = new Map<string, typeof finance.contexts>()
  for (const context of finance.contexts) {
    const current = contextsByCostCentre.get(context.costCentreId) ?? []
    current.push(context)
    contextsByCostCentre.set(context.costCentreId, current)
  }

  const submissions: BudgetSubmissionPlan[] = []
  const lines: BudgetLinePlan[] = []
  const monthlyAllocations: MonthlyAllocationPlan[] = []
  const ceilings: BudgetCeilingPlan[] = []

  for (const division of organisation.budgetDivisions) {
    const department = departmentById.get(division.departmentId)
    if (!department) throw new Error(`Budget division ${division.code} references missing department`)
    const tier = BUDGET_TIERS[department.courtLocationCode]
    if (!tier) throw new Error(`No budget tier for ${department.courtLocationCode}`)
    const contexts = [...(contextsByCostCentre.get(division.costCentreId) ?? [])].sort((a, b) => a.financeCode.localeCompare(b.financeCode))
    if (contexts.length < 2) throw new Error(`Budget division ${division.code} has fewer than two canonical finance contexts`)

    const submissionId = deterministicUuid(`budget-submission:2026:${division.code}`)
    const submissionLines: BudgetLinePlan[] = contexts.map((context, index) => {
      const ledger = ledgerById.get(context.expenseLedgerId)
      if (!ledger) throw new Error(`Finance context ${context.code} references missing ledger`)
      const annualCents = lineAnnualCents(tier, index)
      const profile = MONTHLY_PROFILES[ledger.monthlyProfile]
      const monthlyCents = allocateMonthlyCents(annualCents, profile)
      const lineId = deterministicUuid(`budget-line:${submissionId}:${context.financeCode}`)
      const line: BudgetLinePlan = {
        id: lineId,
        submissionId,
        lineNumber: index + 1,
        activityReference: `UAT26-${division.code}-${String(index + 1).padStart(2, '0')}`,
        expenseLedgerId: context.expenseLedgerId,
        expenseCodeRegistryId: context.expenseCodeRegistryId,
        financeCode: context.financeCode,
        lineItemDescription: `${ledger.standardDescription} for ${division.name} — UAT`,
        businessJustification: `${DATASET_VERSION} controlled synthetic budget line for workflow, activation and financial-control testing.`,
        annualCents,
        monthlyProfile: ledger.monthlyProfile,
        monthlyCents,
      }
      monthlyCents.forEach((amountCents, monthIndex) => {
        monthlyAllocations.push({
          id: deterministicUuid(`budget-monthly:${lineId}:${monthIndex + 1}`),
          budgetLineId: lineId,
          monthNumber: monthIndex + 1,
          monthName: MONTH_NAMES[monthIndex],
          amountCents,
        })
      })
      return line
    })
    lines.push(...submissionLines)
    const totalBudgetCents = submissionLines.reduce((sum, line) => sum + line.annualCents, 0)
    const submission: BudgetSubmissionPlan = {
      id: submissionId,
      code: `UAT26-${division.code}`,
      cycleId,
      budgetYear: financialYear,
      departmentId: division.departmentId,
      divisionId: division.id,
      costCentreId: division.costCentreId,
      costCentreCode: division.costCentreCode,
      courtLocationCode: department.courtLocationCode,
      tier,
      ceilingCents: totalBudgetCents,
      totalBudgetCents,
    }
    submissions.push(submission)
    ceilings.push({
      id: deterministicUuid(`budget-ceiling:${cycleId}:${division.code}`),
      cycleId,
      divisionId: division.id,
      ceilingCents: totalBudgetCents,
      notes: `${DATASET_VERSION} synthetic FY2026 ceiling for ${division.code}.`,
    })
  }

  const departmentCeilingCents = ceilings.reduce((sum, ceiling) => sum + ceiling.ceilingCents, 0)
  const cycles: BudgetCyclePlan[] = [{
    id: cycleId,
    code: 'UAT-FY2026-ANNUAL',
    budgetYear: financialYear,
    cycleType: 'ANNUAL',
    name: 'FY2026 National UAT Annual Budget',
    status: 'OPEN',
    opensOn: '2026-01-01',
    submissionDeadline: '2026-02-28',
    closesOn: '2026-12-31',
    departmentCeilingCents,
    notes: `${DATASET_VERSION}. Synthetic test budget; not an official PNG Judiciary appropriation.`,
  }]

  return {
    financialYear,
    cycles,
    ceilings,
    submissions,
    lines,
    monthlyAllocations,
    activationSubmissionIds: submissions.map((submission) => submission.id),
  }
}

function money(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Invalid monetary cents value ${cents}`)
  const negative = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${negative}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

async function registerBudgetEntity(client: Client, runId: string, tableName: string, entityId: string, businessCode: string): Promise<void> {
  await client.query(
    `insert into public.uat_seed_entities (run_id, table_name, entity_id, business_code, provenance, source_reference)
     values ($1,$2,$3,$4,'UAT',$5)
     on conflict (run_id, table_name, entity_id) do update set
       business_code=excluded.business_code,
       provenance='UAT',
       source_reference=excluded.source_reference`,
    [runId, tableName, entityId, businessCode, `${DATASET_VERSION} synthetic FY2026 budget`],
  )
}

export async function seedDraftBudgets(
  client: Client,
  runId: string,
  plan: BudgetSeedPlan,
): Promise<void> {
  await setActorContext(client, BUDGET_ACTORS.lineSupervisor)
  const actor = await client.query<{ full_name: string; email: string }>(
    'select full_name,email from public.users where id=$1 and is_active=true and archived_at is null',
    [BUDGET_ACTORS.lineSupervisor],
  )
  if (actor.rowCount !== 1) throw new Error('Active Line Supervisor is required for budget preparation')
  const actorName = actor.rows[0].full_name
  const actorEmail = actor.rows[0].email

  for (const cycle of plan.cycles) {
    await client.query(
      `insert into public.budget_cycles (
         id,budget_year,cycle_type,name,status,department_id,opens_on,submission_deadline,closes_on,department_ceiling,notes,instructions,updated_at
       ) values ($1,$2,$3,$4,$5,null,$6,$7,$8,$9,$10,$11,now())
       on conflict (id) do update set
         budget_year=excluded.budget_year,cycle_type=excluded.cycle_type,name=excluded.name,status=excluded.status,
         opens_on=excluded.opens_on,submission_deadline=excluded.submission_deadline,closes_on=excluded.closes_on,
         department_ceiling=excluded.department_ceiling,notes=excluded.notes,instructions=excluded.instructions,updated_at=now()`,
      [cycle.id, cycle.budgetYear, cycle.cycleType, cycle.name, cycle.status, cycle.opensOn, cycle.submissionDeadline, cycle.closesOn, money(cycle.departmentCeilingCents), cycle.notes, 'Use only for controlled NJSS UAT testing.'],
    )
    await registerBudgetEntity(client, runId, 'budget_cycles', cycle.id, cycle.code)
  }

  for (const ceiling of plan.ceilings) {
    await client.query(
      `insert into public.budget_division_ceilings (id,cycle_id,division_id,ceiling_amount,notes,updated_at)
       values ($1,$2,$3,$4,$5,now())
       on conflict (id) do update set cycle_id=excluded.cycle_id,division_id=excluded.division_id,ceiling_amount=excluded.ceiling_amount,notes=excluded.notes,updated_at=now()`,
      [ceiling.id, ceiling.cycleId, ceiling.divisionId, money(ceiling.ceilingCents), ceiling.notes],
    )
    await registerBudgetEntity(client, runId, 'budget_division_ceilings', ceiling.id, `${ceiling.cycleId}:${ceiling.divisionId}`)
  }

  const linesBySubmission = new Map<string, BudgetLinePlan[]>()
  for (const line of plan.lines) {
    const current = linesBySubmission.get(line.submissionId) ?? []
    current.push(line)
    linesBySubmission.set(line.submissionId, current)
  }

  for (const submission of plan.submissions) {
    await client.query(
      `insert into public.divisional_budget_submissions (
         id,cycle_id,budget_year,department_id,division_id,cost_centre,submission_reference,version,budget_ceiling,
         prepared_by,prepared_by_email,date_prepared,status,validation_status,validation_messages,is_locked,notes,updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10,'2026-01-15','DRAFT','PENDING','[]'::jsonb,false,$11,now())`,
      [submission.id, submission.cycleId, submission.budgetYear, submission.departmentId, submission.divisionId, submission.costCentreCode, submission.code, money(submission.ceilingCents), actorName, actorEmail, `${DATASET_VERSION} synthetic submission for ${submission.courtLocationCode}.`],
    )
    await registerBudgetEntity(client, runId, 'divisional_budget_submissions', submission.id, submission.code)

    for (const line of linesBySubmission.get(submission.id) ?? []) {
      await client.query(
        `insert into public.divisional_budget_lines (
           id,submission_id,line_number,activity_reference,expense_ledger_id,line_item_description,business_justification,
           expected_output,location_destination_provider,quantity,unit_of_measure,unit_cost,frequency_periods,other_costs,
           annual_estimate,priority,procurement_method,responsible_officer,supporting_reference,comments,updated_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,'EA',$10,1,0,$10,'MEDIUM','UAT Controlled Test',$11,$12,$13,now())`,
        [line.id, line.submissionId, line.lineNumber, line.activityReference, line.expenseLedgerId, line.lineItemDescription, line.businessJustification, 'Validated FY2026 UAT budget control coverage', submission.courtLocationCode, money(line.annualCents), actorName, DATASET_VERSION, `Finance Code ${line.financeCode}; Posting context ${line.expenseCodeRegistryId}.`],
      )
      await registerBudgetEntity(client, runId, 'divisional_budget_lines', line.id, line.activityReference)
      for (let index = 0; index < 12; index += 1) {
        const monthly = plan.monthlyAllocations.find((item) => item.budgetLineId === line.id && item.monthNumber === index + 1)
        if (!monthly) throw new Error(`Missing month ${index + 1} for budget line ${line.id}`)
        const updated = await client.query(
          `update public.budget_monthly_allocations
           set id=$1,month_name=$4,amount=$5,updated_at=now()
           where budget_line_id=$2 and month_number=$3`,
          [monthly.id, monthly.budgetLineId, monthly.monthNumber, monthly.monthName, money(monthly.amountCents)],
        )
        if (updated.rowCount !== 1) {
          throw new Error(`Expected trigger-created month ${monthly.monthNumber} for budget line ${line.id}`)
        }
        await registerBudgetEntity(client, runId, 'budget_monthly_allocations', monthly.id, `${line.activityReference}:${monthly.monthNumber}`)
      }
    }
  }
}

async function transitionAll(
  client: Client,
  submissionIds: readonly string[],
  actorId: string,
  action: 'SUBMIT' | 'REVIEW' | 'APPROVE',
  comments: string,
): Promise<void> {
  const actor = await setActorContext(client, actorId)
  for (const submissionId of submissionIds) {
    const result = await client.query<{ status: string }>(
      'select status from public.transition_divisional_budget_submission($1,$2,$3,$4)',
      [submissionId, action, comments, actor.email],
    )
    const expected = action === 'SUBMIT' ? 'SUBMITTED' : action === 'REVIEW' ? 'REVIEWED' : 'APPROVED'
    if (result.rowCount !== 1 || result.rows[0]?.status !== expected) {
      throw new Error(`Budget ${submissionId} failed ${action}; expected ${expected}`)
    }
  }
}

export async function workflowAndActivateBudgets(
  client: Client,
  runId: string,
  plan: BudgetSeedPlan,
  finance: FinanceMasterPlan,
): Promise<void> {
  const submissionIds = plan.submissions.map((submission) => submission.id)
  await transitionAll(client, submissionIds, BUDGET_ACTORS.lineSupervisor, 'SUBMIT', `${DATASET_VERSION} Line Supervisor submission.`)
  await transitionAll(client, submissionIds, BUDGET_ACTORS.reviewRegistrar, 'REVIEW', `${DATASET_VERSION} Registrar review.`)
  await transitionAll(client, submissionIds, BUDGET_ACTORS.approvalRegistrar, 'APPROVE', `${DATASET_VERSION} Registrar approval; operational activation remains separate.`)

  await setActorContext(client, BUDGET_ACTORS.systemAdministrator)
  await applyCanonicalFinanceMappings(client, runId, finance)
  const batches: Array<{ id: string; submissionId: string; approvedLineCount: number; approvedTotal: string }> = []
  for (const submissionId of plan.activationSubmissionIds) {
    const batch = await client.query<{ id: string; approved_line_count: number; approved_total: string }>(
      'select id,approved_line_count,approved_total::text from public.budget_activation_batches where submission_id=$1',
      [submissionId],
    )
    if (batch.rowCount !== 1) throw new Error(`Approved submission ${submissionId} has no unique activation batch`)
    const batchId = batch.rows[0].id
    const prepared = await client.query<{ status: string }>('select status from public.njss_prepare_budget_activation($1,$2)', [batchId, null])
    if (prepared.rowCount !== 1 || prepared.rows[0]?.status !== 'DRAFT_MAPPING') throw new Error(`Activation preparation failed for ${submissionId}`)
    const submitted = await client.query<{ status: string }>('select status from public.njss_submit_budget_activation($1,$2)', [batchId, null])
    if (submitted.rowCount !== 1 || submitted.rows[0]?.status !== 'READY_FOR_ACTIVATION') throw new Error(`Activation submission failed for ${submissionId}`)
    batches.push({ id: batchId, submissionId, approvedLineCount: Number(batch.rows[0].approved_line_count), approvedTotal: batch.rows[0].approved_total })
  }

  await setActorContext(client, BUDGET_ACTORS.activationRegistrar)
  for (const batch of batches) {
    const activated = await client.query<{ status: string; variance: string }>(
      'select status,variance::text from public.njss_activate_approved_budget($1,$2)',
      [batch.id, null],
    )
    if (activated.rowCount !== 1 || activated.rows[0]?.status !== 'ACTIVATED' || Number(activated.rows[0]?.variance ?? 1) !== 0) {
      throw new Error(`Registrar activation failed for ${batch.submissionId}`)
    }
    const reconciliation = await client.query<{ allocations: string; snapshots: string; allocation_total: string; snapshot_total: string }>(
      `select
         (select count(*)::text from public.budget_allocations where source_budget_submission_id=$1 and source_module='EXCEL_BUDGET' and is_active=true) as allocations,
         (select count(*)::text from public.budget_activation_line_snapshots where activation_batch_id=$2) as snapshots,
         (select coalesce(sum(original_budget),0)::text from public.budget_allocations where source_budget_submission_id=$1 and source_module='EXCEL_BUDGET' and is_active=true) as allocation_total,
         (select coalesce(sum(approved_amount),0)::text from public.budget_activation_line_snapshots where activation_batch_id=$2) as snapshot_total`,
      [batch.submissionId, batch.id],
    )
    const row = reconciliation.rows[0]
    if (!row || Number(row.allocations) !== batch.approvedLineCount || Number(row.snapshots) !== batch.approvedLineCount) {
      throw new Error(`Activation count reconciliation failed for ${batch.submissionId}`)
    }
    if (Number(row.allocation_total) !== Number(batch.approvedTotal) || Number(row.snapshot_total) !== Number(batch.approvedTotal)) {
      throw new Error(`Activation total reconciliation failed for ${batch.submissionId}`)
    }
    await registerBudgetEntity(client, runId, 'budget_activation_batches', batch.id, `ACT:${batch.submissionId}`)
  }
}

export async function seedAndActivateNationalBudgets(
  client: Client,
  runId: string,
  organisation: NationalMasterPlan,
  finance: FinanceMasterPlan,
): Promise<BudgetSeedPlan> {
  const plan = buildBudgetSeedPlan(organisation, finance)
  await seedDraftBudgets(client, runId, plan)
  await workflowAndActivateBudgets(client, runId, plan, finance)
  return plan
}
