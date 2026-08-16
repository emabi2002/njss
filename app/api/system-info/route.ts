import { NextResponse } from 'next/server'

function supabaseProjectRef() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    if (!url) return null
    return new URL(url).hostname.split('.')[0] || null
  } catch {
    return null
  }
}

export async function GET() {
  return NextResponse.json({
    commitSha: process.env.NEXT_PUBLIC_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_SHA || 'local',
    buildTime: process.env.NEXT_PUBLIC_BUILD_TIME || process.env.BUILD_TIME || null,
    environment: process.env.NEXT_PUBLIC_APP_ENV || process.env.NODE_ENV || 'unknown',
    supabaseProjectRef: supabaseProjectRef(),
    phase: 'Phase 1 funding remediation',
  })
}
