"use client"

import Link from "next/link"
import { BookOpen, Printer } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"

const topics = [
  { id: "annual-budget", label: "Annual budget" },
  { id: "daily-work", label: "Daily workflow" },
  { id: "roles", label: "Roles and access" },
  { id: "checks", label: "Common checks" },
]

const roles = [
  ["Budget Officer", "Capture Division budgets, maintain signed authority documents, submit to the Registrar and correct returned budgets. Record authorised adjustments when assigned the relevant permission."],
  ["Registrar", "Review the submitted figures and signed document, return a budget with a reason or approve and lock it. Authorise annual activation and approve reallocations through the assigned controls. Approve eligible FF3 and FF4 requests."],
  ["Line Supervisor", "Review requisitions for the assigned Section, check their purpose and supporting evidence, and endorse or return them using the available workflow actions."],
  ["Requisition Officer", "Prepare and submit FF3 requests for the assigned Section, maintain supplier and quotation information, and respond to review feedback."],
  ["Payment/Reconciliation Officer", "Prepare and verify FF4 payments against approved commitments, process authorised payments, record payment references and reconcile transactions."],
]

export default function HelpPage() {
  const { can } = useAuth()
  const links = [
    { href: "/dashboard/budget", label: "Budget position", allowed: can('budget.view') },
    { href: "/dashboard/budget-template", label: "Capture and Registrar review", allowed: can('budget.capture') || can('budget.registrar.approve') },
    { href: "/dashboard/budget/activation", label: "Annual activation", allowed: can('budget.activate') || can('budget.documents.manage') },
    { href: "/dashboard/budget/adjustments", label: "Budget adjustments", allowed: can('budget.supplementary.enter') || can('budget.reallocation.request') || can('budget.reallocation.approve') || can('budget.reallocation.execute') },
    { href: "/dashboard/ff3", label: "FF3 requisitions", allowed: can('ff3.view') },
    { href: "/dashboard/ff4", label: "FF4 payments", allowed: can('ff4.view') },
    { href: "/dashboard/reports", label: "Head Office reports", allowed: can('reports.view') },
  ].filter(link => link.allowed || can('all'))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><BookOpen className="h-7 w-7 text-png-red" />Help &amp; User Guide</h1>
          <p className="mt-1 text-slate-600">NJSS Head Office annual budgets, requisitions and payments.</p>
        </div>
        <button onClick={() => window.print()} className="flex items-center gap-2 rounded-lg bg-png-red px-4 py-2 text-sm font-medium text-white print:hidden"><Printer className="h-4 w-4" />Print / Save as PDF</button>
      </div>
      <nav aria-label="Guide topics" className="flex flex-wrap gap-4 text-sm print:hidden">
        {topics.map(topic => <a key={topic.id} href={`#${topic.id}`} className="text-png-red hover:underline">{topic.label}</a>)}
      </nav>
      {links.length > 0 && <nav aria-label="Quick links" className="flex flex-wrap gap-2 print:hidden">{links.map(link => <Link key={link.href} href={link.href} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:border-png-red">{link.label}</Link>)}</nav>}

      <section id="annual-budget" className="scroll-mt-24 space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-slate-900">Prepare and activate the annual budget</h2>
        <p className="text-sm text-slate-700">Select the financial year and Head Office Division in the annual budget workspace. Capture each annual amount against its Section and expense ledger, including Division-wide items where applicable.</p>
        <ol className="list-decimal space-y-3 pl-5 text-sm text-slate-700">
          <li><strong>Capture and save.</strong> Budgets in DRAFT or RETURNED can be edited by authorised staff. Check the amounts against the Registrar-signed official budget, record the approval reference and date, and save all changes.</li>
          <li><strong>Record the official document.</strong> Upload the signed budget to the controlled document register. A corrected document is recorded as a new version with a reason; documents remain available through private, time-limited links.</li>
          <li><strong>Submit to the Registrar.</strong> Submission requires saved figures and an official document. The Division enters PENDING_REGISTRAR_APPROVAL and awaits electronic review.</li>
          <li><strong>Review and lock.</strong> The Registrar checks the submitted figures and document together. A return records a reason and allows correction and resubmission. Approval moves the Division to LOCKED and protects its original amounts.</li>
          <li><strong>Activate the annual cycle.</strong> When every required Division is locked, the cycle is READY_FOR_ACTIVATION. Record and select the Registrar Office activation authority, then use the authorised activation action. Only an ACTIVE cycle supplies approved funds for spending control.</li>
        </ol>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">PREPARATION totals show captured figures and review progress. A locked Division in a preparation cycle is still awaiting annual activation. CLOSED cycles do not provide a current spending balance.</div>
        <p className="text-sm text-slate-700">After activation, use supplementary budgets or reallocations to change the approved position. Supplementary adjustments require authority and posting. Reallocations require Registrar approval followed by execution; requests alone do not change the available balance.</p>
      </section>

      <section id="daily-work" className="scroll-mt-24 space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-slate-900">Daily requisition, payment and reporting workflow</h2>
        <ol className="list-decimal space-y-3 pl-5 text-sm text-slate-700">
          <li><strong>Check the annual position.</strong> Confirm the financial year is ACTIVE and review the relevant Division, Section and expense ledger. Current approved budget equals the original budget plus posted supplementary adjustments and executed reallocations in, less reallocations out.</li>
          <li><strong>Prepare the FF3.</strong> Select the correct Section and expense ledger, describe the goods or services, enter the supplier and quotation details, and attach the required evidence. Check the amount against available budget before submission.</li>
          <li><strong>Review and approve.</strong> Use the assigned workflow tasks to review supporting evidence and endorse or approve the requisition. A return or rejection records feedback. Approval establishes the commitment; a draft request does not reserve funds.</li>
          <li><strong>Prepare the FF4.</strong> Select the eligible approved FF3 or commitment, enter payment and invoice details, and attach supporting evidence. Check the payment against the outstanding commitment.</li>
          <li><strong>Verify, approve, pay and reconcile.</strong> FF4 progresses through SUBMITTED, VERIFIED, APPROVED, PROCESSED, PAID and RECONCILED. Use the actions permitted for your role, record the payment date and external reference, then reconcile against the payment evidence.</li>
          <li><strong>Review reports.</strong> Select the financial year and permitted Division, Section or ledger filters in Head Office reports. Compare original and current approved budgets, outstanding commitments, actual expenditure and available budget. Trace balances to their linked FF3 and FF4 records and export the results you are authorised to view.</li>
        </ol>
        <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-800"><strong>Available budget = current approved budget − outstanding commitments − actual expenditure.</strong><p className="mt-2">Payment posting moves the corresponding amount from outstanding commitment to actual expenditure. Check the linked transaction and its status when investigating a balance.</p></div>
      </section>

      <section id="roles" className="scroll-mt-24 space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-slate-900">Roles and access</h2>
        <p className="text-sm text-slate-700">Your assigned permissions and organisation scope determine which pages, records and actions are available. A role description does not grant access by itself.</p>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50"><tr><th className="px-4 py-3 text-left">Role</th><th className="px-4 py-3 text-left">Main responsibility</th></tr></thead><tbody>{roles.map(([role, description]) => <tr key={role} className="border-t border-slate-100"><th scope="row" className="px-4 py-3 text-left font-medium">{role}</th><td className="px-4 py-3 text-slate-700">{description}</td></tr>)}</tbody></table></div>
        <p className="text-sm text-slate-700">If a required page or action is missing, ask your system administrator to check your active account, role permissions, Division and Section assignment. Include the page and record reference in your request.</p>
      </section>

      <section id="checks" className="scroll-mt-24 space-y-4 rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-xl font-semibold text-slate-900">Common checks</h2>
        <ul className="list-disc space-y-3 pl-5 text-sm text-slate-700">
          <li><strong>Submission is disabled:</strong> save pending budget edits, record the official signed document, and confirm the Division is DRAFT or RETURNED.</li>
          <li><strong>Activation is unavailable:</strong> check that all required Divisions are LOCKED, the cycle is READY_FOR_ACTIVATION, the activation authority is selected, and your account has activation permission.</li>
          <li><strong>An FF3 fails its budget check:</strong> confirm an ACTIVE year, the correct Division/Section/ledger and enough available budget. Review outstanding commitments and actual expenditure before requesting an authorised adjustment.</li>
          <li><strong>An FF4 cannot proceed:</strong> check the linked commitment, remaining payable amount, supporting evidence, current workflow status and assigned permission.</li>
          <li><strong>A report looks incomplete:</strong> check the financial year, filters and organisation scope. Preparation figures appear in the annual budget workspace; active spending balances appear in the budget position and reports.</li>
        </ul>
      </section>
    </div>
  )
}
