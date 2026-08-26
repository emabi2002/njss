# NJSS Four-Group RBAC Design

## Purpose

Redesign the existing NJSS RBAC framework around four operational access groups plus the protected System Administrator role, while preserving existing FF3, FF4, payment and audit history.

## Controlled groups

1. **Requisition Officer** — section-scoped. Creates and manages FF3 requisitions, creates suppliers, and views section reports and relevant section budget/commitment information.
2. **Line Supervisor** — section-scoped. Prepares section budgets, submits budgets to the Registrar, endorses/returns FF3 requisitions, creates suppliers, and views section reports.
3. **Registrar** — system-wide business access. Approves/rejects budgets and FF3 requisitions and has organisation-wide reporting visibility.
4. **Payment/Reconciliation Officer** — system-wide business access. Manages FF4/payment processing, records payment outcomes, performs reconciliation, and sees all departments/sections plus outstanding-payment statistics.
5. **System Administrator** — protected technical role with full system access; not a business workflow role.

## Access model

`User -> Major Group -> Inherited Permissions -> Visible Modules/Menus -> Allowed Actions -> Data Scope`

Normal user provisioning must require the administrator to select the user's organisational assignment and one controlled group. Permissions are inherited from the group automatically; administrators should not assign individual permissions during routine provisioning.

The existing advanced permission matrix remains available to authorised technical administrators for controlled role configuration.

## Data scope

Add `SECTION_WIDE` as a first-class scope.

- Requisition Officer: `SECTION_WIDE`
- Line Supervisor: `SECTION_WIDE`
- Registrar: `SYSTEM_WIDE`
- Payment/Reconciliation Officer: `SYSTEM_WIDE`
- System Administrator: `SYSTEM_WIDE`

For section-scoped users, records must match the authenticated user's `section_id`. This restriction must be enforced by server/API/database authorization as well as UI filtering.

## Permissions

### Requisition Officer

- `dashboard.view`
- `ff3.view`, `ff3.create`, `ff3.edit`, `ff3.delete`, `ff3.submit`, `ff3.print`, `ff3.export`
- `supplier.view`, `supplier.create`
- `reports.view`, `reports.export`
- `budget.view`, `budget.report.view`
- `commitment.view`

### Line Supervisor

- `dashboard.view`
- `budget.template`, `budget.template.view`, `budget.template.create`, `budget.template.edit`, `budget.template.submit`
- `budget.view`, `budget.report.view`, `budget.report.export`
- `ff3.view`, `ff3.endorse`, `ff3.reject`, `ff3.print`, `ff3.export`
- `supplier.view`, `supplier.create`
- `commitment.view`
- `reports.view`, `reports.export`

### Registrar

- `dashboard.view`
- `budget.template`, `budget.template.view`, `budget.template.review`, `budget.template.approve`
- `budget.view`, `budget.report.view`, `budget.report.export`
- `ff3.view`, `ff3.approve`, `ff3.reject`, `ff3.print`, `ff3.export`
- `commitment.view`
- `ff4.view`
- `supplier.view`
- `reports.view`, `reports.export`
- `audit.view`, `audit.export`

### Payment/Reconciliation Officer

- `dashboard.view`
- `ff3.view`
- `commitment.view`
- `ff4.view`, `ff4.create`, `ff4.edit`, `ff4.submit`, `ff4.verify`, `ff4.process`, `ff4.reconcile`, `ff4.print`, `ff4.export`
- `supplier.view`
- `reports.view`, `reports.export`
- `budget.view`, `budget.report.view`

### System Administrator

- `all`

## Workflow

### Requisition

Requisition Officer -> Submit FF3 -> Line Supervisor Endorse/Return -> Registrar Approve/Reject -> Commitment -> Payment/Reconciliation Officer -> FF4/Payment/Reconciliation.

### Budget

Line Supervisor -> Prepare/Edit Section Budget -> Submit -> Registrar Approve/Reject.

## Supplier rule

Only Requisition Officer and Line Supervisor receive normal operational `supplier.create`. Registrar and Payment/Reconciliation Officer may view supplier records but do not create suppliers through their business roles.

## Reporting rule

- Requisition Officer: own and authorised section requisition/activity reports; section data, not only personally created records.
- Line Supervisor: all authorised reports for the assigned section.
- Registrar: all departments and sections.
- Payment/Reconciliation Officer: all departments and sections, including outstanding, partially paid, paid and unreconciled statistics.
- System Administrator: unrestricted.

## Migration

Create an additive migration after migration 044. Do not modify historic migrations.

Map existing controlled roles as follows:

- `FF Requisition Officer` -> `Requisition Officer`
- `Line/Section Supervisor` -> `Line Supervisor`
- `Registrar` -> `Registrar`
- `FF4 Officer` -> `Payment/Reconciliation Officer`
- `Accounts Reconciliation Officer` -> `Payment/Reconciliation Officer`

Preserve existing user department/section assignments and audit history. Retire superseded controlled role names without deleting historical role rows referenced by audit records.

## Security constraints

- One business workflow group per normal staff account.
- System Administrator cannot also hold a business workflow group.
- Menu visibility is not authorization; APIs and database operations must independently enforce permissions and scope.
- Self-approval and incompatible workflow actions remain prohibited even for broad business access.
