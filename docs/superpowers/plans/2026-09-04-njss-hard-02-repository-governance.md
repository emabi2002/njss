# NJSS-HARD-02 Repository Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `main` a controlled release branch whose merges require successful CI and whose production releases retain immutable SHA and approval evidence.

**Architecture:** GitHub Actions remains the single validation workflow. Repository governance is made testable in-repo through a regression script that asserts CI least-privilege/concurrency configuration and the presence of an authoritative release-governance policy. Owner-level branch protection is verified separately because GitHub branch rules are external repository state.

**Tech Stack:** GitHub Actions, Node.js regression scripts, Next.js repository metadata and release documentation.

**Spec:** `docs/superpowers/plans/2026-09-04-njss-hardening-programme.md`

## Global Constraints

- `main` is never used as a development branch.
- Required CI job name is `Build and validate`.
- Merge approval does not authorize production deployment.
- Production database migration requires separate explicit approval.
- Production acceptance requires exact equality between approved source commit SHA and deployed commit SHA.
- No Supabase migration or production deployment is part of HARD-02.

---

### Task 1: Repository governance regression — RED

**Files:**
- Create: `scripts/repository-governance.test.mjs`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: repository CI YAML and release-governance document path.
- Produces: executable regression that exits non-zero until least-privilege CI, concurrency and release-governance requirements exist.

- [ ] **Step 1: Write the failing test**

Create `scripts/repository-governance.test.mjs` that reads `.github/workflows/ci.yml` and `docs/governance/NJSS_RELEASE_GOVERNANCE.md`, requiring `permissions: contents: read`, CI concurrency with `cancel-in-progress: true`, pull-request targeting of `main`, approval-separation phrases, SHA evidence and rollback requirements.

- [ ] **Step 2: Wire the test into CI**

Add:

```yaml
      - name: Repository governance regression checks
        run: node scripts/repository-governance.test.mjs
```

before lint.

- [ ] **Step 3: Open/update the HARD-02 pull request and run CI**

Expected: `Build and validate` fails specifically because least-privilege/concurrency/release-governance controls are absent.

### Task 2: CI least privilege and deterministic PR validation — GREEN

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: read-only Actions token, PR validation scoped to `main`, superseded-run cancellation and bounded job timeout.

- [ ] **Step 1: Add workflow permissions**

```yaml
permissions:
  contents: read
```

- [ ] **Step 2: Scope pull requests to main**

```yaml
pull_request:
  branches: [main]
```

- [ ] **Step 3: Add concurrency**

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true
```

- [ ] **Step 4: Bound the build job**

```yaml
    timeout-minutes: 25
```

### Task 3: Authoritative release-governance control — GREEN

**Files:**
- Create: `docs/governance/NJSS_RELEASE_GOVERNANCE.md`

**Interfaces:**
- Produces: release policy used by HARD-02 regression and later HARD-49/HARD-50 evidence.

- [ ] **Step 1: Document protected-main and PR requirements**

Require isolated branches, pull requests, exact-head CI evidence and explicit merge authorization.

- [ ] **Step 2: Document deployment/migration separation**

Include exact text that merge approval does not authorize production deployment and that production database migration requires separate explicit approval.

- [ ] **Step 3: Document SHA verification and rollback evidence**

Require approved source commit SHA, deployed commit SHA, exact equality, smoke/UAT evidence, migration list, backup/restore reference and rollback evidence.

### Task 4: Verify GREEN and external GitHub rule state

**Files:**
- No application files.

**Interfaces:**
- Consumes: PR head SHA, GitHub Actions result, live branch/ruleset metadata.
- Produces: HARD-02 closure evidence.

- [ ] **Step 1: Run CI on the final PR head**

Expected: `Build and validate` succeeds.

- [ ] **Step 2: Configure/verify `main` branch protection**

Owner-level rule must require pull requests, require the `Build and validate` status check, disallow force pushes and deletion, and disallow routine bypass.

- [ ] **Step 3: Verify live protection metadata**

Expected: GitHub reports `main` protected and required status-check enforcement enabled.

- [ ] **Step 4: Record closure evidence**

Do not merge or deploy as part of HARD-02 implementation evidence. Present the PR, exact head SHA and CI/protection results for controlled merge review.