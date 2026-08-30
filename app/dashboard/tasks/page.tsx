"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ClipboardCheck, Clock3, Filter, Loader2, RefreshCw, Search } from "lucide-react"
import { authFetch } from "@/lib/auth-fetch"

type Task = {
  id: string
  sourceId: string
  sourceType: "FF3" | "FF4"
  referenceNumber: string
  status: string
  financialYear: number
  amount: number
  provinceId: string | null
  provinceName: string
  departmentId: string | null
  departmentName: string
  sectionId: string | null
  sectionName: string
  action: string
  actionLabel: string
  summaryLabel: string
  responsibleRole: string
  waitingSince: string
  ageDays: number
  ageBucket: string
  ageLabel: string
  href: string
}

type Lookup = { id: string; name: string }
type DepartmentLookup = Lookup & { province_id: string | null }
type SectionLookup = Lookup & { department_id: string | null }
type Summary = { label: string; count: number; sourceType: "FF3" | "FF4" }

type InboxResponse = {
  isAdministrator: boolean
  scope: { mode: "SYSTEM" | "SECTION"; label: string }
  actionRequired: Task[]
  systemWide: Task[]
  actionSummary: Summary[]
  oversightSummary: Summary[]
  lookups: {
    provinces: Lookup[]
    departments: DepartmentLookup[]
    sections: SectionLookup[]
  }
}

const EMPTY: InboxResponse = {
  isAdministrator: false,
  scope: { mode: "SECTION", label: "Authorised workflow scope" },
  actionRequired: [],
  systemWide: [],
  actionSummary: [],
  oversightSummary: [],
  lookups: { provinces: [], departments: [], sections: [] },
}

const AGE_OPTIONS = [
  ["", "All Ages"],
  ["TODAY", "Today"],
  ["1_2_DAYS", "1–2 days"],
  ["3_5_DAYS", "3–5 days"],
  ["OVER_5_DAYS", "Over 5 days"],
]

function money(value: number) {
  return `K${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function ageClass(bucket: string) {
  if (bucket === "OVER_5_DAYS") return "bg-red-100 text-red-700"
  if (bucket === "3_5_DAYS") return "bg-orange-100 text-orange-700"
  if (bucket === "1_2_DAYS") return "bg-amber-100 text-amber-700"
  return "bg-emerald-100 text-emerald-700"
}

export default function WorkflowTasksPage() {
  const [data, setData] = useState<InboxResponse>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [tab, setTab] = useState<"action" | "system">("action")
  const [provinceId, setProvinceId] = useState("")
  const [departmentId, setDepartmentId] = useState("")
  const [sectionId, setSectionId] = useState("")
  const [workflowType, setWorkflowType] = useState("")
  const [stage, setStage] = useState("")
  const [age, setAge] = useState("")
  const [search, setSearch] = useState("")

  const loadTasks = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const response = await authFetch("/api/workflow/tasks")
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || "Unable to load workflow tasks")
      }
      const payload = await response.json() as InboxResponse
      setData(payload)
      if (!payload.isAdministrator) setTab("action")
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load workflow tasks")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  const departments = useMemo(
    () => data.lookups.departments.filter((item) => !provinceId || item.province_id === provinceId),
    [data.lookups.departments, provinceId],
  )
  const sections = useMemo(
    () => data.lookups.sections.filter((item) => !departmentId || item.department_id === departmentId),
    [data.lookups.sections, departmentId],
  )

  const tasks = tab === "system" ? data.systemWide : data.actionRequired
  const summary = tab === "system" ? data.oversightSummary : data.actionSummary
  const visibleTasks = useMemo(() => {
    const term = search.trim().toLowerCase()
    return tasks.filter((task) => {
      if (provinceId && task.provinceId !== provinceId) return false
      if (departmentId && task.departmentId !== departmentId) return false
      if (sectionId && task.sectionId !== sectionId) return false
      if (workflowType && task.sourceType !== workflowType) return false
      if (stage && task.status !== stage) return false
      if (age && task.ageBucket !== age) return false
      if (term && ![task.referenceNumber, task.actionLabel, task.departmentName, task.sectionName, task.provinceName, task.status]
        .some((value) => value.toLowerCase().includes(term))) return false
      return true
    })
  }, [tasks, provinceId, departmentId, sectionId, workflowType, stage, age, search])

  const availableStages = useMemo(
    () => Array.from(new Set(tasks.map((task) => task.status))).sort(),
    [tasks],
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-7 w-7 text-[#132A44]" />
            <h1 className="text-2xl font-bold text-slate-900">My Tasks / Approvals</h1>
          </div>
          <p className="mt-1 text-slate-600">Live work that still requires action. Tasks disappear only when the underlying workflow moves forward.</p>
          <div className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
            Workflow Scope: {data.scope.label}
          </div>
        </div>
        <button onClick={() => void loadTasks()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </div>

      {data.isAdministrator && (
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          <button onClick={() => setTab("action")} className={`rounded-md px-4 py-2 text-sm font-semibold ${tab === "action" ? "bg-[#132A44] text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            Action Required by Me ({data.actionRequired.length})
          </button>
          <button onClick={() => setTab("system")} className={`rounded-md px-4 py-2 text-sm font-semibold ${tab === "system" ? "bg-[#132A44] text-white" : "text-slate-600 hover:bg-slate-50"}`}>
            System-wide Pending Work ({data.systemWide.length})
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.slice(0, 8).map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-600">{item.label}</p>
            <div className="mt-1 flex items-end justify-between">
              <p className="text-2xl font-bold text-slate-900">{item.count}</p>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{item.sourceType}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><Filter className="h-4 w-4" /> Filter Tasks</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs font-medium text-slate-600">Province
            <select value={provinceId} disabled={data.scope.mode === "SECTION"} onChange={(e) => { setProvinceId(e.target.value); setDepartmentId(""); setSectionId("") }} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100">
              <option value="">All Provinces</option>{data.lookups.provinces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">Department
            <select value={departmentId} disabled={data.scope.mode === "SECTION"} onChange={(e) => { setDepartmentId(e.target.value); setSectionId("") }} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100">
              <option value="">All Departments</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">Section
            <select value={sectionId} disabled={data.scope.mode === "SECTION"} onChange={(e) => setSectionId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-100">
              <option value="">All Sections</option>{sections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">Workflow
            <select value={workflowType} onChange={(e) => setWorkflowType(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">All Workflows</option><option value="FF3">FF3</option><option value="FF4">FF4 / Payment</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">Stage
            <select value={stage} onChange={(e) => setStage(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="">All Stages</option>{availableStages.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">Age
            <select value={age} onChange={(e) => setAge(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {AGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600 md:col-span-2">Search
            <div className="relative mt-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="FF3/FF4 number, location, status or action" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm" /></div>
          </label>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
          <h2 className="font-semibold text-slate-900">{tab === "system" ? "System-wide Pending Work" : "Action Required by Me"}</h2>
          <span className="text-sm text-slate-500">{visibleTasks.length} task{visibleTasks.length === 1 ? "" : "s"}</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-7 w-7 animate-spin text-[#132A44]" /></div>
        ) : visibleTasks.length === 0 ? (
          <div className="py-16 text-center"><ClipboardCheck className="mx-auto h-12 w-12 text-slate-200" /><p className="mt-3 font-medium text-slate-700">No pending work matches these filters.</p></div>
        ) : (
          <div className="divide-y divide-slate-100">
            {visibleTasks.map((task) => (
              <div key={task.id} className="p-4 hover:bg-slate-50">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-[#132A44]/10 px-2 py-0.5 text-xs font-bold text-[#132A44]">{task.sourceType}</span>
                      <Link href={task.href} className="font-semibold text-slate-900 hover:text-[#8A1420]">{task.referenceNumber}</Link>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{task.status.replaceAll("_", " ")}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ageClass(task.ageBucket)}`}><Clock3 className="mr-1 inline h-3 w-3" />{task.ageLabel}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-[#8A1420]">{task.actionLabel}</p>
                    <p className="mt-1 text-sm text-slate-600">{task.provinceName} › {task.departmentName} › {task.sectionName}</p>
                    <p className="mt-1 text-xs text-slate-500">Responsible role: {task.responsibleRole} • FY{task.financialYear} • Waiting since {new Date(task.waitingSince).toLocaleString("en-GB")}</p>
                  </div>
                  <div className="flex items-center gap-4 lg:text-right">
                    <div><p className="text-xs text-slate-500">Amount</p><p className="font-bold text-slate-900">{money(task.amount)}</p></div>
                    <Link href={task.href} className="rounded-lg bg-[#8A1420] px-4 py-2 text-sm font-semibold text-white hover:bg-[#6E1019]">Open Task</Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
