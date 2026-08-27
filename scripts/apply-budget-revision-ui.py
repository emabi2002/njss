from pathlib import Path

path = Path('app/dashboard/budget-template/page.tsx')
text = path.read_text()


def replace_once(old: str, new: str, label: str):
    global text
    if old not in text:
        raise SystemExit(f'missing transform anchor: {label}')
    text = text.replace(old, new, 1)


replace_once(
'''import { findDuplicateBudgetDivision } from "@/lib/budget-division-ui"
''',
'''import { findDuplicateBudgetDivision } from "@/lib/budget-division-ui"
import {
  createBudgetRevision,
  getBudgetRevisionHistory,
  getBudgetRevisionPosition,
  getRevisionForSubmission,
  transitionBudgetRevision,
  type BudgetRevision,
  type BudgetRevisionPosition,
  type CreateBudgetRevisionInput,
} from "@/lib/budget-revision"
import { BudgetRevisionDialog } from "./BudgetRevisionDialog"
import { BudgetRevisionPanel } from "./BudgetRevisionPanel"
''',
'imports',
)

replace_once(
'''  const [draftHeader, setDraftHeader] = useState({ cycle_id: "", division_id: "", budget_ceiling: "", submission_reference: "" })

  const canAdmin = can("masterdata.manage") || can("registry.manage") || can("users.manage") || can("budget.template.approve")
  const canEdit = can("budget.template.edit") || can("budget.template.create") || can("budget.template") || can("budget.template.submit")
  const canReview = can("budget.template.review")
  const canApprove = can("budget.template.approve")
  const selectedLocked = selected?.is_locked || ["SUBMITTED", "RESUBMITTED", "REVIEWED", "APPROVED", "ARCHIVED"].includes(selected?.status || "")
''',
'''  const [draftHeader, setDraftHeader] = useState({ cycle_id: "", division_id: "", budget_ceiling: "", submission_reference: "" })
  const [revision, setRevision] = useState<BudgetRevision | null>(null)
  const [revisionPosition, setRevisionPosition] = useState<BudgetRevisionPosition[]>([])
  const [revisionHistory, setRevisionHistory] = useState<BudgetRevision[]>([])
  const [showRevisionDialog, setShowRevisionDialog] = useState(false)

  const canAdmin = can("masterdata.manage") || can("registry.manage") || can("users.manage") || can("budget.template.approve")
  const canEdit = can("budget.template.edit") || can("budget.template.create") || can("budget.template") || can("budget.template.submit")
  const canReview = can("budget.template.review")
  const canApprove = can("budget.template.approve")
  const canRevisionCreate = can("budget.revision.create")
  const canRevisionEdit = can("budget.revision.edit")
  const canRevisionSubmit = can("budget.revision.submit")
  const canRevisionReview = can("budget.revision.review")
  const canRevisionReturn = can("budget.revision.return")
  const canRevisionReject = can("budget.revision.reject")
  const canRevisionApprove = can("budget.revision.approve")
  const revisionEditable = Boolean(revision && ["DRAFT", "RETURNED"].includes(revision.status) && canRevisionEdit)
  const selectedLocked = revision
    ? !revisionEditable
    : Boolean(selected?.is_locked || ["SUBMITTED", "RESUBMITTED", "REVIEWED", "APPROVED", "ARCHIVED"].includes(selected?.status || "") || !canEdit)
  const canCreateRevision = Boolean(selected && selected.status === "APPROVED" && !selected.superseded_by_id && canRevisionCreate)
''',
'revision state and permissions',
)

replace_once(
'''  const validationLabel = gridRows.some((row) => !isEmptyRow(row)) && !hasVariance && invalidLineCount === 0 ? "VALID" : "CHECK VARIANCES"

  const loadDashboard = useCallback(async () => {
''',
'''  const validationLabel = gridRows.some((row) => !isEmptyRow(row)) && !hasVariance && invalidLineCount === 0 ? "VALID" : "CHECK VARIANCES"
  const revisionPositionByLine = useMemo(
    () => new Map(revisionPosition.map((item) => [item.revision_budget_line_id, item])),
    [revisionPosition]
  )
  const revisionPositionForRow = (row: GridRow) => (row.id ? revisionPositionByLine.get(row.id) : undefined)
  const isProtectedRevisionRow = (row: GridRow) => Boolean(revision && revisionPositionForRow(row)?.source_budget_allocation_id)
  const isRevisionMonthLocked = (row: GridRow, monthIndex: number) => {
    const position = revisionPositionForRow(row)
    if (!revision || !position?.source_budget_allocation_id) return false
    const monthNumber = monthIndex + 1
    return position.closed_month_numbers.includes(monthNumber) || Number(position.actual_monthly?.[String(monthNumber)] || 0) > 0
  }

  const loadDashboard = useCallback(async () => {
''',
'revision position map',
)

replace_once(
'''    if (!id) {
      setSelected(null)
      setGridRows([])
      setSelectedRows([])
      setHistory([])
      return
    }
''',
'''    if (!id) {
      setSelected(null)
      setGridRows([])
      setSelectedRows([])
      setHistory([])
      setRevision(null)
      setRevisionPosition([])
      setRevisionHistory([])
      return
    }
''',
'load submission reset',
)

replace_once(
'''      setSelectedRows([])
      setHistory(detail.history || [])
      setSelectedRow(rows[0]?.clientId || "")
    } catch (err) {
''',
'''      setSelectedRows([])
      setHistory(detail.history || [])
      setSelectedRow(rows[0]?.clientId || "")

      const loadedRevision = await getRevisionForSubmission(detail.submission.id)
      setRevision(loadedRevision)
      if (loadedRevision) {
        const [positionRows, versionRows] = await Promise.all([
          getBudgetRevisionPosition(loadedRevision.id),
          getBudgetRevisionHistory(loadedRevision.parent_submission_id),
        ])
        setRevisionPosition(positionRows)
        setRevisionHistory(versionRows as BudgetRevision[])
      } else {
        setRevisionPosition([])
        setRevisionHistory([])
      }
    } catch (err) {
''',
'load revision context',
)

replace_once(
'''  const addCycle = async () => {
''',
'''  const createRevisionFromSelected = async (input: CreateBudgetRevisionInput) => {
    if (!selected) return
    setSaving(true)
    setMessage(null)
    try {
      const result = await createBudgetRevision(input)
      setShowRevisionDialog(false)
      await loadDashboard()
      setSelectedId(result.revision_submission_id)
      setMessage({ type: "ok", text: `${result.revision_number} created as a controlled revision draft. The approved baseline remains locked.` })
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not create the budget revision." })
    } finally {
      setSaving(false)
    }
  }

  const addCycle = async () => {
''',
'create revision handler',
)

replace_once(
'''  const addRow = () => setGridRows((rows) => [...rows, newRow(rows.length + 1)])
  const duplicateRow = () => {
''',
'''  const selectableGridRows = gridRows.filter((row) => !isProtectedRevisionRow(row))
  const addRow = () => setGridRows((rows) => [...rows, newRow(rows.length + 1)])
  const duplicateRow = () => {
''',
'deletable revision rows',
)

replace_once(
'''  const allRowsSelected = gridRows.length > 0 && gridRows.every((row) => selectedRows.includes(row.clientId))
''',
'''  const allRowsSelected = selectableGridRows.length > 0 && selectableGridRows.every((row) => selectedRows.includes(row.clientId))
''',
'select all calculation',
)

replace_once(
'''  const toggleSelectAllRows = () => {
    setSelectedRows(allRowsSelected ? [] : gridRows.map((row) => row.clientId))
  }
''',
'''  const toggleSelectAllRows = () => {
    setSelectedRows(allRowsSelected ? [] : selectableGridRows.map((row) => row.clientId))
  }
''',
'toggle select all',
)

replace_once(
'''    const rowsToDelete = gridRows.filter((item) => selectedRows.includes(item.clientId))
''',
'''    const rowsToDelete = gridRows.filter((item) => selectedRows.includes(item.clientId) && !isProtectedRevisionRow(item))
''',
'protect baseline deletion',
)

replace_once(
'''  const runAction = async (action: "SUBMIT" | "RESUBMIT" | "RETURN" | "REVIEW" | "APPROVE" | "REJECT") => {
''',
'''  const runAction = async (action: "SUBMIT" | "RESUBMIT" | "RETURN" | "REVIEW" | "APPROVE" | "REJECT") => {
''',
'run action anchor',
)

replace_once(
'''  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
''',
'''  const runRevisionAction = async (action: "SUBMIT" | "RESUBMIT" | "RETURN" | "REVIEW" | "APPROVE" | "REJECT") => {
    if (!selected || !revision) return
    const filledRows = gridRows.filter((row) => !isEmptyRow(row))
    if (["SUBMIT", "RESUBMIT"].includes(action)) {
      if (filledRows.length === 0) {
        setMessage({ type: "err", text: "Add at least one valid budget line before submitting the revision." })
        return
      }
      if (filledRows.some((row) => !isValidLine(row))) {
        setMessage({ type: "err", text: "Revision submission blocked. Complete mandatory fields and zero all monthly variances first." })
        return
      }
      const protectedBreach = filledRows.find((row) => {
        const position = revisionPositionForRow(row)
        return position && annualEstimate(row) + 0.009 < Number(position.protected_minimum || 0)
      })
      if (protectedBreach) {
        setMessage({ type: "err", text: `Revision row ${protectedBreach.line_number} is below its Protected Minimum. Increase the proposed amount before submission.` })
        return
      }
      const saved = await saveGridDraft()
      if (!saved) return
    }

    const comments = action === "RETURN" || action === "REJECT" ? window.prompt("Comments / reason:") || "" : ""
    if (action === "RETURN" && !comments.trim()) {
      setMessage({ type: "err", text: "A return reason is required." })
      return
    }

    setSaving(true)
    try {
      await transitionBudgetRevision(revision.id, action, comments)
      await loadSubmission(selected.id)
      await loadDashboard()
      setMessage({ type: "ok", text: `Budget revision ${action.toLowerCase()} action completed.` })
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Budget revision workflow action failed." })
    } finally {
      setSaving(false)
    }
  }

  const handleGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
''',
'revision workflow handler',
)

replace_once(
'''  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (selectedLocked) return
''',
'''  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (selectedLocked || revision) return
''',
'protect revision paste',
)

replace_once(
'''            <HeaderCell label="Version" value={String(selected.version || 1)} />
            <HeaderCell label="Budget Ceiling" value={money(selected.budget_ceiling || 0)} strong />
''',
'''            <HeaderCell label="Version" value={String(selected.version || 1)} />
            <HeaderCell label="Version Position" value={selected.superseded_by_id ? "Historical" : selected.status === "APPROVED" ? "Current Authoritative" : revision ? "Revision in Progress" : "Working Version"} />
            <HeaderCell label="Budget Ceiling" value={money(selected.budget_ceiling || 0)} strong />
''',
'authoritative badge',
)

replace_once(
'''          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
''',
'''          ) : (
            <>
              <BudgetRevisionPanel
                revision={revision}
                position={revisionPosition}
                history={revisionHistory}
                currentAuthoritative={Boolean(selected.status === "APPROVED" && !selected.superseded_by_id)}
              />

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
''',
'revision panel placement',
)

old_toolbar = '''                <div className="flex flex-wrap gap-2">
                  <button onClick={saveGridDraft} disabled={saving || selectedLocked} className="btn-primary">
                    <Save className="h-4 w-4" /> Save Draft
                  </button>
                  {(selected.status === "DRAFT" || selected.status === "RETURNED") && (
                    <button onClick={() => runAction(selected.status === "RETURNED" ? "RESUBMIT" : "SUBMIT")} disabled={saving} className="btn-primary">
                      <Send className="h-4 w-4" /> Submit
                    </button>
                  )}
                  {canReview && ["SUBMITTED", "RESUBMITTED"].includes(selected.status) && (
                    <button onClick={() => runAction("REVIEW")} className="btn-primary">
                      <ShieldCheck className="h-4 w-4" /> Review
                    </button>
                  )}
                  {canReview && ["SUBMITTED", "RESUBMITTED"].includes(selected.status) && (
                    <button onClick={() => runAction("RETURN")} className="btn-light">
                      <Undo2 className="h-4 w-4" /> Return
                    </button>
                  )}
                  {canApprove && selected.status === "REVIEWED" && (
                    <button onClick={() => runAction("APPROVE")} className="btn-primary">
                      <CheckCircle2 className="h-4 w-4" /> Approve
                    </button>
                  )}
                </div>
'''
new_toolbar = '''                <div className="flex flex-wrap gap-2">
                  {canCreateRevision && (
                    <button onClick={() => setShowRevisionDialog(true)} disabled={saving} className="btn-primary">
                      <Plus className="h-4 w-4" /> Create Budget Revision
                    </button>
                  )}

                  {!revision ? (
                    <>
                      <button onClick={saveGridDraft} disabled={saving || selectedLocked} className="btn-primary">
                        <Save className="h-4 w-4" /> Save Draft
                      </button>
                      {canEdit && (selected.status === "DRAFT" || selected.status === "RETURNED") && (
                        <button onClick={() => runAction(selected.status === "RETURNED" ? "RESUBMIT" : "SUBMIT")} disabled={saving} className="btn-primary">
                          <Send className="h-4 w-4" /> Submit
                        </button>
                      )}
                      {canReview && ["SUBMITTED", "RESUBMITTED"].includes(selected.status) && (
                        <button onClick={() => runAction("REVIEW")} className="btn-primary">
                          <ShieldCheck className="h-4 w-4" /> Review
                        </button>
                      )}
                      {canReview && ["SUBMITTED", "RESUBMITTED"].includes(selected.status) && (
                        <button onClick={() => runAction("RETURN")} className="btn-light">
                          <Undo2 className="h-4 w-4" /> Return
                        </button>
                      )}
                      {canApprove && selected.status === "REVIEWED" && (
                        <button onClick={() => runAction("APPROVE")} className="btn-primary">
                          <CheckCircle2 className="h-4 w-4" /> Approve
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      {["DRAFT", "RETURNED"].includes(revision.status) && canRevisionEdit && (
                        <button onClick={saveGridDraft} disabled={saving || selectedLocked} className="btn-primary">
                          <Save className="h-4 w-4" /> Save Revision Draft
                        </button>
                      )}
                      {["DRAFT", "RETURNED"].includes(revision.status) && canRevisionSubmit && (
                        <button onClick={() => runRevisionAction(revision.status === "RETURNED" ? "RESUBMIT" : "SUBMIT")} disabled={saving} className="btn-primary">
                          <Send className="h-4 w-4" /> {revision.status === "RETURNED" ? "Resubmit Revision" : "Submit Revision"}
                        </button>
                      )}
                      {["SUBMITTED", "RESUBMITTED"].includes(revision.status) && canRevisionReview && (
                        <button onClick={() => runRevisionAction("REVIEW")} disabled={saving} className="btn-primary">
                          <ShieldCheck className="h-4 w-4" /> Review Revision
                        </button>
                      )}
                      {["SUBMITTED", "RESUBMITTED"].includes(revision.status) && canRevisionReturn && (
                        <button onClick={() => runRevisionAction("RETURN")} disabled={saving} className="btn-light">
                          <Undo2 className="h-4 w-4" /> Return Revision
                        </button>
                      )}
                      {["SUBMITTED", "RESUBMITTED", "REVIEWED"].includes(revision.status) && canRevisionReject && (
                        <button onClick={() => runRevisionAction("REJECT")} disabled={saving} className="btn-light text-red-700">
                          Reject Revision
                        </button>
                      )}
                      {revision.status === "REVIEWED" && canRevisionApprove && (
                        <button onClick={() => runRevisionAction("APPROVE")} disabled={saving} className="btn-primary">
                          <CheckCircle2 className="h-4 w-4" /> Approve Revision
                        </button>
                      )}
                    </>
                  )}
                </div>
'''
replace_once(old_toolbar, new_toolbar, 'revision toolbar')

replace_once(
'''                <table className="budget-sheet min-w-[5200px] border-collapse text-xs">
''',
'''                <table className={`budget-sheet ${revision ? "min-w-[6400px]" : "min-w-[5200px]"} border-collapse text-xs`}>
''',
'table width',
)

replace_once(
'''                      <SheetTh width={170}>Expense Category</SheetTh>
                      <SheetTh width={260}>Line Item / Activity Description</SheetTh>
''',
'''                      <SheetTh width={170}>Expense Category</SheetTh>
                      {revision && (
                        <>
                          <SheetTh width={145}>Original Approved</SheetTh>
                          <SheetTh width={145}>Current Revised</SheetTh>
                          <SheetTh width={145}>Actual Paid</SheetTh>
                          <SheetTh width={165}>Outstanding Commitments</SheetTh>
                          <SheetTh width={145}>Protected Minimum</SheetTh>
                          <SheetTh width={145}>Adjustment</SheetTh>
                          <SheetTh width={165}>Available After Revision</SheetTh>
                        </>
                      )}
                      <SheetTh width={260}>Line Item / Activity Description</SheetTh>
''',
'revision column headers',
)

replace_once(
'''                      const lineInvalid = !isEmptyRow(row) && !hasMandatory(row)
                      const lineHasVariance = !isEmptyRow(row) && Math.abs(rowVariance) >= 0.01
                      const rowTone = lineHasVariance ? "bg-red-50" : lineInvalid ? "bg-amber-50" : "odd:bg-[#eaf3f8] even:bg-white"
''',
'''                      const lineInvalid = !isEmptyRow(row) && !hasMandatory(row)
                      const lineHasVariance = !isEmptyRow(row) && Math.abs(rowVariance) >= 0.01
                      const linePosition = revisionPositionForRow(row)
                      const protectedBaseline = Boolean(revision && linePosition?.source_budget_allocation_id)
                      const proposedRevised = annualEstimate(row)
                      const protectedMinimumBreach = Boolean(revision && linePosition && proposedRevised + 0.009 < Number(linePosition.protected_minimum || 0))
                      const rowTone = lineHasVariance || protectedMinimumBreach ? "bg-red-50" : lineInvalid ? "bg-amber-50" : "odd:bg-[#eaf3f8] even:bg-white"
''',
'revision row state',
)

replace_once(
'''                                disabled={selectedLocked}
                                aria-label={`Select budget row ${row.line_number}`}
''',
'''                                disabled={selectedLocked || protectedBaseline}
                                aria-label={`Select budget row ${row.line_number}`}
''',
'baseline checkbox protection',
)

replace_once(
'''                            disabled={selectedLocked || gridRows.length === 0}
''',
'''                            disabled={selectedLocked || selectableGridRows.length === 0}
''',
'header checkbox protection',
)

replace_once(
'''                              disabled={selectedLocked}
                              value={row.expense_ledger_id}
                              options={ledgerOptions}
                              placeholder="Search finance code"
''',
'''                              disabled={selectedLocked || protectedBaseline}
                              value={row.expense_ledger_id}
                              options={ledgerOptions}
                              placeholder="Search finance code"
''',
'baseline finance code protection',
)

replace_once(
'''                          <SheetTd readOnly>
                            <ReadOnlyCell value={row.expense_category} empty="Select Finance Code" />
                          </SheetTd>
                          <SheetTd required invalid={!isEmptyRow(row) && !row.line_item_description.trim()}>
''',
'''                          <SheetTd readOnly>
                            <ReadOnlyCell value={row.expense_category} empty="Select Finance Code" />
                          </SheetTd>
                          {revision && (
                            <>
                              <SheetTd readOnly align="right">{money(Number(linePosition?.original_budget || 0))}</SheetTd>
                              <SheetTd readOnly align="right">{money(Number(linePosition?.current_revised_budget || 0))}</SheetTd>
                              <SheetTd readOnly align="right">{money(Number(linePosition?.actual_expenditure || 0))}</SheetTd>
                              <SheetTd readOnly align="right">{money(Number(linePosition?.outstanding_commitment || 0))}</SheetTd>
                              <SheetTd readOnly align="right" invalid={protectedMinimumBreach}>{money(Number(linePosition?.protected_minimum || 0))}</SheetTd>
                              <SheetTd readOnly align="right">{money(proposedRevised - Number(linePosition?.current_revised_budget || 0))}</SheetTd>
                              <SheetTd readOnly align="right" invalid={protectedMinimumBreach}>{money(proposedRevised - Number(linePosition?.actual_expenditure || 0) - Number(linePosition?.outstanding_commitment || 0))}</SheetTd>
                            </>
                          )}
                          <SheetTd required invalid={!isEmptyRow(row) && !row.line_item_description.trim()}>
''',
'revision financial cells',
)

replace_once(
'''                          {MONTHS.map((month, index) => (
                            <SheetTd key={month}>
                              <SheetNumber disabled={selectedLocked} value={row.months[index]} onChange={(v) => updateMonth(row.clientId, index, v)} />
                            </SheetTd>
                          ))}
''',
'''                          {MONTHS.map((month, index) => {
                            const monthLocked = isRevisionMonthLocked(row, index)
                            return (
                              <SheetTd key={month} readOnly={monthLocked}>
                                <SheetNumber disabled={selectedLocked || monthLocked} value={row.months[index]} onChange={(v) => updateMonth(row.clientId, index, v)} />
                              </SheetTd>
                            )
                          })}
''',
'closed month protection',
)

replace_once(
'''                            <select disabled={selectedLocked} className="sheet-input" value={row.funding_source_id} onChange={(e) => updateRow(row.clientId, { funding_source_id: e.target.value })}>
''',
'''                            <select disabled={selectedLocked || protectedBaseline} className="sheet-input" value={row.funding_source_id} onChange={(e) => updateRow(row.clientId, { funding_source_id: e.target.value })}>
''',
'baseline funding protection',
)

replace_once(
'''                      <td className="border border-[#9fbad0] bg-[#d9eaf7] px-2 py-2 text-right font-bold" colSpan={16}>
''',
'''                      <td className="border border-[#9fbad0] bg-[#d9eaf7] px-2 py-2 text-right font-bold" colSpan={revision ? 23 : 16}>
''',
'footer revision columns',
)

replace_once(
'''      {loading && (
''',
'''      {selected && (
        <BudgetRevisionDialog
          open={showRevisionDialog}
          parentSubmissionId={selected.id}
          saving={saving}
          onClose={() => setShowRevisionDialog(false)}
          onCreate={createRevisionFromSelected}
        />
      )}

      {loading && (
''',
'revision dialog placement',
)

path.write_text(text)
print('Budget revision UI applied')
