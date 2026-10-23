/** Does NOT connect to any database or create any cloud resources. */
import { readFileSync, existsSync } from 'node:fs'
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || ''
const service = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const expected = process.env.AGENCY_PROJECT_REF || ''
if (!expected || !/^[a-z0-9]{12,36}$/i.test(expected)) throw new Error('Set AGENCY_PROJECT_REF to the new, independent agency Supabase project ref')
if (url !== `https://${expected}.supabase.co`) throw new Error('Configured agency project URL does not match the expected project reference')
if (expected === 'qzsmmalfeinoagvronpb') throw new Error('Refusing to install this reusable product against the NJSS database')
if(!publishable || !service || service===publishable) throw new Error('Project-specific publishable and private service keys must be independently configured')
if (publishable.includes('your-') || service.includes('your-')) throw new Error('Template credentials are not valid')
if (!existsSync('supabase/migrations/20261023000100_initial_monitoring.sql')) throw new Error('Clean database migration is missing')
const sql = readFileSync('supabase/migrations/20261023000100_initial_monitoring.sql','utf8')
if(!sql.includes('create table public.monitor_agency') || !sql.includes('create table public.monitor_documents') || !sql.includes("'monitor-evidence','monitor-evidence',false")) throw new Error('Expected private document and agency tables missing')
console.log(`Standalone agency installation configuration verified for project ${expected}. No database changes performed.`)
