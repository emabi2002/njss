import { NextResponse, type NextRequest } from 'next/server'

// TESTING MODE: Authentication disabled for testing
// To re-enable auth, restore the original middleware code

export async function middleware(request: NextRequest) {
  // Allow all routes without authentication for testing
  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - api routes
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$|api).*)',
  ],
}
