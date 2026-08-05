/**
 * Provisions Supabase Auth accounts for the CRMS demo users (one per role),
 * links public.users.auth_user_id, and ensures user_roles.
 * Run with: bun scripts/setup-auth.ts
 */
import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

function loadEnv() {
  const p = path.join(process.cwd(), '.env.local')
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/\\\$/g, '$')
  }
}
loadEnv()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const DEMO_PASSWORD = 'Crms@2025'

// One account per role. dept code is best-effort.
const DEMO_USERS = [
  { email: 'admin@pngjudiciary.gov.pg', name: 'System Administrator', role: 'System Administrator', dept: 'NJSS' },
  { email: 'finance@pngjudiciary.gov.pg', name: 'Mary Finance', role: 'Finance Manager', dept: 'FIN' },
  { email: 'depthead@pngjudiciary.gov.pg', name: 'David Department', role: 'Department Head', dept: 'REG' },
  { email: 'section@pngjudiciary.gov.pg', name: 'Peter Section', role: 'Section Head', dept: 'REG' },
  { email: 'approver@pngjudiciary.gov.pg', name: 'Anna Approver', role: 'Approver', dept: 'FIN' },
  { email: 'officer@pngjudiciary.gov.pg', name: 'John Registry', role: 'Requisition Officer', dept: 'REG' },
  { email: 'auditor@pngjudiciary.gov.pg', name: 'Alex Auditor', role: 'Auditor', dept: 'ADMIN' },
  { email: 'exec@pngjudiciary.gov.pg', name: 'Eva Executive', role: 'Executive Management', dept: 'ADMIN' },
]

async function findAuthUserId(email: string): Promise<string | null> {
  // paginate through users to find by email
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) break
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (found) return found.id
    if (data.users.length < 200) break
  }
  return null
}

async function main() {
  console.log('\n🔐 CRMS auth provisioning\n' + '='.repeat(50))

  // role + department lookups
  const { data: roles } = await admin.from('roles').select('id, name')
  const { data: depts } = await admin.from('departments').select('id, code')
  const roleId = (name: string) => roles?.find((r) => r.name === name)?.id || null
  const deptId = (code: string) => depts?.find((d) => d.code === code)?.id || null

  for (const u of DEMO_USERS) {
    // 1) create (or find) the auth account
    let authId: string | null = null
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: u.email,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: u.name },
    })
    if (created?.user) {
      authId = created.user.id
    } else if (createErr) {
      authId = await findAuthUserId(u.email)
      // make sure the password is set/known
      if (authId) await admin.auth.admin.updateUserById(authId, { password: DEMO_PASSWORD, email_confirm: true })
    }
    if (!authId) {
      console.log(`   ❌ ${u.email}: could not create/find auth user`)
      continue
    }

    // 2) upsert the public.users profile row, linked to the auth id
    const { data: existing } = await admin.from('users').select('id').eq('email', u.email).maybeSingle()
    let profileId = existing?.id as string | undefined
    if (profileId) {
      await admin.from('users').update({ auth_user_id: authId, full_name: u.name, department_id: deptId(u.dept), is_active: true }).eq('id', profileId)
    } else {
      const { data: ins } = await admin.from('users').insert({ auth_user_id: authId, email: u.email, full_name: u.name, department_id: deptId(u.dept), is_active: true }).select('id').single()
      profileId = ins?.id
    }

    // 3) ensure the user_role link
    const rId = roleId(u.role)
    if (profileId && rId) {
      const { data: ur } = await admin.from('user_roles').select('id').eq('user_id', profileId).eq('role_id', rId).maybeSingle()
      if (!ur) await admin.from('user_roles').insert({ user_id: profileId, role_id: rId })
    }

    console.log(`   ✅ ${u.email.padEnd(34)} ${u.role}`)
  }

  console.log('\nPassword for ALL demo accounts: ' + DEMO_PASSWORD)
  console.log('='.repeat(50) + '\n')
}

main().catch((e) => { console.error('💥', e.message); process.exit(1) })
