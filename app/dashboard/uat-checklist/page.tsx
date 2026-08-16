"use client"

import { AlertTriangle, CheckSquare, ClipboardCheck, ShieldCheck } from "lucide-react"
import { PagePermissionGate } from "@/components/PermissionGate"

type UatRow = {
  testNo: string
  function: string
  scenario: string
  expectedResult: string
}

const uatRows: UatRow[] = [
  {
    testNo: "UAT-001",
    function: "Migration readiness",
    scenario: "Confirm migrations 000 through 028, plus any Phase 6 additive migration, are applied in order in the target Supabase project.",
    expectedResult: "Database schema contains all authoritative Phase 1-5 transaction and reporting objects without modifying earlier migrations.",
  },
  {
    testNo: "UAT-002",
    function: "Budget to reporting reconciliation",
    scenario: "Create one realistic K500,000 approved budget, K400,000 funded allocation, and K300,000 release for a real department/section/expense code.",
    expectedResult: "Dashboard and budget-position reports show Approved K500,000, Funded K400,000, Released K300,000 before commitments and payments.",
  },
  {
    testNo: "UAT-003",
    function: "FF3 commitment control",
    scenario: "Create and approve one K60,000 FF3 for ABC Office Supplies from the released budget line.",
    expectedResult: "A single K60,000 commitment is created; duplicate commitment attempts are rejected; available balance is reduced only once.",
  },
  {
    testNo: "UAT-004",
    function: "Partial FF4 payments",
    scenario: "Create, verify, approve, process, mark paid, and reconcile two FF4s for K20,000 and K25,000 against the K60,000 commitment.",
    expectedResult: "Actual expenditure is K45,000; outstanding commitment is K15,000; supplier spend is K45,000; no double counting occurs.",
  },
  {
    testNo: "UAT-005",
    function: "Full payment workflow",
    scenario: "Create a second controlled commitment and liquidate it with a single full-value FF4 payment.",
    expectedResult: "Commitment status becomes fully paid after payment and reconciled after reconciliation, with audit trail entries for each step.",
  },
  {
    testNo: "UAT-006",
    function: "Financial control rejection tests",
    scenario: "Attempt FF3 above released funds, FF4 above remaining commitment, combined FF4s above commitment, duplicate payment, supplier mismatch, and invalid status jumps.",
    expectedResult: "Each attempt is rejected with a readable message and no partially updated financial records.",
  },
  {
    testNo: "UAT-007",
    function: "RBAC and segregation of duties",
    scenario: "Use Requesting Officer, Budget/Finance Officer, Approver, System Administrator, Auditor, and Management users to attempt allowed and prohibited actions.",
    expectedResult: "Menus and actions match assigned permissions; creators cannot perform prohibited final approval on their own transaction.",
  },
  {
    testNo: "UAT-008",
    function: "Report security and filters",
    scenario: "Open reports and directly query report views as restricted users; test financial year/date/status/report filters.",
    expectedResult: "Reports do not expose unauthorized rows and UI filters change the exported data set as labelled.",
  },
  {
    testNo: "UAT-009",
    function: "Audit trail integrity",
    scenario: "Review creation, submission, approval, commitment, payment, reconciliation, previous status, new status, actor, and timestamp audit records.",
    expectedResult: "Audit records are complete and cannot be edited or deleted through normal application access.",
  },
  {
    testNo: "UAT-010",
    function: "Attachments",
    scenario: "Attach supporting documents to FF3 and FF4 records, retrieve them, and test unauthorized access behaviour.",
    expectedResult: "Files are correctly associated with transactions, accessible only to authorized users, and missing attachments do not break workflow pages.",
  },
  {
    testNo: "UAT-011",
    function: "Error handling and resilience",
    scenario: "Simulate slow/failed database requests and repeated button clicks on workflow operations.",
    expectedResult: "The UI times out gracefully, avoids duplicate transactions, and shows user-readable messages while logging diagnostics.",
  },
  {
    testNo: "UAT-012",
    function: "Performance smoke test",
    scenario: "Load dashboard, budget position, FF3 register, commitment register, FF4 register, supplier spend, and audit log with realistic data volume.",
    expectedResult: "Common pages and reports load without hanging; further indexes are added only if measurements demonstrate a need.",
  },
]

const productionChecks = [
  "No demo or UAT data is included in production unless intentionally approved for training.",
  "Environment variables and production credentials are not committed to GitHub.",
  "RLS is enabled on financial, security, audit, user, and reporting tables that require protection.",
  "Direct writes to financial tables are blocked where controlled RPC workflows are required.",
  "Financial RPCs enforce permissions and segregation-of-duties rules.",
  "Report views are authenticated and do not bypass underlying transaction access controls.",
  "Audit logging works and audit history cannot be edited or deleted by ordinary users.",
  "Storage policies for FF3 and FF4 attachments match transaction access requirements.",
  "Backup and recovery arrangements are documented outside the application codebase.",
  "Application lint, typecheck, CI, and production build complete successfully.",
]

export default function UatChecklistPage() {
  const today = new Date().toLocaleDateString("en-GB")

  return (
    <PagePermissionGate permission="users.manage" title="UAT Checklist">
      <div className="space-y-6">
        <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-png-red">
              <ClipboardCheck className="h-4 w-4" />
              Phase 6 readiness
            </div>
            <h1 className="mt-2 text-2xl font-bold text-slate-900">NJSS UAT Checklist</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Use this checklist to execute and record real UAT results. Rows are intentionally unmarked; do not mark PASS until the test has actually been performed in the target environment.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            Prepared date: <span className="font-semibold text-slate-900">{today}</span>
          </div>
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <p>
              This page is a checklist template only. It does not create fake PASS results and does not insert test data into production. Execute UAT in the agreed environment and record the actual tester/date/comments before sign-off.
            </p>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-6 py-4">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <CheckSquare className="h-5 w-5 text-png-red" />
              Test execution record
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[1200px] w-full border-collapse text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 px-4 py-3">Test Number</th>
                  <th className="border-b border-slate-200 px-4 py-3">Function</th>
                  <th className="border-b border-slate-200 px-4 py-3">Scenario</th>
                  <th className="border-b border-slate-200 px-4 py-3">Expected Result</th>
                  <th className="border-b border-slate-200 px-4 py-3">Actual Result</th>
                  <th className="border-b border-slate-200 px-4 py-3">Pass/Fail</th>
                  <th className="border-b border-slate-200 px-4 py-3">Tester</th>
                  <th className="border-b border-slate-200 px-4 py-3">Date</th>
                  <th className="border-b border-slate-200 px-4 py-3">Comments</th>
                </tr>
              </thead>
              <tbody>
                {uatRows.map((row) => (
                  <tr key={row.testNo} className="align-top odd:bg-white even:bg-slate-50/60">
                    <td className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">{row.testNo}</td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-700">{row.function}</td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-600">{row.scenario}</td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-600">{row.expectedResult}</td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-400">To be recorded during UAT</td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-400">Not executed</td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-400">To be assigned</td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-400">To be recorded</td>
                    <td className="border-b border-slate-100 px-4 py-3 text-slate-400">To be recorded</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <ShieldCheck className="h-5 w-5 text-green-700" />
            Production readiness checks
          </h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {productionChecks.map((check) => (
              <div key={check} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                {check}
              </div>
            ))}
          </div>
        </div>
      </div>
    </PagePermissionGate>
  )
}
