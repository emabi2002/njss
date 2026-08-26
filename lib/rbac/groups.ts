export const REQUISITION_OFFICER = 'Requisition Officer' as const
export const LINE_SUPERVISOR = 'Line Supervisor' as const
export const REGISTRAR = 'Registrar' as const
export const PAYMENT_RECONCILIATION_OFFICER = 'Payment/Reconciliation Officer' as const
export const SYSTEM_ADMINISTRATOR = 'System Administrator' as const

export const CONTROLLED_BUSINESS_GROUPS = [
  REQUISITION_OFFICER,
  LINE_SUPERVISOR,
  REGISTRAR,
  PAYMENT_RECONCILIATION_OFFICER,
] as const

export type ControlledBusinessGroup = (typeof CONTROLLED_BUSINESS_GROUPS)[number]

export const SECTION_SCOPED_BUSINESS_GROUPS: readonly ControlledBusinessGroup[] = [
  REQUISITION_OFFICER,
  LINE_SUPERVISOR,
]

export function isControlledBusinessGroup(value: string): value is ControlledBusinessGroup {
  return (CONTROLLED_BUSINESS_GROUPS as readonly string[]).includes(value)
}

export function isSectionScopedBusinessGroup(value: string) {
  return (SECTION_SCOPED_BUSINESS_GROUPS as readonly string[]).includes(value)
}
