# Step 3 delivery gates — independent agency monitoring product v0.3

## Developed and locally verified
- New clean agency-owned application (not a modification to NJSS), with dedicated independent Supabase project/deployment configuration.
- Agency settings, organisational divisions and sections, expense categories, item catalogue, synonyms, suppliers and verified-identity staff assignment.
- Requisitions, approval with maker-checker segregation, pre-approval duplicate checks, auditable repeat-purchase decisions, quantity-checked purchasing, partial receipts, reported expenditure evidence and second-person verification.
- Private supporting-document handling through protected server routes; role/record guards, signature checks, storage path randomisation, 60-second URLs; agency logo is public brand content only, uploaded by administrator.
- Database-backed reporting views by item, section, supplier, expense category and expenditure evidence verification status.
- One-time first administrator bootstrap with exact independent project reference check and explicit server-side authorization.
- Twenty-five Node tests passed locally. Networked GitHub Actions confirmed TypeScript semantic checking and a Next.js production build; a PostgreSQL service-based migration smoke test is being added.

## Cannot truthfully mark as validated without an isolated agency test environment
1. A NEW Supabase project in an organisation chosen by the user with cost accepted. None has been created.
2. Executing baseline SQL in that blank project. No SQL execution occurred.
3. Supabase permission and SQL execution testing with at least five distinct verified Auth users, including forbidden transitions, cross-section history and CRUD denial.
4. Tests that provoke simultaneous purchases and receipts to confirm row-level locking prevents over-order and over-receipt.
5. Actual document uploads and signed download authorization in server runtime; malware scanning, rate limiting and retention controls still require production design.
6. The networked GitHub Actions runner successfully installed dependencies, completed `tsc --noEmit` and built Next.js after isolating the Turbopack root. Its generated package-lock.json is included with the source; final GitHub CI must pass with `npm ci` against this committed lockfile.
7. Independent second agency test installation and restoration drill.
8. Government department information security, data ownership, licence and deployment sign-off.

## Critical rules
- This system is an internal purchasing and expenditure monitoring tool: **NO IFMS integration, no government GL/accounting replacement and no bank payment execution**.
- NEVER import NJSS production database, Auth users, transaction records, storage files or credentials into a new agency project.
- Each agency must have its own database, auth user directory, documents, application hosting and backups.
- The original NJSS production application, database and permissions were not altered.

## Deployment responsibility
A system administrator must provision a brand-new Supabase agency project **after the user selects the intended Supabase organisation and accepts any nonzero quoted cost**. Only then run database installation, first-admin bootstrap, UAT and release approval. Do not label this version production-ready until those gates pass.
