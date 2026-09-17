import fs from 'node:fs'
import assert from 'node:assert/strict'

const pagePath = 'app/dashboard/admin/organisation/page.tsx'
const migrationPath = 'supabase/migrations/20260918070000_organisation_setup_admin_menu.sql'
const safeDeleteMigrationPath = 'supabase/migrations/20260918100000_organisation_safe_delete.sql'
const accessRoute = fs.readFileSync('app/api/account/access/route.ts', 'utf8')

assert.ok(fs.existsSync(pagePath), 'Organisation Setup page must exist')
assert.ok(fs.existsSync(migrationPath), 'Organisation Setup menu migration must exist')
assert.ok(fs.existsSync(safeDeleteMigrationPath), 'Organisation Setup safe-delete migration must exist')

const page = fs.readFileSync(pagePath, 'utf8')
const migration = fs.readFileSync(migrationPath, 'utf8')
const safeDeleteMigration = fs.readFileSync(safeDeleteMigrationPath, 'utf8')

assert.match(page, /Organisation Setup/)
assert.match(page, /Divisions/)
assert.match(page, /Sections \/ Units/)
assert.match(page, /departments/)
assert.match(page, /sections/)
assert.match(page, /masterdata\.manage/)
assert.match(page, /can\("all"\)/)

// Registry -> Division -> Section/Unit hierarchy must drive the administrator UI.
assert.match(page, /court_locations/, 'Organisation Setup must load locations / registries')
assert.match(page, /court_location_id/, 'Divisions must retain their parent location / registry')
assert.match(page, /selectedLocationId/, 'Administrator must explicitly select a location / registry')
assert.match(page, /selectedDivisionId/, 'Sections / Units must be viewed within one selected Division')
assert.match(page, /row\.court_location_id === selectedLocationId/, 'Division list must be filtered to the selected location')
assert.match(page, /row\.department_id === selectedDivisionId/, 'Section list must be filtered to the selected Division')
assert.match(page, /court_location_id: selectedLocationId/, 'New Divisions must automatically attach to the selected location')
assert.match(page, /Location \/ Registry/, 'Location / Registry selector must be visible')
assert.match(page, /Select Location \/ Registry/, 'Location selector must not silently show every registry')
assert.match(page, /Select Division/, 'Sections / Units must require a Division selection')
assert.match(page, /No Sections \/ Units have been created for this Division\./, 'Empty selected Divisions must show a clear empty state')

// Safe-delete CRUD: only genuinely unused organisation records may be permanently removed.
assert.match(page, /Trash2/, 'Organisation Setup must expose an explicit delete action')
assert.match(page, /njss_delete_organisation_record/, 'Delete action must use the guarded server-side RPC')
assert.match(page, /Permanently delete/, 'Delete must require explicit confirmation')
assert.match(page, /Deactivate it instead/, 'Blocked deletes must direct the administrator to deactivate instead')

assert.match(migration, /Organisation Setup/)
assert.match(migration, /\/dashboard\/admin\/organisation/)
assert.match(migration, /system\.organisation_setup/)
assert.match(migration, /masterdata\.manage/)
assert.match(migration, /users\.manage/)
assert.match(migration, /System Administrator/)
assert.match(migration, /SYSTEM_WIDE/)
assert.match(migration, /'all'/)

assert.match(safeDeleteMigration, /njss_delete_organisation_record/, 'Safe-delete RPC must be defined')
assert.match(safeDeleteMigration, /njss_require_permission\('all'\)/, 'Permanent deletion must require System Administrator wildcard access')
assert.match(safeDeleteMigration, /pg_constraint/, 'Deletion must inspect all foreign-key usage rather than a hand-picked subset')
assert.match(safeDeleteMigration, /log_audit_event/, 'Successful permanent deletion must be audited')
assert.match(safeDeleteMigration, /REVOKE DELETE ON TABLE public\.departments, public\.sections FROM authenticated/, 'Direct authenticated DELETE must be disabled so callers cannot bypass the safe-delete RPC')
assert.match(safeDeleteMigration, /GRANT EXECUTE ON FUNCTION public\.njss_delete_organisation_record/, 'Authenticated callers must use the guarded RPC')

assert.match(accessRoute, /permissions\.includes\('all'\)/, 'System-wide all permission must continue to bypass menu permission filters')
assert.match(accessRoute, /ADMIN_VISIBLE_SUPPORT_MENU_CODES/, 'Access API must explicitly expose support menus to System Administrator')
assert.match(accessRoute, /system-admin-visible/, 'Hidden support menu codes must be remapped for System Administrator visibility')

console.log('Organisation Setup administrator contract passed')
