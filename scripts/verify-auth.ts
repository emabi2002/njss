import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

function loadEnv() {
  if (!fs.existsSync('.env.local')) return
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/\\\$/g, '$').trim()
  }
}
loadEnv()

const email = process.env.AUTH_VERIFY_EMAIL
const password = process.env.AUTH_VERIFY_PASSWORD

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.')
}
if (!email || !password) {
  throw new Error('AUTH_VERIFY_EMAIL and AUTH_VERIFY_PASSWORD are required.')
}

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error

  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('full_name, department:departments(name), user_roles(role:roles(name))')
    .eq('auth_user_id', data.user.id)
    .maybeSingle()

  if (profileError) throw profileError
  console.log(JSON.stringify({ email, profile }, null, 2))
  await supabase.auth.signOut()
}

main().catch((error) => { console.error(error.message); process.exit(1) })
