import fs from 'node:fs'
import path from 'node:path'
import { Client, type ClientConfig, type QueryResultRow } from 'pg'
import { EXPECTED_PROJECT_REF } from './constants'

const DEFAULT_POOLER_HOST = 'aws-0-ap-northeast-1.pooler.supabase.com'
const DEFAULT_POOLER_PORT = 5432

type EnvLike = Record<string, string | undefined>

function loadLocalEnv(env: EnvLike = process.env): void {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return

  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (!match) continue
    if (env[match[1]] !== undefined) continue
    env[match[1]] = match[2].replace(/^"|"$/g, '').trim()
  }
}

export function projectRefFromUrl(url: string | undefined): string {
  const normalized = (url ?? '').trim()
  if (!normalized) return ''

  try {
    const hostname = new URL(normalized).hostname
    return hostname.endsWith('.supabase.co') ? hostname.split('.')[0] ?? '' : ''
  } catch {
    return ''
  }
}

export function assertProjectRef(projectRef: string): void {
  if (projectRef !== EXPECTED_PROJECT_REF) {
    throw new Error(
      `Refusing NJSS National UAT operation: target project '${projectRef || '(missing)'}' does not match expected '${EXPECTED_PROJECT_REF}'.`,
    )
  }
}

export function assertExpectedProject(env: EnvLike = process.env): string {
  const projectRef = projectRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL)
  assertProjectRef(projectRef)
  return projectRef
}

function databasePassword(databaseUrl: string): string {
  if (!databaseUrl.trim()) throw new Error('DATABASE_URL is required for NJSS National UAT database access')

  try {
    const parsed = new URL(databaseUrl)
    if (!parsed.password) throw new Error('DATABASE_URL does not contain a password')
    return decodeURIComponent(parsed.password)
  } catch (error) {
    if (error instanceof Error && error.message === 'DATABASE_URL does not contain a password') throw error
    const match = databaseUrl.match(/postgres(?:ql)?:\/\/[^:]+:([^@]+)@/i)
    if (!match) throw new Error('Could not parse DATABASE_URL for database credentials')
    return decodeURIComponent(match[1])
  }
}

export function buildPoolerConfig(env: EnvLike = process.env): ClientConfig {
  const projectRef = assertExpectedProject(env)
  const password = databasePassword(env.DATABASE_URL ?? '')
  const portValue = Number.parseInt(env.SUPABASE_POOLER_PORT ?? String(DEFAULT_POOLER_PORT), 10)
  if (!Number.isInteger(portValue) || portValue <= 0 || portValue > 65535) {
    throw new Error(`Invalid SUPABASE_POOLER_PORT: ${env.SUPABASE_POOLER_PORT}`)
  }

  return {
    host: env.SUPABASE_POOLER_HOST ?? DEFAULT_POOLER_HOST,
    port: portValue,
    user: `postgres.${projectRef}`,
    password,
    database: env.SUPABASE_DB_NAME ?? 'postgres',
    ssl: { rejectUnauthorized: false },
  }
}

export async function connectNjss(env: EnvLike = process.env): Promise<Client> {
  loadLocalEnv(env)
  assertExpectedProject(env)
  const client = new Client(buildPoolerConfig(env))
  await client.connect()
  return client
}

export async function withTransaction<T>(
  client: Client,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN')
  try {
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

export async function setActorContext(client: Client, userId: string): Promise<{ authUserId: string; email: string }> {
  const result = await client.query<{ auth_user_id: string | null; email: string | null }>(
    'select auth_user_id, email from public.users where id = $1',
    [userId],
  )
  if (result.rows.length !== 1) throw new Error(`Cannot impersonate unknown NJSS user ${userId}`)

  const authUserId = result.rows[0].auth_user_id
  const email = result.rows[0].email
  if (!authUserId) throw new Error(`Cannot impersonate NJSS user ${userId}: auth_user_id is missing`)
  if (!email) throw new Error(`Cannot impersonate NJSS user ${userId}: email is missing`)

  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [authUserId])
  await client.query("select set_config('request.jwt.claim.email', $1, true)", [email])
  await client.query("select set_config('request.jwt.claim.role', 'authenticated', true)")

  return { authUserId, email }
}

export async function queryOne<T extends QueryResultRow>(
  client: Client,
  text: string,
  values: unknown[] = [],
): Promise<T> {
  const result = await client.query<T>(text, values)
  if (result.rows.length !== 1) {
    throw new Error(`Expected exactly one database row but received ${result.rows.length}`)
  }
  return result.rows[0]
}
