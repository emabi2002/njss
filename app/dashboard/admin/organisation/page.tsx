"use client"

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import { Building2, Loader2, Pencil, Plus, Power, Save, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/AuthContext"

type Division = {
  id: string
  code: string
  name: string
  description: string | null
  is_active: boolean
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
  const [divisions, setDivisions] = useState<Division[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [search, setSearch] = useState("")

  const loadData = useCallback(async () => {
    setLoading(true)
    setError("")
    const [divisionResult, sectionResult] = await Promise.all([
      supabase
        .from("departments")
        .select("id, code, name, description, is_active")
        .order("name"),
      supabase
        .from("sections")
        .select("id, code, name, department_id, is_active, department:departments(name)")
        .order("name"),
    ])

    if (divisionResult.error || sectionResult.error) {
      setError(divisionResult.error?.message || sectionResult.error?.message || "Unable to load organisation structure.")
    } else {
      setDivisions((divisionResult.data || []) as Division[])
      setSections((sectionResult.data || []) as unknown as Section[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (accessReady) loadData()
  }, [accessReady, loadData])

  const filteredDivisions = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return divisions
    return divisions.filter((row) => `${row.code} ${row.name}`.toLowerCase().includes(needle))
  }, [divisions, search])

  const filteredSections = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return sections
    return sections.filter((row) => `${row.code} ${row.name} ${row.department?.name || ""}`.toLowerCase().includes(needle))
  }, [sections, search])

  const startAdd = () => {
    setError("")
    setSuccess("")
    setEditor({ ...EMPTY_EDITOR })
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
            Maintain NJSS Divisions and the Sections / Units that belong to each Division. Budget, FF3 and reporting screens use this structure dynamically.
          </p>
        </div>
        <button
          type="button"
          onClick={startAdd}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#132A44] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3a5d]"
        >
          <Plus className="h-4 w-4" />
          Add {mode === "divisions" ? "Division" : "Section / Unit"}
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="inline-flex rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => { setMode("divisions"); setEditor(null) }}
              className={`rounded-md px-4 py-2 text-sm font-medium ${mode === "divisions" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
            >
              Divisions
            </button>
            <button
              type="button"
              onClick={() => { setMode("sections"); setEditor(null) }}
              className={`rounded-md px-4 py-2 text-sm font-medium ${mode === "sections" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"}`}
            >
              Sections / Units
            </button>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search code or name..."
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm md:w-80"
          />
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div>}

      {editor && (
        <form onSubmit={save} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">
              {editor.id ? "Edit" : "Add"} {mode === "divisions" ? "Division" : "Section / Unit"}
            </h2>
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
                  {divisions.filter((division) => division.is_active || division.id === editor.department_id).map((division) => (
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
              {((mode === "divisions" && filteredDivisions.length === 0) || (mode === "sections" && filteredSections.length === 0)) && (
                <tr><td colSpan={mode === "sections" ? 5 : 4} className="px-4 py-8 text-center text-slate-500">No organisation records found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
