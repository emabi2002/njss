import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // These two controlled budget workspaces perform authenticated async data
  // hydration on initial mount/year-selection changes. The state updates occur
  // inside the awaited loader callbacks rather than as derived synchronous
  // effect state, so keep the exception tightly scoped to these workspaces.
  {
    files: [
      "app/dashboard/budget-template/page.tsx",
      "app/dashboard/budget/activation/page.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Standalone Node/Bun maintenance scripts (not part of the app bundle):
    "scripts/**",
    // Supabase Edge Functions run under Deno and are validated by Supabase,
    // not by the Next.js browser/server TypeScript environment.
    "supabase/functions/**",
  ]),
]);

export default eslintConfig;
