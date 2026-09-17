"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { Building2, Loader2, Pencil, Plus, Power, Save, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/AuthContext"

type Location = {
  id: string
  code: string
  name: string
  is_active: boolean
}

type Division = {
  id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
  court_location_id: string | null
}

type Section = {
  id: string
  code: string
  name: string
  department_id: string
  is_active: boolean
  department?: { name: string } | null
}

type Mode = "divisions" | "sections"

type EditorState = {
  id?: string
  code: string
  name: string
  description: string
  department_id: string
}

const EMPTY_EDITOR: EditorState = {
  code: "",
  name: "",
  description: "",
  department_id: "",
}

export default function OrganisationSetupPage() {
  const { can, accessReady } = useAuth()
  const canManage = can("all") || can("masterdata.manage") || can("users.manage")
  const [mode, setMode] = useState<Mode>("divisions")
  const [locations, setLocations] = useState<Location[]>([])
  const [divisions, setDivisions] = useState<Division[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [selectedLocationId, setSelectedLocationId] = useState("")
  const [selectedDivisionId, setSelectedDivisionId] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [search, setSearch] = useState("")

  const loadData = useCallback(async () => {
    const [locationResult, divisionResult, sectionResult] = await Promise.all([
      supabase
        .from("court_locations")
        .select("id, code, name, is_active")
        .order("name"),
      supabase
        .from("departments")
        .select("id, code, name, description, is_active, court_location_id")
        .order("name"),
      supabase
        .from("sections")
        .select("id, code, name, department_id, is_active, department:departments(name)")
        .order("name"),
    ])

    if (locationResult.error || divisionResult.error || sectionResult.error) {
      setError(
        locationResult.error?.message ||
        divisionResult.error?.message ||
        sectionResult.error?.message ||
        "Unable to load organisation structure."
      )
    } else {
      setLocations((locationResult.data || []) as Location[])
      setDivisions((divisionResult.data || []) as Division[])
      setSections((sectionResult.data || []) as unknown as Section[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!accessReady) return

    const timer = window.setTimeout(() => {
      void loadData()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [accessReady, loadData])

  const locationDivisions = useMemo(() => {
    if (!selectedLocationId) return []
    return divisions.filter((row) => row.court_location_id === selectedLocationId)
  }, [divisions, selectedLocationId])

  const filteredDivisions = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const scopedRows = selectedLocationId
      ? divisions.filter((row) => row.court_location_id === selectedLocationId)
      : []
    if (!needle) return scopedRows
    return scopedRows.filter((row) => `${row.code} ${row.name}`.toLowerCase().includes(needle))
  }, [divisions, search, selectedLocationId])

  const filteredSections = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const scopedRows = selectedDivisionId
      ? sections.filter((row) => row.department_id === selectedDivisionId)
      : []
    if (!needle) return scopedRows
    return scopedRows.filter((row) => `${row.code} ${row.name}`.toLowerCase().includes(needle))
  }, [sections, search, selectedDivisionId])

  const availableParentDivisions = useMemo(() => {
    if (!selectedLocationId) return []
    return divisions.filter(
      (row) => row.court_location_id === selectedLocationId && (row.is_active || row.id === editor?.department_id)
    )
  }, [divisions, editor?.department_id, selectedLocationId])

  const selectedLocation = locations.find((row) => row.id === selectedLocationId)
  const selectedDivision = divisions.find((row) => row.id === selectedDivisionId)
  const canAdd = Boolean(selectedLocationId) && (mode === "divisions" || Boolean(selectedDivisionId))

  const changeLocation = (locationId: string) => {
    setSelectedLocationId(locationId)
    setSelectedDivisionId("")
    setEditor(null)
    setSearch("")
    setError("")
    setSuccess("")
  }

  const changeMode = (nextMode: Mode) => {
    setMode(nextMode)
    setSelectedDivisionId("")
    setEditor(null)
    setSearch("")
    setError("")
    setSuccess("")
  }

  const startAdd = () => {
    setError("")
    setSuccess("")

    if (!selectedLocationId) {
      setError("Select a Location / Registry before adding organisation records.")
      return
    }
    if (mode === "sections" && !selectedDivisionId) {
      setError("Select a Division before adding a Section / Unit.")
      return
    }

    setEditor({
      ...EMPTY_EDITOR,
      department_id: mode === "sections" ? selectedDivisionId : "",
    })
  }

  const startEditDivision = (row: Division) => {
    setEditor({
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description || "",
      department_id: "",
    })
  }

  const startEditSection = (row: Section) => {
    setEditor({
      id: row.id,
      code: row.code,
      name: row.name,
      description: "",
      department_id: row.department_id,
    })
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!editor || !canManage) return
    if (!selectedLocationId) {
      setError("Select a Location / Registry first.")
      return
    }
    if (!editor.code.trim() || !editor.name.trim()) {
      setError("Code and name are required.")
      return
    }
    if (mode === "sections" && !editor.department_id) {
      setError("Select the parent Division.")
      return
    }

    setSaving(true)
    setError("")
    setSuccess("")

    const payload = mode === "divisions"
      ? {
          code: editor.code.trim(),
          name: editor.name.trim(),
          description: editor.description.trim() || null,
          court_location_id: selectedLocationId,
          is_active: true,
        }
      : {
          code: editor.code.trim(),
          name: editor.name.trim(),
          department_id: editor.department_id,
          is_active: true,
        }

    const table = mode === "divisions" ? "departments" : "sections"
    const result = editor.id
      ? await supabase.from(table).update(payload).eq("id", editor.id)
      : await supabase.from(table).insert(payload)

    if (result.error) {
      setError(result.error.message)
    } else {
      setSuccess(editor.id ? "Organisation record updated." : "Organisation record created.")
      if (mode === "sections") setSelectedDivisionId(editor.department_id)
      setEditor(null)
      await loadData()
    }
    setSaving(false)
  }

  const toggleDivision = async (row: Division) => {
    if (!canManage) return
    const { error: updateError } = await supabase
      .from("departments")
      .update({ is_active: !row.is_active })
      .eq("id", row.id)
    if (updateError) setError(updateError.message)
    else await loadData()
  }

  const toggleSection = async (row: Section) => {
    if (!canManage) return
    const { error: updateError } = await supabase
      .from("sections")
      .update({ is_active: !row.is_active })
      .eq("id", row.id)
    if (updateError) setError(updateError.message)
    else await loadData()
  }

  if (!accessReady || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-slate-600" />
      </div>
    )
  }

  if (!canManage) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        Organisation Setup is restricted to authorised system administrators.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="h-6 w-6 text-[#132A44]" />
            <h1 className="text-2xl font-bold text-slate-900">Organisation Setup</h1>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Build each Registry organisation as Location / Registry → Division → Section / Unit. Only records within the selected Registry are shown.
          </p>
        </div>
        <button
          type="button"
          onClick={startAdd}
          disabled={!canAdd}
          title={!selectedLocationId ? "Select a Location / Registry first" : mode === "sections" && !selectedDivisionId ? "Select a Division first" : undefined}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#132A44] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3a5d] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          Add {mode === "divisions" ? "Division" : "Section / Unit"}
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_auto_minmax(240px,320px)] lg:items-end">
          <label className="text-sm font-medium text-slate-700">
            Location / Registry
            <select
              value={selectedLocationId}
              onChange={(event) => changeLocation(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
            >
              <option value="">Select Location / Registry</option>
              {locations.filter((location) => location.is_active || location.id === selectedLocationId).map((location) => (
                <option key={location.id} value={location.id}>{location.code} — {location.name}</option>
              ))}
            </select>
          </label>

          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => changeMode("divisions")}
              className={`rounded-md px-4 py-2 text-sm font-medium ${mode === "divisions" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
            >
              Divisions
            </button>
            <button
              type="button"
              onClick={() => changeMode("sections")}
              className={`rounded-md px-4 py-2 text-sm font-medium ${mode === "sections" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
            >
              Sections / Units
            </button>
          </div>

          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search code or name..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            disabled={!selectedLocationId || (mode === "sections" && !selectedDivisionId)}
          />
        </div>

        {mode === "sections" && selectedLocationId && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <label className="block text-sm font-medium text-slate-700">
              Division
              <select
                value={selectedDivisionId}
                onChange={(event) => {
                  setSelectedDivisionId(event.target.value)
                  setEditor(null)
                  setSearch("")
                  setError("")
                  setSuccess("")
                }}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              >
                <option value="">Select Division</option>
                {locationDivisions.filter((division) => division.is_active || division.id === selectedDivisionId).map((division) => (
                  <option key={division.id} value={division.id}>{division.code} — {division.name}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        {selectedLocation && (
          <p className="mt-3 text-xs text-slate-500">
            Showing {mode === "divisions" ? "Divisions" : selectedDivision ? `Sections / Units for ${selectedDivision.name}` : "Sections / Units"} within {selectedLocation.name} only.
          </p>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

      {editor && (
        <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">
                {editor.id ? "Edit" : "Add"} {mode === "divisions" ? "Division" : "Section / Unit"}
              </h2>
              {selectedLocation && <p className="mt-1 text-xs text-slate-500">Location / Registry: {selectedLocation.code} — {selectedLocation.name}</p>}
            </div>
            <button type="button" onClick={() => setEditor(null)} className="rounded-md p-1 text-slate-500 hover:bg-slate-100">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {mode === "sections" && (
              <label className="text-sm font-medium text-slate-700 md:col-span-2">
                Parent Division
                <select
                  value={editor.department_id}
                  onChange={(event) => setEditor({ ...editor, department_id: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  required
                >
                  <option value="">Select Division</option>
                  {availableParentDivisions.map((division) => (
                    <option key={division.id} value={division.id}>{division.code} — {division.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-sm font-medium text-slate-700">
              Code
              <input
                value={editor.code}
                onChange={(event) => setEditor({ ...editor, code: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                required
              />
            </label>
            <label className="text-sm font-medium text-slate-700">
              Name
              <input
                value={editor.name}
                onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                required
              />
            </label>
            {mode === "divisions" && (
              <label className="text-sm font-medium text-slate-700 md:col-span-2">
                Description
                <input
                  value={editor.description}
                  onChange={(event) => setEditor({ ...editor, description: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
            )}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setEditor(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Cancel</button>
            <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-[#132A44] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                {mode === "sections" && <th className="px-4 py-3">Division</th>}
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {mode === "divisions" ? filteredDivisions.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-mono text-xs">{row.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{row.name}</td>
                  <td className="px-4 py-3">{row.is_active ? "Active" : "Inactive"}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => startEditDivision(row)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" title="Edit Division"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => toggleDivision(row)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" title={row.is_active ? "Deactivate Division" : "Activate Division"}><Power className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              )) : filteredSections.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-mono text-xs">{row.code}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">{row.name}</td>
                  <td className="px-4 py-3 text-slate-600">{row.department?.name || "—"}</td>
                  <td className="px-4 py-3">{row.is_active ? "Active" : "Inactive"}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => startEditSection(row)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" title="Edit Section / Unit"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => toggleSection(row)} className="rounded-md p-2 text-slate-600 hover:bg-slate-100" title={row.is_active ? "Deactivate Section / Unit" : "Activate Section / Unit"}><Power className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}

              {mode === "divisions" && !selectedLocationId && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">Select a Location / Registry to view its Divisions.</td></tr>
              )}
              {mode === "divisions" && selectedLocationId && filteredDivisions.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500">No Divisions have been created for this Location / Registry.</td></tr>
              )}
              {mode === "sections" && !selectedLocationId && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Select a Location / Registry to view its Sections / Units.</td></tr>
              )}
              {mode === "sections" && selectedLocationId && !selectedDivisionId && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Select a Division to view its Sections / Units.</td></tr>
              )}
              {mode === "sections" && selectedDivisionId && filteredSections.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">No Sections / Units have been created for this Division.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
