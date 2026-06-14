"use client"

import { useState } from "react"
import {
  BookOpen, Printer, FileText, Calendar, Layers, Building2, Banknote, DollarSign,
  BarChart3, ShieldCheck, ChevronRight, Info, Lightbulb, AlertTriangle,
  Hash, Workflow, GraduationCap, ClipboardCheck, ArrowRight, Users
} from "lucide-react"

type TabKey = "process" | "training" | "roles"

const TABS: { key: TabKey; label: string; icon: typeof BookOpen }[] = [
  { key: "process", label: "Process Documentation", icon: Workflow },
  { key: "training", label: "Training Manual", icon: GraduationCap },
  { key: "roles", label: "Roles & Glossary", icon: ShieldCheck },
]

const PROCESS_TOC = [
  { id: "overview", label: "1. System Overview" },
  { id: "flow", label: "2. The End-to-End Cycle" },
  { id: "p-master", label: "3. Master Data & Code Registry" },
  { id: "p-plan", label: "4. Annual Activity Planning" },
  { id: "p-consolidate", label: "5. Budget Consolidation" },
  { id: "p-release", label: "6. Quarterly Budget Release" },
  { id: "p-ff3", label: "7. FF3 Requisition & Commitment" },
  { id: "p-ff4", label: "8. FF4 Payment & Reconciliation" },
  { id: "p-reports", label: "9. Reporting & Exports" },
  { id: "p-audit", label: "10. Audit & Compliance" },
]

const TRAINING_TOC = [
  { id: "t-start", label: "1. Getting Started" },
  { id: "t-master", label: "2. Set Up Master Data & Codes" },
  { id: "t-plan", label: "3. Create an Annual Plan" },
  { id: "t-approve-plan", label: "4. Review, Authorize & Confirm" },
  { id: "t-consolidate", label: "5. Consolidate Budgets" },
  { id: "t-release", label: "6. Release Quarterly Funds" },
  { id: "t-ff3", label: "7. Raise an FF3 Requisition" },
  { id: "t-endorse", label: "8. Endorse & Approve an FF3" },
  { id: "t-ff4", label: "9. Process an FF4 Payment" },
  { id: "t-reports", label: "10. Generate Reports" },
  { id: "t-faq", label: "11. Tips & FAQ" },
]

const ROLES_TOC = [
  { id: "r-roles", label: "1. Roles & Responsibilities" },
  { id: "r-status", label: "2. Status Reference" },
  { id: "r-glossary", label: "3. Glossary" },
]

export default function HelpPage() {
  const [tab, setTab] = useState<TabKey>("process")

  const toc = tab === "process" ? PROCESS_TOC : tab === "training" ? TRAINING_TOC : ROLES_TOC

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <BookOpen className="h-7 w-7 text-png-red" /> Help &amp; User Guide
          </h1>
          <p className="text-slate-600 mt-1">Complete process documentation and step-by-step training manual for NJSS CREMS</p>
        </div>
        <button onClick={() => window.print()}
          className="px-4 py-2 bg-png-red text-white rounded-lg text-sm font-medium hover:bg-png-maroon flex items-center gap-2">
          <Printer className="h-4 w-4" /> Print / Save as PDF
        </button>
      </div>

      {/* Print-only cover */}
      <div className="hidden print:block text-center border-b-4 border-png-gold pb-6 mb-6">
        <h1 className="text-3xl font-bold text-png-maroon">NJSS CREMS</h1>
        <p className="text-lg text-slate-700 mt-1">Court Registry &amp; Expense Monitoring System</p>
        <p className="text-sm text-slate-500 mt-2">Process Documentation &amp; Training Manual — National Judiciary Staff Services, Papua New Guinea</p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 print:hidden">
        {TABS.map((t) => {
          const Icon = t.icon
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${tab === t.key ? "bg-png-red text-white" : "text-slate-600 bg-white border border-slate-200 hover:bg-slate-50"}`}>
              <Icon className="h-4 w-4" /> {t.label}
            </button>
          )
        })}
      </div>

      <div className="grid lg:grid-cols-[260px_1fr] gap-6">
        {/* Sticky TOC */}
        <aside className="hidden lg:block print:hidden">
          <div className="sticky top-20 bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-png-red/60 mb-2">On this page</p>
            <nav className="space-y-0.5">
              {toc.map((item) => (
                <button key={item.id} onClick={() => scrollTo(item.id)}
                  className="w-full text-left px-3 py-1.5 rounded-md text-sm text-slate-600 hover:bg-png-red/5 hover:text-png-red flex items-center gap-1.5 group">
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-png-gold" />
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* Content */}
        <div className="min-w-0 space-y-8">
          <div className={`${tab === "process" ? "block" : "hidden"} print:block space-y-8`}>
            <ProcessDocumentation />
          </div>
          <div className={`${tab === "training" ? "block" : "hidden"} print:block space-y-8 print:mt-12`}>
            <TrainingManual />
          </div>
          <div className={`${tab === "roles" ? "block" : "hidden"} print:block space-y-8 print:mt-12`}>
            <RolesGlossary />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ============================ Shared building blocks ============================ */

function SectionTitle({ id, num, icon: Icon, title, subtitle }: { id: string; num?: string; icon: typeof BookOpen; title: string; subtitle?: string }) {
  return (
    <div id={id} className="scroll-mt-20 flex items-start gap-3 border-b border-png-gold/30 pb-3">
      <div className="p-2 rounded-lg bg-png-red/10 text-png-red shrink-0"><Icon className="h-5 w-5" /></div>
      <div>
        <h2 className="text-xl font-bold text-slate-900">{num && <span className="text-png-red">{num} </span>}{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  )
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-white rounded-lg border border-slate-200 p-6 print:border print:break-inside-avoid ${className}`}>{children}</div>
}

function RolePill({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-png-gold/20 text-png-maroon whitespace-nowrap">{children}</span>
}

function Callout({ type = "info", title, children }: { type?: "info" | "tip" | "warn"; title?: string; children: React.ReactNode }) {
  const map = {
    info: { icon: Info, cls: "bg-png-red/5 border-png-gold/40 text-slate-700", ic: "text-png-red", t: "text-png-maroon" },
    tip: { icon: Lightbulb, cls: "bg-green-50 border-green-200 text-green-900", ic: "text-green-600", t: "text-green-800" },
    warn: { icon: AlertTriangle, cls: "bg-amber-50 border-amber-200 text-amber-900", ic: "text-amber-600", t: "text-amber-800" },
  }[type]
  const Icon = map.icon
  return (
    <div className={`rounded-lg border p-4 flex gap-3 print:break-inside-avoid ${map.cls}`}>
      <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${map.ic}`} />
      <div className="text-sm">
        {title && <p className={`font-semibold mb-0.5 ${map.t}`}>{title}</p>}
        {children}
      </div>
    </div>
  )
}

function Step({ n, title, role, children }: { n: number; title: string; role?: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 print:break-inside-avoid">
      <div className="flex flex-col items-center">
        <div className="h-8 w-8 rounded-full bg-png-red text-white flex items-center justify-center text-sm font-bold shrink-0">{n}</div>
        <div className="w-px flex-1 bg-png-gold/30 my-1" />
      </div>
      <div className="pb-5 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="font-semibold text-slate-900">{title}</h4>
          {role && <RolePill>{role}</RolePill>}
        </div>
        <div className="text-sm text-slate-600 mt-1 space-y-1">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="font-medium text-slate-500 w-28 shrink-0">{label}</span>
      <span className="text-slate-700">{value}</span>
    </div>
  )
}

/* ============================ A) PROCESS DOCUMENTATION ============================ */

function ProcessDocumentation() {
  return (
    <>
      <SectionTitle id="overview" num="1." icon={Info} title="System Overview" subtitle="What NJSS CREMS does and the principles it enforces" />
      <Card>
        <p className="text-slate-700">
          <b>NJSS CREMS</b> (Court Registry &amp; Expense Monitoring System) digitises the National Judiciary&apos;s
          full budget-to-payment cycle — from preparing annual activity plans, through building the expense-code budget,
          releasing funds each quarter, raising requisitions (Form FF3), committing funds, and finally paying suppliers
          (Form FF4) — with a complete audit trail at every step.
        </p>
        <div className="grid sm:grid-cols-3 gap-3 mt-4">
          <Principle icon={ShieldCheck} title="Control before spend" text="No money can be committed or paid unless an approved, released budget code exists." />
          <Principle icon={Workflow} title="Segregation of duties" text="Preparation, endorsement, approval and payment are performed by different roles." />
          <Principle icon={ClipboardCheck} title="Full traceability" text="Every status change is automatically written to the audit log." />
        </div>
        <Callout type="info" title="The core budget formula">
          <p><b>Available Balance = Released − Committed − Actual Expenditure.</b> A requisition can only proceed if its
          value is within the available balance of its expense code.</p>
        </Callout>
      </Card>

      <SectionTitle id="flow" num="2." icon={Workflow} title="The End-to-End Cycle" subtitle="How a kina flows through the system" />
      <Card>
        <FlowDiagram />
        <Callout type="tip" title="Reading the flow">
          Each stage produces the input for the next. Planning creates the <b>budget</b>; releases turn budget into
          <b> spendable cash</b>; an FF3 <b>commits</b> that cash; an FF4 <b>pays</b> it; and reports read the position
          back across every stage.
        </Callout>
      </Card>

      {/* PHASE 1 */}
      <SectionTitle id="p-master" num="3." icon={Layers} title="Master Data &amp; Code Registry" subtitle="Foundation set-up — done once, maintained as needed" />
      <Card>
        <PhaseMeta role={<RolePill>Administrator</RolePill>} screen="Master Data" purpose="Define the organisation structure and the expense codes every transaction is charged against." />
        <h4 className="font-semibold text-slate-900 mt-4 mb-2">Steps</h4>
        <Step n={1} title="Maintain organisation structure" role="Administrator">
          Create <b>Departments</b> → <b>Sections</b> → <b>Cost Centres</b>. A cost centre belongs to a section and
          department and is the budget-holding unit.
        </Step>
        <Step n={2} title="Maintain expense classifications" role="Administrator">
          Create <b>Expense Categories</b> (e.g. Travel, Supplies) and the elementary <b>Expense Items</b> under each
          (e.g. Airfare, Accommodation).
        </Step>
        <Step n={3} title="Build full expense codes" role="Administrator">
          In the <b>Code Registry</b> builder, combine <span className="font-mono text-png-red">Department · Cost Centre · Category · Item</span>.
          The system auto-generates the full code, e.g. <span className="font-mono text-png-red">FIN-ACC-TRAVEL-AIR</span>.
        </Step>
        <Step n={4} title="(Optional) Define activity templates" role="Administrator">
          Standard activity descriptions used to speed up annual-plan data entry.
        </Step>
        <Callout type="warn" title="Why this matters">
          Every plan line, budget allocation, requisition and payment is ultimately tied to a <b>full expense code</b>.
          If the registry is incomplete, planners cannot select a code.
        </Callout>
      </Card>

      {/* PHASE 2 */}
      <SectionTitle id="p-plan" num="4." icon={Calendar} title="Annual Activity Planning" subtitle="Sections plan their year; the plan becomes the budget" />
      <Card>
        <PhaseMeta role={<><RolePill>Section Manager</RolePill> <RolePill>Department Head</RolePill> <RolePill>Registrar</RolePill> <RolePill>Administrator</RolePill></>} screen="Annual Plans" purpose="Capture each section's planned activities and turn the authorised plan into the working budget." />
        <h4 className="font-semibold text-slate-900 mt-4 mb-2">Workflow &amp; status path</h4>
        <Step n={1} title="Prepare the plan (DRAFT)" role="Section Manager">
          Create a plan for the financial year and cost centre. Add activity lines — each with an <b>expense code</b>,
          <b> quantity</b> and <b>unit cost</b>; the line total and plan total calculate automatically.
        </Step>
        <Step n={2} title="Submit (SUBMITTED)" role="Section Manager">Lock the draft and send it for departmental review.</Step>
        <Step n={3} title="Review (REVIEWED)" role="Department Head">Check the activities and amounts; may return for correction.</Step>
        <Step n={4} title="Approve at department (APPROVED_BY_DEPARTMENT)" role="Department Head">Departmental sign-off that the plan is sound.</Step>
        <Step n={5} title="Authorize (AUTHORIZED_BY_REGISTRAR)" role="Registrar">Executive authorisation that the plan may become budget.</Step>
        <Step n={6} title="Confirm to budget (BUDGET_CONFIRMED)" role="Administrator">
          The decisive step: the system converts every plan line into an active <b>budget allocation</b> against its
          expense code. This is what populates Budget Control.
        </Step>
        <Callout type="info" title="Result">
          A set of <b>budget allocations</b> (the approved annual ceiling) per expense code, ready for quarterly release.
        </Callout>
      </Card>

      {/* PHASE 3 */}
      <SectionTitle id="p-consolidate" num="5." icon={Building2} title="Budget Consolidation" subtitle="Roll section plans up to a department budget" />
      <Card>
        <PhaseMeta role={<><RolePill>Administrator</RolePill> <RolePill>Registrar</RolePill></>} screen="Budget Control → Consolidation" purpose="Produce a single consolidated budget figure per department from its authorised/confirmed section plans." />
        <Step n={1} title="Run consolidation" role="Administrator">
          On <b>Budget Control → Consolidation</b>, choose a department and run the roll-up. The system totals all
          authorised &amp; confirmed plans, counts the sections and plans, and stores a <b>CONSOLIDATED</b> record.
        </Step>
        <Step n={2} title="Review the consolidated budget" role="Registrar">
          The consolidation table shows each department&apos;s total budget, section count and plan count for the year.
        </Step>
      </Card>

      {/* PHASE 4 */}
      <SectionTitle id="p-release" num="6." icon={Banknote} title="Quarterly Budget Release" subtitle="Turn approved budget into spendable cash" />
      <Card>
        <PhaseMeta role={<><RolePill>Administrator</RolePill> <RolePill>Finance Manager</RolePill></>} screen="Budget Control → Releases" purpose="Release funds quarter-by-quarter against approved codes so spending is paced through the year." />
        <Step n={1} title="Select a budget code" role="Finance Manager">
          On <b>Budget Control → Releases</b>, pick an approved budget code. The form shows its approved ceiling,
          how much is already released, and the remaining releasable amount.
        </Step>
        <Step n={2} title="Release for a quarter" role="Finance Manager">
          Enter the quarter (Q1–Q4), the amount and the date, then submit. A release number (e.g.
          <span className="font-mono text-png-red"> QR-2025-00001</span>) is generated automatically.
        </Step>
        <Callout type="warn" title="Hard limit">
          Cumulative releases for a code can never exceed its <b>approved budget</b>. The system blocks any release that would breach the ceiling.
        </Callout>
        <Callout type="info" title="Effect on availability">
          Released funds increase the code&apos;s <b>Available Balance</b> (Released − Committed − Actual), which is what
          requisitions are checked against.
        </Callout>
      </Card>

      {/* PHASE 5 */}
      <SectionTitle id="p-ff3" num="7." icon={FileText} title="FF3 Requisition &amp; Commitment" subtitle="Request to spend; on approval funds are committed" />
      <Card>
        <PhaseMeta role={<><RolePill>Requisition Officer</RolePill> <RolePill>Supervisor</RolePill> <RolePill>Section Head</RolePill> <RolePill>Approver / Finance Manager</RolePill></>} screen="FF3 Requisitions" purpose="Formally request goods/services, prove value-for-money, check budget, and on approval commit the funds." />
        <Step n={1} title="Create the FF3 (DRAFT)" role="Requisition Officer">
          Capture the header (department, section, cost centre, <b>expense code</b>, funding source), the <b>line items</b>
          (qty × unit price), and attach a minimum of <b>three supplier quotations</b> with one selected.
        </Step>
        <Step n={2} title="Automatic budget check" role="System">
          The Budget Validation panel shows Approved, Released, Committed, Spent and <b>Available</b> for the chosen code,
          and flags whether the request is within budget.
        </Step>
        <Step n={3} title="Submit (SUBMITTED)" role="Requisition Officer">Send for endorsement once the 3-quotation and budget rules are satisfied.</Step>
        <Step n={4} title="Endorse — supervisor &amp; section head" role="Supervisor → Section Head">Two endorsement levels confirm operational need.</Step>
        <Step n={5} title="Approve (APPROVED)" role="Approver / Finance Manager">
          Final approval. The system immediately creates a <b>commitment</b> against the budget code, reserving the funds.
        </Step>
        <Callout type="info" title="Result — the Commitment Ledger">
          Each approved FF3 produces a commitment (e.g. <span className="font-mono text-png-red">CMT-2025-00001</span>)
          tracking <b>committed</b>, <b>paid</b> and <b>remaining balance</b>. Committed funds reduce availability immediately.
        </Callout>
      </Card>

      {/* PHASE 6 */}
      <SectionTitle id="p-ff4" num="8." icon={DollarSign} title="FF4 Payment &amp; Reconciliation" subtitle="Pay against a commitment; close the loop" />
      <Card>
        <PhaseMeta role={<><RolePill>Requisition Officer</RolePill> <RolePill>Finance Manager</RolePill></>} screen="FF4 Expenses" purpose="Pay the supplier against an approved FF3/commitment, then reconcile." />
        <Step n={1} title="Create the FF4 (DRAFT/SUBMITTED)" role="Requisition Officer">
          Raised from an approved FF3. Capture payee, invoice details and amounts; <b>net = gross − tax − deductions</b>.
        </Step>
        <Step n={2} title="Verify → Approve → Process" role="Finance Manager">Three control checkpoints before money moves.</Step>
        <Step n={3} title="Mark Paid (PAID)" role="Finance Manager">
          Record the payment reference. The system updates the commitment&apos;s paid amount and writes a payment
          transaction. A payment can never exceed the commitment&apos;s remaining balance.
        </Step>
        <Step n={4} title="Reconcile (RECONCILED)" role="Finance Manager">Match to the bank/ledger to close the transaction.</Step>
        <Callout type="info" title="Result">
          Actual expenditure rises, the commitment moves to <b>PARTIALLY_PAID</b> or <b>FULLY_PAID</b>, and the code&apos;s
          available balance reflects the real position.
        </Callout>
      </Card>

      {/* PHASE 7 */}
      <SectionTitle id="p-reports" num="9." icon={BarChart3} title="Reporting &amp; Exports" subtitle="See the position at any level" />
      <Card>
        <PhaseMeta role={<><RolePill>All (reports.view)</RolePill></>} screen="Reports · Budget Control · Dashboard" purpose="Provide planning, budget, requisition, payment and audit reporting with export." />
        <ul className="list-disc pl-5 text-sm text-slate-700 space-y-1 mt-2">
          <li><b>Planning &amp; budget:</b> consolidated department budget, budget by cost centre, budget by expense code, available balance, plans by section/department.</li>
          <li><b>Transactions:</b> FF3 status &amp; pending approvals, FF4 status &amp; reconciliation, quarterly utilisation.</li>
          <li><b>Audit:</b> full activity trail and user activity.</li>
          <li><b>Export:</b> every report can be exported to <b>CSV</b> (Excel) or <b>PDF</b>; FF3/FF4 support bulk PDF.</li>
        </ul>
      </Card>

      {/* PHASE 8 */}
      <SectionTitle id="p-audit" num="10." icon={ShieldCheck} title="Audit &amp; Compliance" subtitle="Automatic, tamper-evident history" />
      <Card>
        <PhaseMeta role={<><RolePill>Auditor</RolePill></>} screen="Audit Log" purpose="Guarantee that every material action is recorded without relying on users to log it." />
        <p className="text-sm text-slate-700">
          Database triggers automatically log a record whenever a plan, expense code, FF3, commitment, FF4 or release is
          created or changes status — capturing the action, entity, reference number, the before/after status and the
          timestamp. The Audit Log screen is filterable and exportable.
        </p>
      </Card>
    </>
  )
}

function Principle({ icon: Icon, title, text }: { icon: typeof BookOpen; title: string; text: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <Icon className="h-5 w-5 text-png-gold-strong mb-1" />
      <p className="font-semibold text-sm text-slate-900">{title}</p>
      <p className="text-xs text-slate-600 mt-0.5">{text}</p>
    </div>
  )
}

function PhaseMeta({ role, screen, purpose }: { role: React.ReactNode; screen: string; purpose: string }) {
  return (
    <div className="space-y-1.5">
      <Field label="Purpose" value={purpose} />
      <Field label="Where" value={<span className="font-medium text-png-red">{screen}</span>} />
      <Field label="Responsible" value={<span className="flex flex-wrap gap-1">{role}</span>} />
    </div>
  )
}

function FlowDiagram() {
  const stages = [
    { icon: Layers, label: "Master Data\n& Codes" },
    { icon: Calendar, label: "Annual Plan\n→ Budget" },
    { icon: Building2, label: "Consolidate" },
    { icon: Banknote, label: "Release Funds" },
    { icon: FileText, label: "FF3 →\nCommit" },
    { icon: DollarSign, label: "FF4 → Pay" },
    { icon: BarChart3, label: "Report" },
  ]
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {stages.map((s, i) => {
        const Icon = s.icon
        return (
          <div key={i} className="flex items-center gap-2">
            <div className="flex flex-col items-center justify-center text-center w-24 h-24 rounded-xl border border-png-gold/40 bg-gradient-to-b from-png-red/5 to-png-gold/5 p-2">
              <Icon className="h-6 w-6 text-png-red mb-1" />
              <span className="text-[11px] font-medium text-slate-700 leading-tight whitespace-pre-line">{s.label}</span>
            </div>
            {i < stages.length - 1 && <ArrowRight className="h-4 w-4 text-png-gold shrink-0" />}
          </div>
        )
      })}
    </div>
  )
}

/* ============================ B) TRAINING MANUAL ============================ */

function TrainingManual() {
  return (
    <>
      <SectionTitle id="t-start" num="1." icon={GraduationCap} title="Getting Started" subtitle="Sign in, find your way around, understand your role" />
      <Card>
        <h4 className="font-semibold text-slate-900 mb-2">Sign in</h4>
        <Step n={1} title="Open the system & sign in">
          Go to the NJSS CREMS URL. Enter your <b>email</b> and <b>password</b> and click <b>Sign In</b>. Use
          &quot;Forgot password?&quot; if needed.
        </Step>
        <Step n={2} title="Understand the menu">
          The left sidebar only shows the screens your role can use. The header has global search, notifications and your profile menu (with Sign Out).
        </Step>
        <Callout type="tip" title="What can I do?">
          Your available actions depend on your <b>role</b>. See <b>Roles &amp; Glossary → Roles &amp; Responsibilities</b> for the full matrix.
        </Callout>
      </Card>

      <HowTo id="t-master" num="2." title="Set Up Master Data &amp; Build Expense Codes" role="Administrator" screen="Master Data" goal="Create the organisation structure and the expense codes everything is charged to.">
        <Step n={1} title="Add departments, sections & cost centres">Open <b>Master Data</b>. Use each tab&apos;s <b>Add</b> button, completing code and name. Create the department first, then its sections, then cost centres.</Step>
        <Step n={2} title="Add categories & expense items">On the <b>Categories</b> and <b>Expense Items</b> tabs, create your classifications (an item belongs to a category).</Step>
        <Step n={3} title="Build a full expense code">Open the <b>Code Registry</b> tab. In the builder, pick Department → Cost Centre → Category → Item; the preview shows the generated code. Click <b>Create Code</b>.</Step>
        <Callout type="tip">Build codes for every cost-centre/category combination your sections will plan against.</Callout>
      </HowTo>

      <HowTo id="t-plan" num="3." title="Create &amp; Submit an Annual Plan" role="Section Manager" screen="Annual Plans" goal="Capture your section's planned activities for the year.">
        <Step n={1} title="Start a new plan">Open <b>Annual Plans</b> → <b>New Annual Plan</b>. Choose the financial year, department, section and cost centre, and give the plan a title.</Step>
        <Step n={2} title="Add activity lines">For each activity, enter a description, choose the <b>expense code</b>, the <b>quantity</b>, <b>unit cost</b> and the <b>quarter</b>. The line total and grand total update live. Use <b>Add line</b> for more.</Step>
        <Step n={3} title="Create the plan">Click <b>Create Plan</b>. It is saved as <b>DRAFT</b>.</Step>
        <Step n={4} title="Submit for review">On the plan row, click <b>Submit</b>. Its status becomes <b>SUBMITTED</b> and it goes to your Department Head.</Step>
        <Callout type="warn">A plan needs at least one valid line (description + amount &gt; 0) before it can be created.</Callout>
      </HowTo>

      <HowTo id="t-approve-plan" num="4." title="Review, Authorize &amp; Confirm a Plan" role="Dept Head · Registrar · Administrator" screen="Annual Plans" goal="Move a plan through approval until it becomes budget.">
        <Step n={1} title="Review (Department Head)">Open <b>Annual Plans</b>, expand the plan to inspect its lines, then click <b>Review</b>, then <b>Approve (Dept)</b>. Use <b>Return</b> to send back for correction.</Step>
        <Step n={2} title="Authorize (Registrar)">On an approved plan, click <b>Authorize</b>. Use <b>Reject</b> if it cannot proceed.</Step>
        <Step n={3} title="Confirm to budget (Administrator)">On an authorised plan, click <b>Confirm to Budget</b>. The system creates the budget allocations — the plan is now <b>BUDGET_CONFIRMED</b> and visible in Budget Control.</Step>
      </HowTo>

      <HowTo id="t-consolidate" num="5." title="Consolidate Department Budgets" role="Administrator" screen="Budget Control → Consolidation" goal="Produce a department-level budget total.">
        <Step n={1} title="Open the Consolidation tab">Go to <b>Budget Control</b> and select the <b>Consolidation</b> tab.</Step>
        <Step n={2} title="Run the roll-up">Choose the department and click <b>Run Consolidation</b>. The consolidated total, section and plan counts appear in the table.</Step>
      </HowTo>

      <HowTo id="t-release" num="6." title="Release Quarterly Funds" role="Administrator / Finance Manager" screen="Budget Control → Releases" goal="Make cash available against approved codes.">
        <Step n={1} title="Open the Releases tab">Go to <b>Budget Control</b> → <b>Releases</b>.</Step>
        <Step n={2} title="Choose the code & quarter">Select the budget code (it shows approved / already released / releasable), pick the quarter, enter the amount and date.</Step>
        <Step n={3} title="Submit the release">Click the release button. A release number is generated and the code&apos;s available balance increases.</Step>
        <Callout type="warn">You cannot release more than the approved budget for a code. The form shows the remaining releasable amount.</Callout>
      </HowTo>

      <HowTo id="t-ff3" num="7." title="Raise an FF3 Requisition" role="Requisition Officer / Section Manager" screen="FF3 Requisitions → New" goal="Request goods or services within budget.">
        <Step n={1} title="Open a new FF3">Go to <b>FF3 Requisitions</b> → <b>New Requisition</b>.</Step>
        <Step n={2} title="Complete the header">Select department, section, cost centre and the <b>expense code</b>. Add the purpose, justification and urgency.</Step>
        <Step n={3} title="Add items">List each item with quantity and unit price; the total estimate calculates automatically.</Step>
        <Step n={4} title="Attach 3 quotations">Enter at least three supplier quotations, upload the documents and select the winning quote.</Step>
        <Step n={5} title="Check the budget panel">Confirm the request is <b>Within Budget</b> (green). The panel shows Approved, Released, Committed, Spent and Available for the code.</Step>
        <Step n={6} title="Submit">Click <b>Submit for Approval</b> (enabled once 3 quotations and a valid total exist), or <b>Save as Draft</b>.</Step>
      </HowTo>

      <HowTo id="t-endorse" num="8." title="Endorse &amp; Approve an FF3" role="Supervisor · Section Head · Approver" screen="FF3 Requisitions" goal="Move a requisition to approval and commit funds.">
        <Step n={1} title="Open the requisition">From <b>FF3 Requisitions</b>, open the submitted FF3 to review items, quotations and the budget position.</Step>
        <Step n={2} title="Endorse">As supervisor then section head, use the endorse action (or reject with a reason).</Step>
        <Step n={3} title="Approve">The approver gives final approval. The system creates the <b>commitment</b> automatically.</Step>
      </HowTo>

      <HowTo id="t-ff4" num="9." title="Process an FF4 Payment" role="Requisition Officer / Finance Manager" screen="FF4 Expenses" goal="Pay an approved requisition and reconcile.">
        <Step n={1} title="Create the FF4">From an approved FF3, raise the FF4. Enter payee, invoice and amounts (net calculates automatically).</Step>
        <Step n={2} title="Verify → Approve → Process">Finance moves the FF4 through the three control checkpoints.</Step>
        <Step n={3} title="Mark as paid">Record the payment reference and mark <b>Paid</b>. The commitment&apos;s paid balance updates.</Step>
        <Step n={4} title="Reconcile">Once matched to the bank/ledger, mark <b>Reconciled</b> to close it.</Step>
        <Callout type="warn">A payment cannot exceed the commitment&apos;s remaining balance — the system enforces this.</Callout>
      </HowTo>

      <HowTo id="t-reports" num="10." title="Generate Reports &amp; Exports" role="Any role with reporting access" screen="Reports · Budget Control" goal="Produce and download reports.">
        <Step n={1} title="Pick a report">On <b>Reports</b>, choose a report (e.g. Consolidated Department Budget, Budget by Expense Code, FF3 Status) and set the date range/filters.</Step>
        <Step n={2} title="Export">Click <b>Export PDF</b> or <b>Export CSV</b>. On Budget Control, the CSV/PDF buttons export the currently selected tab.</Step>
      </HowTo>

      <SectionTitle id="t-faq" num="11." icon={Lightbulb} title="Tips &amp; FAQ" />
      <Card className="space-y-3">
        <Faq q="A button I expect is missing — why?" a="Buttons and menu items are shown based on your role's permissions. If you need an action you cannot see, ask an Administrator to review your role." />
        <Faq q="My FF3 says 'Insufficient Funds'." a="The request exceeds the code's Available Balance (Released − Committed − Actual). Either reduce the request, choose a different code, or ask Finance to release more funds for that code." />
        <Faq q="Why must I add three quotations?" a="Procurement policy requires a minimum of three supplier quotations for value-for-money. Submission is blocked until three valid quotes exist." />
        <Faq q="The Budget/Dashboard charts are empty." a="They populate once annual plans are confirmed to budget and funds are released. Confirm a plan and record at least one release." />
        <Faq q="How do I get a hard copy of this guide?" a="Click 'Print / Save as PDF' at the top of this page — it prints the complete documentation and training manual." />
      </Card>
    </>
  )
}

function HowTo({ id, num, title, role, screen, goal, children }: { id: string; num: string; title: string; role: string; screen: string; goal: string; children: React.ReactNode }) {
  return (
    <>
      <SectionTitle id={id} num={num} icon={ClipboardCheck} title={title} />
      <Card>
        <div className="space-y-1.5 mb-4">
          <Field label="Goal" value={goal} />
          <Field label="Where" value={<span className="font-medium text-png-red">{screen}</span>} />
          <Field label="Who" value={<RolePill>{role}</RolePill>} />
        </div>
        {children}
      </Card>
    </>
  )
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div className="print:break-inside-avoid">
      <p className="font-semibold text-slate-900 text-sm flex items-start gap-2"><span className="text-png-red">Q.</span>{q}</p>
      <p className="text-sm text-slate-600 mt-0.5 pl-5">{a}</p>
    </div>
  )
}

/* ============================ C) ROLES & GLOSSARY ============================ */

const ROLE_ROWS: { role: string; resp: string }[] = [
  { role: "System Administrator", resp: "Full access to every module and setting." },
  { role: "Administrator", resp: "Master data & code registry, confirm plans to budget, run consolidations, release funds, manage users, reports." },
  { role: "Registrar", resp: "Review and authorise annual plans and the consolidated department budget; view budget, reports & audit." },
  { role: "Finance Manager", resp: "Approve FF3; verify, process & pay FF4; release funds; view budget & reports." },
  { role: "Department Head", resp: "Review section plans; endorse or reject requisitions; reports." },
  { role: "Section Manager", resp: "Prepare & submit annual plans; create FF3 and FF4 for the section; view budget." },
  { role: "Section Head", resp: "Prepare & submit plans; endorse requisitions." },
  { role: "Approver", resp: "Final approver for requisitions." },
  { role: "Requisition Officer", resp: "Create FF3 and FF4 drafts." },
  { role: "Auditor", resp: "Read-only access to the audit log and reports." },
  { role: "Executive Management / Viewer", resp: "Dashboard and management reports only." },
]

const STATUS_GROUPS: { title: string; items: { s: string; d: string }[] }[] = [
  { title: "Annual Plan", items: [
    { s: "DRAFT", d: "Being prepared by the section." },
    { s: "SUBMITTED", d: "Sent for department review." },
    { s: "REVIEWED", d: "Checked by the department head." },
    { s: "APPROVED_BY_DEPARTMENT", d: "Department sign-off complete." },
    { s: "AUTHORIZED_BY_REGISTRAR", d: "Authorised by the Registrar." },
    { s: "BUDGET_CONFIRMED", d: "Converted into budget allocations." },
    { s: "RETURNED_FOR_CORRECTION / REJECTED", d: "Sent back or stopped." },
  ]},
  { title: "FF3 Requisition", items: [
    { s: "DRAFT", d: "Being prepared." },
    { s: "SUBMITTED", d: "Awaiting endorsement." },
    { s: "ENDORSED_SUPERVISOR", d: "Endorsed by supervisor." },
    { s: "ENDORSED_SECTION_HEAD", d: "Endorsed by section head." },
    { s: "APPROVED", d: "Approved — commitment created." },
    { s: "REJECTED", d: "Declined." },
  ]},
  { title: "FF4 Payment", items: [
    { s: "DRAFT / SUBMITTED", d: "Raised, awaiting verification." },
    { s: "VERIFIED", d: "Checked by finance." },
    { s: "APPROVED", d: "Approved for processing." },
    { s: "PROCESSED", d: "Prepared for payment." },
    { s: "PAID", d: "Paid; commitment updated." },
    { s: "RECONCILED", d: "Matched to bank/ledger." },
    { s: "CANCELLED", d: "Voided." },
  ]},
  { title: "Commitment", items: [
    { s: "ACTIVE", d: "Funds reserved, unpaid." },
    { s: "PARTIALLY_PAID", d: "Some payments made." },
    { s: "FULLY_PAID", d: "Completely paid." },
    { s: "CANCELLED", d: "Released back to budget." },
  ]},
]

const GLOSSARY: { t: string; d: string }[] = [
  { t: "Cost Centre", d: "The budget-holding unit within a section/department that activities and codes are charged to." },
  { t: "Expense Code", d: "The full hierarchical charge code DEPT-CC-CAT-ITEM (e.g. FIN-ACC-TRAVEL-AIR) every transaction uses." },
  { t: "Annual Plan", d: "A section's planned activities for a financial year; once confirmed it becomes the budget." },
  { t: "Budget Allocation", d: "The approved annual budget for a specific expense code, created when a plan is confirmed." },
  { t: "Consolidation", d: "The roll-up of a department's confirmed section plans into one department budget figure." },
  { t: "Quarterly Release", d: "Cash made available for a code in a given quarter; paces spending through the year." },
  { t: "FF3", d: "Finance Form 3 — the requisition/commitment request to spend." },
  { t: "Commitment", d: "Funds reserved against a code when an FF3 is approved; tracks committed, paid and remaining." },
  { t: "FF4", d: "Finance Form 4 — the payment/expense made against an approved FF3 and its commitment." },
  { t: "Available Balance", d: "Released − Committed − Actual Expenditure; the amount a code can still commit." },
  { t: "Reconciliation", d: "Matching a payment to the bank/ledger to confirm and close it." },
]

function RolesGlossary() {
  return (
    <>
      <SectionTitle id="r-roles" num="1." icon={Users} title="Roles &amp; Responsibilities" subtitle="Who does what across the system" />
      <Card className="p-0 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Role</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Responsibilities</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ROLE_ROWS.map((r) => (
              <tr key={r.role} className="hover:bg-slate-50 print:break-inside-avoid">
                <td className="px-4 py-3 align-top"><RolePill>{r.role}</RolePill></td>
                <td className="px-4 py-3 text-sm text-slate-700">{r.resp}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <SectionTitle id="r-status" num="2." icon={Hash} title="Status Reference" subtitle="What each status means" />
      <div className="grid md:grid-cols-2 gap-6">
        {STATUS_GROUPS.map((g) => (
          <Card key={g.title} className="print:break-inside-avoid">
            <h4 className="font-semibold text-slate-900 mb-3">{g.title}</h4>
            <div className="space-y-2">
              {g.items.map((it) => (
                <div key={it.s} className="flex gap-3 text-sm">
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-png-red/10 text-png-red whitespace-nowrap h-fit">{it.s}</span>
                  <span className="text-slate-600">{it.d}</span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <SectionTitle id="r-glossary" num="3." icon={BookOpen} title="Glossary" subtitle="Key terms" />
      <Card className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
        {GLOSSARY.map((g) => (
          <div key={g.t} className="print:break-inside-avoid">
            <p className="font-semibold text-slate-900 text-sm">{g.t}</p>
            <p className="text-sm text-slate-600">{g.d}</p>
          </div>
        ))}
      </Card>
    </>
  )
}
