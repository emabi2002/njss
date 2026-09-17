"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Building2, CheckCircle2, Loader2, Network, Pencil, Plus, Power, ShieldAlert, X } from "lucide-react"
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
}

type Tab = "divisions" | "sections"

type FormState = {
  id?: string
  code: string
  name: string
  description: string
  department_id: string
}

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  description: "",
  department_id: "",
}

export default function OrganisationSetupPage() {
  const { can, profile, accessReady } = useAuth()
  const isSystemAdministrator = can("all")
  const [tab, setTab] = useState<Tab>("divisions")
  const [divisions, setDivisions] = useState<Division[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const loadOrganisation = useCallback(async () => {
    if (!isSystemAdministrator) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError("")
    try {
      const [divisionResult, sectionResult] = await Promise.all([
        supabase
          .from("departments")
          .select("id, code, name, description, is_active")
          .order("name"),
        supabase
          .from("sections")
          .select("id, code, name, department_id, is_active")
          .order("name"),
      ])

      if (divisionResult.error) throw divisionResult.error
      if (sectionResult.error) throw sectionResult.error

      setDivisions((divisionResult.data || []) as Division[])
      setSections((sectionResult.data || []) as Section[])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load organisation structure.")
    } finally {
      setLoading(false)
    }
  }, [isSystemAdministrator])

  useEffect(() => {
    if (accessReady) loadOrganisation()
  }, [accessReady, loadOrganisation])

  const audit = async (action: string, entityId: string | null, oldValues: unknown, newValues: unknown, entityType: "DIVISION" | "SECTION") => {
    try {
      await supabase.from("audit_logs").insert({
        user_id: profile?.id || null,
        user_email: profile?.email || null,
        user_name: profile?.name || null,
        action,
        entity_type: entityType,
        entity_id: entityId,
        old_values: oldValues || null,
        new_values: newValues || null,
        metadata: { source: "ORGANISATION_SETUP" },
      })
    } catch (err) {
      console.warn("Organisation setup audit failed:", err)
    }
  }

  const divisionName = useCallback(
    (divisionId: string) => divisions.find((division) => division.id === divisionId)?.name || "Unassigned Division",
    [divisions],
  )

  const filteredDivisions = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return divisions
    return divisions.filter((division) => `${division.code} ${division.name}`.toLowerCase().includes(needle))
  }, [divisions, search])

  const filteredSections = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return sections
    return sections.filter((section) => `${section.code} ${section.name} ${divisionName(section.department_id)}`.toLowerCase().includes(needle))
  }, [sections, search, divisionName])

  const openCreate = () => {
    setForm(EMPTY_FORM)
    setEditing(false)
    setFormOpen(true)
    setError("")
    setSuccess("")
  }

  const openDivisionEdit = (division: Division) => {
    setTab("divisions")
    setForm({
      id: division.id,
      code: division.code,
      name: division.name,
      description: division.description || "",
      department_id: "",
    })
    setEditing(true)
    setFormOpen(true)
    setError("")
    setSuccess("")
  }

  const openSectionEdit = (section: Section) => {
    setTab("sections")
    setForm({
      id: section.id,
      code: section.code,
      name: section.name,
      description: "",
      department_id: section.department_id,
    })
    setEditing(true)
    setFormOpen(true)
    setError("")
    setSuccess("")
  }

  const saveRecord = async () => {
    if (!form.code.trim() || !form.name.trim()) {
      setError("Code and name are required.")
      return
    }
    if (tab === "sections" && !form.department_id) {
      setError("A parent Division is required for every Section / Unit.")
      return
    }

    setSaving(true)
    setError("")
    setSuccess("")
    try {
      if (tab === "divisions") {
        const payload = {
          code: form.code.trim(),
          name: form.name.trim(),
          description: form.description.trim() || null,
        }

        if (editing && form.id) {
          const oldRecord = divisions.find((division) => division.id === form.id) || null
          const { data, error: updateError } = await supabase
            .from("departments")
            .update(payload)
            .eq("id", form.id)
            .select("id, code, name, description, is_active")
            .single()
          if (updateError) throw updateError
          await audit("DIVISION_UPDATED", form.id, oldRecord, data, "DIVISION")
          setSuccess("Division updated.")
        } else {
          const { data, error: insertError } = await supabase
            .from("departments")
            .insert({ ...payload, is_active: true })
            .select("id, code, name, description, is_active")
            .single()
          if (insertError) throw insertError
          await audit("DIVISION_CREATED", data?.id || null, null, data, "DIVISION")
          setSuccess("Division created.")
        }
      } else {
        const payload = {
          code: form.code.trim(),
          name: form.name.trim(),
          department_id: form.department_id,
        }

        if (editing && form.id) {
          const oldRecord = sections.find((section) => section.id === form.id) || null
          const { data, error: updateError } = await supabase
            .from("sections")
            .update(payload)
            .eq("id", form.id)
            .select("id, code, name, department_id, is_active")
            .single()
          if (updateError) throw updateError
          await audit("SECTION_UPDATED", form.id, oldRecord, data, "SECTION")
          setSuccess("Section / Unit updated.")
        } else {
          const { data, error: insertError } = await supabase
            .from("sections")
            .insert({ ...payload, is_active: true })
            .select("id, code, name, department_id, is_active")
            .single()
          if (insertError) throw insertError
          await audit("SECTION_CREATED", data?.id || null, null, data, "SECTION")
          setSuccess("Section / Unit created.")
        }
      }

      setFormOpen(false)
      setEditing(false)
      setForm(EMPTY_FORM)
      await loadOrganisation()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save organisation record.")
    } finally {
      setSaving(false)
    }
  }

  const toggleDivision = async (division: Division) => {
    const nextActive = !division.is_active
    if (!nextActive) {
      const activeChildren = sections.filter((section) => section.department_id === division.id && section.is_active)
      if (activeChildren.length > 0) {
        setError(`Deactivate the ${activeChildren.length} active Section / Unit record(s) under ${division.name} first.`)
        return
      }
    }

    setSaving(true)
    setError("")
    try {
      const { data, error: updateError } = await supabase
        .from("departments")
        .update({ is_active: nextActive })
        .eq("id", division.id)
        .select("id, code, name, description, is_active")
        .single()
      if (updateError) throw updateError
      await audit(nextActive ? "DIVISION_ACTIVATED" : "DIVISION_DEACTIVATED", division.id, division, data, "DIVISION")
      setSuccess(`Division ${nextActive ? "activated" : "deactivated"}.`)
      await loadOrganisation()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update Division status.")
    } finally {
      setSaving(false)
    }
  }

  const toggleSection = async (section: Section) => {
    const nextActive = !section.is_active
    setSaving(true)
    setError("")
    try {
      const { data, error: updateError } = await supabase
        .from("sections")
        .update({ is_active: nextActive })
        .eq("id", section.id)
        .select("id, code, name, department_id, is_active")
        .single()
      if (updateError) throw updateError
      await audit(nextActive ? "SECTION_ACTIVATED" : "SECTION_DEACTIVATED", section.id, section, data, "SECTION")
      setSuccess(`Section / Unit ${nextActive ? "activated" : "deactivated"}.`)
      await loadOrganisation()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update Section / Unit status.")
    } finally {
      setSaving(false)
    }
  }

  if (!accessReady || loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-png-red" /></div>
  }

  if (!isSystemAdministrator) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">
        <div className="flex items-center gap-3"><ShieldAlert className="h-6 w-6" /><h1 className="text-xl font-semibold">Organisation Setup</h1></div>
        <p className="mt-3 text-sm">Only the System Administrator with full-system access can maintain Divisions and Sections / Units.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2"><Building2 className="h-7 w-7 text-png-red" /><h1 className="text-2xl font-bold text-slate-900">Organisation Setup</h1></div>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Maintain the NJSS Head Office structure used by Budget, FF3, FF4, reporting and user access. Divisions are stored in the existing organisational master and every Section / Unit must belong to one Division.</p>
        </div>
        <button onClick={openCreate} className="flex items-center gap-2 rounded-lg bg-png-red px-4 py-2 text-sm font-semibold text-white hover:bg-png-maroon"><Plus className="h-4 w-4" /> Add {tab === "divisions" ? "Division" : "Section / Unit"}</button>
      </div>

      {success && <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800"><CheckCircle2 className="h-4 w-4" />{success}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2">
        <button onClick={() => { setTab("divisions"); setFormOpen(false); setSearch("") }} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "divisions" ? "bg-png-red text-white" : "text-slate-700 hover:bg-slate-100"}`}>Divisions</button>
        <button onClick={() => { setTab("sections"); setFormOpen(false); setSearch("") }} className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === "sections" ? "bg-png-red text-white" : "text-slate-700 hover:bg-slate-100"}`}>Sections / Units</button>
      </div>

      {formOpen && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between"><h2 className="font-semibold text-slate-900">{editing ? "Edit" : "Add"} {tab === "divisions" ? "Division" : "Section / Unit"}</h2><button onClick={() => setFormOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button></div>
          <div className="grid gap-4 md:grid-cols-2">
            {tab === "sections" && (
              <label className="text-sm font-medium text-slate-700">Parent Division
                <select value={form.department_id} onChange={(event) => setForm((current) => ({ ...current, department_id: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2">
                  <option value="">Select Division</option>
                  {divisions.filter((division) => division.is_active || division.id === form.department_id).map((division) => <option key={division.id} value={division.id}>{division.code} — {division.name}</option>)}
                </select>
              </label>
            )}
            <label className="text-sm font-medium text-slate-700">Code
              <input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder={tab === "divisions" ? "e.g. NCD-WGN-ICT" : "e.g. NCD-WGN-ICT-DEV"} />
            </label>
            <label className="text-sm font-medium text-slate-700">Name
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder={tab === "divisions" ? "Information Technology" : "Development"} />
            </label>
            {tab === "divisions" && (
              <label className="text-sm font-medium text-slate-700 md:col-span-2">Description
                <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" placeholder="Optional description" />
              </label>
            )}
          </div>
          <div className="mt-5 flex justify-end gap-2"><button onClick={() => setFormOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">Cancel</button><button disabled={saving} onClick={saveRecord} className="rounded-lg bg-png-red px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Save"}</button></div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${tab === "divisions" ? "divisions" : "sections / units"}...`} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm md:max-w-md" /></div>
        <div className="overflow-x-auto">
          {tab === "divisions" ? (
            <table className="w-full"><thead className="bg-slate-50"><tr><Header>Code</Header><Header>Division</Header><Header>Description</Header><Header>Status</Header><Header align="right">Actions</Header></tr></thead><tbody className="divide-y divide-slate-100">{filteredDivisions.map((division) => <tr key={division.id}><Cell mono>{division.code}</Cell><Cell>{division.name}</Cell><Cell>{division.description || "—"}</Cell><Cell><StatusBadge active={division.is_active} /></Cell><Cell align="right"><div className="flex justify-end gap-1"><IconButton title="Edit Division" onClick={() => openDivisionEdit(division)}><Pencil className="h-4 w-4" /></IconButton><IconButton title={division.is_active ? "Deactivate Division" : "Activate Division"} onClick={() => toggleDivision(division)}><Power className="h-4 w-4" /></IconButton></div></Cell></tr>)}</tbody></table>
          ) : (
            <table className="w-full"><thead className="bg-slate-50"><tr><Header>Code</Header><Header>Section / Unit</Header><Header>Division</Header><Header>Status</Header><Header align="right">Actions</Header></tr></thead><tbody className="divide-y divide-slate-100">{filteredSections.map((section) => <tr key={section.id}><Cell mono>{section.code}</Cell><Cell>{section.name}</Cell><Cell>{divisionName(section.department_id)}</Cell><Cell><StatusBadge active={section.is_active} /></Cell><Cell align="right"><div className="flex justify-end gap-1"><IconButton title="Edit Section / Unit" onClick={() => openSectionEdit(section)}><Pencil className="h-4 w-4" /></IconButton><IconButton title={section.is_active ? "Deactivate Section / Unit" : "Activate Section / Unit"} onClick={() => toggleSection(section)}><Power className="h-4 w-4" /></IconButton></div></Cell></tr>)}</tbody></table>
          )}
        </div>
        {((tab === "divisions" && filteredDivisions.length === 0) || (tab === "sections" && filteredSections.length === 0)) && <div className="py-12 text-center text-sm text-slate-500">No matching records found.</div>}
      </div>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900"><div className="flex gap-3"><Network className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-semibold">Structure used throughout NJSS</p><p className="mt-1">Changes made here flow into Annual Budget, FF3, FF4, reporting and user assignment. Historical records are preserved; use deactivate rather than deleting organisational units that are no longer current.</p></div></div></div>
    </div>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return <span className={`rounded-full px-2 py-1 text-xs font-semibold ${active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{active ? "Active" : "Inactive"}</span>
}

function Header({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={`px-4 py-3 text-${align} text-xs font-semibold uppercase tracking-wide text-slate-600`}>{children}</th>
}

function Cell({ children, align = "left", mono = false }: { children: React.ReactNode; align?: "left" | "right"; mono?: boolean }) {
  return <td className={`px-4 py-3 text-${align} text-sm text-slate-700 ${mono ? "font-mono" : ""}`}>{children}</td>
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={title} onClick={onClick} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900">{children}</button>
}
