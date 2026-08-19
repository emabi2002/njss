"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Building2,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Mail,
  MoreVertical,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react"
import { authFetch } from "@/lib/auth-fetch"
import { useAuth } from "@/contexts/AuthContext"
import { AccessDenied } from "@/components/AccessDenied"
import { evaluatePassword } from "@/lib/password"
import { AccessAuditTab } from "./access-audit"
import { ModulesTab, PermissionsTab, RolesTab, ScopeTab } from "./access-tabs"
import {
  SYSTEM_ADMINISTRATOR,
  formatDate,
  formatDateTime,
  initialsOf,
  roleOf,
  sortRoles,
  type AccessConfig,
  type AdminRole,
  type AdminUser,
  type Department,
  type Section,
} from "./types"

type AdminTab = "users" | "roles" | "permissions" | "modules" | "scope" | "audit"
const ADMIN_TABS: AdminTab[] = ["users", "roles", "permissions", "modules", "scope", "audit"]

const TAB_LABELS: Array<[AdminTab, string]> = [
  ["users", "Users"],
  ["roles", "Roles"],
  ["permissions", "Role Permissions"],
  ["modules", "Module Access"],
  ["scope", "Data Scope"],
  ["audit", "Access Audit"],
]

const EMPTY_CONFIG: AccessConfig = {
  roles: [],
  permissions: [],
  rolePermissions: [],
  modules: [],
  menus: [],
  roleScopes: [],
  userScopes: [],
  userPermissions: [],
}

type UserForm = {
  email: string
  full_name: string
  employee_id: string
  position: string
  phone: string
  department_id: string
  section_id: string
  role_id: string
  is_active: boolean
}

const BLANK_FORM: UserForm = {
  email: "",
  full_name: "",
  employee_id: "",
  position: "",
  phone: "",
  department_id: "",
  section_id: "",
  role_id: "",
  is_active: true,
}

type ConfirmState = {
  kind: "ARCHIVE" | "DELETE"
  user: AdminUser
}

async function copyText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // fall through to the legacy path below
  }
  try {
    const area = document.createElement("textarea")
    area.value = value
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export default function AccessControlPage() {
  const { can, canAny, profile } = useAuth()

  const [activeTab, setActiveTab] = useState<AdminTab>("users")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const [users, setUsers] = useState<AdminUser[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [sections, setSections] = useState<Section[]>([])
  const [config, setConfig] = useState<AccessConfig>(EMPTY_CONFIG)
  const [migrationApplied, setMigrationApplied] = useState(true)
  const [forbidden, setForbidden] = useState(false)

  const [search, setSearch] = useState("")
  const [roleFilter, setRoleFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")

  const [menu, setMenu] = useState<{ user: AdminUser; x: number; y: number } | null>(null)
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null)
  const [form, setForm] = useState<UserForm>(BLANK_FORM)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [detail, setDetail] = useState<{
    user: AdminUser
    activity: Record<string, number | boolean> | null
    authAccount: { lastSignInAt?: string | null; emailConfirmedAt?: string | null } | null
  } | null>(null)
  const [resetFor, setResetFor] = useState<AdminUser | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [issuedPassword, setIssuedPassword] = useState<{ email: string; password: string } | null>(null)

  const canManageUsers = can("users.manage")

  const notify = (message: string, isError = false) => {
    if (isError) {
      setError(message)
      setSuccess("")
    } else {
      setSuccess(message)
      setError("")
    }
    window.setTimeout(() => {
      setError("")
      setSuccess("")
    }, 6000)
  }

  const loadAll = useCallback(async () => {
    try {
      const [usersRes, accessRes] = await Promise.all([
        authFetch("/api/admin/users"),
        authFetch("/api/admin/access"),
      ])

      if (usersRes.status === 401 || usersRes.status === 403) {
        setForbidden(true)
        return
      }

      const usersJson = await usersRes.json().catch(() => ({}))
      if (!usersRes.ok) throw new Error(usersJson.error || "Unable to load the user register.")

      setUsers((usersJson.users || []) as AdminUser[])
      setDepartments((usersJson.departments || []) as Department[])
      setSections((usersJson.sections || []) as Section[])
      setMigrationApplied(usersJson.migrationApplied !== false)

      if (accessRes.ok) {
        const accessJson = (await accessRes.json()) as AccessConfig
        setConfig({ ...EMPTY_CONFIG, ...accessJson })
      }
    } catch (err) {
      console.error("Access control load failed:", err)
      setError(err instanceof Error ? err.message : "Unable to load access control data.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll()
  }, [loadAll])

  const assignableRoles = useMemo(
    () =>
      sortRoles(
        config.roles.filter(
          (role) => role.is_active !== false && (role.is_business_role || role.name === SYSTEM_ADMINISTRATOR),
        ),
      ),
    [config.roles],
  )

  // Before migration 041 the is_business_role flag does not exist, so the
  // controlled-role filter would collapse to the administrator alone. Fall back
  // to every active legacy role until the migration lands.
  const roleChoices =
    migrationApplied && assignableRoles.length
      ? assignableRoles
      : sortRoles(config.roles.filter((role) => role.is_active !== false))

  const userAction = async (payload: Record<string, unknown>, successMessage: string) => {
    setBusy(true)
    try {
      const res = await authFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        notify(json.error || "The action could not be completed.", true)
        return null
      }
      await loadAll()
      notify(successMessage)
      return json as Record<string, unknown>
    } catch {
      notify("Unable to reach the server. Please try again.", true)
      return null
    } finally {
      setBusy(false)
    }
  }

  const accessAction = async (payload: Record<string, unknown>) => {
    const res = await authFetch("/api/admin/access", {
      method: "POST",
      body: JSON.stringify(payload),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      notify(json.error || "The access change could not be saved.", true)
      return false
    }
    await loadAll()
    notify("Access configuration updated.")
    return true
  }

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase()
    return users.filter((user) => {
      if (roleFilter && roleOf(user)?.id !== roleFilter) return false
      if (statusFilter === "active" && (!user.is_active || user.archived_at)) return false
      if (statusFilter === "inactive" && (user.is_active || user.archived_at)) return false
      if (statusFilter === "archived" && !user.archived_at) return false
      if (statusFilter === "pending" && !user.must_change_password) return false
      if (!term) return true
      return (
        user.email.toLowerCase().includes(term) ||
        (user.full_name || "").toLowerCase().includes(term) ||
        (user.employee_id || "").toLowerCase().includes(term) ||
        (user.department?.name || "").toLowerCase().includes(term)
      )
    })
  }, [users, search, roleFilter, statusFilter])

  const stats = useMemo(
    () => ({
      total: users.length,
      active: users.filter((user) => user.is_active && !user.archived_at).length,
      inactive: users.filter((user) => !user.is_active && !user.archived_at).length,
      archived: users.filter((user) => Boolean(user.archived_at)).length,
      pending: users.filter((user) => user.must_change_password).length,
    }),
    [users],
  )

  const openCreate = () => {
    setEditing(null)
    setForm({ ...BLANK_FORM, role_id: roleChoices[0]?.id || "" })
    setFormMode("create")
  }

  const openEdit = (user: AdminUser) => {
    setEditing(user)
    setForm({
      email: user.email,
      full_name: user.full_name || "",
      employee_id: user.employee_id || "",
      position: user.position || "",
      phone: user.phone || "",
      department_id: user.department_id || "",
      section_id: user.section_id || "",
      role_id: roleOf(user)?.id || "",
      is_active: user.is_active,
    })
    setFormMode("edit")
  }

  const openDetail = async (user: AdminUser) => {
    setDetail({ user, activity: null, authAccount: null })
    const res = await authFetch(`/api/admin/users?userId=${user.id}`)
    if (!res.ok) return
    const json = await res.json()
    setDetail({ user: json.user || user, activity: json.activity || null, authAccount: json.authAccount || null })
  }

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>, user: AdminUser) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu({
      user,
      x: Math.max(12, rect.right - 224),
      y: Math.min(rect.bottom + 6, window.innerHeight - 340),
    })
  }

  if (!canAny(["users.manage", "roles.manage", "permissions.manage", "modules.manage", "data_scope.manage", "audit.view"]) || forbidden) {
    return <AccessDenied title="Access Control" />
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-png-red" />
      </div>
    )
  }

  const tabProps = {
    config,
    canManageRoles: can("roles.manage"),
    canManagePermissions: can("permissions.manage"),
    canManageModules: can("modules.manage"),
    canManageScope: can("data_scope.manage"),
    onAccessAction: accessAction,
  }

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <AdminTabQuerySync onTabChange={setActiveTab} />
      </Suspense>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-png-red">Administration</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-900">Users &amp; Access Control</h1>
          <p className="mt-1 max-w-2xl text-slate-600">
            Create and maintain NJSS accounts, assign exactly one workflow role per officer, control permissions,
            module visibility and data scope, and review the immutable access audit.
          </p>
        </div>
        {activeTab === "users" && canManageUsers && (
          <button
            onClick={openCreate}
            disabled={!migrationApplied}
            className="inline-flex items-center gap-2 rounded-lg bg-png-red px-4 py-2.5 font-medium text-white hover:bg-png-maroon disabled:cursor-not-allowed disabled:opacity-50"
          >
            <UserPlus className="h-4 w-4" />
            Add User
          </button>
        )}
      </div>

      {!migrationApplied && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">Database migration 041 has not been applied to this environment.</p>
            <p className="mt-0.5">
              User administration is read-only until{" "}
              <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-[11px]">
                041_user_administration_and_access_control.sql
              </code>{" "}
              is applied. Roles, permissions, module access and data scope remain editable.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {TAB_LABELS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === key ? "bg-png-red text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {activeTab === "users" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Total accounts" value={stats.total} icon={<Users className="h-4 w-4" />} />
            <StatCard label="Active" value={stats.active} tone="green" icon={<CheckCircle2 className="h-4 w-4" />} />
            <StatCard label="Inactive" value={stats.inactive} tone="slate" icon={<EyeOff className="h-4 w-4" />} />
            <StatCard label="Archived" value={stats.archived} tone="amber" icon={<Archive className="h-4 w-4" />} />
            <StatCard
              label="Password reset pending"
              value={stats.pending}
              tone="red"
              icon={<KeyRound className="h-4 w-4" />}
            />
          </div>

          <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-[1fr_200px_200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by name, email, employee ID or department…"
                className="w-full rounded-lg border border-slate-200 py-2 pl-10 pr-4 text-sm focus:border-png-red focus:outline-none focus:ring-2 focus:ring-png-red/20"
              />
            </div>
            <select
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-png-red focus:outline-none focus:ring-2 focus:ring-png-red/20"
            >
              <option value="">All roles</option>
              {roleChoices.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-png-red focus:outline-none focus:ring-2 focus:ring-png-red/20"
            >
              <option value="">All statuses</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
              <option value="archived">Archived only</option>
              <option value="pending">Password reset pending</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <Th>Officer</Th>
                    <Th>Workflow role</Th>
                    <Th>Department / Section</Th>
                    <Th>Status</Th>
                    <Th>Last sign-in</Th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map((user) => {
                    const role = roleOf(user)
                    return (
                      <tr key={user.id} className={`hover:bg-slate-50/70 ${user.archived_at ? "opacity-60" : ""}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div
                              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${
                                user.is_protected ? "bg-[#132A44]" : "bg-png-red"
                              }`}
                            >
                              {initialsOf(user)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="truncate font-medium text-slate-900">{user.full_name || "No name"}</p>
                                {user.is_protected && (
                                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#D4A62A]" aria-label="Protected" />
                                )}
                              </div>
                              <p className="truncate text-sm text-slate-500">{user.email}</p>
                              {user.employee_id && (
                                <p className="truncate text-xs text-slate-400">ID {user.employee_id}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {role ? (
                            <span
                              className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${
                                role.name === SYSTEM_ADMINISTRATOR
                                  ? "bg-[#132A44] text-[#D4A62A]"
                                  : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {role.name}
                            </span>
                          ) : (
                            <span className="text-xs text-amber-600">No role assigned</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          <p>{user.department?.name || "—"}</p>
                          <p className="text-xs text-slate-400">{user.section?.name || ""}</p>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1">
                            {user.archived_at ? (
                              <Badge tone="amber">Archived</Badge>
                            ) : user.is_active ? (
                              <Badge tone="green">Active</Badge>
                            ) : (
                              <Badge tone="slate">Inactive</Badge>
                            )}
                            {user.must_change_password && <Badge tone="red">Password change due</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">{formatDate(user.last_login_at)}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(event) => openMenu(event, user)}
                            className="rounded-lg p-2 hover:bg-slate-100"
                            aria-label={`Actions for ${user.full_name || user.email}`}
                          >
                            <MoreVertical className="h-4 w-4 text-slate-600" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {filteredUsers.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-14 text-center text-sm text-slate-500">
                        No accounts match these filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === "roles" && <RolesTab {...tabProps} />}
      {activeTab === "permissions" && <PermissionsTab {...tabProps} />}
      {activeTab === "modules" && <ModulesTab {...tabProps} />}
      {activeTab === "scope" && <ScopeTab {...tabProps} />}
      {activeTab === "audit" && <AccessAuditTab canExport={canAny(["audit.export", "audit.view"])} />}

      {menu && (
        <>
          <button
            className="fixed inset-0 z-40 cursor-default"
            aria-label="Close menu"
            onClick={() => setMenu(null)}
          />
          <div
            className="fixed z-50 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-2xl"
            style={{ top: menu.y, left: menu.x }}
          >
            <MenuItem
              icon={<Eye className="h-4 w-4" />}
              label="View details"
              onClick={() => {
                openDetail(menu.user)
                setMenu(null)
              }}
            />
            <MenuItem
              icon={<Pencil className="h-4 w-4" />}
              label="Edit account"
              disabled={!canManageUsers || !migrationApplied}
              onClick={() => {
                openEdit(menu.user)
                setMenu(null)
              }}
            />
            <MenuItem
              icon={<KeyRound className="h-4 w-4" />}
              label="Reset password"
              disabled={!canManageUsers || !migrationApplied || !menu.user.auth_user_id}
              onClick={() => {
                setResetFor(menu.user)
                setMenu(null)
              }}
            />
            <MenuItem
              icon={<Send className="h-4 w-4" />}
              label="Resend invitation"
              disabled={!canManageUsers || !migrationApplied}
              onClick={() => {
                userAction({ action: "RESEND_INVITATION", userId: menu.user.id }, "Invitation recorded as re-sent.")
                setMenu(null)
              }}
            />
            <div className="my-1 border-t border-slate-100" />
            {menu.user.archived_at ? (
              <MenuItem
                icon={<ArchiveRestore className="h-4 w-4" />}
                label="Restore account"
                disabled={!canManageUsers || !migrationApplied}
                onClick={() => {
                  userAction({ action: "RESTORE", userId: menu.user.id }, "Account restored.")
                  setMenu(null)
                }}
              />
            ) : (
              <MenuItem
                icon={menu.user.is_active ? <EyeOff className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                label={menu.user.is_active ? "Deactivate" : "Activate"}
                disabled={!canManageUsers || !migrationApplied || menu.user.id === profile?.id}
                onClick={() => {
                  userAction(
                    { action: "SET_ACTIVE", userId: menu.user.id, user: { is_active: !menu.user.is_active } },
                    menu.user.is_active ? "Account deactivated." : "Account activated.",
                  )
                  setMenu(null)
                }}
              />
            )}
            {!menu.user.archived_at && (
              <MenuItem
                icon={<Archive className="h-4 w-4" />}
                label="Archive account"
                disabled={!canManageUsers || !migrationApplied || menu.user.is_protected}
                onClick={() => {
                  setConfirm({ kind: "ARCHIVE", user: menu.user })
                  setMenu(null)
                }}
              />
            )}
            <MenuItem
              icon={<Trash2 className="h-4 w-4" />}
              label="Delete account"
              tone="danger"
              disabled={!canManageUsers || !migrationApplied || menu.user.is_protected}
              onClick={() => {
                setConfirm({ kind: "DELETE", user: menu.user })
                setMenu(null)
              }}
            />
          </div>
        </>
      )}

      {formMode && (
        <UserFormModal
          mode={formMode}
          form={form}
          setForm={setForm}
          roles={roleChoices}
          departments={departments}
          sections={sections}
          busy={busy}
          onClose={() => setFormMode(null)}
          onSubmit={async (password) => {
            const payload =
              formMode === "create"
                ? {
                    action: "CREATE",
                    user: form,
                    generatePassword: password.generate,
                    password: password.value,
                    confirmPassword: password.confirm,
                    sendWelcomeEmail: password.notify,
                  }
                : { action: "UPDATE", userId: editing?.id, user: form }

            const result = await userAction(
              payload,
              formMode === "create" ? "Account created." : "Account updated.",
            )
            if (!result) return
            setFormMode(null)
            if (typeof result.generatedPassword === "string") {
              setIssuedPassword({ email: form.email, password: result.generatedPassword })
            }
          }}
        />
      )}

      {resetFor && (
        <ResetPasswordModal
          user={resetFor}
          busy={busy}
          onClose={() => setResetFor(null)}
          onSubmit={async (password) => {
            const result = await userAction(
              {
                action: "RESET_PASSWORD",
                userId: resetFor.id,
                generatePassword: password.generate,
                password: password.value,
                confirmPassword: password.confirm,
              },
              "Password reset. The officer must set a new password at next sign-in.",
            )
            if (!result) return
            setResetFor(null)
            if (typeof result.generatedPassword === "string") {
              setIssuedPassword({ email: resetFor.email, password: result.generatedPassword })
            }
          }}
        />
      )}

      {confirm && (
        <ConfirmModal
          state={confirm}
          busy={busy}
          onClose={() => setConfirm(null)}
          onSubmit={async (reason) => {
            const done = await userAction(
              { action: confirm.kind, userId: confirm.user.id, reason },
              confirm.kind === "ARCHIVE" ? "Account archived." : "Deletion processed.",
            )
            if (done) setConfirm(null)
          }}
        />
      )}

      {detail && <UserDetailModal detail={detail} onClose={() => setDetail(null)} />}

      {issuedPassword && (
        <IssuedPasswordModal issued={issuedPassword} onClose={() => setIssuedPassword(null)} />
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Small presentational helpers
// -----------------------------------------------------------------------------

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">{children}</th>
  )
}

function Badge({ tone, children }: { tone: "green" | "slate" | "amber" | "red"; children: React.ReactNode }) {
  const tones = {
    green: "bg-green-100 text-green-700",
    slate: "bg-slate-100 text-slate-600",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-700",
  }
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

function StatCard({
  label,
  value,
  icon,
  tone = "default",
}: {
  label: string
  value: number
  icon: React.ReactNode
  tone?: "default" | "green" | "slate" | "amber" | "red"
}) {
  const tones = {
    default: "bg-slate-100 text-slate-700",
    green: "bg-green-100 text-green-700",
    slate: "bg-slate-100 text-slate-500",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-red-100 text-red-700",
  }
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
        </div>
        <div className={`rounded-lg p-2 ${tones[tone]}`}>{icon}</div>
      </div>
    </div>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  tone,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  tone?: "danger"
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-40 ${
        tone === "danger" ? "text-png-red hover:bg-red-50" : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label} {required && <span className="text-png-red">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-png-red focus:outline-none focus:ring-2 focus:ring-png-red/20 disabled:bg-slate-100"

function ModalShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = "max-w-2xl",
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  width?: string
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={`flex max-h-[90vh] w-full ${width} flex-col overflow-hidden rounded-xl bg-white shadow-2xl`}>
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Password sub-form shared by create and reset
// -----------------------------------------------------------------------------

type PasswordChoice = { generate: boolean; value: string; confirm: string; notify: boolean }

function PasswordFields({
  choice,
  setChoice,
  showNotify,
}: {
  choice: PasswordChoice
  setChoice: (next: PasswordChoice) => void
  showNotify?: boolean
}) {
  const [reveal, setReveal] = useState(false)
  const rules = evaluatePassword(choice.value)
  const matches = choice.value.length > 0 && choice.value === choice.confirm

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <p className="text-sm font-semibold text-slate-800">Initial password</p>

      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="radio"
          checked={choice.generate}
          onChange={() => setChoice({ ...choice, generate: true })}
          className="mt-0.5 h-4 w-4 accent-[#8a1420]"
        />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
            <Sparkles className="h-3.5 w-3.5 text-[#D4A62A]" />
            Generate a temporary password
          </span>
          <span className="block text-xs text-slate-500">
            Shown once after saving so it can be handed over through a separate secure channel.
          </span>
        </span>
      </label>

      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="radio"
          checked={!choice.generate}
          onChange={() => setChoice({ ...choice, generate: false })}
          className="mt-0.5 h-4 w-4 accent-[#8a1420]"
        />
        <span className="text-sm font-medium text-slate-800">Set a password manually</span>
      </label>

      {!choice.generate && (
        <div className="space-y-3 pt-1">
          <div className="relative">
            <input
              type={reveal ? "text" : "password"}
              value={choice.value}
              autoComplete="new-password"
              onChange={(event) => setChoice({ ...choice, value: event.target.value })}
              placeholder="New password"
              className={`${inputClass} pr-10`}
            />
            <button
              type="button"
              onClick={() => setReveal((value) => !value)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label={reveal ? "Hide password" : "Show password"}
            >
              {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <input
            type={reveal ? "text" : "password"}
            value={choice.confirm}
            autoComplete="new-password"
            onChange={(event) => setChoice({ ...choice, confirm: event.target.value })}
            placeholder="Confirm password"
            className={inputClass}
          />
          <ul className="grid gap-1 sm:grid-cols-2">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-1.5 text-xs">
                <span className={rule.passed ? "text-green-600" : "text-slate-300"}>
                  {rule.passed ? <CheckCircle2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                </span>
                <span className={rule.passed ? "text-slate-700" : "text-slate-500"}>{rule.label}</span>
              </li>
            ))}
            <li className="flex items-center gap-1.5 text-xs">
              <span className={matches ? "text-green-600" : "text-slate-300"}>
                {matches ? <CheckCircle2 className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
              </span>
              <span className={matches ? "text-slate-700" : "text-slate-500"}>Both entries match</span>
            </li>
          </ul>
        </div>
      )}

      {showNotify && (
        <label className="flex items-center gap-2 border-t border-slate-200 pt-3">
          <input
            type="checkbox"
            checked={choice.notify}
            onChange={(event) => setChoice({ ...choice, notify: event.target.checked })}
            className="h-4 w-4 accent-[#8a1420]"
          />
          <span className="text-sm text-slate-700">Record that a welcome notice was issued</span>
        </label>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-slate-500">
        <Shield className="mt-0.5 h-3 w-3 shrink-0" />
        The officer is forced to choose their own password at next sign-in. NJSS never stores the password value and it
        never appears in the audit trail.
      </p>
    </div>
  )
}

function passwordReady(choice: PasswordChoice) {
  if (choice.generate) return true
  return evaluatePassword(choice.value).every((rule) => rule.passed) && choice.value === choice.confirm
}

// -----------------------------------------------------------------------------
// Modals
// -----------------------------------------------------------------------------

function UserFormModal({
  mode,
  form,
  setForm,
  roles,
  departments,
  sections,
  busy,
  onClose,
  onSubmit,
}: {
  mode: "create" | "edit"
  form: UserForm
  setForm: React.Dispatch<React.SetStateAction<UserForm>>
  roles: AdminRole[]
  departments: Department[]
  sections: Section[]
  busy: boolean
  onClose: () => void
  onSubmit: (password: PasswordChoice) => Promise<void>
}) {
  const [password, setPassword] = useState<PasswordChoice>({
    generate: true,
    value: "",
    confirm: "",
    notify: true,
  })

  const update = (patch: Partial<UserForm>) => setForm((current) => ({ ...current, ...patch }))
  const availableSections = sections.filter(
    (section) => !form.department_id || section.department_id === form.department_id,
  )

  const ready =
    Boolean(form.email.trim()) &&
    Boolean(form.full_name.trim()) &&
    Boolean(form.role_id) &&
    (mode === "edit" || passwordReady(password))

  return (
    <ModalShell
      title={mode === "create" ? "Add NJSS user" : "Edit account"}
      subtitle={
        mode === "create"
          ? "Creates the sign-in account and the NJSS profile in one step."
          : form.email
      }
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(password)}
            disabled={!ready || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-png-red px-4 py-2 text-sm font-medium text-white hover:bg-png-maroon disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "create" ? "Create account" : "Save changes"}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email address" required>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                value={form.email}
                disabled={mode === "edit"}
                onChange={(event) => update({ email: event.target.value })}
                placeholder="officer@pngjudiciary.gov.pg"
                className={`${inputClass} pl-10`}
              />
            </div>
          </Field>
          <Field label="Full name" required>
            <input
              value={form.full_name}
              onChange={(event) => update({ full_name: event.target.value })}
              placeholder="Jonah Kila"
              className={inputClass}
            />
          </Field>
          <Field label="Employee ID">
            <input
              value={form.employee_id}
              onChange={(event) => update({ employee_id: event.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Position">
            <input
              value={form.position}
              onChange={(event) => update({ position: event.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Phone">
            <input
              value={form.phone}
              onChange={(event) => update({ phone: event.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label="Department">
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select
                value={form.department_id}
                onChange={(event) => update({ department_id: event.target.value, section_id: "" })}
                className={`${inputClass} pl-10`}
              >
                <option value="">Not assigned</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </div>
          </Field>
          <Field label="Section">
            <select
              value={form.section_id}
              onChange={(event) => update({ section_id: event.target.value })}
              className={inputClass}
            >
              <option value="">Not assigned</option>
              {availableSections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">
            Workflow role <span className="text-png-red">*</span>
          </p>
          <p className="mb-3 text-xs text-slate-500">
            Exactly one role per officer. Segregation of duties is enforced in the database, so the same person can
            never raise and approve the same document.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {roles.map((role) => {
              const selected = form.role_id === role.id
              return (
                <label
                  key={role.id}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors ${
                    selected ? "border-png-red bg-red-50/60" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="workflow-role"
                    checked={selected}
                    onChange={() => update({ role_id: role.id })}
                    className="mt-0.5 h-4 w-4 accent-[#8a1420]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-900">{role.name}</span>
                    <span className="block text-xs leading-snug text-slate-500">
                      {role.description || "No description"}
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>

        {mode === "create" && <PasswordFields choice={password} setChoice={setPassword} showNotify />}
      </div>
    </ModalShell>
  )
}

function ResetPasswordModal({
  user,
  busy,
  onClose,
  onSubmit,
}: {
  user: AdminUser
  busy: boolean
  onClose: () => void
  onSubmit: (password: PasswordChoice) => Promise<void>
}) {
  const [password, setPassword] = useState<PasswordChoice>({
    generate: true,
    value: "",
    confirm: "",
    notify: false,
  })

  return (
    <ModalShell
      title="Reset password"
      subtitle={user.email}
      width="max-w-lg"
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(password)}
            disabled={!passwordReady(password) || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-png-red px-4 py-2 text-sm font-medium text-white hover:bg-png-maroon disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Reset password
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            All active sessions for this officer are signed out immediately, and they must set their own password at
            next sign-in.
          </p>
        </div>
        <PasswordFields choice={password} setChoice={setPassword} />
      </div>
    </ModalShell>
  )
}

function ConfirmModal({
  state,
  busy,
  onClose,
  onSubmit,
}: {
  state: ConfirmState
  busy: boolean
  onClose: () => void
  onSubmit: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState("")
  const isDelete = state.kind === "DELETE"

  return (
    <ModalShell
      title={isDelete ? "Delete account" : "Archive account"}
      subtitle={state.user.full_name || state.user.email}
      width="max-w-lg"
      onClose={onClose}
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(reason)}
            disabled={!reason.trim() || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-png-red px-4 py-2 text-sm font-medium text-white hover:bg-png-maroon disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {isDelete ? "Delete account" : "Archive account"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <div className="text-sm text-red-800">
            {isDelete ? (
              <>
                <p className="font-semibold">Deletion is only possible for accounts with no history.</p>
                <p className="mt-0.5">
                  If this officer has raised, endorsed, approved or paid anything, NJSS automatically converts the
                  request into an archive so the financial record stays complete.
                </p>
              </>
            ) : (
              <p>
                Archiving keeps every historical record intact, signs the officer out and blocks further sign-in. The
                account can be restored later.
              </p>
            )}
          </div>
        </div>

        <Field label="Reason (recorded in the Access Audit)" required>
          <textarea
            value={reason}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            placeholder="For example: officer transferred out of the Judiciary on 12 August 2026."
            className={inputClass}
          />
        </Field>
      </div>
    </ModalShell>
  )
}

function UserDetailModal({
  detail,
  onClose,
}: {
  detail: {
    user: AdminUser
    activity: Record<string, number | boolean> | null
    authAccount: { lastSignInAt?: string | null; emailConfirmedAt?: string | null } | null
  }
  onClose: () => void
}) {
  const { user, activity, authAccount } = detail
  const role = roleOf(user)
  const activityEntries = Object.entries(activity || {}).filter(
    ([key, value]) => typeof value === "number" && value > 0 && key !== "total",
  )

  return (
    <ModalShell title={user.full_name || user.email} subtitle={user.email} onClose={onClose}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Detail label="Workflow role" value={role?.name || "No role assigned"} />
          <Detail label="Data scope" value={role?.data_scope_type || "OWN_RECORDS"} />
          <Detail label="Employee ID" value={user.employee_id || "—"} />
          <Detail label="Position" value={user.position || "—"} />
          <Detail label="Department" value={user.department?.name || "—"} />
          <Detail label="Section" value={user.section?.name || "—"} />
          <Detail label="Phone" value={user.phone || "—"} />
          <Detail label="Account created" value={formatDate(user.created_at)} />
          <Detail label="Password last set by admin" value={formatDateTime(user.password_set_at)} />
          <Detail label="Password last changed by user" value={formatDateTime(user.password_changed_at)} />
          <Detail label="Last sign-in" value={formatDateTime(user.last_login_at || authAccount?.lastSignInAt)} />
          <Detail label="Sign-in account" value={user.auth_user_id ? "Linked" : "Not linked"} />
        </div>

        <div className="flex flex-wrap gap-2">
          {user.archived_at ? (
            <Badge tone="amber">Archived {formatDate(user.archived_at)}</Badge>
          ) : user.is_active ? (
            <Badge tone="green">Active</Badge>
          ) : (
            <Badge tone="slate">Inactive</Badge>
          )}
          {user.is_protected && <Badge tone="slate">Protected technical account</Badge>}
          {user.must_change_password && <Badge tone="red">Must change password</Badge>}
        </div>

        {user.archive_reason && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="font-semibold">Archive reason: </span>
            {user.archive_reason}
          </div>
        )}

        <div>
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <ClipboardCheck className="h-4 w-4 text-png-red" />
            Historical footprint
          </p>
          {activity === null ? (
            <p className="text-sm text-slate-500">Activity summary is unavailable in this environment.</p>
          ) : activityEntries.length === 0 ? (
            <p className="text-sm text-slate-500">
              No transactions recorded. This account can be permanently deleted.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              {activityEntries.map(([key, value]) => (
                <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <p className="text-lg font-bold text-slate-900">{String(value)}</p>
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">{key.replace(/_/g, " ")}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  )
}

function IssuedPasswordModal({
  issued,
  onClose,
}: {
  issued: { email: string; password: string }
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  return (
    <ModalShell
      title="Temporary password issued"
      subtitle={issued.email}
      width="max-w-lg"
      onClose={onClose}
      footer={
        <button
          onClick={onClose}
          className="rounded-lg bg-png-red px-4 py-2 text-sm font-medium text-white hover:bg-png-maroon"
        >
          I have recorded it
        </button>
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            This is the only time the password is shown. Hand it over through a separate secure channel — never by the
            same email that carries the sign-in link.
          </p>
        </div>

        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-900 px-4 py-3">
          <code className="flex-1 break-all font-mono text-sm text-slate-100">{issued.password}</code>
          <button
            onClick={async () => {
              const ok = await copyText(issued.password)
              setCopied(ok)
              window.setTimeout(() => setCopied(false), 2500)
            }}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-white/20"
          >
            {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <p className="flex items-start gap-1.5 text-xs text-slate-500">
          <RefreshCw className="mt-0.5 h-3 w-3 shrink-0" />
          The officer is taken to the Set New Password screen at first sign-in and cannot reach any NJSS module until
          they replace this password.
        </p>
      </div>
    </ModalShell>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 break-words text-sm text-slate-800">{value}</p>
    </div>
  )
}

function AdminTabQuerySync({ onTabChange }: { onTabChange: (tab: AdminTab) => void }) {
  const searchParams = useSearchParams()

  useEffect(() => {
    const tab = searchParams.get("tab")
    if (tab && ADMIN_TABS.includes(tab as AdminTab)) onTabChange(tab as AdminTab)
  }, [onTabChange, searchParams])

  return null
}
