import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

function loadEnv() {
  const p = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(p)) return
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/\\\$/g, '$').trim()
  }
}
loadEnv()

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const usersFile = process.env.AUTH_USERS_FILE

if (!url || !serviceKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
}
if (!usersFile) {
  throw new Error('AUTH_USERS_FILE is required. Provide a JSON file with [{ email, password, name, role, departmentCode? }].')
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

type ProvisionUser = {
  email: string
  password: string
  name: string
  role: string
  departmentCode?: string | null
}

function loadUsers(): ProvisionUser[] {
  const fullPath = path.isAbsolute(usersFile!) ? usersFile! : path.join(process.cwd(), usersFile!)
  const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as ProvisionUser[]
  if (!Array.isArray(parsed)) throw new Error('AUTH_USERS_FILE must contain a JSON array.')
  for (const user of parsed) {
    if (!user.email || !user.password || !user.name || !user.role) {
      throw new Error('Each auth user must include email, password, name, and role.')
    }
  }
  return parsed
}

async function findAuthUserId(email: string): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (found) return found.id
    if (data.users.length < 200) break
  }
  return null
}

async function main() {
  const users = loadUsers()
  const { data: roles } = await admin.from('roles').select('id, name')
  const { data: departments } = await admin.from('departments').select('id, code')
  const roleId = (name: string) => roles?.find((role) => role.name === name)?.id || null
  const deptId = (code?: string | null) => code ? departments?.find((department) => department.code === code)?.id || null : null

  for (const input of users) {
    let authId = await findAuthUserId(input.email)
    if (!authId) {
      const { data, error } = await admin.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: { full_name: input.name },
      })
      if (error) throw error
      authId = data.user?.id || null
    }
    if (!authId) throw new Error(`Could not create/find auth user for ${input.email}`)

    const { data: existing } = await admin.from('users').select('id').eq('email', input.email).maybeSingle()
    let profileId = existing?.id as string | undefined
    const profilePayload = {
      auth_user_id: authId,
      email: input.email,
      full_name: input.name,
      department_id: deptId(input.departmentCode),
      is_active: true,
    }

    if (profileId) {
      await admin.from('users').update(profilePayload).eq('id', profileId)
    } else {
      const { data: inserted, error } = await admin.from('users').insert(profilePayload).select('id').single()
      if (error) throw error
      profileId = inserted?.id
    }

    const rId = roleId(input.role)
    if (!rId) throw new Error(`Role not found in database: ${input.role}`)
    if (profileId) {
      const { data: existingRole } = await admin.from('user_roles').select('id').eq('user_id', profileId).eq('role_id', rId).maybeSingle()
      if (!existingRole) await admin.from('user_roles').insert({ user_id: profileId, role_id: rId })
    }

    console.log(`Provisioned ${input.email} as ${input.role}`)
  }
}

main().catch((error) => { console.error(error.message); process.exit(1) })
