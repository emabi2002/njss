# Division budget ledger categories and Registrar approval

Date: 2026-09-30
Status: Design for review

## Purpose and scope

NJSS Head Office in Waigani records one annual budget for each division. Each division first sends a detailed printed budget to the Registrar's Office. The Registrar signs or stamps that printout before data entry. A receiving officer then attaches the signed or stamped document and keys the approved figures against individual ledgers. The Registrar reviews the electronic figures against the document and approves the electronic budget. This design covers budget preparation and approval, not spending, funding allocation, or production migration.

The supplied Sheriff example defines the presentation order and the meaning of its yellow headings. The source's four-digit codes are not identical to the current UAT ledger's finance codes, so the catalogue must be reconciled before any legacy amount is treated as an approved posting.

## Ledger catalogue

Represent each yellow heading as an active, non-posting master ledger category. Its children are posting sub-ledgers with their own stable finance codes and descriptions. A child belongs to exactly one master category; the category has a display order. The existing expense_ledger.is_posting and parent_ledger_id fields can carry the hierarchy if constraints and catalogue management enforce it consistently. Amounts may be entered only on active posting children. Category subtotals are calculated from children and are never stored as separate budget lines. Inactive categories and children remain visible in historical approved budgets through a stable code/description snapshot or retained master records.

Map the sample's headings and sub-ledgers into a reviewed catalogue. Resolve duplicate or ambiguous old codes, conflicting captions, and the difference between four-digit source codes and the current UAT finance codes before seeding. Do not silently collapse separate source rows, or use a category as a substitute for an unmapped posting code. The ledger mapping review explicitly covers 7847 construction, 7835 plant, and 7852 ICT projects.

## Data and documents

Retain annual_budget_cycles, division_budgets, division_budget_lines, and budget_documents. Each division has its own budget record for each cycle and its own submitted signed or stamped document. An attachment for one division cannot satisfy another division's submission, even when the same officer prepares both. Lines remain unique by division budget, section, and posting ledger; the screen aggregates the same ledger across sections for category display.

Every line explicitly identifies its owner: either the division as a whole or one named section/unit belonging to that division. A division can have several sections/units, each with its own lines under the same posting ledger. Since the current schema requires section_id, represent the explicit “Division-wide” choice with a designated section row belonging to that division and validate its type; do not silently assign a line to Enforcement or another operational section. Register actual units as division-owned sections in the current organisation catalogue when they are used for budgeting. The receiving officer chooses the allocation on each line based on the division's approved submission. The printed Sheriff example has no section breakdown, so its amounts remain division-wide until a signed division submission provides an allocation. Totals sum division-wide and section/unit lines once each, with section subtotals available for multi-section divisions.

Use an OFFICIAL_APPROVED_BUDGET document in the existing private budget bucket for the signed or stamped printout. The receiving officer records the manual approval date/reference and attaches the document before submitting the electronic entries. A working spreadsheet may be attached as supporting material, but it does not replace signed or stamped approval evidence. Keep version lineage for replacement documents, and let authorized reviewers open the private file.

Store electronic submission and approval details separately: submitted_by/at; approved_by/at; and an approval snapshot or revision number tying the Registrar's action to the exact lines and official document reviewed. Preserve the existing original amounts and document history. A correction after approval follows a controlled revision and requires a fresh Registrar review, rather than editing an approved line in place.

## Workflow and access

1. Division sends detailed printout. Registrar signs or stamps it outside NJSS.
2. Receiving officer creates or opens a DRAFT division budget, records manual approval details, uploads that division's signed or stamped submission, and enters each posting ledger amount against Division-wide or a named section/unit of that division.
3. On Submit, the server checks the Head Office division, financial year, active posting ledgers, the explicit division/section choice on every line, ownership of each chosen section/unit, nonnegative figures, that division's own official document, and at least one line. Status becomes PENDING_REGISTRAR_APPROVAL. The receiving officer can no longer change the submitted version without withdrawal or return.
4. Registrar opens a review page showing the attached document, entries grouped by master ledger, category subtotals, division-wide and per-section/unit detail, and division total. Registrar either returns it with a reason or approves it electronically. Approval records actor/time and document/version/amount fingerprint, then locks the original approved budget.
5. A returned submission becomes editable with its return reason and audit history. On resubmission it gets a new review version. Only an electronically approved division budget contributes to the ready-for-activation check; activation remains a separate controlled step.

Separate capture/submit permission from Registrar review/approve permission. Remove budget.lock from the receiving Budget Officer role if it is the capture role, and grant the approval action only to the configured Registrar authority. Enforce actor separation and state transitions in authenticated server-side RPCs, not only hidden UI buttons. Retain RLS and the private storage policies; check the current grant matrix before migration so legitimate users retain read access.

## Interface

The preparation screen lists one division and year at a time and shows only that division's attachment. Each ledger amount requires a visible Division-wide or named section/unit selection, filtered to the selected division; multiple sections/units may use the same ledger. Master categories are visible group headings with calculated subtotals; only posting children have editable amounts. The document, manual approval details, line entries, and totals are available before Submit. Draft saves remain possible. The Registrar review screen compares the signed attachment and submitted figures, with Approve and Return actions and a clear audit trail. Export/print shows the same category hierarchy and category and division totals.

## Verification and UAT

Test unauthorized approval, self-approval, absent signed document, attempts to post to master categories, wrong-division sections/units, missing allocation selections, a document attached to the wrong division, duplicate lines, return/resubmit, stale review versions, and edits after approval. Reconcile category subtotals to posting children and division totals to all lines. Replay the Sheriff source as historical UAT material only after code mapping and the Lae/Head Office scope are resolved; do not migrate its figures into production automatically.

## Existing implementation to change

The current foundation migration has DRAFT/LOCKED states, a private budget_documents register, and lock_division_budget requiring OFFICIAL_APPROVED_BUDGET. The budget-template page currently displays a flat active posting ledger list. The foundation grants budget.capture and budget.lock to Budget Officer. The change adds the pending/return review states and separate Registrar authorization, strengthens document/version linkage, and groups the UI with the existing ledger hierarchy. The designated Division-wide section and division-owned unit records require catalogue validation, without changing the existing non-null section_id contract. Existing locked budgets need a compatibility/backfill rule without weakening their immutability.
