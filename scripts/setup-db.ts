/**
 * CRMS database setup — runs the consolidated schema + seed against Supabase.
 * Connects through the Supavisor pooler (IPv4) because direct DB is IPv6-only.
 * Run with:  bun scripts/setup-db.ts
 */
import { Client } from 'pg'
import * as fs from 'fs'
import * as path from 'path'

// ---- load env from .env.local (manual, so it always works) ----
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '').replace(/\\\$/g, '$')
  }
}
loadEnv()

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const ref = SUPA_URL.replace('https://', '').split('.')[0]
const dbUrl = process.env.DATABASE_URL || ''
const password = decodeURIComponent((dbUrl.match(/postgres:([^@]+)@/) || [])[1] || '')

if (!ref || !password) {
  console.error('Missing ref or password. ref=%s, hasPassword=%s', ref, !!password)
  process.exit(1)
}

const REGIONS = [
  'ap-southeast-2', 'ap-southeast-1', 'us-east-1', 'us-east-2', 'us-west-1',
  'eu-west-1', 'eu-central-1', 'eu-west-2', 'ap-south-1', 'ap-northeast-1',
  'ap-northeast-2', 'ca-central-1', 'sa-east-1', 'us-west-2',
]

// ---- dollar-quote aware SQL splitter ----
function splitSql(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  let i = 0
  let dollarTag: string | null = null
  let inSingle = false
  let inLineComment = false
  let inBlockComment = false
  while (i < sql.length) {
    const ch = sql[i]
    const two = sql.slice(i, i + 2)
    if (inLineComment) { cur += ch; if (ch === '\n') inLineComment = false; i++; continue }
    if (inBlockComment) { cur += ch; if (two === '*/') { cur += '/'; i += 2; inBlockComment = false; continue } i++; continue }
    if (!dollarTag && !inSingle && two === '--') { inLineComment = true; cur += two; i += 2; continue }
    if (!dollarTag && !inSingle && two === '/*') { inBlockComment = true; cur += two; i += 2; continue }
    if (!dollarTag && ch === "'") { inSingle = !inSingle; cur += ch; i++; continue }
    if (!inSingle) {
      const dm = sql.slice(i).match(/^\$[a-zA-Z0-9_]*\$/)
      if (dm) {
        const tag = dm[0]
        if (!dollarTag) dollarTag = tag
        else if (dollarTag === tag) dollarTag = null
        cur += tag; i += tag.length; continue
      }
    }
    if (ch === ';' && !dollarTag && !inSingle) { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue }
    cur += ch; i++
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

async function tryConnect(): Promise<Client | null> {
  for (const prefix of ['aws-1', 'aws-0']) {
    for (const region of REGIONS) {
      const host = `${prefix}-${region}.pooler.supabase.com`
      for (const port of [5432, 6543]) {
        const client = new Client({
          host, port, user: `postgres.${ref}`, password,
          database: 'postgres', ssl: { rejectUnauthorized: false },
          connectionTimeoutMillis: 8000,
        })
        try {
          await client.connect()
          console.log(`✅ Connected via ${host}:${port}`)
          return client
        } catch (e: any) {
          const msg = (e.message || '').split('\n')[0]
          // Only log the meaningful ones to reduce noise
          if (!/not found/i.test(msg) || port === 5432) console.log(`   ✗ ${prefix}-${region}:${port} ${msg}`)
          try { await client.end() } catch {}
        }
      }
    }
  }
  return null
}

async function runFile(client: Client, file: string, opts: { soft?: string[] } = {}) {
  const sql = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
  const stmts = splitSql(sql)
  let ok = 0, warn = 0
  for (const stmt of stmts) {
    try {
      await client.query(stmt)
      ok++
    } catch (e: any) {
      const soft = (opts.soft || []).some(s => stmt.toLowerCase().includes(s))
      const msg = e.message?.split('\n')[0]
      if (soft) { console.log(`   ⚠ (soft) ${msg}`); warn++ }
      else { console.log(`   ❌ ${msg}\n      in: ${stmt.slice(0, 90).replace(/\n/g, ' ')}...`); warn++ }
    }
  }
  console.log(`   ${file}: ${ok} ok, ${warn} warnings of ${stmts.length} statements`)
}

async function main() {
  console.log(`\n🚀 CRMS DB setup for project: ${ref}\n`)
  const client = await tryConnect()
  if (!client) { console.error('❌ Could not connect to any pooler region.'); process.exit(1) }

  try {
    console.log('\n📦 Running schema (000_crms_complete.sql)...')
    await runFile(client, 'supabase/migrations/000_crms_complete.sql', { soft: ['storage.', 'publication', 'policy'] })

    console.log('\n🌱 Running seed (seed.sql)...')
    await runFile(client, 'supabase/seed.sql')

    console.log('\n📊 Verifying row counts...')
    const tables = ['departments','sections','provinces','projects','funding_sources','chart_of_accounts','roles','role_permissions','users','user_roles','budget_allocations','quarterly_releases','ff3_headers','ff4_headers','ff3_commitments','notifications','audit_logs','system_settings']
    for (const t of tables) {
      try {
        const r = await client.query(`SELECT COUNT(*)::int AS c FROM ${t}`)
        console.log(`   ${t.padEnd(22)} ${r.rows[0].c}`)
      } catch (e: any) {
        console.log(`   ${t.padEnd(22)} ERR ${e.message?.split('\n')[0]}`)
      }
    }
    console.log('\n✅ Setup complete.\n')
  } finally {
    await client.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
