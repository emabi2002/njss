# NJSS Full and Differential ZIP Backup Design

## Objective
Replace the current selective portable JSON export with two controlled database-backup modes for NJSS Housekeeping:

- **Full ZIP Backup** — capture a consistent logical snapshot of all application tables in the `public` schema together with schema metadata, manifest data, and checksums.
- **Differential ZIP Backup** — capture all row-level inserts, updates, and deletes that occurred after the baseline cursor recorded by the latest successful Full ZIP Backup.

Both backup types must download as `.zip` files to the administrator's local machine.

## Scope and terminology
This is an **NJSS logical database backup**, not a Supabase provider physical/PITR snapshot. The Full ZIP contains every ordinary/partitioned table in the application `public` schema except the backup subsystem's own registry/change-log tables. It also contains schema metadata sufficient to identify columns, constraints, indexes, RLS, policies, triggers, views and public routines. Supabase-managed infrastructure outside the application schema (for example provider-level physical WAL/PITR internals, external storage object bytes and password hashes managed by Supabase Auth) is not represented as a physical database image.

## Security
- Backup creation requires one of `operations.manage`, `settings.manage`, or `all`.
- Browser requests carry the signed-in user's JWT.
- A JWT-protected Supabase Edge Function re-verifies the caller and permission before using service-role authority to read all application data.
- Backup registry and change-log tables are RLS protected and not directly writable by normal authenticated users.
- Every successful or failed backup request is audit logged without storing backup contents in audit metadata.

## Consistency model
A Full Backup is generated from one PostgreSQL statement-level snapshot through `njss_backup_full_snapshot()`. That function returns the complete public-table dataset and the exact change-log cursor visible in the same database snapshot. The cursor becomes the baseline for future differentials.

A Differential Backup always references the **latest completed Full Backup** and contains every tracked change with `change_id > full.baseline_change_id` up to a consistent `through_change_id` captured by `njss_backup_differential_snapshot()`.

## Database change journal
Migration 049 creates:
- `system_backup_registry`
- `system_backup_change_log`
- `njss_capture_backup_change()` trigger function
- one AFTER INSERT/UPDATE/DELETE change-capture trigger on every public application table except the two backup internal tables
- security-definer snapshot/catalog functions callable only by `service_role`

Each differential change record contains table name, operation, old row JSON, new row JSON, timestamp, and transaction id. Deletes are therefore restorable even when the original row no longer exists.

## ZIP formats

### Full
`NJSS_FULL_<timestamp>.zip`

Contents:
- `manifest.json`
- `README.txt`
- `schema/public-schema.json`
- `tables/<table>.json` for every application table
- `checksums.json`

Manifest includes backup id, type, timestamps, creator, baseline cursor, table count, total record count, schema version/migration marker, file counts, and file checksums.

### Differential
`NJSS_DIFF_<timestamp>_FROM_<full-backup-id>.zip`

Contents:
- `manifest.json`
- `README.txt`
- `schema/schema-version.json`
- `changes/change-log.json`
- `checksums.json`

Manifest includes the baseline Full Backup id, baseline cursor, through cursor, number of changes, tables affected, and checksums.

## User interface
Housekeeping replaces the single **Create backup** action with:
- **Full ZIP Backup**
- **Differential ZIP Backup**

Both actions download directly to the browser. Differential clearly states that a successful Full Backup is required first.

## Validation
The existing validation endpoint is extended to recognize both new backup formats, verify required files and SHA-256 checksums, and reject a Differential package that has no baseline backup reference.

## Restore
This change builds backup generation and validation only. It does not perform destructive restore. A future restore feature must require explicit administrator confirmation, safety backup, backup-chain validation, idempotent replay of differential changes, and post-restore verification.
