"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, Loader2, Plus, Search, X } from "lucide-react"
import { supabase } from "@/lib/supabase"

export type LookupOption = {
  id: string
  code?: string | null
  name: string
  description?: string | null
  [key: string]: unknown
}

export type AddField = {
  name: string
  label: string
  required?: boolean
  placeholder?: string
}

type LookupSelectProps = {
  label?: string
  value: string
  onChange: (value: string, option?: LookupOption) => void
  options: LookupOption[]
  placeholder?: string
  disabled?: boolean
  required?: boolean
  canAdd?: boolean
  addLabel?: string
  emptyLabel?: string
  unauthorizedEmptyLabel?: string
  addTable?: string
  addFields?: AddField[]
  addPayload?: (form: Record<string, string>) => Record<string, unknown>
  createVia?: (form: Record<string, string>) => Promise<LookupOption>
  onCreated?: (option: LookupOption) => void
  onRefresh?: () => Promise<void> | void
  compact?: boolean
  className?: string
}

export function optionLabel(option: LookupOption) {
  return option.code ? `${option.code} — ${option.name}` : option.name
}

export function LookupSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Select...",
  disabled,
  required,
  canAdd = false,
  addLabel = "+ Add New",
  emptyLabel = "No records configured.",
  unauthorizedEmptyLabel = "No options available — contact System Administrator.",
  addTable,
  addFields = [
    { name: "code", label: "Code", required: true },
    { name: "name", label: "Name", required: true },
  ],
  addPayload,
  createVia,
  onCreated,
  onRefresh,
  compact = false,
  className = "",
}: LookupSelectProps) {
  const [query, setQuery] = useState("")
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const selected = options.find((option) => option.id === value)
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return options
    return options.filter((option) => optionLabel(option).toLowerCase().includes(needle))
  }, [options, query])

  useEffect(() => {
    // Keep the searchable text synchronized when parent state selects or clears a value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery(selected ? optionLabel(selected) : "")
  }, [selected])

  const createRecord = async () => {
    if (!addTable) return
    setError("")
    for (const field of addFields) {
      if (field.required && !form[field.name]?.trim()) {
        setError(`${field.label} is required.`)
        return
      }
    }
    const duplicate = options.find((option) =>
      [option.code, option.name].filter(Boolean).some((existing) =>
        addFields.some((field) => form[field.name]?.trim().toLowerCase() === String(existing).toLowerCase())
      )
    )
    if (duplicate) {
      onChange(duplicate.id, duplicate)
      setShowAdd(false)
      return
    }
    setSaving(true)
    try {
      let created: LookupOption
      if (createVia) {
        created = await createVia(form)
      } else {
        const payload = addPayload ? addPayload(form) : { ...form, is_active: true }
        const { data, error: insertError } = await supabase.from(addTable).insert(payload).select("*").single()
        if (insertError) throw insertError
        created = {
          id: data.id,
          code: data.code || data.supplier_code || null,
          name: data.name || data.supplier_name || data.full_name || data.email || "New record",
          ...data,
        }
      }
      await onRefresh?.()
      onCreated?.(created)
      onChange(created.id, created)
      setShowAdd(false)
      setForm({})
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the record.")
    } finally {
      setSaving(false)
    }
  }

  const listId = `${label || placeholder || "lookup"}-options`

  if (compact) {
    return (
      <div className={`min-w-0 ${className}`}>
        {label && <label className="sr-only">{label} {required && "required"}</label>}
        <div className="flex min-w-0 items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                if (!event.target.value) onChange("")
              }}
              disabled={disabled}
              placeholder={options.length === 0 ? unauthorizedEmptyLabel : placeholder}
              list={listId}
              className="h-8 w-full rounded-md border border-slate-200 bg-white py-1 pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-png-red disabled:bg-slate-100"
            />
            <datalist id={listId}>{filtered.map((option) => <option key={option.id} value={optionLabel(option)} />)}</datalist>
          </div>
          <select
            value={value}
            onChange={(event) => {
              const option = options.find((item) => item.id === event.target.value)
              onChange(event.target.value, option)
            }}
            disabled={disabled || options.length === 0}
            className="h-8 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs focus:outline-none focus:ring-2 focus:ring-png-red disabled:bg-slate-100"
          >
            <option value="">{options.length === 0 ? unauthorizedEmptyLabel : placeholder}</option>
            {filtered.map((option) => <option key={option.id} value={option.id}>{optionLabel(option)}</option>)}
          </select>
        </div>
      </div>
    )
  }

  return (
    <div className={`space-y-1 ${className}`}>
      {label && <label className="block text-sm font-medium text-slate-700">{label} {required && <span className="text-red-500">*</span>}</label>}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            if (!event.target.value) onChange("")
          }}
          disabled={disabled}
          placeholder={options.length === 0 ? (canAdd ? emptyLabel : unauthorizedEmptyLabel) : placeholder}
          list={listId}
          className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-png-red disabled:bg-slate-100"
        />
        <datalist id={listId}>
          {filtered.map((option) => <option key={option.id} value={optionLabel(option)} />)}
        </datalist>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          value={value}
          onChange={(event) => {
            const option = options.find((item) => item.id === event.target.value)
            onChange(event.target.value, option)
          }}
          disabled={disabled || options.length === 0}
          className="min-w-[180px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red disabled:bg-slate-100"
        >
          <option value="">{options.length === 0 ? (canAdd ? emptyLabel : unauthorizedEmptyLabel) : placeholder}</option>
          {filtered.map((option) => <option key={option.id} value={option.id}>{optionLabel(option)}</option>)}
        </select>
        {canAdd && addTable && (
          <button type="button" onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1 rounded-lg border border-png-gold/50 px-3 py-2 text-sm font-medium text-png-red hover:bg-png-red/5">
            <Plus className="h-4 w-4" /> {addLabel.replace(/^\+\s*/, "")}
          </button>
        )}
      </div>

      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-4">
              <h3 className="font-semibold text-slate-900">{addLabel.replace(/^\+\s*/, "")}</h3>
              <button type="button" onClick={() => setShowAdd(false)} className="rounded p-1 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 p-4">
              {error && <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
              {addFields.map((field) => (
                <div key={field.name}>
                  <label className="mb-1 block text-sm font-medium text-slate-700">{field.label} {field.required && <span className="text-red-500">*</span>}</label>
                  <input value={form[field.name] || ""} onChange={(event) => setForm((current) => ({ ...current, [field.name]: event.target.value }))} placeholder={field.placeholder} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-png-red" />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
              <button type="button" onClick={() => setShowAdd(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={createRecord} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-png-red px-4 py-2 text-sm font-medium text-white hover:bg-png-maroon disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
