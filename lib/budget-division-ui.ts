export type BudgetDivisionOption = {
  id: string
  code: string
  name: string
  cost_centre_code?: string | null
  cost_centre_name?: string | null
}

const normalizeDivisionCode = (value: string) => value.trim().toUpperCase()

export function findDuplicateBudgetDivision<T extends BudgetDivisionOption>(divisions: T[], code: string): T | undefined {
  const normalizedCode = normalizeDivisionCode(code)
  return divisions.find((division) => normalizeDivisionCode(division.code) === normalizedCode)
}
