# NJSS Release Governance

## Purpose

This document is the authoritative repository and release-control policy for NJSS. Application changes, database migrations and production deployments are separate controlled events. A successful technical change is not considered released until its source SHA, approval evidence, deployment evidence and post-deployment validation are reconciled.

## Protected `main` branch

`main` is the controlled release branch. Normal development must never be committed directly to `main`. Every change must originate from an isolated branch and enter `main` through a pull request.

The repository owner must protect `main`, require the `Build and validate` CI check before merge, prevent force pushes and branch deletion, require review where an independent reviewer is available, and prevent routine bypass of the pull-request gate.

## Pull-request gate

Every pull request must identify its NJSS-HARD/task scope, affected application/database components, migrations, RBAC/RLS implications, regression evidence and rollback implications.

The full CI workflow must pass on the exact PR head proposed for merge. A later commit invalidates earlier CI evidence and requires a fresh successful run.

Merge requires explicit release approval from the NJSS project authority.

**Merge approval does not authorize production deployment.**

## Database migration gate

Every database migration must be listed in exact execution order and reconciled against the target Supabase migration/schema state before execution.

**Production database migration requires separate explicit approval.**

No pull-request approval, merge, application deployment, UAT approval or previous migration approval implicitly authorizes a new production database change.

Historical migrations that may already have been applied are not renamed or rewritten merely to normalize numbering. Migration-ledger and schema-drift reconciliation precede any corrective migration.

## Deployment gate and SHA verification

Before production deployment, record the exact approved source commit SHA from `main` as the **approved source commit SHA**.

The deployment platform must expose the immutable source SHA used for the production build through NJSS release/System Information metadata. After deployment, record that value as the **deployed commit SHA**.

The deployed commit SHA must exactly equal the approved source commit SHA. A mismatch blocks production acceptance and requires investigation or rollback.

## Release evidence record

Every production release must retain:

- NJSS-HARD/task identifier;
- pull-request number;
- approved source commit SHA and merge commit where applicable;
- successful `Build and validate` CI evidence for the exact approved SHA;
- exact migration list and migration approval where applicable;
- production deployment approval;
- deployed commit SHA and build/deployment timestamp;
- post-deployment smoke/UAT evidence;
- database backup/restore reference when database changes are involved;
- unresolved-risk decision, if any;
- rollback decision, procedure and outcome when rollback is required.

## Rollback

A failed CI gate, source/deployed SHA mismatch, migration validation failure, security regression, financial-integrity regression or failed production smoke test blocks release closure.

Use the documented application rollback or database restore/recovery procedure appropriate to the change. Never hide a failed release by overwriting evidence, deleting audit history or silently applying a corrective production mutation outside the controlled migration process.

## Approval separation

The normal control sequence is:

Specification / approved task -> RED test -> implementation -> GREEN regression -> full CI -> pull-request review -> explicit merge approval -> merge -> separate production migration approval when applicable -> separate production deployment approval -> deployed SHA verification -> smoke/UAT evidence -> task closure.

## HARD-02 branch-protection acceptance criteria

HARD-02 is not complete until live GitHub repository state verifies that:

1. `main` is protected.
2. Changes to `main` require a pull request.
3. `Build and validate` is a required status check.
4. Force pushes are disabled.
5. Branch deletion is disabled.
6. Routine bypass of the rule is disabled.
7. Repository CI remains least-privilege and successful on the final PR head.
