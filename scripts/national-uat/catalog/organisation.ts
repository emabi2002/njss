export type Provenance = 'OFFICIAL' | 'DERIVED' | 'UAT'
export type CourtLocationType = 'HEADQUARTERS' | 'NATIONAL_COURT_REGISTRY' | 'NATIONAL_COURT_SUB_REGISTRY'

export type ProvinceSeed = {
  code: string
  name: string
  provenance: 'OFFICIAL'
}

export type CourtLocationSeed = {
  code: string
  provinceCode: string
  name: string
  town: string
  locationType: CourtLocationType
  isHeadquarters: boolean
  provenance: 'OFFICIAL'
}

export type FunctionalSectionTemplate = {
  code: string
  name: string
  provenance: 'DERIVED' | 'UAT'
}

export type FunctionalUnitTemplate = {
  code: string
  name: string
  provenance: 'DERIVED' | 'UAT'
  sections: readonly FunctionalSectionTemplate[]
}

const sections = (
  items: ReadonlyArray<readonly [code: string, name: string, provenance?: 'DERIVED' | 'UAT']>,
): readonly FunctionalSectionTemplate[] =>
  items.map(([code, name, provenance = 'DERIVED']) => ({ code, name, provenance }))

export const PROVINCES: readonly ProvinceSeed[] = [
  { code: 'NCD', name: 'National Capital District', provenance: 'OFFICIAL' },
  { code: 'CEN', name: 'Central Province', provenance: 'OFFICIAL' },
  { code: 'GUL', name: 'Gulf Province', provenance: 'OFFICIAL' },
  { code: 'WES', name: 'Western Province', provenance: 'OFFICIAL' },
  { code: 'MBA', name: 'Milne Bay Province', provenance: 'OFFICIAL' },
  { code: 'ORO', name: 'Oro / Northern Province', provenance: 'OFFICIAL' },
  { code: 'MOR', name: 'Morobe Province', provenance: 'OFFICIAL' },
  { code: 'MAD', name: 'Madang Province', provenance: 'OFFICIAL' },
  { code: 'ESP', name: 'East Sepik Province', provenance: 'OFFICIAL' },
  { code: 'SAN', name: 'Sandaun / West Sepik Province', provenance: 'OFFICIAL' },
  { code: 'EHP', name: 'Eastern Highlands Province', provenance: 'OFFICIAL' },
  { code: 'SIM', name: 'Simbu Province', provenance: 'OFFICIAL' },
  { code: 'WHP', name: 'Western Highlands Province', provenance: 'OFFICIAL' },
  { code: 'JWK', name: 'Jiwaka Province', provenance: 'OFFICIAL' },
  { code: 'ENG', name: 'Enga Province', provenance: 'OFFICIAL' },
  { code: 'SHP', name: 'Southern Highlands Province', provenance: 'OFFICIAL' },
  { code: 'HEL', name: 'Hela Province', provenance: 'OFFICIAL' },
  { code: 'ENB', name: 'East New Britain Province', provenance: 'OFFICIAL' },
  { code: 'WNB', name: 'West New Britain Province', provenance: 'OFFICIAL' },
  { code: 'NIR', name: 'New Ireland Province', provenance: 'OFFICIAL' },
  { code: 'MAN', name: 'Manus Province', provenance: 'OFFICIAL' },
  { code: 'ARB', name: 'Autonomous Region of Bougainville', provenance: 'OFFICIAL' },
] as const

export const COURT_LOCATIONS: readonly CourtLocationSeed[] = [
  { code: 'NCD-WGN', provinceCode: 'NCD', name: 'Waigani Headquarters', town: 'Waigani', locationType: 'HEADQUARTERS', isHeadquarters: true, provenance: 'OFFICIAL' },
  { code: 'CEN-KWL', provinceCode: 'CEN', name: 'Kwikila National Court Registry', town: 'Kwikila', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'CEN-BER', provinceCode: 'CEN', name: 'Bereina National Court Registry', town: 'Bereina', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'GUL-KER', provinceCode: 'GUL', name: 'Kerema National Court Registry', town: 'Kerema', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'WES-DAR', provinceCode: 'WES', name: 'Daru National Court Registry', town: 'Daru', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'WES-TKI', provinceCode: 'WES', name: 'Tabubil / Kiunga National Court Sub-Registry', town: 'Tabubil / Kiunga', locationType: 'NATIONAL_COURT_SUB_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'MBA-ALO', provinceCode: 'MBA', name: 'Alotau National Court Registry', town: 'Alotau', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'ORO-POP', provinceCode: 'ORO', name: 'Popondetta National Court Registry', town: 'Popondetta', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'MOR-LAE', provinceCode: 'MOR', name: 'Lae National Court Registry', town: 'Lae', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'MAD-MAD', provinceCode: 'MAD', name: 'Madang National Court Registry', town: 'Madang', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'ESP-WEW', provinceCode: 'ESP', name: 'Wewak National Court Registry', town: 'Wewak', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'SAN-VAN', provinceCode: 'SAN', name: 'Vanimo National Court Registry', town: 'Vanimo', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'EHP-GOR', provinceCode: 'EHP', name: 'Goroka National Court Registry', town: 'Goroka', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'EHP-KAI', provinceCode: 'EHP', name: 'Kainantu National Court Registry', town: 'Kainantu', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'SIM-KUN', provinceCode: 'SIM', name: 'Kundiawa National Court Registry', town: 'Kundiawa', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'WHP-MHG', provinceCode: 'WHP', name: 'Mt Hagen National Court Registry', town: 'Mt Hagen', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'JWK-MIN', provinceCode: 'JWK', name: 'Minj National Court Registry', town: 'Minj', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'ENG-WAB', provinceCode: 'ENG', name: 'Wabag National Court Registry', town: 'Wabag', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'SHP-MEN', provinceCode: 'SHP', name: 'Mendi National Court Registry', town: 'Mendi', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'HEL-TAR', provinceCode: 'HEL', name: 'Tari National Court Registry', town: 'Tari', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'ENB-KOK', provinceCode: 'ENB', name: 'Kokopo National Court Registry', town: 'Kokopo', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'WNB-KIM', provinceCode: 'WNB', name: 'Kimbe National Court Registry', town: 'Kimbe', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'WNB-BIA', provinceCode: 'WNB', name: 'Bialla National Court Sub-Registry', town: 'Bialla', locationType: 'NATIONAL_COURT_SUB_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'NIR-KAV', provinceCode: 'NIR', name: 'Kavieng National Court Registry', town: 'Kavieng', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'NIR-LIH', provinceCode: 'NIR', name: 'Lihir National Court Registry', town: 'Lihir', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'MAN-LOR', provinceCode: 'MAN', name: 'Manus / Lorengau National Court Registry', town: 'Lorengau', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'ARB-BUK', provinceCode: 'ARB', name: 'Buka National Court Registry', town: 'Buka', locationType: 'NATIONAL_COURT_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
  { code: 'ARB-ARA', provinceCode: 'ARB', name: 'Arawa National Court Sub-Registry', town: 'Arawa', locationType: 'NATIONAL_COURT_SUB_REGISTRY', isHeadquarters: false, provenance: 'OFFICIAL' },
] as const

export const WAIGANI_FUNCTIONS: readonly FunctionalUnitTemplate[] = [
  { code: 'EXE', name: 'Office of the Secretary / Executive Management', provenance: 'DERIVED', sections: sections([['EXEC', 'Executive Support'], ['PLN', 'Policy & Planning'], ['PERF', 'Corporate Performance']]) },
  { code: 'REG', name: 'Registry Services', provenance: 'DERIVED', sections: sections([['SUP', 'Supreme Court Registry'], ['CIV', 'Civil Registry'], ['CRI', 'Criminal Registry'], ['FIL', 'Filing & Counter'], ['CT1', 'Court Track 1'], ['CT2', 'Court Track 2'], ['CT3', 'Court Track 3'], ['COM', 'Commercial Track'], ['HRT', 'Human Rights Track'], ['ARV', 'Appeals & Review'], ['ADR', 'Alternative Dispute Resolution'], ['ELP', 'Election Petitions']]) },
  { code: 'SHF', name: 'Sheriff Services', provenance: 'DERIVED', sections: sections([['PRS', 'Process Service'], ['ENF', 'Enforcement'], ['EXE', 'Execution & Auction']]) },
  { code: 'JSS', name: 'Judicial Support Services', provenance: 'DERIVED', sections: sections([['CHM', 'Judges Chambers'], ['ASS', 'Judges Associates'], ['SEC', 'Secretarial Support'], ['CIR', 'Circuit Support']]) },
  { code: 'CRS', name: 'Court Reporting Service', provenance: 'DERIVED', sections: sections([['REP', 'Court Reporting'], ['TECH', 'Technical Services'], ['TRN', 'Transcript & Records']]) },
  { code: 'FIN', name: 'Finance Division', provenance: 'DERIVED', sections: sections([['BUD', 'Budget'], ['ACC', 'Accounts'], ['AP', 'Accounts Payable'], ['REV', 'Revenue'], ['REC', 'Reconciliation'], ['RPT', 'Financial Reporting']]) },
  { code: 'HR', name: 'Human Resources', provenance: 'DERIVED', sections: sections([['ODR', 'Organisational Development & Recruitment'], ['PAY', 'Salary & Payroll Administration'], ['IRW', 'Industrial Relations & Staff Welfare'], ['TRN', 'Training & Development'], ['HRA', 'HR Records & Personnel Administration']]) },
  { code: 'ICT', name: 'Information Technology', provenance: 'DERIVED', sections: sections([['SYS', 'Systems Administration'], ['NET', 'Networks & Infrastructure'], ['DB', 'Database Administration'], ['CMS', 'Case Management Systems'], ['DEV', 'Website & Systems Development'], ['HLP', 'User Support & Helpdesk']]) },
  { code: 'INF', name: 'Infrastructure & Facilities', provenance: 'DERIVED', sections: sections([['CAP', 'Capital Works'], ['MNT', 'Building Maintenance'], ['HOU', 'Judicial Housing'], ['FAC', 'Facilities Management']]) },
  { code: 'PRO', name: 'Procurement & Contracts', provenance: 'DERIVED', sections: sections([['PLN', 'Procurement Planning'], ['TND', 'Tendering'], ['CON', 'Contract Administration'], ['STR', 'Stores & Supply']]) },
  { code: 'LEG', name: 'Legal Services', provenance: 'DERIVED', sections: sections([['ADV', 'Legal Advisory'], ['LIT', 'Litigation'], ['CTR', 'Contracts & Legal Review']]) },
  { code: 'AUD', name: 'Internal Audit', provenance: 'DERIVED', sections: sections([['FIN', 'Financial Audit'], ['COM', 'Compliance Audit'], ['OPS', 'Operational Audit']]) },
  { code: 'LIB', name: 'Library, Research & Records', provenance: 'DERIVED', sections: sections([['LIB', 'Court Library'], ['RSH', 'Legal Research'], ['ARC', 'Archives & Records']]) },
  { code: 'SEC', name: 'Security Services', provenance: 'DERIVED', sections: sections([['CRT', 'Court Security'], ['ACC', 'Access Control'], ['JUD', 'Judicial Security Coordination']]) },
  { code: 'ADM', name: 'Corporate Administration', provenance: 'DERIVED', sections: sections([['FLT', 'Fleet & Transport'], ['TRV', 'Travel Administration'], ['AST', 'Asset Management'], ['GEN', 'General Administration'], ['LOG', 'Logistics']]) },
] as const

export const PROVINCIAL_TEMPLATE: readonly FunctionalUnitTemplate[] = [
  { code: 'REG', name: 'Registry Services', provenance: 'DERIVED', sections: sections([['FIL', 'Filing & Counter'], ['CIV', 'Civil Registry'], ['CRI', 'Criminal Registry'], ['CRT', 'Courtroom & Interpreting']]) },
  { code: 'JSS', name: 'Judicial Support', provenance: 'DERIVED', sections: sections([['CHM', 'Judges Chambers & Private Staff'], ['CIR', 'Circuit Support']]) },
  { code: 'CRS', name: 'Court Reporting', provenance: 'DERIVED', sections: sections([['REC', 'Court Recording'], ['TRL', 'Transcript Liaison']]) },
  { code: 'SHF', name: 'Sheriff Services', provenance: 'DERIVED', sections: sections([['PRS', 'Process Service'], ['ENF', 'Enforcement']]) },
  { code: 'ADM', name: 'Provincial Administration', provenance: 'DERIVED', sections: sections([['FIN', 'Administration & Finance'], ['HRA', 'HR & Staff Administration'], ['TRF', 'Transport & Facilities']]) },
  { code: 'SEC', name: 'Security', provenance: 'DERIVED', sections: sections([['ACC', 'Court Security & Access']]) },
  { code: 'ICT', name: 'ICT Support', provenance: 'DERIVED', sections: sections([['SUP', 'Local ICT & User Support']]) },
  { code: 'LIB', name: 'Library', provenance: 'DERIVED', sections: sections([['LIB', 'Court Library']]) },
] as const

export const SUBREGISTRY_TEMPLATE: readonly FunctionalUnitTemplate[] = [
  { code: 'REG', name: 'Registry Services', provenance: 'DERIVED', sections: sections([['FIL', 'Filing & Counter'], ['CRT', 'Courtroom & Interpreting']]) },
  { code: 'SHF', name: 'Sheriff / Process Service', provenance: 'DERIVED', sections: sections([['PRS', 'Process Service']]) },
  { code: 'ADM', name: 'Sub-Registry Administration', provenance: 'DERIVED', sections: sections([['GEN', 'Administration'], ['TRF', 'Transport & Facilities']]) },
  { code: 'SEC', name: 'Security', provenance: 'DERIVED', sections: sections([['ACC', 'Court Security & Access']]) },
  { code: 'ICT', name: 'Shared ICT Support', provenance: 'UAT', sections: sections([['SUP', 'Shared ICT & User Support', 'UAT']]) },
] as const
