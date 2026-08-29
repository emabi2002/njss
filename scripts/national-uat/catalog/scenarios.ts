import { COURT_LOCATIONS } from './organisation'

export type BudgetTier = 'H' | 'T1' | 'T2' | 'T3'
export type MonthlyProfileName = 'EVEN' | 'TRAVEL' | 'TRAINING' | 'EQUIPMENT' | 'MAINTENANCE'

const TIER_ONE_LOCATIONS = new Set(['MOR-LAE', 'WHP-MHG', 'ENB-KOK', 'ESP-WEW', 'MAD-MAD', 'EHP-GOR'])

export const BUDGET_TIERS: Readonly<Record<string, BudgetTier>> = Object.freeze(
  Object.fromEntries(
    COURT_LOCATIONS.map((location) => [
      location.code,
      location.locationType === 'HEADQUARTERS'
        ? 'H'
        : location.locationType === 'NATIONAL_COURT_SUB_REGISTRY'
          ? 'T3'
          : TIER_ONE_LOCATIONS.has(location.code)
            ? 'T1'
            : 'T2',
    ]),
  ) as Record<string, BudgetTier>,
)

export const MONTHLY_PROFILES: Readonly<Record<MonthlyProfileName, readonly number[]>> = Object.freeze({
  EVEN: [833, 833, 834, 833, 833, 834, 833, 833, 834, 833, 833, 834],
  TRAVEL: [500, 700, 1000, 900, 1000, 1100, 900, 800, 1100, 800, 700, 500],
  TRAINING: [200, 300, 500, 1200, 1400, 600, 500, 600, 1400, 900, 600, 1800],
  EQUIPMENT: [200, 300, 500, 900, 1800, 1600, 900, 500, 700, 900, 1000, 700],
  MAINTENANCE: [500, 600, 700, 800, 900, 1000, 1000, 1000, 1100, 900, 800, 700],
})

export type FundingSourceScenario = {
  code: string
  name: string
  sourceType: string
  provenance: 'UAT'
}

export const FUNDING_SOURCES: readonly FundingSourceScenario[] = [
  { code: 'UAT-GOV-REC', name: 'Government Recurrent Funding — UAT', sourceType: 'GOVERNMENT_RECURRENT', provenance: 'UAT' },
  { code: 'UAT-GOV-PIP', name: 'Government Development / PIP — UAT', sourceType: 'GOVERNMENT_DEVELOPMENT', provenance: 'UAT' },
  { code: 'UAT-DP', name: 'Development Partner Funding — UAT', sourceType: 'DEVELOPMENT_PARTNER', provenance: 'UAT' },
  { code: 'UAT-SPF', name: 'Special Purpose Funding — UAT', sourceType: 'SPECIAL_PURPOSE', provenance: 'UAT' },
  { code: 'UAT-OTH', name: 'Other Approved Funding — UAT', sourceType: 'OTHER', provenance: 'UAT' },
] as const

export type SupplierScenarioStatus = 'PENDING' | 'VERIFIED' | 'APPROVED' | 'SUSPENDED' | 'REJECTED' | 'INCOMPLETE'
export type SupplierScenario = {
  code: string
  name: string
  category: string
  status: SupplierScenarioStatus
  homeLocationCode: string
  provenance: 'UAT'
}

export const SUPPLIER_SCENARIOS: readonly SupplierScenario[] = [
  { code: 'UAT-SUP-001', name: 'Pacific Office Supplies PNG Ltd — UAT', category: 'OFFICE_SUPPLIES', status: 'APPROVED', homeLocationCode: 'NCD-WGN', provenance: 'UAT' },
  { code: 'UAT-SUP-002', name: 'Island ICT Solutions Ltd — UAT', category: 'ICT', status: 'APPROVED', homeLocationCode: 'NCD-WGN', provenance: 'UAT' },
  { code: 'UAT-SUP-003', name: 'Judiciary Travel Services Ltd — UAT', category: 'TRAVEL', status: 'VERIFIED', homeLocationCode: 'NCD-WGN', provenance: 'UAT' },
  { code: 'UAT-SUP-004', name: 'Capital Facilities Maintenance Ltd — UAT', category: 'MAINTENANCE', status: 'APPROVED', homeLocationCode: 'NCD-WGN', provenance: 'UAT' },
  { code: 'UAT-SUP-005', name: 'Highlands Fleet Services Ltd — UAT', category: 'VEHICLE', status: 'APPROVED', homeLocationCode: 'WHP-MHG', provenance: 'UAT' },
  { code: 'UAT-SUP-006', name: 'Morobe Registry Supplies Ltd — UAT', category: 'OFFICE_SUPPLIES', status: 'APPROVED', homeLocationCode: 'MOR-LAE', provenance: 'UAT' },
  { code: 'UAT-SUP-007', name: 'Sepik Court Technology Ltd — UAT', category: 'ICT', status: 'APPROVED', homeLocationCode: 'ESP-WEW', provenance: 'UAT' },
  { code: 'UAT-SUP-008', name: 'East New Britain Training Services — UAT', category: 'TRAINING', status: 'VERIFIED', homeLocationCode: 'ENB-KOK', provenance: 'UAT' },
  { code: 'UAT-SUP-009', name: 'Milne Bay Facilities Services Ltd — UAT', category: 'MAINTENANCE', status: 'APPROVED', homeLocationCode: 'MBA-ALO', provenance: 'UAT' },
  { code: 'UAT-SUP-010', name: 'Hela Fleet & Fuel Services Ltd — UAT', category: 'VEHICLE', status: 'APPROVED', homeLocationCode: 'HEL-TAR', provenance: 'UAT' },
  { code: 'UAT-SUP-011', name: 'Bougainville Registry Services Ltd — UAT', category: 'OFFICE_SUPPLIES', status: 'APPROVED', homeLocationCode: 'ARB-BUK', provenance: 'UAT' },
  { code: 'UAT-SUP-012', name: 'National Legal Publishing Services — UAT', category: 'LEGAL_PUBLICATIONS', status: 'PENDING', homeLocationCode: 'NCD-WGN', provenance: 'UAT' },
  { code: 'UAT-SUP-013', name: 'Court Security Equipment PNG — UAT', category: 'SECURITY', status: 'VERIFIED', homeLocationCode: 'NCD-WGN', provenance: 'UAT' },
  { code: 'UAT-SUP-014', name: 'Regional Printing & Forms Ltd — UAT', category: 'PRINTING', status: 'INCOMPLETE', homeLocationCode: 'MOR-LAE', provenance: 'UAT' },
  { code: 'UAT-SUP-015', name: 'Highlands Building Works Ltd — UAT', category: 'MAINTENANCE', status: 'SUSPENDED', homeLocationCode: 'WHP-MHG', provenance: 'UAT' },
  { code: 'UAT-SUP-016', name: 'Coastal Administrative Supplies Ltd — UAT', category: 'OFFICE_SUPPLIES', status: 'REJECTED', homeLocationCode: 'MBA-ALO', provenance: 'UAT' },
  { code: 'UAT-SUP-017', name: 'National Court Recording Systems Ltd — UAT', category: 'COURT_REPORTING', status: 'APPROVED', homeLocationCode: 'ESP-WEW', provenance: 'UAT' },
  { code: 'UAT-SUP-018', name: 'PNG Judicial Workshop Services — UAT', category: 'TRAINING', status: 'APPROVED', homeLocationCode: 'NCD-WGN', provenance: 'UAT' },
] as const

export type TransactionScenario = {
  code: string
  locationCode: string
  description: string
  financeCodes: readonly string[]
  expectedWorkflowCoverage: readonly string[]
}

export const TRANSACTION_SCENARIOS: readonly TransactionScenario[] = [
  {
    code: 'UAT-TXN-WGN',
    locationCode: 'NCD-WGN',
    description: 'Complete headquarters chain including ICT equipment, Registry supplies, circuit travel, maintenance, training, Sheriff operations and budget revisions.',
    financeCodes: ['271-02', '223-01', '227-02', '233-01', '228-01', '224-03'],
    expectedWorkflowCoverage: ['FF3', 'COMMITMENT', 'FF4', 'PAYMENT', 'RECONCILIATION', 'SUPPLEMENTARY', 'VIREMENT', 'REFORECAST', 'REDUCTION'],
  },
  {
    code: 'UAT-TXN-LAE',
    locationCode: 'MOR-LAE',
    description: 'Registry supplies, judicial circuit travel and Sheriff vehicle/fuel with a complete FF3-to-FF4 chain.',
    financeCodes: ['223-01', '227-02', '225-01'],
    expectedWorkflowCoverage: ['FF3', 'COMMITMENT', 'FF4', 'PAYMENT'],
  },
  {
    code: 'UAT-TXN-MHG',
    locationCode: 'WHP-MHG',
    description: 'Courthouse maintenance, fuel, vehicle operating costs and operational materials including an attempted budget overrun.',
    financeCodes: ['233-01', '225-01', '225-02', '224-01'],
    expectedWorkflowCoverage: ['FF3', 'BUDGET_OVERRUN_REJECTION'],
  },
  {
    code: 'UAT-TXN-WEW',
    locationCode: 'ESP-WEW',
    description: 'Court Reporting equipment, ICT support and quotation comparison.',
    financeCodes: ['271-03', '271-02', '223-01'],
    expectedWorkflowCoverage: ['FF3', 'QUOTATION_COMPARISON', 'COMMITMENT', 'FF4'],
  },
  {
    code: 'UAT-TXN-KOK',
    locationCode: 'ENB-KOK',
    description: 'Staff training, travel and supplier lifecycle workflow.',
    financeCodes: ['228-01', '221-01', '221-02'],
    expectedWorkflowCoverage: ['SUPPLIER', 'FF3', 'COMMITMENT', 'FF4'],
  },
  {
    code: 'UAT-TXN-ALO',
    locationCode: 'MBA-ALO',
    description: 'Utilities, facilities maintenance and routine FF3/FF4 processing.',
    financeCodes: ['231-01', '231-02', '233-01'],
    expectedWorkflowCoverage: ['FF3', 'COMMITMENT', 'FF4', 'RECONCILIATION'],
  },
  {
    code: 'UAT-TXN-TAR',
    locationCode: 'HEL-TAR',
    description: 'Urgent operational expenditure, judicial travel and vehicle/fuel including insufficient-funding validation.',
    financeCodes: ['227-01', '227-02', '225-01'],
    expectedWorkflowCoverage: ['FF3', 'FUNDING_CONTROL', 'INSUFFICIENT_FUNDS_REJECTION'],
  },
  {
    code: 'UAT-TXN-BUK',
    locationCode: 'ARB-BUK',
    description: 'Registry operations, circuit support, funding allocation and regional reporting.',
    financeCodes: ['223-03', '227-02', '227-01'],
    expectedWorkflowCoverage: ['FUNDING', 'FF3', 'COMMITMENT', 'FF4', 'REPORTING'],
  },
] as const
