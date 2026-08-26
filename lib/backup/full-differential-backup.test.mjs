import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const exists = (file) => fs.existsSync(path.join(root, file))

const migrationPath = 'supabase/migrations/049_full_differential_backup_framework.sql'
assert.equal(exists(migrationPath), true, 'migration 049 must exist')
const migration = read(migrationPath)
for (const token of [
  'system_backup_registry',
  'system_backup_change_log',
  'njss_capture_backup_change',
  'njss_backup_full_snapshot',
  'njss_backup_differential_snapshot',
  'njss_backup_schema_snapshot',
  'ENABLE ROW LEVEL SECURITY',
  'service_role',
  'AFTER INSERT OR UPDATE OR DELETE',
]) assert.match(migration, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))

const functionPath = 'supabase/functions/njss-database-backup/index.ts'
assert.equal(exists(functionPath), true, 'database backup Edge Function must exist')
const fn = read(functionPath)
for (const token of [
  'NJSS_FULL_DATABASE_BACKUP',
  'NJSS_DIFFERENTIAL_DATABASE_BACKUP',
  'njss_backup_full_snapshot',
  'njss_backup_differential_snapshot',
  'njss_backup_schema_snapshot',
  'operations.manage',
  'settings.manage',
  'JSZip',
  'SHA-256',
  'system_backup_registry',
  'Content-Disposition',
  'X-NJSS-Backup-Filename',
]) assert.match(fn, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))

const controlsPath = 'app/dashboard/admin/operations/database-backup-controls.tsx'
assert.equal(exists(controlsPath), true, 'database backup controls must exist')
const ui = read(controlsPath)
assert.match(ui, /Full ZIP Backup/)
assert.match(ui, /Differential ZIP Backup/)
assert.match(ui, /createBackup\("FULL"\)/)
assert.match(ui, /createBackup\("DIFFERENTIAL"\)/)

const layout = read('app/dashboard/admin/operations/layout.tsx')
assert.match(layout, /DatabaseBackupControls/)

const route = read('app/api/operations/housekeeping/backup/route.ts')
assert.match(route, /njss-database-backup/)
assert.match(route, /body\.backupType \|\| 'FULL'/)
assert.doesNotMatch(route, /EXPORT_TABLES/)
assert.doesNotMatch(route, /NJSS_PORTABLE_DATA_EXPORT/)

const validator = read('app/api/operations/housekeeping/validate-backup/route.ts')
assert.match(validator, /NJSS_FULL_DATABASE_BACKUP/)
assert.match(validator, /NJSS_DIFFERENTIAL_DATABASE_BACKUP/)
assert.match(validator, /checksums\.json/)
assert.match(validator, /createHash\(['"]sha256['"]\)/)

const ci = read('.github/workflows/ci.yml')
assert.match(ci, /Full and differential backup regression checks/)
assert.match(ci, /node lib\/backup\/full-differential-backup\.test\.mjs/)

console.log('Full and differential backup regression checks passed')
