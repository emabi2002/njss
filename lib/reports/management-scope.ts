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
      label: 'National Judiciary — All Provinces & Court Locations',
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
      .select('id, name, department_id')
      .eq('id', context.sectionId)
      .maybeSingle(),
    supabase
      .from('departments')
      .select('id, name, court_location_id')
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

  let courtLocation: { id: string; name: string; province_id: string | null } | null = null
  let province: { id: string; name: string } | null = null

  if (department.court_location_id) {
    const locationResult = await supabase
      .from('court_locations')
      .select('id, name, province_id')
      .eq('id', department.court_location_id)
      .maybeSingle()
    if (locationResult.error) throw locationResult.error
    courtLocation = locationResult.data

    if (courtLocation?.province_id) {
      const provinceResult = await supabase
        .from('provinces')
        .select('id, name')
        .eq('id', courtLocation.province_id)
        .maybeSingle()
      if (provinceResult.error) throw provinceResult.error
      province = provinceResult.data
    }
  }

  const label = [province?.name, courtLocation?.name, department.name, section.name]
    .filter(Boolean)
    .join(' › ')

  return {
    mode: 'SECTION',
    label: label || `${department.name} › ${section.name}`,
    departmentId: department.id,
    sectionId: section.id,
    province: province ? { id: province.id, name: province.name } : null,
    courtLocation: courtLocation ? { id: courtLocation.id, name: courtLocation.name } : null,
    department: { id: department.id, name: department.name },
    section: { id: section.id, name: section.name },
  }
}
