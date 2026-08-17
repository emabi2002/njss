import { NextResponse, type NextRequest } from 'next/server'
import { requirePermission } from '@/lib/rbac/server'

function supabaseProjectRef() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    if (!url) return null
    return new URL(url).hostname.split('.')[0] || null
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const guard = await requirePermission(request, ['operations.view', 'operations.manage', 'settings.manage', 'all'])
  if (guard.response) return guard.response

  return NextResponse.json({
    commitSha: process.env.NEXT_PUBLIC_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'Not Available',
    buildTime: process.env.NEXT_PUBLIC_BUILD_TIME || process.env.BUILD_TIME || null,
    environment: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || 'unknown',
    supabaseProjectRef: supabaseProjectRef(),
    phase: 'System Assurance & UAT',
  })
}
