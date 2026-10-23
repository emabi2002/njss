import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const file=(s)=>readFileSync(new URL('../'+s,import.meta.url),'utf8')
const sql=file('supabase/migrations/20261023000100_initial_monitoring.sql')
test('private evidence bucket and metadata table are inaccessible to direct browser writes',()=>{
 assert.match(sql,/create table public\.monitor_documents/i)
 assert.match(sql,/alter table public\.monitor_documents enable row level security/i)
 assert.match(sql,/revoke all on public\.monitor_documents from public, anon, authenticated/i)
 assert.match(sql,/values\('monitor-evidence','monitor-evidence',false/i)
})
test('agency branding storage contains public logos only',()=>{
 assert.match(sql,/values\('monitor-branding','monitor-branding',true/i)
 assert.match(file('app/api/branding/route.ts'),/actor\.role!=='administrator'/)
})
test('uploads are identity-bound and verify record permissions',()=>{
 const route=file('app/api/attachments/route.ts')
 assert.match(route,/authenticatedAgencyActor\(request,db\)/)
 assert.match(route,/documentAccess\(db,actor,entity,id,true\)/)
 assert.match(route,/isValidFileSignature/)
 assert.match(route,/storage\.from\('monitor-evidence'\)/)
})
test('document retrieval verifies permissions and uses expiring signed URLs',()=>{
 const route=file('app/api/attachments/[id]/route.ts')
 assert.match(route,/documentAccess\(db,actor,record\.entity_type,record\.entity_id,false\)/)
 assert.match(route,/createSignedUrl\(record\.object_path,60\)/)
})
test('standalone first-administrator bootstrap rejects wrong projects',()=>{
 const script=file('scripts/bootstrap-admin.mjs')
 assert.match(script,/BOOTSTRAP_PROJECT_REF/)
 assert.match(script,/Project reference mismatch/)
 assert.match(script,/count !== 0/)
})
test('historical external purchase requires agency administrator',()=>{
 assert.match(sql,/Only an administrator may enter an unlinked historical purchase/)
})
