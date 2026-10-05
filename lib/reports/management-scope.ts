import type { UserAccessContext } from '@/lib/rbac/types'
import { createRequestSupabaseClient } from '@/lib/rbac/server'

export type ManagementReportScope = {
  mode: 'SYSTEM' | 'SECTION'
  label: string
  departmentId: string | null
  sectionId: string | null
  province: { id: string; name: string } | null
  courtLocation: { id: string; name: string } | null
  department: { id: string; name: string } | null
  section: { id: string; name: string } | null
}

type RequestSupabaseClient = ReturnType<typeof createRequestSupabaseClient>

function hasSystemWideScope(context: UserAccessContext) {
  return context.permissions.includes('all')
    || context.scopes.some((scope) => scope.scope_type === 'SYSTEM_WIDE')
    || context.roleNames.includes('Registrar')
    || context.roleNames.includes('Payment/Reconciliation Officer')
}

export async function resolveManagementReportScope(
  supabase: RequestSupabaseClient,
  context: UserAccessContext,
): Promise<ManagementReportScope> {
  if (hasSystemWideScope(context)) {
    return {
      mode: 'SYSTEM',
      label: 'Head Office — All Divisions & Sections',
      departmentId: null,
      sectionId: null,
      province: null,
      courtLocation: null,
      department: null,
      section: null,
    }
  }

  if (!context.sectionId || !context.departmentId) {
    throw new Error('Reporting user has no enforceable organisational scope.')
  }

  const [sectionResult, departmentResult] = await Promise.all([
    supabase
      .from('sections')
      .select('id, name, department_id').eq('is_active', true)
      .eq('id', context.sectionId)
      .maybeSingle(),
    supabase
      .from('departments')
      .select('id, name, court_location_id').eq('is_active', true)
      .eq('id', context.departmentId)
      .maybeSingle(),
  ])

  if (sectionResult.error) throw sectionResult.error
  if (departmentResult.error) throw departmentResult.error

  const section = sectionResult.data
  const department = departmentResult.data
  if (!section || !department || section.department_id !== department.id) {
    throw new Error('Assigned reporting Section is not valid for the assigned Department.')
  }

  const locationResult = await supabase.from('court_locations')
    .select('id, name').eq('id', department.court_location_id || '')
    .eq('location_type', 'HEADQUARTERS').eq('is_active', true).maybeSingle()
  if (locationResult.error) throw locationResult.error
  const courtLocation = locationResult.data
  if (!courtLocation) throw new Error('Reporting assignment is outside active Head Office scope.')
  const label = ['Head Office', department.name, section.name].join(' › ')

  return {
    mode: 'SECTION',
    label: label || `${department.name} › ${section.name}`,
    departmentId: department.id,
    sectionId: section.id,
    province: null,
    courtLocation: courtLocation ? { id: courtLocation.id, name: courtLocation.name } : null,
    department: { id: department.id, name: department.name },
    section: { id: section.id, name: section.name },
  }
}
