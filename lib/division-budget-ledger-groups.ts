export type GroupLedger = {
  id: string
  finance_code: string
  standard_description: string
  is_posting: boolean
  is_active: boolean
  parent_ledger_id: string | null
  sort_order: number | null
}

export type LedgerGroup<T extends GroupLedger> = { category: T; children: T[] }

export function groupLedgers<T extends GroupLedger>(ledgers: T[]): LedgerGroup<T>[] {
  const categories = ledgers.filter(item => item.is_active && !item.is_posting)
    .sort((a,b) => (a.sort_order ?? 0)-(b.sort_order ?? 0) || a.finance_code.localeCompare(b.finance_code))
  const groups = categories.map(category => ({
    category,
    children: ledgers.filter(item => item.is_active && item.is_posting && item.parent_ledger_id === category.id)
      .sort((a,b) => (a.sort_order ?? 0)-(b.sort_order ?? 0) || a.finance_code.localeCompare(b.finance_code)),
  }))
  const included = new Set(groups.flatMap(group => group.children.map(child => child.id)))
  const unmapped = ledgers.filter(item => item.is_posting && !included.has(item.id))
    .sort((a,b) => a.finance_code.localeCompare(b.finance_code))
  if (unmapped.length) groups.push({
    category: { ...unmapped[0], id: 'unmapped', finance_code: 'UNMAPPED', standard_description: 'Uncategorised — catalogue review required', is_posting: false, parent_ledger_id: null, sort_order: Number.MAX_SAFE_INTEGER } as T,
    children: unmapped,
  })
  return groups
}

export function sumCategoryAmounts<T extends GroupLedger>(
  group: LedgerGroup<T>, sectionIds: string[], amounts: Record<string,string>,
): number {
  return sectionIds.reduce((total, sectionId) =>
    total + group.children.reduce((sum, ledger) => sum + Number(amounts[`${sectionId}:${ledger.id}`] || 0), 0), 0)
}
