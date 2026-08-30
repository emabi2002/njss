import fs from 'node:fs'

const path = 'app/dashboard/budget-template/page.tsx'
let source = fs.readFileSync(path, 'utf8')

function replaceOnce(oldText, newText, label) {
  const index = source.indexOf(oldText)
  if (index === -1) {
    if (source.includes(newText)) return
    throw new Error(`Could not find ${label}`)
  }
  source = source.slice(0, index) + newText + source.slice(index + oldText.length)
}

replaceOnce(
  '      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">\n        <aside className="space-y-5">',
  '      <div className="space-y-5">\n        <div data-testid="budget-entry-setup" className="space-y-5">',
  'two-column budget workspace',
)

replaceOnce(
  '            <div className="space-y-3 p-4">',
  '            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.1fr)_minmax(320px,1.6fr)_minmax(150px,.7fr)_minmax(220px,1fr)_auto] xl:items-end">',
  'create-draft field stack',
)

replaceOnce(
  '              <button onClick={createSubmission} disabled={saving || !canEdit} className="btn-primary w-full justify-center">',
  '              <button onClick={createSubmission} disabled={saving || !canEdit} className="btn-primary w-full justify-center xl:w-auto xl:self-end">',
  'create draft button',
)

const submissionsHeading = '              <h2 className="font-semibold text-slate-900">Submissions</h2>'
const submissionsHeadingIndex = source.indexOf(submissionsHeading)
if (submissionsHeadingIndex !== -1) {
  const cardStart = source.lastIndexOf('          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">', submissionsHeadingIndex)
  const asideEndMarker = '        </aside>\n\n        <main className="min-w-0 space-y-5">'
  const asideEnd = source.indexOf(asideEndMarker, submissionsHeadingIndex)
  if (cardStart === -1 || asideEnd === -1) throw new Error('Could not isolate submissions panel')

  const replacement = `          <div data-testid="budget-submission-selector" className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 lg:grid-cols-[minmax(300px,1fr)_minmax(0,2fr)] lg:items-end">
              <Field label="Existing budget sheet">
                <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="input">
                  <option value="">Select existing budget sheet</option>
                  {submissions.map((submission) => (
                    <option key={submission.id} value={submission.id}>
                      {submission.submission_number || "Draft"} — {submission.division?.code || "No division"} — {submission.division?.name || "Unnamed division"} — FY{submission.budget_year} — {submission.status}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="min-w-0 rounded-lg bg-slate-50 px-4 py-2.5">
                {selected ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">{selected.submission_number || "Draft"}</span>
                      <StatusBadge status={selected.status} />
                    </div>
                    <p className="mt-1 truncate text-sm text-slate-600">
                      {selected.division?.code || "-"} — {selected.division?.name || "-"} • FY{selected.budget_year} • {money(selected.total_proposed_budget || 0)}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-500">Choose an existing budget sheet to continue editing, reviewing or approving it.</p>
                )}
              </div>
            </div>
            {submissions.length === 0 && <Empty message="No budget templates yet." />}
          </div>
        </div>

        <main data-testid="budget-sheet-workspace" className="w-full min-w-0 space-y-5">`

  source = source.slice(0, cardStart) + replacement + source.slice(asideEnd + asideEndMarker.length)
} else if (!source.includes('data-testid="budget-submission-selector"')) {
  throw new Error('Could not find submissions panel')
}

replaceOnce(
  '              <div ref={gridRef} onKeyDown={handleGridKeyDown} onPaste={handlePaste} className="sheet-wrap rounded-xl border border-[#1f4e79] bg-white shadow-sm">',
  '              <div ref={gridRef} onKeyDown={handleGridKeyDown} onPaste={handlePaste} className="sheet-wrap min-h-[calc(100vh-360px)] overflow-x-auto rounded-xl border border-[#1f4e79] bg-white shadow-sm">',
  'spreadsheet scroll wrapper',
)

replaceOnce(
  '        .sheet-wrap { max-width: 100%; overflow: auto; max-height: calc(100vh - 245px); }',
  '        .sheet-wrap { max-width: 100%; overflow-x: auto; overflow-y: visible; }',
  'spreadsheet fixed-height CSS',
)

fs.writeFileSync(path, source)
console.log('Applied full-width Budget Entry layout')
