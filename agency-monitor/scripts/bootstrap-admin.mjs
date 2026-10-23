/** One-time, opt-in, standalone agency administrator activation.
 * The login must already exist and be email-verified in THIS agency's Supabase Auth.
 * Usage: set project-specific env vars, then node scripts/bootstrap-admin.mjs.
 */
import { createClient } from '@supabase/supabase-js'

const env=process.env
if(env.ALLOW_AGENCY_BOOTSTRAP !== 'YES_I_APPROVE') throw new Error('Set ALLOW_AGENCY_BOOTSTRAP=YES_I_APPROVE after formal agency approval')
const url=env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey=env.SUPABASE_SERVICE_ROLE_KEY
const id=env.BOOTSTRAP_AUTH_USER_ID
const fullName=env.BOOTSTRAP_FULL_NAME
const projectRef=env.BOOTSTRAP_PROJECT_REF
if (!url || !serviceKey || !id || !fullName || !projectRef || !/^[0-9a-f-]{36}$/i.test(id) || fullName.trim().length<3) {
 throw new Error('Missing/invalid project-specific URL, service key, confirmed user UUID, full name or expected project ref')
}
const parsed=new URL(url)
if(parsed.protocol!=='https:' || parsed.hostname!==`${projectRef}.supabase.co`) throw new Error('Project reference mismatch — refusing to bootstrap the wrong agency database')
const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const {data:{user},error:authError}=await admin.auth.admin.getUserById(id)
if(authError || !user || !user.email || !user.email_confirmed_at || user.is_anonymous) throw new Error('The selected agency login is not a verified human Auth account')
const {count,error:countError}=await admin.from('monitor_users').select('auth_user_id',{head:true,count:'exact'})
if(countError) throw countError
if(count !== 0) throw new Error('Bootstrap is only permitted on a completely empty agency staff directory')
const {error}=await admin.from('monitor_users').insert({auth_user_id:id,full_name:fullName.trim(),role:'administrator',is_active:true})
if(error) throw error
const {error:auditError}=await admin.from('monitor_audit_events').insert({actor_id:id,action:'INITIAL_ADMIN_BOOTSTRAP',entity_type:'user',context:{setup:'manual approved agency provisioning'}})
if(auditError) throw new Error('Admin created but audit insert failed. Investigate immediately: '+auditError.message)
console.log('First administrator provisioned in the independently verified agency project.')
