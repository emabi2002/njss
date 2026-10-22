# Step 1 — Independent Agency Internal Requisition & Expenditure Monitoring System
**Project:** Reusable Internal Requisition & Expenditure Monitoring System (working description; official product name pending)  
**Version:** 1.2 — product scope corrected  
**Updated:** 22 October 2026  
**Status:** Architecture and product-scope decision; no production change  
**Reference application:** NJSS CREMS

## 1. Authoritative product purpose

Build an **independent internal requisition, purchasing-history and expense monitoring tool** for any government agency. It is a departmental **management and internal control system**, not an official accounting ledger, not a government financial management ERP and not a replacement for the Integrated Financial Management System (IFMS).

**IFMS integration is explicitly OUT OF SCOPE.** Do not design IFMS connectors, synchronisation, exports for automated IFMS posting, interfaces or integration dependencies as part of the product roadmap. The application operates independently.

The business problem: divisions and sections may purchase the same goods repeatedly without being able to find prior requests, purchases, quantities, vendors or expenditure by item. The tool must make those records accessible and provide duplicate-purchase warnings before approval.

The product must answer: what was requested, endorsed, approved, ordered, received and internally recorded as spent; by which section, on what item, from which supplier, in what quantity, at what price, and when; and whether there is a recent/pending similar purchase.

## 2. Deployment decision: completely independent agency installations

Every adopting agency receives its own application project/deployment, new Supabase project, new PostgreSQL database, independent Auth users, Storage buckets, keys, backups and operations. Separate UAT and production projects when required. There is **no shared cross-agency database or runtime application** and no central store of agency expenditure records.

Only master source code, migrations, generic reference definitions, user-interface conventions and tested releases are reused. NJSS remains a separately configured installation and is never the source of copied operational records for another agency.

Do not add tenant IDs to every table to simulate multi-tenancy. Access scope inside each agency is by user, section, division and authorised role.

## 3. Core functional scope

1. **Agency onboarding/identity:** agency name, official logo, address, contacts, branding, locations, divisions, sections, cost centres (optional organisational reporting tags), approvers and users.
2. **Item catalogue:** standard internal expense categories, agency-configurable item names/codes, item description, unit of measure, supplier references, normalized aliases, quantities, indicative prices, and optional item identifiers/SKUs.
3. **Requisitions:** staff request items/services with quantity, expected unit cost, purpose, section, attachments and required-by date; line items are searchable and traceable.
4. **Internal approval controls:** supervisor/authorised officer checks, spending limits, maker-checker segregation, review history, return/reject and rationale.
5. **Duplicate-purchase review:** search pending, approved, ordered and received purchases for same/similar items before approval; warn on matching aliases, item codes, supplier, quantities, date windows or overlapping requests. **Warnings require explicit review and reasoned overrides**, not silent auto-rejection.
6. **Purchase/receipt register:** capture supplier, purchase reference, purchase date, unit price, quantity, order and receipt evidence, received quantity and delivery status. The system records actions; it does not issue bank payments.
7. **Internal expenditure tracking:** record expenditure amounts and evidence as reported/verified by authorised agency officers, and record source/status separately. Do **not** claim that an internal entry represents an official IFMS posting or bank settlement.
8. **Management dashboards:** expenditure and quantity by period, item, supplier, section/division; purchased item history, repeat-purchase alerts, pending requests, overdue delivery, approval turnaround and configurable internal planned spending ceilings.
9. **Audit and documentation:** immutable event history, supporting attachments, access controls, private document storage, exportable internal management reports and retention configuration.

## 4. Strict exclusions and scope guardrails

- No IFMS integration, interfaces, mapping to IFMS posting codes or IFMS implementation dependency.
- No accounting general-ledger or statutory financial-statement engine.
- No bank payment execution, funds transfer, settlement authority or payment gateway.
- No automatic assertion that "approved" means "purchased", "received" or "paid".
- No common cross-agency user database, agency operational database, central payment service or shared financial ledger.
- No mandatory procurement award/e-tendering system; only register purchasing/requisition data needed for internal monitoring.
- No requirement for agencies to adopt NJSS's court-specific forms. FF3/FF4 terminology, Registrar stages and court-location controls are an **optional NJSS workflow template** rather than the default for every agency.

## 5. Standardized product versus agency setup

**Standard application:** user and role framework, approvals and audit patterns, item catalogue fields, purchase/receipt history model, item-level search, duplicate detection logic, standard management reports, data security and release tests.

**Configurable per agency:** institutional identity/logo/addresses, department/division/section hierarchy, authorised officers and approval limits, categories and ledger *labels used for internal reporting*, item codes/aliases, supplier master, document templates, approval stages, fiscal/reporting periods, colours and enabled optional modules.

The word *ledger* in this product means **internal expenditure category or monitoring register**, not government GL bookkeeping. A local "spent" entry must carry a verification/source status. Financial accuracy still requires decimal currency calculations, authorisation and corrections by auditable reversals.

## 6. Proposed internal process

```text
Request initiated → Similar/Pending Purchase Check
      → Supervisor/Approver Review → Approved or Returned/Rejected
      → Purchase / Order Recorded → Delivery / Receipt Recorded
      → Internal Expenditure Evidence Verified → Closed / Reported
```

The stages are independently time-stamped and attributable. A requisition does not become an expense merely because it was submitted or approved. Payment may optionally be *recorded as reported* with evidence, but the tool is not an authoritative financial settlement source.

## 7. Duplicate purchasing controls

For each proposed purchase line:
- Compare normalized description / item identifier, unit of measure, category, section and supplier with prior **pending requests and completed purchases**;
- Scan configurable short and extended windows (e.g., 30/90/365 days);
- Show matches with request number, description, order/purchase date, supplier, quantity, price and owning section;
- Highlight possible duplicated or fragmented orders across divisions; avoid presenting similarity as proof of waste;
- Permit authorised reviewer overrides with mandatory explanation; retain all warnings and decisions in audit log;
- Track rates of repeated requests, overrides and verified avoidable purchases as distinct metrics.

## 8. Current NJSS read-only baseline

- Connected GitHub repository `emabi2002/njss` uses Next.js/React/TypeScript and Supabase.
- The connected NJSS system has organisation, cost centre, budget, FF3/FF4, expense ledger, supplier, document, reporting and permissions infrastructure.
- Hard-coded NJSS terms, court location rules, initial seed data and multiple historical budget approaches must be extracted or restricted to NJSS-only configuration.
- Existing agency database remains unchanged. Do not use a copied NJSS database as the template.
- Existing public attachment/quotation bucket access and some database-function advisor findings need dedicated security review.
- Master-template preparation must preserve working NJSS UAT and production behavior until validated.

## 9. Independent agency provisioning

Authorised agency request → issue approved template release → provision an isolated application project/deployment → provision a brand-new Supabase project/database/Auth/Storage → apply vetted **clean schema** and non-sensitive generic setup seed → configure agency logo/address/organisation/categories/approvers → create first authorised administrator through secure invitation → complete standalone controls and history tests → agency UAT → agency go-live and independent support.

No paid projects or production changes are authorised solely by this document.

## 10. Implementation stage gates

**Step 1:** approve purpose, independent-agency topology and exclusions (this architecture document).  
**Step 2:** audit NJSS source/database; classify shared reusable modules, NJSS-specific features, legacy accounting-oriented parts and feature gaps; prepare extraction plan.  
**Step 3:** develop independent master-template code, clean schema, item catalogue, purchase register, duplicate controls and agency setup, with tests in approved non-production environment.  
**Step 4:** complete configurable UI, dashboards and controlled workflows; preserve NJSS optional forms.  
**Step 5:** deploy an empty synthetic second-agency pilot and validate workflows, duplicate warnings, access controls, backup/recovery, reports and independence.

## 11. Change control and explicit withdrawal of previous scope

**Withdrawn from all earlier concept proposals:** shared multi-tenant operating model; adding tenant IDs for cross-agency separation; **IFMS integration**; "Government Financial Management Platform" positioning as a full ERP; formal official general ledger and payment settlement capabilities as product requirements.

**Still valuable but repurposed:** NJSS's budget, ledger and FF3/FF4 infrastructure can support internal spending ceilings, expense classification, requisitions, evidence and controls, once stripped of unnecessary accounting/settlement assumptions. No source-code deletion or live migration is approved by this document.

**Open decisions:** product name and commercial licensing; item master and duplicate match thresholds; required proof for expenditure recording; default approval hierarchy; reporting vocabulary; government hosting/retention; agency ownership and release support contract.

**Acceptance:** Step 1 purpose and architecture corrected. Existing NJSS data, Supabase project and production environment remain untouched.
