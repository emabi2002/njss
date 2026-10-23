import { NextRequest, NextResponse } from 'next/server'
import { agencyAdminClient, authenticatedAgencyActor, documentAccess, safeUuid, validateFile, isValidFileSignature } from '../../../src/server-auth'
export const runtime = 'nodejs'
const json = (message: string, status: number) => NextResponse.json({ error: message }, {status, headers:{'Cache-Control':'no-store'}})

export async function POST(request: NextRequest) {
  try {
    const db=agencyAdminClient()
    const actor=await authenticatedAgencyActor(request,db)
    if (!actor) return json('Sign-in required',401)
    const form=await request.formData()
    const entity=String(form.get('entity')||'')
    const id=form.get('entityId')
    const file=form.get('file')
    if(!safeUuid(id) || !(file instanceof File) || !['requisition','purchase','expense'].includes(entity)) return json('Invalid attachment request',400)
    if(!await documentAccess(db,actor,entity,id,true)) return json('Not permitted to attach to this record',403)
    const error=validateFile(file)
    if(error) return json(error,400)
    const buffer = new Uint8Array(await file.arrayBuffer())
    if(!isValidFileSignature(buffer,file.type)) return json('File contents do not match the declared type',400)
    const suffix=({ 'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg' } as Record<string,string>)[file.type]
    const objectPath=`${entity}/${id}/${crypto.randomUUID()}.${suffix}`
    const {error:uploadError}=await db.storage.from('monitor-evidence').upload(objectPath,buffer,{contentType:file.type,upsert:false,cacheControl:'0'})
    if(uploadError) return json('Unable to store attachment',500)
    const {data,error:dbError}=await db.from('monitor_documents').insert({entity_type:entity,entity_id:id,object_path:objectPath,original_name:file.name.slice(0,180),mime_type:file.type,file_size:file.size,uploaded_by:actor.id}).select('id').single()
    if(dbError){ await db.storage.from('monitor-evidence').remove([objectPath]); return json('Unable to save attachment record',500) }
    const {error:auditError}=await db.from('monitor_audit_events').insert({actor_id:actor.id,action:'ATTACH_DOCUMENT',entity_type:entity,entity_id:id,context:{document_id:data.id}})
    if(auditError){
      await db.from('monitor_documents').delete().eq('id',data.id)
      await db.storage.from('monitor-evidence').remove([objectPath])
      return json('Unable to complete audited upload',500)
    }
    return NextResponse.json({ id:data.id },{status:201,headers:{'Cache-Control':'no-store'}})
  } catch { return json('Unable to process attachment',500) }
}
export async function GET(request: NextRequest) {
  try {
    const db=agencyAdminClient()
    const actor=await authenticatedAgencyActor(request,db)
    if(!actor) return json('Sign-in required',401)
    const entity=request.nextUrl.searchParams.get('entity')||''
    const id=request.nextUrl.searchParams.get('entityId')
    if(!safeUuid(id) || !['requisition','purchase','expense'].includes(entity)) return json('Invalid record',400)
    if(!await documentAccess(db,actor,entity,id,false)) return json('Not permitted',403)
    const {data,error}=await db.from('monitor_documents').select('id,original_name,mime_type,file_size,created_at,uploaded_by').eq('entity_type',entity).eq('entity_id',id).order('created_at',{ascending:false}).limit(100)
    if(error) return json('Unable to fetch document list',500)
    return NextResponse.json({documents:data},{headers:{'Cache-Control':'no-store'}})
  } catch {return json('Unable to fetch documents',500)}
}
