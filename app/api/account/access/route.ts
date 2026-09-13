import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, getServerAccessContext } from '@/lib/rbac/server'
import type { RbacMenuItem, RbacModule } from '@/lib/rbac/types'

export const dynamic = 'force-dynamic'

function menuAllowed(permissions: string[], required: string[] | null | undefined) {
  if (permissions.includes('all')) return true
  if (!required?.length) return true
  return required.some((permission) => permissions.includes(permission))
}

export async function GET(request: NextRequest) {
  const context = await getServerAccessContext(request)
  if (!context) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const supabase = createRequestSupabaseClient(request)
  const [menuResult, moduleResult] = await Promise.all([
    supabase
      .from('menu_items')
      .select('code, module_code, parent_code, label, href, icon, sort_order, required_permissions, is_active')
      .eq('is_active', true)
      .order('sort_order'),
    supabase
      .from('modules')
      .select('code, name, description, base_path, icon, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order'),
  ])

  if (menuResult.error || moduleResult.error) {
    console.error('Unable to load server RBAC navigation:', menuResult.error || moduleResult.error)
    return NextResponse.json({ error: 'Unable to load account navigation' }, { status: 500 })
  }

  const menus = ((menuResult.data || []) as RbacMenuItem[]).filter((menu) =>
    menuAllowed(context.permissions, menu.required_permissions),
  )
  const modules = (moduleResult.data || []) as RbacModule[]

  return NextResponse.json({
    userId: context.userId,
    authUserId: context.authUserId,
    email: context.email,
    name: context.name,
    roles: context.roles,
    roleNames: context.roleNames,
    permissions: context.permissions,
    scopes: context.scopes,
    departmentId: context.departmentId,
    sectionId: context.sectionId,
    menus,
    modules,
  })
}
