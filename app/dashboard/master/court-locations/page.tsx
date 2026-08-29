"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Power,
  Trash2,
  X,
} from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import {
  COURT_LOCATION_TYPE_OPTIONS,
  courtLocationTypeLabel,
  createCourtLocation,
  deleteCourtLocation,
  listActiveProvinces,
  listCourtLocations,
  setCourtLocationActive,
  updateCourtLocation,
  type CourtLocationInput,
  type CourtLocationRow,
  type CourtLocationType,
  type ProvinceOption,
} from "@/lib/court-locations"
import { supabase } from "@/lib/supabase"

type FormState = {
  province_id: string
  code: string
  name: string
  location_type: CourtLocationType
  town: string
}

const EMPTY_FORM: FormState = {
  province_id: "",
  code: "",
  name: "",
  location_type: "NATIONAL_COURT_REGISTRY",
  town: "",
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error) return String(error.message)
  return "The Court Location operation could not be completed."
}

export default function CourtLocationsPage() {
  const { can, profile } = useAuth()
  const canEdit = can("masterdata.manage") || can("registry.manage") || can("all")
  const [rows, setRows] = useState<CourtLocationRow[]>([])
  const [provinces, setProvinces] = useState<ProvinceOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<"ACTIVE" | "INACTIVE" | "ALL">("ACTIVE")
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<CourtLocationRow | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const [locationRows, provinceRows] = await Promise.all([
        listCourtLocations(),
        listActiveProvinces(),
      ])
      setRows(locationRows)
      setProvinces(provinceRows)
    } catch (loadError) {
      setError(messageFrom(loadError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const audit = useCallback(async (
    action: string,
    rowId: string | null,
    oldValues: unknown,
    newValues: unknown,
  ) => {
    try {
      await supabase.from("audit_logs").insert({
        user_id: profile?.id || null,
        user_email: profile?.email || null,
        user_name: profile?.name || null,
        action,
        entity_type: "MASTER_DATA",
        entity_id: rowId,
        entity_reference: "court_locations",
        old_values: oldValues || null,
        new_values: newValues || null,
        metadata: { table: "court_locations", master: "Court Locations" },
      })
    } catch (auditError) {
      console.warn("Court Location audit failed:", auditError)
    }
  }, [profile?.email, profile?.id, profile?.name])

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (statusFilter === "ACTIVE" && !row.is_active) return false
      if (statusFilter === "INACTIVE" && row.is_active) return false
      if (!needle) return true
      return [
        row.code,
        row.name,
        row.town || "",
        row.province?.code || "",
        row.province?.name || "",
        courtLocationTypeLabel(row.location_type),
      ].some((value) => value.toLowerCase().includes(needle))
    })
  }, [rows, search, statusFilter])

  const activeCount = useMemo(() => rows.filter((row) => row.is_active).length, [rows])
  const headquartersCount = useMemo(() => rows.filter((row) => row.is_headquarters).length, [rows])

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setForm(EMPTY_FORM)
  }

  function openAdd() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError("")
    setSuccess("")
    setShowForm(true)
  }

  function openEdit(row: CourtLocationRow) {
    setEditing(row)
    setForm({
      province_id: row.province_id,
      code: row.code,
      name: row.name,
      location_type: row.location_type,
      town: row.town || "",
    })
    setError("")
    setSuccess("")
    setShowForm(true)
  }

  function validatedInput(): CourtLocationInput {
    const code = form.code.trim().toUpperCase()
    const name = form.name.trim()
    if (!form.province_id) throw new Error("Province is required.")
    if (!code) throw new Error("Court Location code is required.")
    if (!name) throw new Error("Court Location name is required.")
    if (!form.location_type) throw new Error("Location Type is required.")
    return {
      province_id: form.province_id,
      code,
      name,
      location_type: form.location_type,
      town: form.town.trim(),
    }
  }

  async function save() {
    if (!canEdit) return
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      const input = validatedInput()
      if (editing) {
        const updated = await updateCourtLocation(editing.id, input)
        await audit("MASTER_DATA_UPDATED", editing.id, editing, updated)
        setSuccess(`Court Location ${updated.code} updated.`)
      } else {
        const created = await createCourtLocation(input)
        await audit("MASTER_DATA_CREATED", created.id, null, created)
        setSuccess(`Court Location ${created.code} created.`)
      }
      closeForm()
      await loadData()
    } catch (saveError) {
      setError(messageFrom(saveError))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(row: CourtLocationRow) {
    if (!canEdit) return
    setSaving(true)
    setError("")
    setSuccess("")
    try {
      const updated = await setCourtLocationActive(row.id, !row.is_active)
      await audit(row.is_active ? "MASTER_DATA_DEACTIVATED" : "MASTER_DATA_ACTIVATED", row.id, row, updated)
      setSuccess(`Court Location ${row.code} ${updated.is_active ? "activated" : "deactivated"}.`)
      await loadData()
    } catch (toggleError) {
      setError(messageFrom(toggleError))
    } finally {
      setSaving(false)
    }
  }

  async function remove(row: CourtLocationRow) {
    if (!canEdit) return
    const confirmed = window.confirm(
      `Delete Court Location ${row.code} — ${row.name}? Locations referenced by Departments cannot be deleted.`,
    )
    if (!confirmed) return

    setSaving(true)
    setError("")
    setSuccess("")
    try {
      await deleteCourtLocation(row.id)
      await audit("MASTER_DATA_DELETED", row.id, row, null)
      setSuccess(`Court Location ${row.code} deleted.`)
      await loadData()
    } catch (deleteError) {
      setError(messageFrom(deleteError))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link
            href="/dashboard/master"
            className="mb-3 inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-png-red"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Master Data
          </Link>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-png-red/10 p-2.5">
              <MapPin className="h-6 w-6 text-png-red" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Court Locations</h1>
              <p className="mt-1 text-sm text-slate-600">
                Maintain the Province and registry location layer used by NJSS organisational, budget and reporting structures.
              </p>
            </div>
          </div>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-png-red px-4 py-2.5 text-sm font-semibold text-white hover:bg-png-maroon"
          >
            <Plus className="h-4 w-4" />
            Add Court Location
          </button>
        )}
      </div>

      {!canEdit && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          You have read-only access. Court Location changes require master-data or registry-management permission.
        </div>
      )}

      {success && <Notice tone="green" text={success} />}
      {error && <Notice tone="red" text={error} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Total Locations" value={rows.length} />
        <SummaryCard label="Active Locations" value={activeCount} />
        <SummaryCard label="Headquarters" value={headquartersCount} />
      </div>

      {showForm && canEdit && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">
                {editing ? "Edit Court Location" : "Add Court Location"}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Headquarters is derived automatically when Location Type is set to Headquarters.
              </p>
            </div>
            <button type="button" onClick={closeForm} className="rounded p-1.5 hover:bg-slate-100">
              <X className="h-4 w-4 text-slate-500" />
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Field label="Province" required>
              <select
                value={form.province_id}
                onChange={(event) => setForm((current) => ({ ...current, province_id: event.target.value }))}
                className="input-control"
              >
                <option value="">Select Province...</option>
                {provinces.map((province) => (
                  <option key={province.id} value={province.id}>
                    {province.code} — {province.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Court Location Code" required>
              <input
                value={form.code}
                maxLength={30}
                onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))}
                placeholder="e.g. MOR-LAE"
                className="input-control"
              />
            </Field>

            <Field label="Court Location" required>
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="e.g. Lae National Court Registry"
                className="input-control"
              />
            </Field>

            <Field label="Town">
              <input
                value={form.town}
                onChange={(event) => setForm((current) => ({ ...current, town: event.target.value }))}
                placeholder="e.g. Lae"
                className="input-control"
              />
            </Field>

            <Field label="Location Type" required>
              <select
                value={form.location_type}
                onChange={(event) => setForm((current) => ({
                  ...current,
                  location_type: event.target.value as CourtLocationType,
                }))}
                className="input-control"
              >
                {COURT_LOCATION_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Location Type values: Headquarters · National Court Registry · National Court Sub-Registry.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={closeForm}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-png-red px-4 py-2 text-sm font-semibold text-white hover:bg-png-maroon disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {editing ? "Save Changes" : "Save Court Location"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search code, Court Location, Province, town or type..."
            className="min-w-[280px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "ACTIVE" | "INACTIVE" | "ALL")}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red"
          >
            <option value="ACTIVE">Active only</option>
            <option value="INACTIVE">Inactive only</option>
            <option value="ALL">All records</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-png-red" />
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">No Court Locations found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px]">
              <thead className="border-b border-slate-200 bg-slate-50">
                <tr>
                  {[
                    "Code",
                    "Court Location",
                    "Province",
                    "Town",
                    "Location Type",
                    "Headquarters",
                    "Status",
                    "Actions",
                  ].map((label) => (
                    <th key={label} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-700">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-sm font-semibold text-slate-800">{row.code}</td>
                    <td className="px-4 py-3 text-sm text-slate-800">{row.name}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.province ? `${row.province.code} — ${row.province.name}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">{row.town || "—"}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{courtLocationTypeLabel(row.location_type)}</td>
                    <td className="px-4 py-3 text-sm text-slate-700">{row.is_headquarters ? "Yes" : "No"}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${row.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>
                        {row.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {canEdit ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEdit(row)}
                            className="rounded p-1.5 text-slate-600 hover:bg-slate-100"
                            title="Edit Court Location"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleActive(row)}
                            disabled={saving}
                            className="rounded p-1.5 text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                            title={row.is_active ? "Deactivate" : "Activate"}
                          >
                            <Power className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(row)}
                            disabled={saving}
                            className="rounded p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50"
                            title="Delete Court Location"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Read only</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label} {required && <span className="text-png-red">*</span>}
      </label>
      {children}
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  )
}

function Notice({ tone, text }: { tone: "green" | "red"; text: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${tone === "green" ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"}`}>
      {tone === "green" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
      {text}
    </div>
  )
}
