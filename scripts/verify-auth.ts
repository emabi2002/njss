import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
function loadEnv() {
  for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/\\\$/g, '$')
  }
}
loadEnv()

const tests: [string, string][] = [
  ['officer@pngjudiciary.gov.pg', 'Requisition Officer'],
  ['auditor@pngjudiciary.gov.pg', 'Auditor'],
  ['finance@pngjudiciary.gov.pg', 'Finance Manager'],
  ['exec@pngjudiciary.gov.pg', 'Executive Management'],
]

async function main() {
  for (const [email, expected] of tests) {
    const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    const { data, error } = await s.auth.signInWithPassword({ email, password: 'Crms@2025' })
    if (error) { console.log('LOGIN FAIL ' + email + ' :: ' + error.message); continue }
    const { data: prof } = await s.from('users').select('full_name, department:departments(name), user_roles(role:roles(name))').eq('auth_user_id', data.user.id).maybeSingle()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const role = (prof as any)?.user_roles?.[0]?.role?.name
    console.log((role === expected ? 'OK    ' : 'WRONG ') + email + ' -> ' + role + ' (expected ' + expected + ')')
    await s.auth.signOut()
  }
}
main()
