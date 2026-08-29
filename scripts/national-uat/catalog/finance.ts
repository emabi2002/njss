import type { Provenance } from './organisation'

export type EconomicClassSeed = {
  code: string
  name: string
  provenance: 'OFFICIAL'
  sourceReference: string
}

export type FinanceCodeSeed = {
  code: string
  parentCode: string
  name: string
  provenance: 'UAT'
  monthlyProfile: 'EVEN' | 'TRAVEL' | 'TRAINING' | 'EQUIPMENT' | 'MAINTENANCE'
  applicableFunctions: readonly string[] | 'ALL'
}

const PNG_PUBLIC_FINANCE_SOURCE = 'PNG Department of Finance / Treasury public economic classification material'

export const ECONOMIC_CLASSES: readonly EconomicClassSeed[] = [
  { code: '211', name: 'Salaries and Allowances', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '212', name: 'Wages', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '213', name: 'Overtime', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '214', name: 'Leave Fares', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '215', name: 'Retirement Benefits / Pensions / Gratuities', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '221', name: 'Domestic Travel and Subsistence', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '222', name: 'Travel and Subsistence', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '223', name: 'Office Materials and Supplies', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '224', name: 'Operational Materials and Supplies', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '225', name: 'Transport and Fuel', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '226', name: 'Administrative Consultancy Fees', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '227', name: 'Other Operational Expenses', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '228', name: 'Training', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '231', name: 'Utilities', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '232', name: 'Rental of Property', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '233', name: 'Routine Maintenance', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '251', name: 'Membership / Subscription / Contribution', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
  { code: '271', name: 'Office Equipment, Furniture and Fittings', provenance: 'OFFICIAL', sourceReference: PNG_PUBLIC_FINANCE_SOURCE },
] as const

export const FINANCE_CODES: readonly FinanceCodeSeed[] = [
  { code: '211-01', parentCode: '211', name: 'Salaries — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['EXE', 'REG', 'SHF', 'JSS', 'CRS', 'FIN', 'HR', 'ICT', 'INF', 'PRO', 'LEG', 'AUD', 'LIB', 'SEC', 'ADM'] },
  { code: '211-02', parentCode: '211', name: 'Staff Allowances — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: 'ALL' },
  { code: '212-01', parentCode: '212', name: 'Casual / Auxiliary Wages — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['ADM', 'INF', 'SEC'] },
  { code: '213-01', parentCode: '213', name: 'Approved Overtime — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['REG', 'SHF', 'CRS', 'ICT', 'SEC', 'ADM'] },
  { code: '214-01', parentCode: '214', name: 'Leave Fares — UAT', provenance: 'UAT', monthlyProfile: 'TRAVEL', applicableFunctions: 'ALL' },
  { code: '215-01', parentCode: '215', name: 'Retirement Benefits — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['HR', 'FIN'] },

  { code: '221-01', parentCode: '221', name: 'Domestic Airfares — UAT', provenance: 'UAT', monthlyProfile: 'TRAVEL', applicableFunctions: 'ALL' },
  { code: '221-02', parentCode: '221', name: 'Accommodation & Subsistence — UAT', provenance: 'UAT', monthlyProfile: 'TRAVEL', applicableFunctions: 'ALL' },
  { code: '221-03', parentCode: '221', name: 'Domestic Ground Travel — UAT', provenance: 'UAT', monthlyProfile: 'TRAVEL', applicableFunctions: 'ALL' },
  { code: '222-01', parentCode: '222', name: 'International Airfares — UAT', provenance: 'UAT', monthlyProfile: 'TRAVEL', applicableFunctions: ['EXE', 'JSS', 'ICT', 'HR'] },
  { code: '222-02', parentCode: '222', name: 'Overseas Subsistence — UAT', provenance: 'UAT', monthlyProfile: 'TRAVEL', applicableFunctions: ['EXE', 'JSS', 'ICT', 'HR'] },

  { code: '223-01', parentCode: '223', name: 'Stationery & Office Consumables — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: 'ALL' },
  { code: '223-02', parentCode: '223', name: 'Printing & Copying Supplies — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: 'ALL' },
  { code: '223-03', parentCode: '223', name: 'Legal Forms & Registry Supplies — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['REG', 'JSS', 'LEG'] },

  { code: '224-01', parentCode: '224', name: 'Courtroom Operational Materials — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['REG', 'JSS'] },
  { code: '224-02', parentCode: '224', name: 'Court Reporting Consumables — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['CRS'] },
  { code: '224-03', parentCode: '224', name: 'Sheriff Operational Materials — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['SHF'] },

  { code: '225-01', parentCode: '225', name: 'Vehicle Fuel — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['SHF', 'JSS', 'ADM', 'INF'] },
  { code: '225-02', parentCode: '225', name: 'Vehicle Operating Costs — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['SHF', 'JSS', 'ADM', 'INF'] },
  { code: '225-03', parentCode: '225', name: 'Freight & Transport Services — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['REG', 'PRO', 'ADM', 'INF'] },

  { code: '226-01', parentCode: '226', name: 'Professional Consultancy — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['EXE', 'FIN', 'HR', 'ICT', 'INF', 'LEG', 'AUD'] },
  { code: '226-02', parentCode: '226', name: 'Technical Advisory Services — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['ICT', 'INF', 'CRS'] },

  { code: '227-01', parentCode: '227', name: 'Court Operations — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['REG', 'CRS'] },
  { code: '227-02', parentCode: '227', name: 'Judicial Circuit Support — UAT', provenance: 'UAT', monthlyProfile: 'TRAVEL', applicableFunctions: ['JSS', 'REG'] },
  { code: '227-03', parentCode: '227', name: 'Security Operations — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['SEC', 'SHF'] },
  { code: '227-04', parentCode: '227', name: 'General Administration Operations — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['ADM', 'EXE', 'FIN', 'HR', 'PRO'] },

  { code: '228-01', parentCode: '228', name: 'Staff Training — UAT', provenance: 'UAT', monthlyProfile: 'TRAINING', applicableFunctions: 'ALL' },
  { code: '228-02', parentCode: '228', name: 'Judicial & Administrative Workshops — UAT', provenance: 'UAT', monthlyProfile: 'TRAINING', applicableFunctions: ['JSS', 'REG', 'EXE', 'HR'] },

  { code: '231-01', parentCode: '231', name: 'Electricity — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['ADM', 'INF'] },
  { code: '231-02', parentCode: '231', name: 'Water & Utilities — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['ADM', 'INF'] },
  { code: '231-03', parentCode: '231', name: 'Communications & Internet Utility — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['ICT', 'ADM'] },

  { code: '232-01', parentCode: '232', name: 'Office / Court Facility Rental — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['ADM', 'INF'] },
  { code: '232-02', parentCode: '232', name: 'Leased Judicial / Staff Housing — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['INF', 'ADM'] },

  { code: '233-01', parentCode: '233', name: 'Building Maintenance — UAT', provenance: 'UAT', monthlyProfile: 'MAINTENANCE', applicableFunctions: ['INF', 'ADM'] },
  { code: '233-02', parentCode: '233', name: 'Vehicle Maintenance — UAT', provenance: 'UAT', monthlyProfile: 'MAINTENANCE', applicableFunctions: ['SHF', 'JSS', 'ADM'] },
  { code: '233-03', parentCode: '233', name: 'Equipment Maintenance — UAT', provenance: 'UAT', monthlyProfile: 'MAINTENANCE', applicableFunctions: ['ICT', 'CRS', 'SEC', 'ADM'] },

  { code: '251-01', parentCode: '251', name: 'Professional Subscriptions — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['LIB', 'LEG', 'ICT', 'FIN', 'HR'] },
  { code: '251-02', parentCode: '251', name: 'Institutional Membership & Contributions — UAT', provenance: 'UAT', monthlyProfile: 'EVEN', applicableFunctions: ['EXE', 'JSS'] },

  { code: '271-01', parentCode: '271', name: 'Office Furniture — UAT', provenance: 'UAT', monthlyProfile: 'EQUIPMENT', applicableFunctions: 'ALL' },
  { code: '271-02', parentCode: '271', name: 'Computer & ICT Equipment — UAT', provenance: 'UAT', monthlyProfile: 'EQUIPMENT', applicableFunctions: ['ICT', 'REG', 'CRS', 'FIN', 'HR', 'JSS'] },
  { code: '271-03', parentCode: '271', name: 'Courtroom Equipment — UAT', provenance: 'UAT', monthlyProfile: 'EQUIPMENT', applicableFunctions: ['REG', 'JSS', 'CRS'] },
  { code: '271-04', parentCode: '271', name: 'Recording & Security Equipment — UAT', provenance: 'UAT', monthlyProfile: 'EQUIPMENT', applicableFunctions: ['CRS', 'SEC', 'ICT'] },
] as const

export function financeCodeProvenance(): Provenance {
  return 'UAT'
}
