import { NextResponse, type NextRequest } from 'next/server'
import { getServerAccessContext } from '@/lib/rbac/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await getServerAccessContext(request)
  if (!context) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

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
  })
}
