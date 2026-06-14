/**
 * Apply a .sql file to the live Supabase Postgres via the Supavisor session pooler.
 * The direct db host is IPv6-only in this container, so we use the pooler.
 *
 * Usage: bun scripts/apply-sql.ts supabase/migrations/011_quarterly_release_management.sql
 */
import { Client } from 'pg'
import * as fs from 'fs'
import * as path from 'path'

function loadEnv() {
  const p = path.join(process.cwd(), '.env.local')
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '')
  }
}
loadEnv()

const PROJECT_REF = 'pxfayiavwxvdenhstric'
const POOLER_HOST = 'aws-1-ap-northeast-1.pooler.supabase.com'
const POOLER_PORT = 5432

function buildPoolerConfig() {
  const url = process.env.DATABASE_URL || ''
  const m = url.match(/postgresql:\/\/([^:]+):([^@]+)@/)
  if (!m) throw new Error('Could not parse DATABASE_URL for credentials')
  const password = decodeURIComponent(m[2])
  return {
    host: POOLER_HOST,
    port: POOLER_PORT,
    user: `postgres.${PROJECT_REF}`,
    password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
  }
}

async function main() {
  const file = process.argv[2]
  if (!file) { console.error('Usage: bun scripts/apply-sql.ts <path-to-sql>'); process.exit(1) }
  const sql = fs.readFileSync(path.join(process.cwd(), file), 'utf8')
  console.log(`📄 Applying ${file} (${sql.length} chars) via pooler ${POOLER_HOST}:${POOLER_PORT}`)

  const client = new Client(buildPoolerConfig())
  await client.connect()
  try {
    await client.query('BEGIN')
    await client.query(sql)
    await client.query('COMMIT')
    console.log('✅ APPLY=OK (committed)')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('❌ APPLY=FAILED — rolled back:', (e as Error).message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error('💥', e.message); process.exit(1) })
