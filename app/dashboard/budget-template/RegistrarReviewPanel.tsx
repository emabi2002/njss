"use client"

import { useMemo, useState } from "react"
import { approveDivisionBudget, returnDivisionBudget, type BudgetDocument, type DivisionBudgetDetail, type LedgerReference, type SectionReference } from "@/lib/head-office-budget"
import { type LedgerGroup } from "@/lib/division-budget-ledger-groups"

type Props = {
  detail: DivisionBudgetDetail
  sections: SectionReference[]
  groups: LedgerGroup<LedgerReference>[]
  onOpenDocument: (document: BudgetDocument) => Promise<void>
  onComplete: () => Promise<void>
}

const money = (amount: number) => `K ${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function RegistrarReviewPanel({ detail, sections, groups, onOpenDocument, onComplete }: Props) {
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const document = detail.documents.find(item => item.id === detail.budget.submitted_document_id)
  const amounts = useMemo(() => new Map(detail.lines.map(line => [`${line.section_id}:${line.expense_ledger_id}`, line.original_amount])), [detail.lines])
  const total = detail.lines.reduce((sum,line) => sum + line.original_amount, 0)

  async function act(kind: "approve" | "return") {
    setBusy(true)
    setError("")
    try {
      if (kind === "approve") {
        if (!window.confirm("Approve this electronic budget against the attached signed submission?")) return
        await approveDivisionBudget(detail.budget.id, detail.budget.review_version)
      } else {
        await returnDivisionBudget(detail.budget.id, detail.budget.review_version, reason)
      }
      await onComplete()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review action failed.")
    } finally {
      setBusy(false)
    }
  }

  return <section className="rounded-xl border border-amber-300 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-semibold text-slate-900">Registrar electronic review</h2>
    <p className="mt-1 text-sm text-slate-600">Version {detail.budget.review_version} · Submitted {detail.budget.submitted_at?.slice(0,10) || "—"} · Division total {money(total)}</p>
    <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm">
      {document ? <button type="button" onClick={() => void onOpenDocument(document)} className="font-semibold text-blue-800 underline">Open this Division's signed or stamped submission: {document.original_filename}</button> : <span className="text-red-700">Submitted document unavailable; approval is blocked.</span>}
    </div>
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <thead><tr className="border-b text-left"><th className="py-2">Master ledger / sub-ledger</th><th>Division or section/unit</th><th className="text-right">Amount</th></tr></thead>
        <tbody>{groups.map(group => {
          const groupTotal = sections.reduce((sum,section) => sum + group.children.reduce((n,ledger) => n + Number(amounts.get(`${section.id}:${ledger.id}`) || 0), 0), 0)
          if (!groupTotal) return null
          return <FragmentGroup key={group.category.id} title={group.category.standard_description} total={groupTotal} rows={sections.flatMap(section => group.children.flatMap(ledger => {
            const amount = Number(amounts.get(`${section.id}:${ledger.id}`) || 0)
            return amount ? [{ key: `${section.id}:${ledger.id}`, code: ledger.finance_code, description: ledger.standard_description, section: section.budget_scope === "DIVISION_WIDE" ? "Division-wide" : section.name, amount }] : []
          }))} />
        })}</tbody>
        <tfoot><tr className="border-t-2 font-bold"><td colSpan={2} className="py-3">Division total</td><td className="text-right">{money(total)}</td></tr></tfoot>
      </table>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="flex-1 text-sm">Reason for return<input value={reason} onChange={event => setReason(event.target.value)} className="mt-1 w-full rounded border p-2" /></label>
      <button type="button" disabled={busy || !reason.trim()} onClick={() => void act("return")} className="rounded border border-amber-500 px-4 py-2 text-sm font-semibold disabled:opacity-50">Return for correction</button>
      <button type="button" disabled={busy || !document} onClick={() => void act("approve")} className="rounded bg-[#8A1420] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve electronically</button>
    </div>
  </section>
}

function FragmentGroup({ title, total, rows }: { title: string; total: number; rows: {key:string;code:string;description:string;section:string;amount:number}[] }) {
  return <>
    <tr className="bg-amber-100 font-semibold"><td colSpan={2} className="py-2 pl-2">{title}</td><td className="pr-2 text-right">{money(total)}</td></tr>
    {rows.map(row => <tr key={row.key} className="border-b border-slate-100"><td className="py-1 pl-2">{row.code} · {row.description}</td><td>{row.section}</td><td className="pr-2 text-right">{money(row.amount)}</td></tr>)}
  </>
}
