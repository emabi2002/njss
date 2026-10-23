/** Server-side agency-local authentication. Never import in client components. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'

export type AgencyActor = { id: string; role: string; sectionId: string | null }
export function agencyAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Agency server credentials have not been configured')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}
export async function authenticatedAgencyActor(request: NextRequest, db: SupabaseClient): Promise<AgencyActor | null> {
  const bearer = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') || '')
  if (!bearer) return null
  const { data: { user }, error: authError } = await db.auth.getUser(bearer[1])
  if (authError || !user || user.is_anonymous) return null
  const { data: profile, error } = await db.from('monitor_users')
    .select('auth_user_id,role,section_id,is_active').eq('auth_user_id', user.id).maybeSingle()
  if (error || !profile?.is_active) return null
  return { id: user.id, role: profile.role, sectionId: profile.section_id }
}
export async function documentAccess(db: SupabaseClient, actor: AgencyActor, entity: string, id: string, write: boolean) {
  if (actor.role === 'administrator') return await entityExists(db, entity, id)
  if (entity === 'requisition') {
    const {data} = await db.from('monitor_requisitions').select('requester_id,status').eq('id',id).maybeSingle()
    if (!data) return false
    return write ? data.requester_id === actor.id && data.status === 'DRAFT'
      : data.requester_id === actor.id || ['reviewer','auditor','purchaser'].includes(actor.role)
  }
  if (entity === 'purchase') {
    const {data} = await db.from('monitor_purchases').select('entered_by,requisition_id').eq('id',id).maybeSingle()
    if (!data) return false
    if (write) return actor.role === 'purchaser' && data.entered_by === actor.id
    if (['reviewer','auditor','purchaser','receiver'].includes(actor.role)) return true
    if (data.requisition_id) return documentAccess(db,actor,'requisition',data.requisition_id,false)
    return false
  }
  if (entity === 'expense') {
    const {data} = await db.from('monitor_expense_evidence').select('recorded_by').eq('id',id).maybeSingle()
    if (!data) return false
    return write ? data.recorded_by === actor.id && actor.role === 'purchaser'
      : data.recorded_by === actor.id || ['reviewer','auditor','purchaser'].includes(actor.role)
  }
  return false
}
async function entityExists(db: SupabaseClient, entity: string, id: string) {
  const table = ({requisition:'monitor_requisitions',purchase:'monitor_purchases',expense:'monitor_expense_evidence'} as Record<string,string>)[entity]
  if (!table) return false
  const {data,error} = await db.from(table).select('id').eq('id',id).maybeSingle()
  return !error && Boolean(data)
}
export function safeUuid(x: unknown): x is string { return typeof x==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x) }
export function validateFile(file: File, logo = false): string | null {
  if (file.size < 1 || file.size > (logo? 2:8)*1024*1024) return 'File size exceeds allowed limit'
  if (!(logo? ['image/png','image/jpeg']:['application/pdf','image/png','image/jpeg']).includes(file.type)) return 'Unsupported file type'
  return null
}
export function isValidFileSignature(bytes: Uint8Array, type: string): boolean {
  if (type==='application/pdf') return bytes.length >= 5 && bytes[0]===37 && bytes[1]===80 && bytes[2]===68 && bytes[3]===70 && bytes[4]===45
  if (type==='image/png') return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((x,i)=>bytes[i]===x)
  if (type==='image/jpeg') return bytes.length >= 4 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255
  return false
}
