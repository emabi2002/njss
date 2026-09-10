# NJSS AI Reporting Agent — Deployment and UAT Runbook

## Purpose

This runbook activates the natural-language AI Reporting Assistant without weakening NJSS authentication, RBAC, Supabase RLS, or the read-only SQL controls already implemented in the application and database.

## Active deployment target

The active Netlify project for this repository is `njsscrem`.

Current PR #33 deploy preview pattern:

- `https://deploy-preview-33--njsscrem.netlify.app`

A second Netlify project named `njsscrems` has also posted failed preview notifications. Treat it as a separate/legacy deployment target unless it is deliberately brought back into service.

## Required server-side Netlify variables

Configure these on the active `njsscrem` site. Never expose them with a `NEXT_PUBLIC_` prefix.

```text
OLLAMA_BASE_URL=https://<reachable-ollama-or-proxy-host>
REPORT_MODEL=qwen3-coder:30b
OLLAMA_API_KEY=<optional-token-if-the-proxy-requires-it>
REPORT_MODEL_TIMEOUT_MS=25000
```

Requirements:

1. `OLLAMA_BASE_URL` must be reachable from Netlify's server runtime. `localhost` on the Netlify function points to the function container, not an office/server-hosted Ollama instance.
2. Prefer HTTPS and an authenticated reverse proxy in front of Ollama rather than exposing the native Ollama listener directly to the public Internet.
3. If an API key is required by that proxy, store it only as `OLLAMA_API_KEY` in Netlify environment variables.
4. Keep the model temperature at the application-defined deterministic value. Do not weaken the SQL guard to accommodate model output.
5. The application must continue to call Supabase with the signed-in user's JWT. Do not add a service-role fallback for AI reports.

## Preview UAT sequence

1. Configure the variables above for deploy previews on `njsscrem`.
2. Redeploy PR #33 so the preview receives the new runtime variables.
3. Sign in with a non-admin UAT user that has `reports.view` plus the domain permission required by the report being tested.
4. Run at least one report from `/dashboard/reports/ai` in each authorized domain relevant to that user's role.
5. Confirm the response shows a narrative, returned rows, generated SQL, category, source tables, elapsed time, and CSV export.
6. Confirm an unauthorized reporting category returns HTTP 403 and no report rows.
7. Confirm a prompt attempting SQL mutation, multiple statements, internal schemas, or prompt-injection instructions does not bypass the application guard.
8. Confirm the generated SQL executes only through `exec_report_sql` under the signed-in user's RLS scope.

## Automated live smoke harness

Use a short-lived Supabase UAT access token. Do not commit the token or paste it into issue/PR comments.

```bash
NJSS_BASE_URL=https://deploy-preview-33--njsscrem.netlify.app \
NJSS_ACCESS_TOKEN=<short-lived-user-token> \
node scripts/ai-report-agent-smoke.mjs
```

Optional overrides:

```text
NJSS_REPORT_QUESTION="Show outstanding FF3 commitments by department"
NJSS_REPORT_MAX_ROWS=25
NJSS_REPORT_SMOKE_TIMEOUT_MS=60000
```

The smoke harness fails unless the deployed endpoint returns HTTP 200 and the required response contract (`sql`, `category`, `tables`, `narrative`, `rows`, `rowCount`, `truncated`, `ms`) is present. It also rejects returned SQL containing mutation/DDL keywords.

## Production activation order

Do not expose the AI menu before the model path is proven on the preview.

1. Preview runtime configured and deploy successful.
2. Preview authenticated smoke test passes.
3. PR #33 CI is green on the exact merge head.
4. Merge PR #33 to `main`.
5. Confirm the active `njsscrem` production deployment completes.
6. Run the authenticated smoke harness against the production base URL.
7. Only after the production smoke succeeds, apply `supabase/migrations/20260911090000_ai_reporting_agent_navigation.sql` to the NJSS Supabase project.
8. Confirm `AI Report Assistant` appears in the Reports module only for users with `reports.view`.

## Rollback

If production AI runtime verification fails after the code deployment:

- Do not apply the navigation migration, or set the `reports.ai_agent` menu item inactive if it was already activated.
- Keep the existing Management Reports and Management Drill-Down workspaces unchanged.
- Revert or redeploy the application commit if the issue is application-side.
- Remove/rotate a compromised model-proxy key immediately; never solve connectivity by exposing an unauthenticated Ollama listener.

The database reporting RPCs remain read-only and RLS-bound independently of the menu visibility, so disabling the menu is a presentation rollback rather than a security control.
