import { NextResponse, type NextRequest } from 'next/server'
import { createRequestSupabaseClient, getServerAccessContext } from '@/lib/rbac/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const context = await getServerAccessContext(request)
  if (!context) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }

  const supabase = createRequestSupabaseClient(request)
  const { data, error } = await supabase
    .from('system_settings')
    .select('setting_value')
    .eq('setting_key', 'organization')
    .maybeSingle()

  if (error) {
    console.error('Unable to load organization settings:', error)
    return NextResponse.json({ error: 'Unable to load organization settings' }, { status: 500 })
  }

  return NextResponse.json({ organization: data?.setting_value || {} })
}
