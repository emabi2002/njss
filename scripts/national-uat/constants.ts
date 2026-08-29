export const DATASET_VERSION = 'NJSS-NATIONAL-UAT-2026-V1' as const
export const EXPECTED_PROJECT_REF = 'qzsmmalfeinoagvronpb' as const
export const RUN_ID_PREFIX = 'UAT-2026-V1' as const

export function runIdFor(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error('runIdFor requires a valid Date')
  const yyyy = date.getUTCFullYear().toString().padStart(4, '0')
  const mm = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = date.getUTCDate().toString().padStart(2, '0')
  return `${RUN_ID_PREFIX}-${yyyy}${mm}${dd}`
}
