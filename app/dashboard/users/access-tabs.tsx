"use client"

import { useMemo, useState } from "react"
import { Check, Layers, Lock, Save, Search, ShieldCheck, SlidersHorizontal } from "lucide-react"
import type { DataScopeType } from "@/lib/rbac/types"
import {
  DATA_SCOPE_OPTIONS,
  SYSTEM_ADMINISTRATOR,
  sortRoles,
  type AccessConfig,
  type AdminRole,
  type PermissionRow,
} from "./types"

type TabProps = {
  config: AccessConfig
  canManageRoles: boolean
  canManagePermissions: boolean
  canManageModules: boolean
  canManageScope: boolean
  onAccessAction: (payload: Record<string, unknown>) => Promise<boolean>
}

function scopeLabel(scope?: string | null) {
  return DATA_SCOPE_OPTIONS.find((option) => option.value === scope)?.label || "Own Records"
}

// -----------------------------------------------------------------------------
// Roles
// -----------------------------------------------------------------------------

export function RolesTab({ config, canManageRoles, onAccessAction }: TabProps) {
  const [draft, setDraft] = useState<Record<string, { description: string; scope: DataScopeType }>>({})
  const [savingId, setSavingId] = useState("")

  const roles = useMemo(() => sortRoles(config.roles.filter((role) => role.is_active !== false)), [config.roles])
  const retired = useMemo(() => config.roles.filter((role) => role.is_active === false), [config.roles])

  const valueFor = (role: AdminRole) => ({
    description: draft[role.id]?.description ?? role.description ?? "",
    scope: draft[role.id]?.scope ?? (role.data_scope_type as DataScopeType) ?? "OWN_RECORDS",
  })

  const save = async (role: AdminRole) => {
    setSavingId(role.id)
    const value = valueFor(role)
    const ok = await onAccessAction({
      action: "UPDATE_ROLE",
      roleId: role.id,
      description: value.description,
      dataScopeType: value.scope,
    })
    if (ok) setDraft((current) => ({ ...current, [role.id]: undefined as never }))
    setSavingId("")
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-[#132A44] p-2">
            <ShieldCheck className="h-4 w-4 text-[#D4A62A]" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Controlled workflow roles</h2>
            <p className="mt-1 text-sm text-slate-600">
              NJSS operates on five fixed workflow roles plus one protected technical account. Roles cannot be created,
              renamed or deleted — only their description and data scope are configurable, so segregation of duties
              stays intact.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {roles.map((role, index) => {
          const value = valueFor(role)
          const dirty = Boolean(draft[role.id])
          const isAdmin = role.name === SYSTEM_ADMINISTRATOR
          return (
            <div
              key={role.id}
              className={`rounded-xl border bg-white p-5 ${isAdmin ? "border-[#D4A62A]/50" : "border-slate-200"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-bold ${
                      isAdmin ? "bg-[#132A44] text-[#D4A62A]" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {isAdmin ? <Lock className="h-3.5 w-3.5" /> : role.workflow_sequence ?? index + 1}
                  </span>
                  <div>
                    <p className="font-semibold text-slate-900">{role.name}</p>
                    <p className="text-xs text-slate-500">
                      {isAdmin ? "Technical account — not a business workflow role" : "Business workflow role"}
                    </p>
                  </div>
                </div>
                {role.is_protected && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    Protected
                  </span>
                )}
              </div>

              <label className="mt-4 block text-xs font-medium text-slate-600">Description</label>
              <textarea
                value={value.description}
                disabled={!canManageRoles}
                rows={2}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [role.id]: { ...valueFor(role), description: event.target.value },
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-png-red focus:outline-none focus:ring-2 focus:ring-png-red/20 disabled:bg-slate-50"
              />

              <label className="mt-3 block text-xs font-medium text-slate-600">Default data scope</label>
              <select
                value={value.scope}
                disabled={!canManageRoles}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [role.id]: { ...valueFor(role), scope: event.target.value as DataScopeType },
                  }))
                }
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-png-red focus:outline-none focus:ring-2 focus:ring-png-red/20 disabled:bg-slate-50"
              >
                {DATA_SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              {dirty && canManageRoles && (
                <button
                  onClick={() => save(role)}
                  disabled={savingId === role.id}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-png-red px-3 py-1.5 text-sm font-medium text-white hover:bg-png-maroon disabled:opacity-50"
                >
                  <Save className="h-3.5 w-3.5" />
                  {savingId === role.id ? "Saving…" : "Save changes"}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {retired.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="text-sm font-semibold text-slate-900">Retired legacy roles ({retired.length})</h3>
          <p className="mt-1 text-xs text-slate-500">
            Kept so historic audit references still resolve. They can no longer be assigned.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {retired.map((role) => (
              <span
                key={role.id}
                title={role.deactivation_reason || undefined}
                className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-500 line-through"
              >
                {role.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Role permissions matrix
// -----------------------------------------------------------------------------

export function PermissionsTab({ config, canManagePermissions, onAccessAction }: TabProps) {
  const roles = useMemo(() => sortRoles(config.roles.filter((role) => role.is_active !== false)), [config.roles])
  const [selectedRoleId, setSelectedRoleId] = useState(roles[0]?.id || "")
  const [query, setQuery] = useState("")
  const [pending, setPending] = useState<string[]>([])
  const [granted, setGranted] = useState<Record<string, boolean> | null>(null)

  const roleId = selectedRoleId || roles[0]?.id || ""
  const role = roles.find((item) => item.id === roleId)

  const baseGranted = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const row of config.rolePermissions) {
      if (row.role_id === roleId && row.is_allowed) map[row.permission] = true
    }
    return map
  }, [config.rolePermissions, roleId])

  const effective = granted ?? baseGranted
  const hasAll = Boolean(effective.all)

  const grouped = useMemo(() => {
    const search = query.trim().toLowerCase()
    const map = new Map<string, PermissionRow[]>()
    for (const permission of config.permissions) {
      if (!permission.is_active) continue
      if (
        search &&
        !permission.code.toLowerCase().includes(search) &&
        !permission.label.toLowerCase().includes(search)
      ) {
        continue
      }
      const list = map.get(permission.module_code) || []
      list.push(permission)
      map.set(permission.module_code, list)
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
  }, [config.permissions, query])

  const toggle = async (permission: string, next: boolean) => {
    setGranted({ ...effective, [permission]: next })
    setPending((current) => [...current, permission])
    const ok = await onAccessAction({
      action: "TOGGLE_ROLE_PERMISSION",
      roleId,
      permission,
      grant: next,
    })
    if (!ok) setGranted({ ...effective, [permission]: !next })
    setPending((current) => current.filter((code) => code !== permission))
  }

  const selectRole = (id: string) => {
    setSelectedRoleId(id)
    setGranted(null)
  }

  const grantedCount = Object.values(effective).filter(Boolean).length

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-png-red" />
          <h2 className="font-semibold text-slate-900">Permission matrix</h2>
        </div>
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter permissions…"
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-png-red focus:outline-none focus:ring-2 focus:ring-png-red/20"
            />
          </div>
          <select
            value={roleId}
            onChange={(event) => selectRole(event.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-png-red focus:outline-none focus:ring-2 focus:ring-png-red/20"
          >
            {roles.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {hasAll && (
        <div className="rounded-lg border border-[#D4A62A]/40 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-semibold">{role?.name}</span> holds the <code className="font-mono">all</code>{" "}
          permission and therefore passes every application check. Segregation-of-duties rules still apply — the
          database no longer lets <code className="font-mono">all</code> bypass self-action bans.
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <p className="text-sm text-slate-600">
            <span className="font-semibold text-slate-900">{grantedCount}</span> permissions granted to{" "}
            <span className="font-semibold text-slate-900">{role?.name || "—"}</span>
          </p>
          {!canManagePermissions && (
            <span className="text-xs text-slate-500">Read-only — you lack permissions.manage</span>
          )}
        </div>

        <div className="divide-y divide-slate-100">
          {grouped.map(([moduleCode, permissions]) => (
            <div key={moduleCode} className="px-4 py-3">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
                {moduleCode.replace(/_/g, " ")}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {permissions.map((permission) => {
                  const on = Boolean(effective[permission.code])
                  const busy = pending.includes(permission.code)
                  return (
                    <label
                      key={permission.code}
                      className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ${
                        on ? "border-png-red/30 bg-red-50/50" : "border-slate-200 hover:bg-slate-50"
                      } ${!canManagePermissions ? "cursor-not-allowed opacity-70" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={!canManagePermissions || busy}
                        onChange={(event) => toggle(permission.code, event.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-[#8a1420]"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-slate-800">{permission.label}</span>
                        <span className="block truncate font-mono text-[11px] text-slate-400">{permission.code}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
          {grouped.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-500">No permissions match that filter.</p>
          )}
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Modules and menus
// -----------------------------------------------------------------------------

export function ModulesTab({ config, canManageModules, onAccessAction }: TabProps) {
  const [savingCode, setSavingCode] = useState("")

  const toggleModule = async (code: string, isActive: boolean) => {
    const target = config.modules.find((module) => module.code === code)
    if (!target) return
    setSavingCode(code)
    await onAccessAction({ action: "SAVE_MODULE", module: { ...target, is_active: isActive } })
    setSavingCode("")
  }

  const toggleMenu = async (code: string, isActive: boolean) => {
    const target = config.menus.find((menu) => menu.code === code)
    if (!target) return
    setSavingCode(code)
    await onAccessAction({ action: "SAVE_MENU", menu: { ...target, is_active: isActive } })
    setSavingCode("")
  }

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Layers className="h-4 w-4 text-png-red" />
          <h2 className="font-semibold text-slate-900">Registered modules</h2>
          <span className="ml-auto text-xs text-slate-500">{config.modules.length}</span>
        </div>
        <div className="divide-y divide-slate-100">
          {config.modules.map((module) => (
            <div key={module.code} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{module.name}</p>
                <p className="truncate font-mono text-[11px] text-slate-400">{module.base_path}</p>
              </div>
              <button
                onClick={() => toggleModule(module.code, !module.is_active)}
                disabled={!canManageModules || savingCode === module.code}
                className={`rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                  module.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                }`}
              >
                {module.is_active ? "Active" : "Hidden"}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <Layers className="h-4 w-4 text-png-red" />
          <h2 className="font-semibold text-slate-900">Permission-driven menus</h2>
          <span className="ml-auto text-xs text-slate-500">{config.menus.length}</span>
        </div>
        <div className="max-h-[540px] divide-y divide-slate-100 overflow-y-auto">
          {config.menus.map((menu) => (
            <div key={menu.code} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{menu.label}</p>
                <p className="truncate font-mono text-[11px] text-slate-400">{menu.href}</p>
                <p className="mt-1 truncate text-[11px] text-slate-500">
                  Requires: {menu.required_permissions?.join(", ") || "none"}
                </p>
              </div>
              <button
                onClick={() => toggleMenu(menu.code, !menu.is_active)}
                disabled={!canManageModules || savingCode === menu.code}
                className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${
                  menu.is_active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                }`}
              >
                {menu.is_active ? "Active" : "Hidden"}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Data scope
// -----------------------------------------------------------------------------

export function ScopeTab({ config, canManageScope, onAccessAction }: TabProps) {
  const roles = useMemo(() => sortRoles(config.roles.filter((role) => role.is_active !== false)), [config.roles])
  const [savingId, setSavingId] = useState("")
  const [local, setLocal] = useState<Record<string, DataScopeType>>({})

  const currentScope = (roleId: string, fallback?: string | null) =>
    local[roleId] || (config.roleScopes.find((row) => row.role_id === roleId)?.scope_type as DataScopeType) ||
    ((fallback as DataScopeType) ?? "OWN_RECORDS")

  const change = async (roleId: string, scopeType: DataScopeType) => {
    setLocal((current) => ({ ...current, [roleId]: scopeType }))
    setSavingId(roleId)
    await onAccessAction({ action: "SAVE_ROLE_SCOPE", roleId, scopeType })
    setSavingId("")
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold text-slate-900">Data visibility by role</h2>
        <p className="mt-1 text-sm text-slate-600">
          Data scope decides which records a role can read once its permissions allow the action. It is enforced in the
          database by row-level security, not only in the interface.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Role</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                Data scope
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                What it means
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {roles.map((role) => {
              const scope = currentScope(role.id, role.data_scope_type)
              const option = DATA_SCOPE_OPTIONS.find((item) => item.value === scope)
              return (
                <tr key={role.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <p className="text-sm font-medium text-slate-900">{role.name}</p>
                    <p className="text-xs text-slate-500">{scopeLabel(role.data_scope_type)} by default</p>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={scope}
                      disabled={!canManageScope || savingId === role.id}
                      onChange={(event) => change(role.id, event.target.value as DataScopeType)}
                      className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-png-red focus:outline-none focus:ring-2 focus:ring-png-red/20 disabled:bg-slate-50"
                    >
                      {DATA_SCOPE_OPTIONS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      {savingId === role.id ? (
                        <span className="text-xs text-slate-400">Saving…</span>
                      ) : (
                        <Check className="h-3.5 w-3.5 text-green-600" />
                      )}
                      {option?.description}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
