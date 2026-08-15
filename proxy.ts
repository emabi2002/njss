import { NextResponse, type NextRequest } from 'next/server'
import { guardDashboardRoute } from './lib/rbac/server'

const RBAC_ENFORCED = process.env.NEXT_PUBLIC_RBAC_ENFORCED === 'true'

export async function proxy(request: NextRequest) {
  if (!RBAC_ENFORCED) return NextResponse.next()

  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    return guardDashboardRoute(request)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
