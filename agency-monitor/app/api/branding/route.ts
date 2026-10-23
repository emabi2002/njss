import { NextRequest,NextResponse } from 'next/server'
import {agencyAdminClient,authenticatedAgencyActor,validateFile,isValidFileSignature} from '../../../src/server-auth'
export const runtime='nodejs'
export async function POST(request:NextRequest){
 try {
  const db=agencyAdminClient()
  const actor=await authenticatedAgencyActor(request,db)
  if(!actor) return NextResponse.json({error:'Authentication required'},{status:401})
  if(actor.role!=='administrator') return NextResponse.json({error:'Administrator only'},{status:403})
  const form=await request.formData()
  const file=form.get('file')
  if(!(file instanceof File)) return NextResponse.json({error:'Image required'},{status:400})
  const fileError=validateFile(file,true)
  if(fileError) return NextResponse.json({error:fileError},{status:400})
  const buffer=new Uint8Array(await file.arrayBuffer())
  if(!isValidFileSignature(buffer,file.type)) return NextResponse.json({error:'Invalid image signature'},{status:400})
  const suffix=file.type==='image/png'?'png':'jpg'
  const path=`agency-logo-${crypto.randomUUID()}.${suffix}`
  const {error}=await db.storage.from('monitor-branding').upload(path,buffer,{contentType:file.type,upsert:false})
  if(error) return NextResponse.json({error:'Unable to upload agency logo'},{status:500})
  const {data}=db.storage.from('monitor-branding').getPublicUrl(path)
  const {error:auditError}=await db.from('monitor_audit_events').insert({actor_id:actor.id,action:'UPLOAD_LOGO',entity_type:'agency',context:{object_path:path}})
  if(auditError){await db.storage.from('monitor-branding').remove([path]);return NextResponse.json({error:'Unable to audit logo upload'},{status:500})}
  return NextResponse.json({url:data.publicUrl},{headers:{'Cache-Control':'no-store'}})
 } catch {return NextResponse.json({error:'Unable to upload image'},{status:500})}
}
