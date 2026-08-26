import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || ''

/**
 * Privileged user-account writes run in a JWT-protected Supabase Edge Function.
 * The browser's NJSS access token is forwarded so the function can independently
 * verify the caller and their `users.manage` permission before using service-role
 * authority. No service-role credential is required or exposed by Netlify here.
 */
export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Supabase application configuration is unavailable.' }, { status: 500 })
  }

  const authorization = request.headers.get('authorization')?.trim() || ''
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/njss-admin-users`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const text = await response.text()
    return new NextResponse(text || null, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/json',
      },
    })
  } catch (error) {
    console.error('User administration Edge Function request failed:', error)
    return NextResponse.json({ error: 'Unable to reach the user administration service.' }, { status: 502 })
  }
}
