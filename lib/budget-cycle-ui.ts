export type BudgetCycleOption = {
  id: string
  budget_year: number
  cycle_type: string
  name: string
  department_ceiling?: number | null
}

const normalizeCycleType = (value: string) => value.trim().toUpperCase()

export function findDuplicateBudgetCycle<T extends BudgetCycleOption>(cycles: T[], budgetYear: number, cycleType: string): T | undefined {
  const normalizedType = normalizeCycleType(cycleType)
  return cycles.find((cycle) => Number(cycle.budget_year) === Number(budgetYear) && normalizeCycleType(cycle.cycle_type) === normalizedType)
}

export function selectBudgetCycle(cycles: BudgetCycleOption[], cycleId: string) {
  const cycle = cycles.find((item) => item.id === cycleId)
  return {
    cycle_id: cycleId,
    budget_ceiling: cycle ? String(cycle.department_ceiling ?? "") : "",
  }
}
