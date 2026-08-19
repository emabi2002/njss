"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  ShieldAlert,
  X,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { exportToCSV, exportToPDF, rowsToPdfTable, type ExportRow } from "@/lib/export"
import { formatDateTime } from "./types"

type AuditRow = {
  id: string
  user_id: string | null
  user_email: string | null
  user_name: string | null
  action: string
  entity_type: string
  entity_id: string | null
  entity_reference: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  changes: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  ip_address: string | null
  created_at: string
}

const CATEGORIES: Array<{ id: string; label: string; actions: string[] }> = [
  {
    id: "sign_in",
    label: "Sign-in activity",
    actions: ["LOGIN", "LOGOUT", "LOGIN_FAILED"],
  },
  {
    id: "authorization",
    label: "Authorisation denials",
    actions: ["ACCESS_DENIED", "UNAUTHORIZED_ACCESS_ATTEMPT"],
  },
  {
    id: "user_admin",
    label: "User administration",
    actions: [
      "USER_CREATED",
      "USER_UPDATED",
      "USER_VIEWED",
      "USER_DEACTIVATED",
      "USER_RESTORED",
      "USER_ARCHIVED",
      "USER_DELETED",
      "USER_DELETE_REJECTED",
      "USER_DEACTIVATION_REJECTED",
      "USER_INVITATION_SENT",
    ],
  },
  {
    id: "credentials",
    label: "Credentials",
    actions: ["USER_PASSWORD_SET", "PASSWORD_CHANGED"],
  },
  {
    id: "roles",
    label: "Roles and permissions",
    actions: [
      "USER_ROLE_CHANGED",
      "USER_ROLE_MIGRATED",
      "ROLE_CREATED",
      "ROLE_UPDATED",
      "ROLE_PERMISSIONS_CHANGED",
      "PERMISSION_CHANGED",
      "PERMISSION_GRANTED",
      "PERMISSION_REVOKED",
      "USER_PERMISSION_GRANTED",
      "USER_PERMISSION_REVOKED",
    ],
  },
  {
    id: "scope",
    label: "Data scope",
    actions: ["DATA_SCOPE_CHANGED", "USER_DATA_SCOPE_CHANGED", "USER_DATA_SCOPE_REVOKED"],
  },
  {
    id: "navigation",
    label: "Modules and menus",
    actions: ["MODULE_CREATED", "MODULE_UPDATED", "MODULE_DELETED", "MENU_CREATED", "MENU_UPDATED", "MENU_DELETED"],
  },
]

const ALL_ACCESS_ACTIONS = CATEGORIES.flatMap((category) => category.actions)
const PAGE_SIZE = 25

const DENIAL_ACTIONS = new Set([
  "ACCESS_DENIED",
  "UNAUTHORIZED_ACCESS_ATTEMPT",
  "USER_DELETE_REJECTED",
  "USER_DEACTIVATION_REJECTED",
  "LOGIN_FAILED",
])

function toneFor(action: string) {
  if (DENIAL_ACTIONS.has(action)) return "bg-red-50 text-red-700 border-red-200"
  if (action.includes("DELETED") || action.includes("ARCHIVED") || action === "USER_DEACTIVATED") {
    return "bg-amber-50 text-amber-800 border-amber-200"
  }
  if (action === "LOGIN" || action === "LOGOUT") return "bg-slate-100 text-slate-600 border-slate-200"
  return "bg-emerald-50 text-emerald-700 border-emerald-200"
}

function humanise(action: string) {
  return action
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function AccessAuditTab({ canExport }: { canExport: boolean }) {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<AuditRow | null>(null)
  const [filters, setFilters] = useState({ category: "", search: "", from: "", to: "" })

  const activeActions = useMemo(() => {
    if (!filters.category) return ALL_ACCESS_ACTIONS
    return CATEGORIES.find((item) => item.id === filters.category)?.actions || ALL_ACCESS_ACTIONS
  }, [filters.category])

  const load = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      let query = supabase
        .from("audit_logs")
        .select(
          "id, user_id, user_email, user_name, action, entity_type, entity_id, entity_reference, old_values, new_values, changes, metadata, ip_address, created_at",
          { count: "exact" },
        )
        .in("action", activeActions)
        .order("created_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

      if (filters.from) query = query.gte("created_at", filters.from)
      if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59`)
      if (filters.search.trim()) {
        const term = filters.search.trim().replace(/[%,]/g, "")
        query = query.or(
          `user_email.ilike.%${term}%,user_name.ilike.%${term}%,entity_reference.ilike.%${term}%`,
        )
      }

      const { data, error: queryError, count } = await query
      if (queryError) throw queryError
      setRows((data || []) as AuditRow[])
      setTotal(count || 0)
    } catch (err) {
      console.error("Access audit load failed:", err)
      setError(
        err instanceof Error
          ? err.message
          : "Unable to read the Access Audit. The audit.view permission is required.",
      )
      setRows([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [activeActions, filters.from, filters.to, filters.search, page])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const exportRows = (): ExportRow[] =>
    rows.map((row) => ({
      Timestamp: formatDateTime(row.created_at),
      Actor: row.user_name || row.user_email || "System",
      Email: row.user_email || "",
      Event: humanise(row.action),
      Entity: row.entity_type,
      Reference: row.entity_reference || "",
      "IP address": row.ip_address || "",
    }))

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const setFilter = (patch: Partial<typeof filters>) => {
    setPage(1)
    setFilters((current) => ({ ...current, ...patch }))
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[#132A44] p-2">
              <ClipboardList className="h-4 w-4 text-[#D4A62A]" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Access Audit</h2>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                Append-only evidence of every sign-in, authorisation denial, account change, role change, permission
                change and data-scope change. Records cannot be edited or removed by anyone, including administrators.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => load()}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </button>
            <button
              onClick={() => exportToCSV(`njss-access-audit-${new Date().toISOString().slice(0, 10)}`, exportRows())}
              disabled={!canExport || rows.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              CSV
            </button>
            <button
              onClick={() => {
                const table = rowsToPdfTable(exportRows())
                exportToPDF({
                  title: "NJSS Access Audit",
                  subtitle: `${total} matching events`,
                  columns: table.columns,
                  rows: table.rows,
                  filename: `njss-access-audit-${new Date().toISOString().slice(0, 10)}`,
                })
              }}
              disabled={!canExport || rows.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" />
              PDF
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <select
            value={filters.category}
            onChange={(event) => setFilter({ category: event.target.value })}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-png-red focus:outline-none focus:ring-2 focus:ring-png-red/20"
          >
            <option value="">All access events</option>
            {CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
              </option>
            ))}
          </select>
          <input
            value={filters.search}
            onChange={(event) => setFilter({ search: event.target.value })}
            placeholder="Search actor or reference…"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-png-red focus:outline-none focus:ring-2 focus:ring-png-red/20"
          />
          <input
            type="date"
            value={filters.from}
            onChange={(event) => setFilter({ from: event.target.value })}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-png-red focus:outline-none focus:ring-2 focus:ring-png-red/20"
          />
          <input
            type="date"
            value={filters.to}
            onChange={(event) => setFilter({ to: event.target.value })}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-png-red focus:outline-none focus:ring-2 focus:ring-png-red/20"
          />
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 text-amber-600" />
          <p className="text-sm text-amber-800">{error}</p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-png-red" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-16 text-center text-sm text-slate-500">No access events match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    When
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Actor
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Event
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Target
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    IP
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className="cursor-pointer hover:bg-slate-50/70"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-slate-600">
                      {formatDateTime(row.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-slate-900">{row.user_name || "System"}</p>
                      <p className="text-xs text-slate-500">{row.user_email || "—"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${toneFor(row.action)}`}>
                        {humanise(row.action)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-slate-700">{row.entity_reference || row.entity_type}</p>
                      <p className="text-xs text-slate-400">{row.entity_type}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.ip_address || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-500">
              Page {page} of {totalPages} · {total} events
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page === 1}
                className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                disabled={page >= totalPages}
                className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="font-semibold text-slate-900">{humanise(selected.action)}</h3>
                <p className="text-xs text-slate-500">{formatDateTime(selected.created_at)}</p>
              </div>
              <button onClick={() => setSelected(null)} className="rounded-lg p-1 hover:bg-slate-100">
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
            <div className="space-y-4 px-6 py-5">
              <dl className="grid gap-3 sm:grid-cols-2">
                <Detail label="Actor" value={selected.user_name || "System"} />
                <Detail label="Email" value={selected.user_email || "—"} />
                <Detail label="Entity" value={selected.entity_type} />
                <Detail label="Reference" value={selected.entity_reference || "—"} />
                <Detail label="IP address" value={selected.ip_address || "—"} />
                <Detail label="Record id" value={selected.entity_id || "—"} mono />
              </dl>
              {(["changes", "new_values", "old_values", "metadata"] as const).map((key) =>
                selected[key] ? (
                  <div key={key}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {key.replace("_", " ")}
                    </p>
                    <pre className="max-h-56 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
                      {JSON.stringify(selected[key], null, 2)}
                    </pre>
                  </div>
                ) : null,
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-0.5 break-all text-sm text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
    </div>
  )
}
