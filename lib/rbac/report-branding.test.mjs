import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const routePath = 'app/api/settings/organization/route.ts'
const orgPath = 'lib/org.ts'
const exportPath = 'lib/export.ts'
const layoutPath = 'app/dashboard/layout.tsx'

assert.equal(existsSync(routePath), true, 'Authenticated organization settings endpoint must exist')
assert.equal(existsSync(orgPath), true, 'Organization profile helper must exist')
assert.equal(existsSync(exportPath), true, 'Shared report export helper must exist')
assert.equal(existsSync(layoutPath), true, 'Dashboard layout must exist')

const route = readFileSync(routePath, 'utf8')
const org = readFileSync(orgPath, 'utf8')
const exportsSource = readFileSync(exportPath, 'utf8')
const layout = readFileSync(layoutPath, 'utf8')

assert.match(route, /getServerAccessContext/, 'Organization settings endpoint must authenticate through server RBAC context')
assert.match(route, /system_settings/, 'Organization settings endpoint must read system_settings')
assert.match(route, /setting_key/, 'Organization settings endpoint must select the organization setting key')
assert.match(route, /organization/, 'Organization settings endpoint must return the organization profile')

assert.match(org, /authFetch/, 'Organization profile loader must use authenticated server fetch')
assert.match(org, /\/api\/settings\/organization/, 'Organization profile loader must load from the server settings endpoint')
assert.match(layout, /loadOrganization\(\)/, 'Dashboard initialization must hydrate the organization report profile')

assert.match(exportsSource, /export function exportToPDF/, 'PDF export must exist')
assert.match(exportsSource, /getLogoForPdf\(\)/, 'PDF header must use the System Settings logo')
assert.match(exportsSource, /orgAddressLine\(org\)/, 'Printable headers must use the System Settings address')
assert.match(exportsSource, /orgContactLine\(org\)/, 'Printable headers must use the System Settings contact details')
assert.match(exportsSource, /njss-print-logo/, 'Browser print output must render the System Settings logo')

const excelStart = exportsSource.indexOf('export function exportToExcel')
const pdfStart = exportsSource.indexOf('export function exportToPDF')
assert.ok(excelStart >= 0 && pdfStart > excelStart, 'Excel and PDF export functions must be discoverable')
const excelSource = exportsSource.slice(excelStart, pdfStart)
assert.doesNotMatch(excelSource, /getOrg\(/, 'Excel export must remain data-focused and must not render the official printed header')
assert.doesNotMatch(excelSource, /orgAddressLine\(/, 'Excel export must not render the official address header')
assert.doesNotMatch(excelSource, /orgContactLine\(/, 'Excel export must not render the official contact header')

console.log('System Settings printable report branding contract passed')
