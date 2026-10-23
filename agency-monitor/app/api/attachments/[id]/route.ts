import { NextRequest,NextResponse } from 'next/server'
import { agencyAdminClient,authenticatedAgencyActor,documentAccess,safeUuid } from '../../../../src/server-auth'
export const runtime='nodejs'
export async function GET(request:NextRequest,ctx:{params:Promise<{id:string}>}) {
  try {
    const {id}=await ctx.params
    if(!safeUuid(id)) return NextResponse.json({error:'Invalid attachment ID'},{status:400})
    const db=agencyAdminClient()
    const actor=await authenticatedAgencyActor(request,db)
    if(!actor) return NextResponse.json({error:'Authentication required'},{status:401})
    const {data:record,error}=await db.from('monitor_documents').select('entity_type,entity_id,object_path').eq('id',id).maybeSingle()
    if(error||!record) return NextResponse.json({error:'Not found'},{status:404})
    if(!await documentAccess(db,actor,record.entity_type,record.entity_id,false)) return NextResponse.json({error:'Not authorised'},{status:403})
    const {data,error:signError}=await db.storage.from('monitor-evidence').createSignedUrl(record.object_path,60)
    if(signError||!data?.signedUrl) return NextResponse.json({error:'Attachment unavailable'},{status:500})
    return NextResponse.json({url:data.signedUrl,expiresIn:60},{headers:{'Cache-Control':'no-store'}})
  } catch { return NextResponse.json({error:'Unable to retrieve attachment'},{status:500}) }
}
