import fs from 'node:fs'

const file = 'app/dashboard/budget-template/page.tsx'
let source = fs.readFileSync(file, 'utf8')

function replaceOnce(label, before, after) {
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`${label}: expected exactly one match, found ${count}`)
  source = source.replace(before, after)
}

replaceOnce(
  'selection state',
  '  const [selectedRow, setSelectedRow] = useState("")\n',
  '  const [selectedRow, setSelectedRow] = useState("")\n  const [selectedRows, setSelectedRows] = useState<string[]>([])\n'
)

replaceOnce(
  'clear selection for empty submission',
  '      setSelected(null)\n      setGridRows([])\n      setHistory([])\n',
  '      setSelected(null)\n      setGridRows([])\n      setSelectedRows([])\n      setHistory([])\n'
)

replaceOnce(
  'clear selection after loading submission',
  '      setGridRows(rows.length > 0 ? rows : [newRow(1)])\n      setHistory(detail.history || [])\n',
  '      setGridRows(rows.length > 0 ? rows : [newRow(1)])\n      setSelectedRows([])\n      setHistory(detail.history || [])\n'
)

const oldRemove = [
  '  const removeSelectedRow = async () => {',
  '    const row = gridRows.find((item) => item.clientId === selectedRow)',
  '    if (!row) return',
  '    if (row.id && selected && !confirm("Delete this saved budget line?")) return',
  '    setSaving(true)',
  '    try {',
  '      if (row.id) {',
  '        await deleteBudgetLine(row.id)',
  '        await createAuditEvent({ action: "DELETE", entity_type: "BUDGET_LINE", entity_id: row.id, entity_reference: selected?.submission_number || null, user_email: profile?.email || null, user_name: profile?.name || null })',
  '      }',
  '      setGridRows((rows) => rows.filter((item) => item.clientId !== selectedRow).map((item, index) => ({ ...item, line_number: index + 1 })))',
  '      setSelectedRow("")',
  '      if (selected) await loadSubmission(selected.id)',
  '      await loadDashboard()',
  '    } catch (err) {',
  '      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not delete the row." })',
  '    } finally {',
  '      setSaving(false)',
  '    }',
  '  }',
  '',
].join('\n')

const newRemove = [
  '  const allRowsSelected = gridRows.length > 0 && gridRows.every((row) => selectedRows.includes(row.clientId))',
  '',
  '  const toggleSelectedRow = (clientIdValue: string) => {',
  '    setSelectedRows((rows) => (rows.includes(clientIdValue) ? rows.filter((id) => id !== clientIdValue) : [...rows, clientIdValue]))',
  '  }',
  '',
  '  const toggleSelectAllRows = () => {',
  '    setSelectedRows(allRowsSelected ? [] : gridRows.map((row) => row.clientId))',
  '  }',
  '',
  '  const removeSelectedRows = async () => {',
  '    if (selectedRows.length === 0) return',
  '    const rowsToDelete = gridRows.filter((item) => selectedRows.includes(item.clientId))',
  '    if (rowsToDelete.length === 0) return',
  '    const savedRows = rowsToDelete.filter((row) => row.id)',
  '    if (savedRows.length > 0 && selected && !confirm(`Delete ${rowsToDelete.length} selected budget row${rowsToDelete.length === 1 ? "" : "s"}?`)) return',
  '    setSaving(true)',
  '    try {',
  '      for (const row of savedRows) {',
  '        if (!row.id) continue',
  '        await deleteBudgetLine(row.id)',
  '        await createAuditEvent({ action: "DELETE", entity_type: "BUDGET_LINE", entity_id: row.id, entity_reference: selected?.submission_number || null, user_email: profile?.email || null, user_name: profile?.name || null })',
  '      }',
  '      const selectedIds = new Set(rowsToDelete.map((row) => row.clientId))',
  '      setGridRows((rows) => rows.filter((item) => !selectedIds.has(item.clientId)).map((item, index) => ({ ...item, line_number: index + 1 })))',
  '      if (selectedRows.includes(selectedRow)) setSelectedRow("")',
  '      setSelectedRows([])',
  '      if (selected) await loadSubmission(selected.id)',
  '      await loadDashboard()',
  '      setMessage({ type: "ok", text: `${rowsToDelete.length} budget row${rowsToDelete.length === 1 ? "" : "s"} deleted.` })',
  '    } catch (err) {',
  '      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not delete the selected rows." })',
  '    } finally {',
  '      setSaving(false)',
  '    }',
  '  }',
  '',
].join('\n')
replaceOnce('multi-row delete handler', oldRemove, newRemove)

const oldButton = [
  '                  <button onClick={removeSelectedRow} disabled={selectedLocked || !selectedRow} className="btn-light text-red-700">',
  '                    <Trash2 className="h-4 w-4" /> Delete Row',
  '                  </button>',
].join('\n')
const newButton = [
  '                  <button onClick={removeSelectedRows} disabled={selectedLocked || selectedRows.length === 0} className="btn-light text-red-700">',
  '                    <Trash2 className="h-4 w-4" /> Delete Selected Rows{selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}',
  '                  </button>',
].join('\n')
replaceOnce('delete button', oldButton, newButton)

const oldHeader = [
  '                      <SheetTh sticky left={0} width={70}>',
  '                        Line No.',
  '                      </SheetTh>',
].join('\n')
const newHeader = [
  '                      <SheetTh sticky left={0} width={70}>',
  '                        <div className="flex items-center gap-1">',
  '                          <input',
  '                            type="checkbox"',
  '                            checked={allRowsSelected}',
  '                            onChange={toggleSelectAllRows}',
  '                            onClick={(event) => event.stopPropagation()}',
  '                            disabled={selectedLocked || gridRows.length === 0}',
  '                            aria-label="Select all budget rows"',
  '                            className="h-4 w-4 shrink-0 accent-[#1f4e79]"',
  '                          />',
  '                          <span>Line No.</span>',
  '                        </div>',
  '                      </SheetTh>',
].join('\n')
replaceOnce('line number header', oldHeader, newHeader)

const oldRowCell = [
  '                          <SheetTd sticky left={0} readOnly>',
  '                            {row.line_number}',
  '                          </SheetTd>',
].join('\n')
const newRowCell = [
  '                          <SheetTd sticky left={0} readOnly>',
  '                            <div className="flex items-center gap-2">',
  '                              <input',
  '                                type="checkbox"',
  '                                checked={selectedRows.includes(row.clientId)}',
  '                                onChange={() => {',
  '                                  setSelectedRow(row.clientId)',
  '                                  toggleSelectedRow(row.clientId)',
  '                                }}',
  '                                onClick={(event) => event.stopPropagation()}',
  '                                disabled={selectedLocked}',
  '                                aria-label={`Select budget row ${row.line_number}`}',
  '                                className="h-4 w-4 shrink-0 accent-[#1f4e79]"',
  '                              />',
  '                              <span>{row.line_number}</span>',
  '                            </div>',
  '                          </SheetTd>',
].join('\n')
replaceOnce('row checkbox', oldRowCell, newRowCell)

fs.writeFileSync(file, source)
console.log('Applied budget checkbox multi-row selection changes')
