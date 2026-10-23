# Agency monitor — test acceptance checklist (v0.2)

Perform each case in a **new isolated UAT Supabase project**. Use synthetic data only. Capture results, date, tester and evidence. No case below has been executed against a live Supabase project as part of the Step 3 development release.

| ID | Setup / test | Expected result |
| --- | --- | --- |
| I-01 | Create separate Supabase project and app site | Own DB, Auth, Storage and env keys; no NJSS data present |
| I-02 | Invite and verify agency's first administrator | Verified user can be securely bootstrapped; no seeded password |
| I-03 | Configure agency name, addresses and HTTPS logo | Only this agency deployment changes |
| I-04 | Create divisions, sections and internal monitoring categories | Independent codes; no judicial records or court locations preloaded |
| I-05 | Add items, units and aliases | Duplicate matching across item names and aliases with compatible units |
| A-01 | Sign in as unprovisioned Auth user | No access to agency data/RPCs |
| A-02 | Sign in as inactive monitor user | No operational data / action access |
| A-03 | Requester creates item request in assigned section | Allowed, cannot create in an unrelated section |
| A-04 | Requester tries to approve their own requisition | Rejected server-side |
| A-05 | Reviewer approves without duplicates | New workflow state approved and audit logged |
| D-01 | Section A requests same item as pending Section B | Duplicate warning on submission, prior request displayed |
| D-02 | Record purchase of equivalent item with alternate alias | Alias-based candidate warning in another section |
| D-03 | Reviewer attempts approval without sufficient duplicate rationale | Blocked |
| D-04 | Reviewer justifies repeat purchase with explanation | Approval + resolved warning + auditable reason |
| P-01 | Purchaser records PO linked to approved request, correct item/qty | Allowed, linked to originating section |
| P-02 | Purchaser records unrelated item on linked PO | Blocked |
| P-03 | Two purchases cumulatively exceed approved quantity | Second blocked even under concurrent requests |
| P-04 | Historical purchase without an authorised section | Blocked |
| R-01 | Receiver records 2 partial deliveries | Sum may equal, not exceed original order |
| R-02 | Receiver attempts additional delivery exceeding ordered qty | Blocked including concurrent receipts |
| E-01 | Purchaser records expenditure evidence | Status REPORTED, not assumed paid |
| E-02 | Same purchaser verifies own evidence | Blocked |
| E-03 | Independent reviewer verifies/disputes with rationale | Recorded with audit timestamp and actor |
| G-01 | Data API attempts direct INSERT/UPDATE on finance tables | Blocked; RPC actions enforce roles |
| G-02 | Anonymous requester calls sensitive RPCs/reports | Blocked |
| G-03 | Private evidence bucket public URL request | Denied; uploading requires later approved policies |
| G-04 | Staff views another staff member's profile or full audit | Denied unless administrator/auditor as designed |
| T-01 | Create 1,000+ purchase lines | Database report totals cover full dataset, not first 500 UI records |
| T-02 | Verify empty install still contains no NJSS entries | Zero NJSS user records, transactions and documents |
| T-03 | Export restore point and recover test instance | Full agency-local recovery evidence |

**Go-live gate:** clean migration success, RLS/RPC negative tests, user-level UAT, concurrency, evidence security, recovery and agency sign-off. Do not treat Node static-contract tests as SQL/UAT passes.

## Step 3 v0.3 document and branding acceptance
- [ ] Authenticated requester uploads a PDF to own DRAFT requisition; another requester cannot upload there.
- [ ] Reviewer and auditor can open permitted attachments only through short-lived signed URLs; anonymous downloads must fail.
- [ ] HTML/mismatched file signatures, oversized PDFs, double-extension executables and unsupported MIME types must be rejected.
- [ ] Ordinary staff cannot upload branding; administrator can upload PNG/JPEG agency logo.
- [ ] Every attachment record and branding upload produces corresponding agency-local audit events.
- [ ] A second independent agency project cannot resolve any signed URL, role identity or private document belonging to the first (separate credentials/storage).
- [ ] First administrator script refuses an NJSS URL, mismatched project reference, unconfirmed email and nonempty staff directory.
- [ ] Re-run a source-locked `npm install` and full `next build` in a networked CI job; production release requires a committed lockfile.
