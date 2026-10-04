import { NextResponse } from 'next/server'

/** Legacy budget mutations are retired; annual budget RPCs are authoritative. */
export async function POST() {
  return NextResponse.json({
    error: 'The legacy budget workflow is retired. Use the Head Office annual budget workspace.',
    code: 'LEGACY_BUDGET_RETIRED',
    replacement: '/dashboard/budget/activation',
  }, { status: 410 })
}
