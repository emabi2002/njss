# Import the full standalone source into a controlled GitHub project

**Recommendation:** import into a **new private master-product repository**, not the publicly visible NJSS operational repository, unless the software owner explicitly chooses otherwise.

The v0.2 ZIP is the complete **22-file source snapshot**. GitHub draft PR #64 currently contains incremental helpers and documentation only. It is **not** a fully imported or deployable build.

## Windows PowerShell (example using a fresh private repository)

1. Download the ZIP to a local folder such as `Downloads`.
2. Extract: `Expand-Archive .\Agency_Internal_Monitor_Step3_Development_v0.2.zip .\extracted -Force`.
3. In a separate folder, clone the new master product repository supplied by its owner: `git clone <YOUR-APPROVED-PRIVATE-REPOSITORY-URL>`.
4. Copy the **contents** of `extracted\agency-monitor` into the checked-out private repository folder. Do not copy any real agency database dump or local `.env` file.
5. Create an implementation branch: `git checkout -b feature/independent-monitor-v0.2`.
6. Review changes for credentials and license ownership, then `git add .`, `git commit -m "feat: add independent agency monitoring v0.2"`, and `git push -u origin feature/independent-monitor-v0.2`.
7. Open a draft PR for the full source; require dependency lockfile, build, tests and a new-project SQL/RLS UAT gate before merge.

Existing NJSS production remains untouched. GitHub authorization, project provisioning and production changes are separate decisions.
