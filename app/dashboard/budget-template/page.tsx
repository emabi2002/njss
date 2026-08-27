"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Copy,
  FileSpreadsheet,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Undo2,
} from "lucide-react"
import {
  MONTHS,
  createAuditEvent,
  createBudgetCycle,
  createBudgetDivision,
  createDraftSubmission,
  deleteBudgetLine,
  getBudgetDashboard,
  getBudgetLookups,
  getSubmissionDetail,
  saveBudgetLine,
  transitionSubmission,
  updateSubmissionHeader,
  type BudgetActivityTemplate,
  type BudgetCycle,
  type BudgetDivision,
  type BudgetLine,
  type BudgetMonthlyAllocation,
  type BudgetSubmission,
  type ExpenseLedger,
} from "@/lib/budget-module"
import { useAuth } from "@/contexts/AuthContext"
import { exportToExcel, exportToPDF, rowsToPdfTable } from "@/lib/export"
import { LookupSelect, type LookupOption } from "@/components/LookupSelect"
import { loadActiveUsers, loadLookup } from "@/lib/lookups"
import { findDuplicateBudgetCycle, selectBudgetCycle } from "@/lib/budget-cycle-ui"
import { findDuplicateBudgetDivision } from "@/lib/budget-division-ui"
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

type FundingSource = { id: string; code: string; name: string }
type LookupState = {
  cycles: BudgetCycle[]
  divisions: BudgetDivision[]
  ledgers: ExpenseLedger[]
  fundingSources: FundingSource[]
  activityTemplates: BudgetActivityTemplate[]
}
type CashflowRow = { budget_year: number; division_code: string; division_name: string; month_number: number; month_name: string; amount: number }
type WorkflowRow = { action: string; from_status: string | null; to_status: string; comments: string | null; created_at: string; changed_by_email: string | null }

type GridRow = {
  clientId: string
  id?: string
  line_number: number
  activity_reference: string
  finance_code: string
  expense_ledger_id: string
  ledger_number: string
  standard_description: string
  budget_class: string
  expense_category: string
  line_item_description: string
  business_justification: string
  location_destination_provider: string
  beneficiary_custodian_officer: string
  start_date: string
  end_date: string
  quantity: number
  unit_of_measure: string
  unit_of_measure_id: string
  unit_cost: number
  frequency_periods: number
  other_costs: number
  months: number[]
  priority: string
  priority_level_id: string
  funding_source_id: string
  procurement_method: string
  procurement_method_id: string
  responsible_officer: string
  responsible_officer_id: string
  supporting_reference: string
  comments: string
}

const emptyLookups: LookupState = { cycles: [], divisions: [], ledgers: [], fundingSources: [], activityTemplates: [] }
const money = (value: number) => `K ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const clientId = () => `row-${Date.now()}-${Math.random().toString(36).slice(2)}`
const blankMonths = () => Array.from({ length: 12 }, () => 0)
const annualEstimate = (row: GridRow) => (Number(row.quantity) || 0) * (Number(row.unit_cost) || 0) * (Number(row.frequency_periods) || 0) + (Number(row.other_costs) || 0)
const monthlyTotal = (row: GridRow) => row.months.reduce((sum, value) => sum + (Number(value) || 0), 0)
const variance = (row: GridRow) => annualEstimate(row) - monthlyTotal(row)
const isEmptyRow = (row: GridRow) => !row.expense_ledger_id && !row.line_item_description && !row.business_justification && annualEstimate(row) === 0 && monthlyTotal(row) === 0
const hasMandatory = (row: GridRow) => Boolean(row.expense_ledger_id && row.line_item_description.trim() && row.business_justification.trim() && Number(row.quantity) > 0 && Number(row.unit_cost) >= 0 && Number(row.frequency_periods) > 0)
const isValidLine = (row: GridRow) => !isEmptyRow(row) && hasMandatory(row) && Math.abs(variance(row)) < 0.01

function newRow(lineNumber: number): GridRow {
  return {
    clientId: clientId(),
    line_number: lineNumber,
    activity_reference: "",
    finance_code: "",
    expense_ledger_id: "",
    ledger_number: "",
    standard_description: "",
    budget_class: "",
    expense_category: "",
    line_item_description: "",
    business_justification: "",
    location_destination_provider: "",
    beneficiary_custodian_officer: "",
    start_date: "",
    end_date: "",
    quantity: 1,
    unit_of_measure: "",
    unit_of_measure_id: "",
    unit_cost: 0,
    frequency_periods: 1,
    other_costs: 0,
    months: blankMonths(),
    priority: "MEDIUM",
    priority_level_id: "",
    funding_source_id: "",
    procurement_method: "",
    procurement_method_id: "",
    responsible_officer: "",
    responsible_officer_id: "",
    supporting_reference: "",
    comments: "",
  }
}

function rowFromBudgetLine(line: BudgetLine): GridRow {
  const months = blankMonths()
  ;(line.allocations || []).forEach((allocation) => {
    months[(allocation.month_number || 1) - 1] = Number(allocation.amount || 0)
  })
  return {
    clientId: line.id,
    id: line.id,
    line_number: line.line_number,
    activity_reference: line.activity_reference || "",
    finance_code: line.ledger?.finance_code || "",
    expense_ledger_id: line.expense_ledger_id || "",
    ledger_number: line.ledger?.ledger_number || "",
    standard_description: line.ledger?.standard_description || "",
    budget_class: line.ledger?.budget_class_lookup?.name || line.ledger?.budget_class || "",
    expense_category: line.ledger?.budget_expense_category_lookup?.name || line.ledger?.expense_category || "",
    line_item_description: line.line_item_description || "",
    business_justification: line.business_justification || "",
    location_destination_provider: line.location_destination_provider || "",
    beneficiary_custodian_officer: line.beneficiary_custodian_officer || "",
    start_date: line.start_date || "",
    end_date: line.end_date || "",
    quantity: Number(line.quantity || 0),
    unit_of_measure: line.unit_of_measure || "",
    unit_of_measure_id: line.unit_of_measure_id || "",
    unit_cost: Number(line.unit_cost || 0),
    frequency_periods: Number(line.frequency_periods || 0),
    other_costs: Number(line.other_costs || 0),
    months,
    priority: line.priority || "MEDIUM",
    priority_level_id: line.priority_level_id || "",
    funding_source_id: line.funding_source_id || "",
    procurement_method: line.procurement_method || "",
    procurement_method_id: line.procurement_method_id || "",
    responsible_officer: line.responsible_officer || "",
    responsible_officer_id: line.responsible_officer_id || "",
    supporting_reference: line.supporting_reference || "",
    comments: line.comments || "",
  }
}

function allocationsFor(row: GridRow): BudgetMonthlyAllocation[] {
  return MONTHS.map((month, index) => ({ month_number: index + 1, month_name: month, amount: Number(row.months[index] || 0) }))
}

export default function BudgetTemplatePage() {
  const { profile, roles, can } = useAuth()
  const gridRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [lookups, setLookups] = useState<LookupState>(emptyLookups)
  const [priorityLevels, setPriorityLevels] = useState<LookupOption[]>([])
  const [procurementMethods, setProcurementMethods] = useState<LookupOption[]>([])
  const [units, setUnits] = useState<LookupOption[]>([])
  const [officers, setOfficers] = useState<LookupOption[]>([])
  const [submissions, setSubmissions] = useState<BudgetSubmission[]>([])
  const [cashflow, setCashflow] = useState<CashflowRow[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [selected, setSelected] = useState<BudgetSubmission | null>(null)
  const [gridRows, setGridRows] = useState<GridRow[]>([])
  const [history, setHistory] = useState<WorkflowRow[]>([])
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null)
  const [selectedRow, setSelectedRow] = useState("")
  const [selectedRows, setSelectedRows] = useState<string[]>([])
  const [divisionSearch, setDivisionSearch] = useState("")
  const [showDivisionForm, setShowDivisionForm] = useState(false)
  const [newDivision, setNewDivision] = useState({ code: "", name: "", cost_centre_code: "", cost_centre_name: "" })
  const [showCycleForm, setShowCycleForm] = useState(false)
  const [newCycle, setNewCycle] = useState({ budget_year: String(new Date().getFullYear() + 1), cycle_type: "ANNUAL", name: "", submission_deadline: "", department_ceiling: "" })
  const [draftHeader, setDraftHeader] = useState({ cycle_id: "", division_id: "", budget_ceiling: "", submission_reference: "" })
  const [revision, setRevision] = useState<BudgetRevision | null>(null)
  const [revisionPosition, setRevisionPosition] = useState<BudgetRevisionPosition[]>([])
  const [revisionHistory, setRevisionHistory] = useState<BudgetRevision[]>([])
  const [showRevisionDialog, setShowRevisionDialog] = useState(false)

  const canAdmin = can("masterdata.manage") || can("registry.manage") || can("users.manage") || can("budget.template.approve")
  const canEdit = can("budget.template.edit") || can("budget.template.create") || can("budget.template") || can("budget.template.submit")
  const canReview = can("budget.template.review")
  const canApprove = can("budget.template.approve")
  const isRegistrar = roles.includes("Registrar")
  const isLineSupervisor = roles.includes("Line Supervisor")
  const canRevisionCreate = isRegistrar && can("budget.revision.create")
  const canRevisionEdit = isLineSupervisor && can("budget.revision.edit")
  const canRevisionSubmit = isLineSupervisor && can("budget.revision.submit")
  const canRevisionReturn = isRegistrar && can("budget.revision.return")
  const canRevisionReject = isRegistrar && can("budget.revision.reject")
  const canRevisionApprove = isRegistrar && can("budget.revision.approve")
  const revisionEditable = Boolean(revision && ["DRAFT", "RETURNED"].includes(revision.status) && canRevisionEdit)
  const selectedLocked = revision
    ? !revisionEditable
    : Boolean(selected?.is_locked || ["SUBMITTED", "RESUBMITTED", "REVIEWED", "APPROVED", "ARCHIVED"].includes(selected?.status || "") || !canEdit)
  const canCreateRevision = Boolean(selected && selected.status === "APPROVED" && !selected.superseded_by_id && canRevisionCreate)

  const restrictedDivisionUser = !canAdmin && !canReview && !canApprove
  const profileDepartment = profile?.department || ""
  const assignedDivisions = useMemo(() => {
    if (!restrictedDivisionUser || !profileDepartment) return lookups.divisions
    const needle = profileDepartment.toLowerCase()
    const matches = lookups.divisions.filter((division) =>
      [division.name, division.code, division.cost_centre_name, division.cost_centre_code].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle))
    )
    return matches.length > 0 ? matches : lookups.divisions
  }, [lookups.divisions, profileDepartment, restrictedDivisionUser])

  const filteredDivisions = useMemo(() => {
    const needle = divisionSearch.toLowerCase().trim()
    return assignedDivisions.filter((division) => {
      const label = `${division.code} ${division.name} ${division.cost_centre_code || ""} ${division.cost_centre_name || ""}`.toLowerCase()
      return !needle || label.includes(needle)
    })
  }, [assignedDivisions, divisionSearch])

  const activityOptions = useMemo<LookupOption[]>(
    () =>
      lookups.activityTemplates.map((activity) => ({
        ...activity,
        id: activity.id,
        code: activity.code,
        name: activity.name,
        description: activity.description,
      })),
    [lookups.activityTemplates]
  )

  const ledgerOptions = useMemo<LookupOption[]>(
    () =>
      lookups.ledgers.map((ledger) => ({
        ...ledger,
        id: ledger.id,
        code: ledger.finance_code,
        name: ledger.standard_description,
        description: `${ledger.ledger_number || "No ledger number"} • ${ledger.budget_class_lookup?.name || ledger.budget_class || "No class"} • ${ledger.budget_expense_category_lookup?.name || ledger.expense_category || "No category"}`,
      })),
    [lookups.ledgers]
  )

  const selectedCycle = lookups.cycles.find((cycle) => cycle.id === draftHeader.cycle_id)
  const selectedDivision = lookups.divisions.find((division) => division.id === draftHeader.division_id)
  const totalProposed = gridRows.filter((row) => !isEmptyRow(row)).reduce((sum, row) => sum + annualEstimate(row), 0)
  const totalMonthly = gridRows.filter((row) => !isEmptyRow(row)).reduce((sum, row) => sum + monthlyTotal(row), 0)
  const totalVariance = totalProposed - totalMonthly
  const hasVariance = gridRows.some((row) => !isEmptyRow(row) && Math.abs(variance(row)) >= 0.01)
  const invalidLineCount = gridRows.filter((row) => !isEmptyRow(row) && !hasMandatory(row)).length
  const validationLabel = gridRows.some((row) => !isEmptyRow(row)) && !hasVariance && invalidLineCount === 0 ? "VALID" : "CHECK VARIANCES"
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
    setLoading(true)
    try {
      const [lookupData, dashboard, priorities, methods, unitRows, officerRows] = await Promise.all([
        getBudgetLookups(),
        getBudgetDashboard(),
        loadLookup("priority_levels"),
        loadLookup("procurement_methods"),
        loadLookup("units_of_measure"),
        loadActiveUsers(),
      ])
      setLookups(lookupData as LookupState)
      setPriorityLevels(priorities)
      setProcurementMethods(methods)
      setUnits(unitRows)
      setOfficers(officerRows)
      setSubmissions((dashboard.submissions || []) as BudgetSubmission[])
      setCashflow((dashboard.cashflow || []) as CashflowRow[])
      setDraftHeader((header) => {
        if (header.cycle_id || !lookupData.cycles?.[0]) return header
        const defaultCycle = lookupData.cycles[0]
        return { ...header, cycle_id: defaultCycle.id, budget_ceiling: String(defaultCycle.department_ceiling ?? "") }
      })
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not load the budget template workspace." })
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSubmission = useCallback(async (id: string) => {
    if (!id) {
      setSelected(null)
      setGridRows([])
      setSelectedRows([])
      setHistory([])
      setRevision(null)
      setRevisionPosition([])
      setRevisionHistory([])
      return
    }
    setLoading(true)
    try {
      const detail = await getSubmissionDetail(id)
      setSelected(detail.submission)
      const rows = (detail.lines || []).map(rowFromBudgetLine)
      setGridRows(rows.length > 0 ? rows : [newRow(1)])
      setSelectedRows([])
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
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not load the selected submission." })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const submissionId = params.get("submission")
    if (submissionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(submissionId)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSubmission(selectedId)
  }, [selectedId, loadSubmission])

  const updateRow = (clientIdValue: string, patch: Partial<GridRow>) => {
    setGridRows((rows) => rows.map((row) => (row.clientId === clientIdValue ? { ...row, ...patch } : row)))
  }

  const updateMonth = (clientIdValue: string, index: number, value: number) => {
    setGridRows((rows) =>
      rows.map((row) => {
        if (row.clientId !== clientIdValue) return row
        const months = [...row.months]
        months[index] = Number(value || 0)
        return { ...row, months }
      })
    )
  }

  const selectFinanceCode = (clientIdValue: string, value: string) => {
    const ledger = lookups.ledgers.find((item) => item.finance_code === value || item.id === value)
    updateRow(
      clientIdValue,
      ledger
        ? {
            finance_code: ledger.finance_code,
            expense_ledger_id: ledger.id,
            ledger_number: ledger.ledger_number || "",
            standard_description: ledger.standard_description || "",
            budget_class: ledger.budget_class_lookup?.name || ledger.budget_class || "",
            expense_category: ledger.budget_expense_category_lookup?.name || ledger.expense_category || "",
          }
        : { finance_code: value, expense_ledger_id: "", ledger_number: "", standard_description: "", budget_class: "", expense_category: "" }
    )
  }

  const selectActivityTemplate = (clientIdValue: string, value: string, option?: LookupOption) => {
    const activity = lookups.activityTemplates.find((item) => item.id === value || item.code === value || item.name === value)
    updateRow(
      clientIdValue,
      activity
        ? {
            activity_reference: activity.code,
            line_item_description: (option?.default_line_item_description as string) || activity.default_line_item_description || activity.name,
            business_justification: (option?.default_business_justification as string) || activity.default_business_justification || "",
            unit_of_measure_id: activity.default_unit_of_measure_id || "",
            priority_level_id: activity.default_priority_level_id || "",
            priority: priorityLevels.find((priority) => priority.id === activity.default_priority_level_id)?.code || "",
          }
        : { activity_reference: value }
    )
  }

  const selectCycle = (cycleId: string) => {
    setDraftHeader((header) => ({ ...header, ...selectBudgetCycle(lookups.cycles, cycleId) }))
  }

  const createSubmission = async () => {
    setMessage(null)
    if (!selectedCycle || !selectedDivision) {
      setMessage({ type: "err", text: "Select a budget cycle and division first." })
      return
    }
    setSaving(true)
    try {
      const id = await createDraftSubmission({
        cycle_id: selectedCycle.id,
        budget_year: selectedCycle.budget_year,
        division_id: selectedDivision.id,
        department_id: selectedDivision.department_id,
        cost_centre: selectedDivision.cost_centre_code || selectedDivision.code,
        budget_ceiling: Number(draftHeader.budget_ceiling || 0),
        submission_reference: draftHeader.submission_reference || null,
        prepared_by: profile?.id || null,
      })
      await createAuditEvent({ action: "CREATE", entity_type: "BUDGET_SUBMISSION", entity_id: id, entity_reference: draftHeader.submission_reference || null, user_email: profile?.email || null, user_name: profile?.name || null })
      setSelectedId(id)
      setMessage({ type: "ok", text: "Draft divisional budget template created." })
      await loadDashboard()
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? `Could not create the draft submission: ${err.message}` : "Could not create the draft submission." })
    } finally {
      setSaving(false)
    }
  }

  const createRevisionFromSelected = async (input: CreateBudgetRevisionInput) => {
    if (!selected) return
    setSaving(true)
    setMessage(null)
    try {
      const result = await createBudgetRevision(input)
      setShowRevisionDialog(false)
      await loadDashboard()
      setSelectedId(result.revision_submission_id)
      setMessage({ type: "ok", text: `${result.revision_number} requested. The Line Supervisor can now review and adjust the controlled revision draft; the approved baseline remains locked.` })
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not create the budget revision." })
    } finally {
      setSaving(false)
    }
  }

  const addCycle = async () => {
    setMessage(null)
    if (!canAdmin) return

    const budgetYear = Number(newCycle.budget_year)
    const cycleType = newCycle.cycle_type.trim().toUpperCase()
    const cycleName = newCycle.name.trim()

    if (!Number.isInteger(budgetYear) || budgetYear < 2000 || !cycleType || !cycleName) {
      setMessage({ type: "err", text: "Complete the financial year, cycle type and cycle name before creating a budget cycle." })
      return
    }

    const duplicate = findDuplicateBudgetCycle(lookups.cycles, budgetYear, cycleType)
    if (duplicate) {
      setDraftHeader((header) => ({ ...header, ...selectBudgetCycle(lookups.cycles, duplicate.id) }))
      setMessage({ type: "err", text: `An ${cycleType} budget cycle already exists for FY${budgetYear}: ${duplicate.name}. It has been selected from the list instead.` })
      return
    }

    setSaving(true)
    try {
      const created = await createBudgetCycle({
        budget_year: budgetYear,
        cycle_type: cycleType,
        name: cycleName,
        submission_deadline: newCycle.submission_deadline || null,
        department_ceiling: Number(newCycle.department_ceiling || 0),
        instructions: "Created from Budget Preparation controlled setup.",
      })
      await loadDashboard()
      setDraftHeader((header) => ({ ...header, cycle_id: created.id, budget_ceiling: String(created.department_ceiling ?? "") }))
      setShowCycleForm(false)
      setNewCycle({ budget_year: String(created.budget_year + 1), cycle_type: "ANNUAL", name: "", submission_deadline: "", department_ceiling: "" })
      setMessage({ type: "ok", text: "Budget cycle added to the controlled register and selected for this draft." })
    } catch (err) {
      const errorCode = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code || "") : ""
      if (errorCode === "23505") {
        setMessage({ type: "err", text: `An ${cycleType} budget cycle already exists for FY${budgetYear}. Refresh the list and select the existing cycle.` })
      } else {
        setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not add budget cycle." })
      }
    } finally {
      setSaving(false)
    }
  }

  const addDivision = async () => {
    setMessage(null)
    if (!canAdmin) return

    const divisionCode = newDivision.code.trim().toUpperCase()
    const divisionName = newDivision.name.trim()
    const costCentreCode = newDivision.cost_centre_code.trim().toUpperCase()
    const costCentreName = newDivision.cost_centre_name.trim()

    if (!divisionCode || !divisionName) {
      setMessage({ type: "err", text: "Complete the division code and division name before creating a division / cost centre." })
      return
    }

    const duplicate = findDuplicateBudgetDivision(lookups.divisions, divisionCode)
    if (duplicate) {
      setDivisionSearch("")
      setDraftHeader((header) => ({ ...header, division_id: duplicate.id }))
      setMessage({ type: "err", text: `Division code ${divisionCode} already exists: ${duplicate.name}. It has been selected from the list instead.` })
      return
    }

    setSaving(true)
    try {
      const created = await createBudgetDivision({
        code: divisionCode,
        name: divisionName,
        cost_centre_code: costCentreCode || null,
        cost_centre_name: costCentreName || null,
      })
      await loadDashboard()
      setDivisionSearch("")
      setDraftHeader((header) => ({ ...header, division_id: created.id }))
      setShowDivisionForm(false)
      setNewDivision({ code: "", name: "", cost_centre_code: "", cost_centre_name: "" })
      setMessage({ type: "ok", text: "Division / cost centre added to the controlled register and selected for this draft." })
    } catch (err) {
      const errorCode = typeof err === "object" && err && "code" in err ? String((err as { code?: unknown }).code || "") : ""
      if (errorCode === "23505") {
        setMessage({ type: "err", text: `Division code ${divisionCode} already exists. Refresh the list and select the existing division.` })
      } else {
        setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not add division / cost centre." })
      }
    } finally {
      setSaving(false)
    }
  }

  const selectableGridRows = gridRows.filter((row) => !isProtectedRevisionRow(row))
  const addRow = () => setGridRows((rows) => [...rows, newRow(rows.length + 1)])
  const duplicateRow = () => {
    const source = gridRows.find((row) => row.clientId === selectedRow)
    if (!source) return
    setGridRows((rows) => [...rows, { ...source, id: undefined, clientId: clientId(), line_number: rows.length + 1 }])
  }

  const allRowsSelected = selectableGridRows.length > 0 && selectableGridRows.every((row) => selectedRows.includes(row.clientId))

  const toggleSelectedRow = (clientIdValue: string) => {
    setSelectedRows((rows) => (rows.includes(clientIdValue) ? rows.filter((id) => id !== clientIdValue) : [...rows, clientIdValue]))
  }

  const toggleSelectAllRows = () => {
    setSelectedRows(allRowsSelected ? [] : selectableGridRows.map((row) => row.clientId))
  }

  const removeSelectedRows = async () => {
    if (selectedRows.length === 0) return
    const rowsToDelete = gridRows.filter((item) => selectedRows.includes(item.clientId) && !isProtectedRevisionRow(item))
    if (rowsToDelete.length === 0) return
    const savedRows = rowsToDelete.filter((row) => row.id)
    if (savedRows.length > 0 && selected && !confirm(`Delete ${rowsToDelete.length} selected budget row${rowsToDelete.length === 1 ? "" : "s"}?`)) return
    setSaving(true)
    try {
      for (const row of savedRows) {
        if (!row.id) continue
        await deleteBudgetLine(row.id)
        await createAuditEvent({ action: "DELETE", entity_type: "BUDGET_LINE", entity_id: row.id, entity_reference: selected?.submission_number || null, user_email: profile?.email || null, user_name: profile?.name || null })
      }
      const selectedIds = new Set(rowsToDelete.map((row) => row.clientId))
      setGridRows((rows) => rows.filter((item) => !selectedIds.has(item.clientId)).map((item, index) => ({ ...item, line_number: index + 1 })))
      if (selectedRows.includes(selectedRow)) setSelectedRow("")
      setSelectedRows([])
      if (selected) await loadSubmission(selected.id)
      await loadDashboard()
      setMessage({ type: "ok", text: `${rowsToDelete.length} budget row${rowsToDelete.length === 1 ? "" : "s"} deleted.` })
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not delete the selected rows." })
    } finally {
      setSaving(false)
    }
  }

  const allocateEvenly = () => {
    const row = gridRows.find((item) => item.clientId === selectedRow)
    if (!row) return
    const estimate = annualEstimate(row)
    const lockedIndexes = revision
      ? MONTHS.map((_, index) => index).filter((index) => isRevisionMonthLocked(row, index))
      : []

    if (lockedIndexes.length > 0) {
      const unlockedIndexes = MONTHS.map((_, index) => index).filter((index) => !isRevisionMonthLocked(row, index))
      if (unlockedIndexes.length === 0) {
        setMessage({ type: "err", text: "All monthly periods on this revision line are locked by closed periods or actual expenditure." })
        return
      }

      const months = [...row.months]
      const lockedTotal = lockedIndexes.reduce((sum, index) => sum + Number(months[index] || 0), 0)
      const remainingEstimate = Number((estimate - lockedTotal).toFixed(2))
      if (remainingEstimate < -0.009) {
        setMessage({ type: "err", text: "The proposed annual estimate is below the amount already fixed in locked monthly periods." })
        return
      }

      const perOpenMonth = Math.floor((Math.max(remainingEstimate, 0) / unlockedIndexes.length) * 100) / 100
      unlockedIndexes.forEach((index) => { months[index] = perOpenMonth })
      const allocated = months.reduce((sum, value) => sum + Number(value || 0), 0)
      const finalOpenIndex = unlockedIndexes[unlockedIndexes.length - 1]
      months[finalOpenIndex] = Number((months[finalOpenIndex] + (estimate - allocated)).toFixed(2))
      updateRow(row.clientId, { months })
      return
    }

    const perMonth = Math.floor((estimate / 12) * 100) / 100
    const months = Array.from({ length: 12 }, () => perMonth)
    months[11] = Number((months[11] + (estimate - months.reduce((sum, value) => sum + value, 0))).toFixed(2))
    updateRow(row.clientId, { months })
  }

  const saveGridDraft = async () => {
    if (!selected) return false
    const rowsToSave = gridRows.filter((row) => !isEmptyRow(row))
    const invalidRows = rowsToSave.filter((row) => !hasMandatory(row))
    if (invalidRows.length > 0) {
      setMessage({ type: "err", text: `Complete mandatory fields before saving. ${invalidRows.length} row(s) need attention.` })
      return false
    }
    setSaving(true)
    try {
      await updateSubmissionHeader(selected.id, {
        submission_reference: selected.submission_reference || null,
        budget_ceiling: selected.budget_ceiling || 0,
      })
      for (const [index, row] of rowsToSave.entries()) {
        await saveBudgetLine(selected.id, { ...row, line_number: index + 1 }, allocationsFor(row))
      }
      await createAuditEvent({ action: "SAVE_DRAFT_GRID", entity_type: "BUDGET_SUBMISSION", entity_id: selected.id, entity_reference: selected.submission_number, changes: { rows: rowsToSave.length, totalProposed, totalMonthly, totalVariance }, user_email: profile?.email || null, user_name: profile?.name || null })
      await loadSubmission(selected.id)
      await loadDashboard()
      setMessage({ type: "ok", text: "Spreadsheet draft saved." })
      return true
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Could not save the spreadsheet draft." })
      return false
    } finally {
      setSaving(false)
    }
  }

  const runAction = async (action: "SUBMIT" | "RESUBMIT" | "RETURN" | "REVIEW" | "APPROVE" | "REJECT") => {
    if (!selected) return
    const filledRows = gridRows.filter((row) => !isEmptyRow(row))
    if (["SUBMIT", "RESUBMIT"].includes(action)) {
      if (filledRows.length === 0) {
        setMessage({ type: "err", text: "Add at least one valid budget line before submission." })
        return
      }
      if (filledRows.some((row) => !isValidLine(row))) {
        setMessage({ type: "err", text: "Submission blocked. Resolve missing fields and zero all monthly variances first." })
        return
      }
      const saved = await saveGridDraft()
      if (!saved) return
    }
    const comments = action === "RETURN" || action === "REJECT" ? window.prompt("Comments / reason:") || "" : ""
    setSaving(true)
    try {
      await transitionSubmission(selected.id, action, comments, profile?.email || "")
      await createAuditEvent({ action, entity_type: "BUDGET_SUBMISSION", entity_id: selected.id, entity_reference: selected.submission_number, changes: { comments }, user_email: profile?.email || null, user_name: profile?.name || null })
      await loadSubmission(selected.id)
      await loadDashboard()
      setMessage({ type: "ok", text: `Budget submission ${action.toLowerCase()} action completed.` })
    } catch (err) {
      setMessage({ type: "err", text: err instanceof Error ? err.message : "Workflow action failed." })
    } finally {
      setSaving(false)
    }
  }

  const runRevisionAction = async (action: "SUBMIT" | "RESUBMIT" | "RETURN" | "APPROVE" | "REJECT") => {
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
    if (event.key !== "Enter") return
    const inputs = Array.from(gridRef.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input,select,textarea") || [])
    const current = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    const index = inputs.indexOf(current)
    if (index >= 0 && inputs[index + 1]) {
      event.preventDefault()
      inputs[index + 1].focus()
    }
  }

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (selectedLocked || revision) return
    const text = event.clipboardData.getData("text")
    if (!text.includes("\t") && !text.includes("\n")) return
    event.preventDefault()
    const rows = text.trim().split(/\r?\n/).map((line) => line.split("\t"))
    if (rows.length === 0) return
    setGridRows((existing) => {
      const startIndex = Math.max(0, existing.findIndex((row) => row.clientId === selectedRow))
      const next = [...existing]
      rows.forEach((cols, offset) => {
        const row = next[startIndex + offset] || newRow(next.length + 1)
        const financeCode = cols[2]?.trim() || row.finance_code
        const ledger = lookups.ledgers.find((item) => item.finance_code === financeCode)
        const months = blankMonths().map((_, index) => Number(cols[19 + index] || row.months[index] || 0))
        next[startIndex + offset] = {
          ...row,
          activity_reference: cols[1] || row.activity_reference,
          finance_code: financeCode,
          expense_ledger_id: ledger?.id || row.expense_ledger_id,
          ledger_number: ledger?.ledger_number || row.ledger_number,
          standard_description: ledger?.standard_description || row.standard_description,
          budget_class: ledger?.budget_class_lookup?.name || ledger?.budget_class || row.budget_class,
          expense_category: ledger?.budget_expense_category_lookup?.name || ledger?.expense_category || row.expense_category,
          line_item_description: cols[7] || row.line_item_description,
          business_justification: cols[8] || row.business_justification,
          location_destination_provider: cols[9] || row.location_destination_provider,
          beneficiary_custodian_officer: cols[10] || row.beneficiary_custodian_officer,
          start_date: cols[11] || row.start_date,
          end_date: cols[12] || row.end_date,
          quantity: Number(cols[13] || row.quantity || 0),
          unit_of_measure: cols[14] || row.unit_of_measure,
          unit_cost: Number(cols[15] || row.unit_cost || 0),
          frequency_periods: Number(cols[16] || row.frequency_periods || 0),
          other_costs: Number(cols[17] || row.other_costs || 0),
          months,
          priority: cols[33] || row.priority,
          priority_level_id: priorityLevels.find((priority) => priority.code === cols[33] || priority.name === cols[33])?.id || row.priority_level_id,
          funding_source_id: lookups.fundingSources.find((source) => source.code === cols[34] || source.name === cols[34])?.id || row.funding_source_id,
          procurement_method: cols[35] || row.procurement_method,
          procurement_method_id: procurementMethods.find((method) => method.code === cols[35] || method.name === cols[35])?.id || row.procurement_method_id,
          responsible_officer: cols[36] || row.responsible_officer,
          responsible_officer_id: officers.find((officer) => officer.code === cols[36] || officer.name === cols[36])?.id || row.responsible_officer_id,
          supporting_reference: cols[37] || row.supporting_reference,
          comments: cols[38] || row.comments,
        }
      })
      return next.map((row, index) => ({ ...row, line_number: index + 1 }))
    })
    setMessage({ type: "ok", text: `${rows.length} pasted row(s) loaded into the grid. Review highlighted cells before saving.` })
  }

  const exportRecord = (row: GridRow) => {
    const months = Object.fromEntries(MONTHS.map((month, index) => [month, row.months[index] || 0]))
    return {
      "Line No.": row.line_number,
      "Activity Ref.": row.activity_reference,
      "Finance Code": row.finance_code,
      "Ledger No.": row.ledger_number,
      "Expense Description": row.standard_description,
      "Budget Class": row.budget_class,
      "Expense Category": row.expense_category,
      "Line Item / Activity Description": row.line_item_description,
      "Business Justification / Expected Output": row.business_justification,
      "Location / Destination / Provider": row.location_destination_provider,
      "Beneficiary / Custodian / Officer": row.beneficiary_custodian_officer,
      "Start Date": row.start_date,
      "End Date": row.end_date,
      Quantity: row.quantity,
      Unit: row.unit_of_measure,
      "Unit Cost (K)": row.unit_cost,
      "Frequency / Periods": row.frequency_periods,
      "Other Costs (K)": row.other_costs,
      "Calculated Estimate (K)": annualEstimate(row),
      ...months,
      "Monthly Allocation Total": monthlyTotal(row),
      "Variance (K)": variance(row),
      Priority: row.priority,
      "Funding Source": lookups.fundingSources.find((source) => source.id === row.funding_source_id)?.code || "",
      "Procurement Method": row.procurement_method,
      "Responsible Officer": row.responsible_officer,
      "Supporting Reference": row.supporting_reference,
      Comments: row.comments,
    }
  }

  const exportTemplate = (format: "excel" | "pdf") => {
    if (!selected) return
    const records = gridRows.filter((row) => !isEmptyRow(row)).map((row) => exportRecord(row))
    if (records.length === 0) return
    const filename = `${selected.submission_number || "budget_template"}_${new Date().toISOString().split("T")[0]}`
    const title = `NJSS Standard Divisional Budget Template — ${selected.division?.name || "Division"}`
    const subtitle = `FY${selected.budget_year} • ${selected.status}`
    if (format === "excel") exportToExcel(filename, records, { title, subtitle, sheetName: "Budget Template" })
    else {
      const { columns, rows } = rowsToPdfTable(records)
      exportToPDF({ title, subtitle, columns, rows, filename })
    }
  }

  const cashflowChart = useMemo(() => {
    const activeYear = selected?.budget_year || selectedCycle?.budget_year || 2026
    return MONTHS.map((month, index) => ({
      month: month.slice(0, 3),
      amount: cashflow.filter((row) => row.budget_year === activeYear && row.month_number === index + 1).reduce((sum, row) => sum + (row.amount || 0), 0),
    }))
  }, [cashflow, selected?.budget_year, selectedCycle?.budget_year])

  return (
    <div className="space-y-5">
      <div className="sticky top-[57px] z-20 overflow-hidden rounded-xl border border-[#1f4e79] bg-white shadow-sm">
        <div className="bg-[#1f4e79] px-5 py-3 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-blue-100">NJSS Standard Divisional Budget Template</p>
              <h1 className="text-xl font-bold">Budget Entry Sheet</h1>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={loadDashboard} className="sheet-action">
                <RefreshCw className="h-4 w-4" /> Refresh
              </button>
              {selected && (
                <button onClick={() => exportTemplate("excel")} className="sheet-action">
                  <FileSpreadsheet className="h-4 w-4" /> Excel
                </button>
              )}
              {selected && (
                <button onClick={() => exportTemplate("pdf")} className="sheet-action">
                  <FileSpreadsheet className="h-4 w-4" /> PDF
                </button>
              )}
            </div>
          </div>
        </div>

        {selected ? (
          <div className="grid gap-px bg-[#9fbad0] p-px text-xs md:grid-cols-4 xl:grid-cols-7">
            <HeaderCell label="Budget Year / Cycle" value={`${selected.budget_year} / ${selected.cycle?.name || "-"}`} />
            <HeaderCell label="Department" value={selected.division?.name || "-"} />
            <HeaderCell label="Division" value={`${selected.division?.code || "-"} — ${selected.division?.name || "-"}`} />
            <HeaderCell label="Cost Centre" value={selected.division?.cost_centre_code || selected.division?.cost_centre_name || "-"} />
            <HeaderCell label="Prepared By" value={profile?.name || "-"} />
            <HeaderCell label="Date Prepared" value={selected.date_prepared ? new Date(selected.date_prepared).toLocaleDateString("en-GB") : "-"} />
            <HeaderCell label="Submission Reference" value={selected.submission_reference || "-"} />
            <HeaderCell label="Version" value={String(selected.version || 1)} />
            <HeaderCell label="Version Position" value={selected.superseded_by_id ? "Historical" : selected.status === "APPROVED" ? "Current Authoritative" : revision ? "Revision in Progress" : "Working Version"} />
            <HeaderCell label="Budget Ceiling" value={money(selected.budget_ceiling || 0)} strong />
            <HeaderCell label="Total Proposed Budget" value={money(totalProposed)} strong />
            <HeaderCell label="Monthly Allocation Total" value={money(totalMonthly)} strong />
            <HeaderCell label="Unallocated / Variance" value={money(totalVariance)} alert={Math.abs(totalVariance) >= 0.01} />
            <HeaderCell label="Status" value={selected.status} />
            <HeaderCell label="Validation Status" value={validationLabel} alert={validationLabel !== "VALID"} />
          </div>
        ) : (
          <div className="p-4 text-sm text-slate-600">Create or select a draft to open the spreadsheet.</div>
        )}
      </div>

      {message && (
        <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${message.type === "ok" ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"}`}>
          {message.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} {message.text}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h2 className="flex items-center gap-2 font-semibold text-slate-900">
                <Plus className="h-4 w-4 text-[#1f4e79]" /> Create draft sheet
              </h2>
            </div>
            <div className="space-y-3 p-4">
              <Field label="Budget cycle">
                <div className="flex items-center gap-2">
                  <select value={draftHeader.cycle_id} onChange={(e) => selectCycle(e.target.value)} className="input min-w-0 flex-1">
                    <option value="">Select cycle from database</option>
                    {lookups.cycles.map((cycle) => (
                      <option key={cycle.id} value={cycle.id}>
                        {cycle.name}
                      </option>
                    ))}
                  </select>
                  {canAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowCycleForm((open) => !open)
                        setMessage(null)
                      }}
                      aria-label={showCycleForm ? "Close add budget cycle form" : "Add budget cycle"}
                      aria-expanded={showCycleForm}
                      title={showCycleForm ? "Close add budget cycle form" : "Add budget cycle"}
                      className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                    >
                      <Plus className={`h-5 w-5 transition-transform ${showCycleForm ? "rotate-45" : ""}`} />
                    </button>
                  )}
                </div>
                {canAdmin && showCycleForm && (
                  <div className="mt-2 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <div>
                      <p className="text-xs font-semibold text-emerald-900">Add Budget Cycle</p>
                      <p className="mt-0.5 text-[11px] text-emerald-800">Create a missing cycle in the controlled budget-cycle register.</p>
                    </div>
                    <input className="input" placeholder="Financial year, e.g. 2027" type="number" value={newCycle.budget_year} onChange={(e) => setNewCycle((cycle) => ({ ...cycle, budget_year: e.target.value }))} />
                    <input className="input" placeholder="Cycle type, e.g. ANNUAL" value={newCycle.cycle_type} onChange={(e) => setNewCycle((cycle) => ({ ...cycle, cycle_type: e.target.value }))} />
                    <input className="input" placeholder="Cycle name" value={newCycle.name} onChange={(e) => setNewCycle((cycle) => ({ ...cycle, name: e.target.value }))} />
                    <input className="input" placeholder="Submission deadline" type="date" value={newCycle.submission_deadline} onChange={(e) => setNewCycle((cycle) => ({ ...cycle, submission_deadline: e.target.value }))} />
                    <input className="input text-right" placeholder="Default budget ceiling" type="number" min="0" value={newCycle.department_ceiling} onChange={(e) => setNewCycle((cycle) => ({ ...cycle, department_ceiling: e.target.value }))} />
                    <div className="flex gap-2 pt-1">
                      <button type="button" onClick={() => setShowCycleForm(false)} disabled={saving} className="btn-light flex-1 justify-center">
                        Cancel
                      </button>
                      <button type="button" onClick={addCycle} disabled={saving} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
                        <Plus className="h-4 w-4" /> {saving ? "Creating..." : "Create"}
                      </button>
                    </div>
                  </div>
                )}
              </Field>
              <Field label="Division / cost centre">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                  <input value={divisionSearch} onChange={(e) => setDivisionSearch(e.target.value)} className="input pl-8" placeholder="Search division" />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <select value={draftHeader.division_id} onChange={(e) => setDraftHeader((h) => ({ ...h, division_id: e.target.value }))} className="input min-w-0 flex-1">
                    <option value="">Select active division from database</option>
                    {filteredDivisions.map((division) => (
                      <option key={division.id} value={division.id}>
                        {division.code} — {division.name} — {division.cost_centre_code || division.cost_centre_name || "No cost centre"}
                      </option>
                    ))}
                  </select>
                  {canAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowDivisionForm((open) => !open)
                        setMessage(null)
                      }}
                      aria-label={showDivisionForm ? "Close add division form" : "Add division / cost centre"}
                      aria-expanded={showDivisionForm}
                      title={showDivisionForm ? "Close add division form" : "Add division / cost centre"}
                      className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                    >
                      <Plus className={`h-5 w-5 transition-transform ${showDivisionForm ? "rotate-45" : ""}`} />
                    </button>
                  )}
                </div>
                {canAdmin && showDivisionForm && (
                  <div className="mt-2 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <div>
                      <p className="text-xs font-semibold text-emerald-900">Add Division / Cost Centre</p>
                      <p className="mt-0.5 text-[11px] text-emerald-800">Create a missing division in the controlled budget-division register.</p>
                    </div>
                    <input className="input" placeholder="Division code, e.g. ACC" value={newDivision.code} onChange={(e) => setNewDivision((division) => ({ ...division, code: e.target.value }))} />
                    <input className="input" placeholder="Division name" value={newDivision.name} onChange={(e) => setNewDivision((division) => ({ ...division, name: e.target.value }))} />
                    <input className="input" placeholder="Cost centre code" value={newDivision.cost_centre_code} onChange={(e) => setNewDivision((division) => ({ ...division, cost_centre_code: e.target.value }))} />
                    <input className="input" placeholder="Cost centre name" value={newDivision.cost_centre_name} onChange={(e) => setNewDivision((division) => ({ ...division, cost_centre_name: e.target.value }))} />
                    <div className="flex gap-2 pt-1">
                      <button type="button" onClick={() => setShowDivisionForm(false)} disabled={saving} className="btn-light flex-1 justify-center">
                        Cancel
                      </button>
                      <button type="button" onClick={addDivision} disabled={saving} className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
                        <Plus className="h-4 w-4" /> {saving ? "Creating..." : "Create"}
                      </button>
                    </div>
                  </div>
                )}
                {filteredDivisions.length === 0 && <p className="mt-1 text-[11px] text-amber-700">No matching database record found. Use the + button to add a division if you are authorised.</p>}
                {restrictedDivisionUser && <p className="mt-1 text-[11px] text-slate-500">Division list is restricted by your assigned profile where possible.</p>}
              </Field>
              <Field label="Budget ceiling">
                <input value={draftHeader.budget_ceiling} onChange={(e) => setDraftHeader((h) => ({ ...h, budget_ceiling: e.target.value }))} type="number" className="input text-right" />
              </Field>
              <Field label="Submission reference">
                <input value={draftHeader.submission_reference} onChange={(e) => setDraftHeader((h) => ({ ...h, submission_reference: e.target.value }))} className="input" />
              </Field>
              <button onClick={createSubmission} disabled={saving || !canEdit} className="btn-primary w-full justify-center">
                <ClipboardList className="h-4 w-4" /> Create Draft
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h2 className="font-semibold text-slate-900">Submissions</h2>
            </div>
            <div className="max-h-[520px] divide-y divide-slate-100 overflow-y-auto">
              {submissions.length === 0 ? (
                <Empty message="No budget templates yet." />
              ) : (
                submissions.map((submission) => (
                  <button key={submission.id} onClick={() => setSelectedId(submission.id)} className={`w-full p-4 text-left hover:bg-blue-50 ${selectedId === submission.id ? "bg-blue-50" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">{submission.submission_number || "Draft"}</span>
                      <StatusBadge status={submission.status} />
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      {submission.division?.code} — {submission.division?.name}
                    </p>
                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                      <span>FY{submission.budget_year}</span>
                      <span>{money(submission.total_proposed_budget || 0)}</span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </aside>

        <main className="min-w-0 space-y-5">
          {!selected ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">Select or create a divisional budget sheet to begin.</div>
          ) : (
            <>
              <BudgetRevisionPanel
                revision={revision}
                position={revisionPosition}
                history={revisionHistory}
                currentAuthoritative={Boolean(selected.status === "APPROVED" && !selected.superseded_by_id)}
                proposedTotal={totalProposed}
              />

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap gap-2">
                  <button onClick={addRow} disabled={selectedLocked} className="btn-light">
                    <Plus className="h-4 w-4" /> Add Row
                  </button>
                  <button onClick={duplicateRow} disabled={selectedLocked || !selectedRow} className="btn-light">
                    <Copy className="h-4 w-4" /> Duplicate Row
                  </button>
                  <button onClick={removeSelectedRows} disabled={selectedLocked || selectedRows.length === 0} className="btn-light text-red-700">
                    <Trash2 className="h-4 w-4" /> Delete Selected Rows{selectedRows.length > 0 ? ` (${selectedRows.length})` : ""}
                  </button>
                  <button onClick={allocateEvenly} disabled={selectedLocked || !selectedRow} className="btn-light">
                    Allocate Evenly
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canCreateRevision && (
                    <button onClick={() => setShowRevisionDialog(true)} disabled={saving} className="btn-primary">
                      <Plus className="h-4 w-4" /> Request Budget Change
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
                      {["SUBMITTED", "RESUBMITTED"].includes(revision.status) && canRevisionApprove && (
                        <button onClick={() => runRevisionAction("APPROVE")} disabled={saving} className="btn-primary">
                          <CheckCircle2 className="h-4 w-4" /> Approve Revision
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              <div ref={gridRef} onKeyDown={handleGridKeyDown} onPaste={handlePaste} className="sheet-wrap rounded-xl border border-[#1f4e79] bg-white shadow-sm">
                <table className={`budget-sheet ${revision ? "min-w-[6400px]" : "min-w-[5200px]"} border-collapse text-xs`}>
                  <thead>
                    <tr>
                      <SheetTh sticky left={0} width={70}>
                        <div className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={allRowsSelected}
                            onChange={toggleSelectAllRows}
                            onClick={(event) => event.stopPropagation()}
                            disabled={selectedLocked || selectableGridRows.length === 0}
                            aria-label="Select all budget rows"
                            className="h-4 w-4 shrink-0 accent-[#1f4e79]"
                          />
                          <span>Line No.</span>
                        </div>
                      </SheetTh>
                      <SheetTh sticky left={70} width={130}>
                        Activity Ref.
                      </SheetTh>
                      <SheetTh sticky left={200} width={190}>
                        Finance Code
                      </SheetTh>
                      <SheetTh width={110}>Ledger No.</SheetTh>
                      <SheetTh width={230}>Expense Description</SheetTh>
                      <SheetTh width={150}>Budget Class</SheetTh>
                      <SheetTh width={170}>Expense Category</SheetTh>
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
                      <SheetTh width={280}>Business Justification / Expected Output</SheetTh>
                      <SheetTh width={220}>Location / Destination / Provider</SheetTh>
                      <SheetTh width={220}>Beneficiary / Custodian / Officer</SheetTh>
                      <SheetTh width={130}>Start Date</SheetTh>
                      <SheetTh width={130}>End Date</SheetTh>
                      <SheetTh width={100}>Quantity</SheetTh>
                      <SheetTh width={100}>Unit</SheetTh>
                      <SheetTh width={120}>Unit Cost (K)</SheetTh>
                      <SheetTh width={130}>Frequency / Periods</SheetTh>
                      <SheetTh width={120}>Other Costs (K)</SheetTh>
                      <SheetTh width={150}>Calculated Estimate (K)</SheetTh>
                      {MONTHS.map((month) => (
                        <SheetTh key={month} width={115}>
                          {month}
                        </SheetTh>
                      ))}
                      <SheetTh width={155}>Monthly Allocation Total</SheetTh>
                      <SheetTh width={120}>Variance (K)</SheetTh>
                      <SheetTh width={120}>Priority</SheetTh>
                      <SheetTh width={170}>Funding Source</SheetTh>
                      <SheetTh width={170}>Procurement Method</SheetTh>
                      <SheetTh width={180}>Responsible Officer</SheetTh>
                      <SheetTh width={180}>Supporting Reference</SheetTh>
                      <SheetTh width={220}>Comments</SheetTh>
                    </tr>
                  </thead>
                  <tbody>
                    {gridRows.map((row) => {
                      const rowVariance = variance(row)
                      const lineInvalid = !isEmptyRow(row) && !hasMandatory(row)
                      const lineHasVariance = !isEmptyRow(row) && Math.abs(rowVariance) >= 0.01
                      const linePosition = revisionPositionForRow(row)
                      const protectedBaseline = Boolean(revision && linePosition?.source_budget_allocation_id)
                      const proposedRevised = annualEstimate(row)
                      const protectedMinimumBreach = Boolean(revision && linePosition && proposedRevised + 0.009 < Number(linePosition.protected_minimum || 0))
                      const rowTone = lineHasVariance || protectedMinimumBreach ? "bg-red-50" : lineInvalid ? "bg-amber-50" : "odd:bg-[#eaf3f8] even:bg-white"
                      return (
                        <tr key={row.clientId} onClick={() => setSelectedRow(row.clientId)} className={`${rowTone} ${selectedRow === row.clientId ? "outline outline-2 outline-[#1f4e79]" : ""}`}>
                          <SheetTd sticky left={0} readOnly>
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={selectedRows.includes(row.clientId)}
                                onChange={() => {
                                  setSelectedRow(row.clientId)
                                  toggleSelectedRow(row.clientId)
                                }}
                                onClick={(event) => event.stopPropagation()}
                                disabled={selectedLocked || protectedBaseline}
                                aria-label={`Select budget row ${row.line_number}`}
                                className="h-4 w-4 shrink-0 accent-[#1f4e79]"
                              />
                              <span>{row.line_number}</span>
                            </div>
                          </SheetTd>
                          <SheetTd sticky left={70}>
                            <LookupSelect
                              compact
                              compactSelectOnly
                              disabled={selectedLocked}
                              value={lookups.activityTemplates.find((activity) => activity.code === row.activity_reference)?.id || ""}
                              options={activityOptions}
                              placeholder="Select activity"
                              onChange={(value, option) => selectActivityTemplate(row.clientId, value, option)}
                            />
                          </SheetTd>
                          <SheetTd sticky left={200} required invalid={!isEmptyRow(row) && !row.expense_ledger_id}>
                            <LookupSelect
                              compact
                              compactSelectOnly
                              disabled={selectedLocked || protectedBaseline}
                              value={row.expense_ledger_id}
                              options={ledgerOptions}
                              placeholder="Search finance code"
                              unauthorizedEmptyLabel="No active posting ledgers configured. Add finance ledger records first."
                              onChange={(value) => selectFinanceCode(row.clientId, value)}
                            />
                          </SheetTd>
                          <SheetTd readOnly>
                            <ReadOnlyCell value={row.ledger_number} empty="Select Finance Code" />
                          </SheetTd>
                          <SheetTd readOnly>
                            <ReadOnlyCell value={row.standard_description} empty="Select Finance Code" />
                          </SheetTd>
                          <SheetTd readOnly>
                            <ReadOnlyCell value={row.budget_class} empty="Select Finance Code" />
                          </SheetTd>
                          <SheetTd readOnly>
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
                            <SheetInput disabled={selectedLocked} value={row.line_item_description} onChange={(v) => updateRow(row.clientId, { line_item_description: v })} />
                          </SheetTd>
                          <SheetTd required invalid={!isEmptyRow(row) && !row.business_justification.trim()}>
                            <SheetInput disabled={selectedLocked} value={row.business_justification} onChange={(v) => updateRow(row.clientId, { business_justification: v })} />
                          </SheetTd>
                          <SheetTd>
                            <SheetInput disabled={selectedLocked} value={row.location_destination_provider} onChange={(v) => updateRow(row.clientId, { location_destination_provider: v })} />
                          </SheetTd>
                          <SheetTd>
                            <SheetInput disabled={selectedLocked} value={row.beneficiary_custodian_officer} onChange={(v) => updateRow(row.clientId, { beneficiary_custodian_officer: v })} />
                          </SheetTd>
                          <SheetTd>
                            <SheetInput type="date" disabled={selectedLocked} value={row.start_date} onChange={(v) => updateRow(row.clientId, { start_date: v })} />
                          </SheetTd>
                          <SheetTd>
                            <SheetInput type="date" disabled={selectedLocked} value={row.end_date} onChange={(v) => updateRow(row.clientId, { end_date: v })} />
                          </SheetTd>
                          <SheetTd required invalid={!isEmptyRow(row) && Number(row.quantity) <= 0}>
                            <SheetNumber disabled={selectedLocked} value={row.quantity} onChange={(v) => updateRow(row.clientId, { quantity: v })} />
                          </SheetTd>
                          <SheetTd>
                            <LookupSelect
                              compact
                              compactSelectOnly
                              disabled={selectedLocked}
                              value={row.unit_of_measure_id}
                              options={units}
                              placeholder="Select unit"
                              onChange={(value, option) => updateRow(row.clientId, { unit_of_measure_id: value, unit_of_measure: option?.name || "" })}
                            />
                          </SheetTd>
                          <SheetTd required invalid={!isEmptyRow(row) && Number(row.unit_cost) < 0}>
                            <SheetNumber disabled={selectedLocked} value={row.unit_cost} onChange={(v) => updateRow(row.clientId, { unit_cost: v })} />
                          </SheetTd>
                          <SheetTd required invalid={!isEmptyRow(row) && Number(row.frequency_periods) <= 0}>
                            <SheetNumber disabled={selectedLocked} value={row.frequency_periods} onChange={(v) => updateRow(row.clientId, { frequency_periods: v })} />
                          </SheetTd>
                          <SheetTd>
                            <SheetNumber disabled={selectedLocked} value={row.other_costs} onChange={(v) => updateRow(row.clientId, { other_costs: v })} />
                          </SheetTd>
                          <SheetTd readOnly align="right">
                            {money(annualEstimate(row))}
                          </SheetTd>
                          {MONTHS.map((month, index) => {
                            const monthLocked = isRevisionMonthLocked(row, index)
                            return (
                              <SheetTd key={month} readOnly={monthLocked}>
                                <SheetNumber disabled={selectedLocked || monthLocked} value={row.months[index]} onChange={(v) => updateMonth(row.clientId, index, v)} />
                              </SheetTd>
                            )
                          })}
                          <SheetTd readOnly align="right">
                            {money(monthlyTotal(row))}
                          </SheetTd>
                          <SheetTd readOnly align="right" invalid={lineHasVariance}>
                            {money(rowVariance)}
                          </SheetTd>
                          <SheetTd>
                            <LookupSelect
                              compact
                              compactSelectOnly
                              disabled={selectedLocked}
                              value={row.priority_level_id}
                              options={priorityLevels}
                              placeholder="Select priority"
                              onChange={(value, option) => updateRow(row.clientId, { priority_level_id: value, priority: option?.code || "" })}
                            />
                          </SheetTd>
                          <SheetTd>
                            <select disabled={selectedLocked || protectedBaseline} className="sheet-input" value={row.funding_source_id} onChange={(e) => updateRow(row.clientId, { funding_source_id: e.target.value })}>
                              <option value="">Select</option>
                              {lookups.fundingSources.map((source) => (
                                <option key={source.id} value={source.id}>
                                  {source.code} — {source.name}
                                </option>
                              ))}
                            </select>
                          </SheetTd>
                          <SheetTd>
                            <LookupSelect
                              compact
                              compactSelectOnly
                              disabled={selectedLocked}
                              value={row.procurement_method_id}
                              options={procurementMethods}
                              placeholder="Select method"
                              onChange={(value, option) => updateRow(row.clientId, { procurement_method_id: value, procurement_method: option?.code || "" })}
                            />
                          </SheetTd>
                          <SheetTd>
                            <LookupSelect
                              compact
                              compactSelectOnly
                              disabled={selectedLocked}
                              value={row.responsible_officer_id}
                              options={officers}
                              placeholder="Select officer"
                              onChange={(value, option) => updateRow(row.clientId, { responsible_officer_id: value, responsible_officer: option?.name || "" })}
                            />
                          </SheetTd>
                          <SheetTd>
                            <SheetInput disabled={selectedLocked} value={row.supporting_reference} onChange={(v) => updateRow(row.clientId, { supporting_reference: v })} />
                          </SheetTd>
                          <SheetTd>
                            <SheetInput disabled={selectedLocked} value={row.comments} onChange={(v) => updateRow(row.clientId, { comments: v })} />
                          </SheetTd>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="sticky left-0 z-20 border border-[#9fbad0] bg-[#1f4e79] px-2 py-2 font-bold text-white" colSpan={3}>
                        Totals
                      </td>
                      <td className="border border-[#9fbad0] bg-[#d9eaf7] px-2 py-2 text-right font-bold" colSpan={revision ? 23 : 16}>
                        {money(totalProposed)}
                      </td>
                      {MONTHS.map((month, index) => (
                        <td key={month} className="border border-[#9fbad0] bg-[#d9eaf7] px-2 py-2 text-right font-bold">
                          {money(gridRows.reduce((sum, row) => sum + (row.months[index] || 0), 0))}
                        </td>
                      ))}
                      <td className="border border-[#9fbad0] bg-[#d9eaf7] px-2 py-2 text-right font-bold">{money(totalMonthly)}</td>
                      <td className={`border border-[#9fbad0] px-2 py-2 text-right font-bold ${Math.abs(totalVariance) >= 0.01 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"}`}>
                        {money(totalVariance)}
                      </td>
                      <td className="border border-[#9fbad0] bg-[#d9eaf7]" colSpan={6}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="font-semibold text-slate-900">Reviewed / approved consolidated cash-flow</h3>
                  <div className="mt-4 grid grid-cols-6 gap-2">
                    {cashflowChart.map((row) => (
                      <div key={row.month} className="rounded-lg bg-blue-50 p-2 text-center">
                        <p className="text-xs text-slate-500">{row.month}</p>
                        <p className="text-xs font-bold text-[#1f4e79]">{money(row.amount)}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="font-semibold text-slate-900">Workflow history</h3>
                  {history.length === 0 ? (
                    <p className="mt-4 text-sm text-slate-500">No workflow events yet.</p>
                  ) : (
                    <div className="mt-4 max-h-72 space-y-3 overflow-y-auto">
                      {history.map((item, index) => (
                        <div key={index} className="rounded-lg bg-slate-50 p-3 text-sm">
                          <div className="flex justify-between">
                            <b>{item.action}</b>
                            <span className="text-xs text-slate-500">{new Date(item.created_at).toLocaleString("en-GB")}</span>
                          </div>
                          <p className="text-slate-600">
                            {item.from_status || "START"} → {item.to_status}
                          </p>
                          {item.comments && <p className="mt-1 text-slate-500">{item.comments}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      {selected && (
        <BudgetRevisionDialog
          open={showRevisionDialog}
          parentSubmissionId={selected.id}
          saving={saving}
          onClose={() => setShowRevisionDialog(false)}
          onCreate={createRevisionFromSelected}
        />
      )}

      {loading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/40">
          <Loader2 className="h-8 w-8 animate-spin text-[#1f4e79]" />
        </div>
      )}

      <style jsx global>{`
        .input { width: 100%; border-radius: 0.375rem; border: 1px solid #cbd5e1; background: white; padding: 0.5rem 0.75rem; font-size: 0.875rem; outline: none; }
        .input:focus { border-color: #1f4e79; box-shadow: 0 0 0 2px rgba(31,78,121,0.16); }
        .btn-primary { display: inline-flex; align-items: center; gap: 0.4rem; border-radius: 0.45rem; background: #1f4e79; color: white; padding: 0.55rem 0.85rem; font-size: 0.875rem; font-weight: 700; }
        .btn-primary:hover { background: #173a5b; }
        .btn-primary:disabled { opacity: .5; cursor: not-allowed; }
        .btn-light { display: inline-flex; align-items: center; gap: 0.4rem; border-radius: 0.45rem; border: 1px solid #b7c9d8; background: #f8fbfd; color: #1f4e79; padding: 0.55rem 0.85rem; font-size: 0.875rem; font-weight: 700; }
        .btn-light:hover { background: #eaf3f8; }
        .btn-light:disabled { opacity: .5; cursor: not-allowed; }
        .sheet-action { display: inline-flex; align-items: center; gap: .4rem; border-radius: .4rem; border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.12); padding: .45rem .7rem; font-size: .8rem; font-weight: 700; }
        .sheet-action:hover { background: rgba(255,255,255,.2); }
        .sheet-wrap { max-width: 100%; overflow: auto; max-height: calc(100vh - 245px); }
        .budget-sheet thead th { position: sticky; top: 0; z-index: 10; }
        .budget-sheet .sticky-col { position: sticky; z-index: 12; }
        .budget-sheet thead .sticky-col { z-index: 18; }
        .sheet-input { width: 100%; min-width: 0; border: 0; background: transparent; padding: .2rem .35rem; outline: none; font-size: 0.75rem; line-height: 1.2; }
        .sheet-input:focus { background: white; box-shadow: inset 0 0 0 2px #1f4e79; }
        .sheet-input:disabled { color: #475569; cursor: not-allowed; }
      `}</style>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold text-slate-600">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}

function HeaderCell({ label, value, strong = false, alert = false }: { label: string; value: string; strong?: boolean; alert?: boolean }) {
  return (
    <div className={`${alert ? "bg-red-50" : "bg-white"} p-2`}>
      <p className="text-[10px] font-bold uppercase tracking-wide text-[#1f4e79]">{label}</p>
      <p className={`mt-0.5 truncate ${strong ? "font-bold text-slate-950" : "text-slate-700"} ${alert ? "text-red-700" : ""}`}>{value}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    DRAFT: "bg-slate-100 text-slate-700",
    SUBMITTED: "bg-blue-100 text-blue-700",
    RESUBMITTED: "bg-blue-100 text-blue-700",
    RETURNED: "bg-orange-100 text-orange-700",
    REVIEWED: "bg-amber-100 text-amber-800",
    APPROVED: "bg-green-100 text-green-700",
    REJECTED: "bg-red-100 text-red-700",
    ARCHIVED: "bg-slate-200 text-slate-600",
  }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${classes[status] || classes.DRAFT}`}>{status}</span>
}

function Empty({ message }: { message: string }) {
  return <div className="p-8 text-center text-sm text-slate-500">{message}</div>
}

function SheetTh({ children, width, sticky = false, left = 0 }: { children: React.ReactNode; width: number; sticky?: boolean; left?: number }) {
  return (
    <th style={{ width, minWidth: width, left: sticky ? left : undefined }} className={`${sticky ? "sticky-col" : ""} border border-[#9fbad0] bg-[#1f4e79] px-2 py-2 text-left align-bottom font-bold text-white`}>
      {children}
    </th>
  )
}

function SheetTd({
  children,
  sticky = false,
  left = 0,
  readOnly = false,
  invalid = false,
  required = false,
  align = "left",
}: {
  children: React.ReactNode
  sticky?: boolean
  left?: number
  readOnly?: boolean
  invalid?: boolean
  required?: boolean
  align?: "left" | "right"
}) {
  return (
    <td
      style={{ left: sticky ? left : undefined }}
      className={`${sticky ? "sticky-col bg-inherit" : ""} ${readOnly ? "bg-slate-100 text-slate-600" : ""} ${invalid ? "bg-red-100" : required ? "bg-amber-50" : ""} border border-[#9fbad0] align-top text-${align}`}
    >
      {children}
    </td>
  )
}

function SheetInput({ value, onChange, disabled, type = "text" }: { value: string; onChange: (value: string) => void; disabled?: boolean; type?: string }) {
  return <input type={type} disabled={disabled} className="sheet-input" value={value} onChange={(event) => onChange(event.target.value)} />
}

function SheetNumber({ value, onChange, disabled }: { value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return <input type="number" disabled={disabled} className="sheet-input text-right" value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(Number(event.target.value || 0))} />
}

function ReadOnlyCell({ value, empty }: { value: string; empty: string }) {
  return <div className={`truncate px-2 py-1.5 text-xs ${value ? "text-slate-800" : "text-slate-400"}`} title={value || empty}>{value || empty}</div>
}
