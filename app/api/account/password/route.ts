import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, getServerAccessContext } from '@/lib/rbac/server'
import { validatePassword } from '@/lib/password'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || ''

/**
 * Reports whether the signed-in user is still holding an administrator-issued
 * password and must go through the Set New Password screen.
 */
export async function GET(request: NextRequest) {
  const context = await getServerAccessContext(request)
  if (!context) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

  const client = createRequestSupabaseClient(request)
  const { data, error } = await client
    .from('users')
    .select('must_change_password')
    .eq('id', context.userId)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ mustChangePassword: Boolean(data?.must_change_password) })
}

/**
 * Proxies the signed-in user's first-login password change to the dedicated
 * Supabase Edge Function. The caller JWT is forwarded unchanged so the Edge
 * Function can independently verify identity. Netlify never needs the service
 * role credential for this self-service operation.
 */
export async function POST(request: NextRequest) {
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Supabase application configuration is unavailable.' }, { status: 500 })
  }

  const authorization = request.headers.get('authorization')?.trim() || ''
  if (!/^Bearer\s+\S+/i.test(authorization)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  let body: { password?: string; confirmPassword?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const password = body.password || ''
  const errors = validatePassword(password, body.confirmPassword)
  if (errors.length) {
    return NextResponse.json({ error: errors[0], errors }, { status: 400 })
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/njss-self-password`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password, confirmPassword: body.confirmPassword }),
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
    console.error('Self-service password Edge Function request failed:', error)
    return NextResponse.json({ error: 'Unable to reach the password service. Please try again.' }, { status: 502 })
  }
}
