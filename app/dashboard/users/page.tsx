"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  Users,
  Search,
  Edit,
  Shield,
  Mail,
  Building2,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
  UserPlus,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { authFetch } from "@/lib/auth-fetch"
import { useAuth } from "@/contexts/AuthContext"
import { AccessDenied } from "@/components/AccessDenied"
import type { DataScopeType, RbacMenuItem, RbacModule, RbacPermission } from "@/lib/rbac/types"

type User = {
  id: string
  email: string
  full_name: string | null
  is_active: boolean
  created_at: string
  department: { name: string } | null
  user_roles: Array<{ role: { id: string; name: string } }>
}

type Role = {
  id: string
  name: string
  description: string | null
}

type Department = {
  id: string
  name: string
}

type RolePermissionRow = { role_id: string; permission: string; is_allowed: boolean }
type RoleScopeRow = { role_id: string; scope_type: DataScopeType }
type AdminTab = "users" | "roles" | "permissions" | "modules" | "scope" | "audit"
const ADMIN_TABS: AdminTab[] = ["users", "roles", "permissions", "modules", "scope", "audit"]

type UserFormData = {
  email: string
  full_name: string
  department_id: string
  role_ids: string[]
  is_active: boolean
}

const DATA_SCOPE_OPTIONS: Array<{ value: DataScopeType; label: string; description: string }> = [
  { value: "OWN_RECORDS", label: "Own Records", description: "Only records created by or assigned to the user" },
  { value: "OWN_DIVISION", label: "Own Division", description: "Records in the user's assigned division" },
  { value: "OWN_BRANCH", label: "Own Branch", description: "Records in the user's assigned branch" },
  { value: "OWN_PROVINCE", label: "Own Province", description: "Records in the user's province" },
  { value: "DEPARTMENT_WIDE", label: "Department-wide", description: "All records in the user's department" },
  { value: "SYSTEM_WIDE", label: "System-wide", description: "All records across NJSS" },
]

export default function UsersPage() {
  const { can, canAny } = useAuth()
  const [activeTab, setActiveTab] = useState<AdminTab>("users")
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<User[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [permissions, setPermissions] = useState<RbacPermission[]>([])
  const [rolePermissions, setRolePermissions] = useState<RolePermissionRow[]>([])
  const [rbacModules, setRbacModules] = useState<RbacModule[]>([])
  const [rbacMenus, setRbacMenus] = useState<RbacMenuItem[]>([])
  const [roleScopes, setRoleScopes] = useState<RoleScopeRow[]>([])
  const [selectedRoleId, setSelectedRoleId] = useState("")
  const [roleForm, setRoleForm] = useState({
    name: "",
    description: "",
    data_scope_type: "OWN_RECORDS" as DataScopeType,
  })

  const [formData, setFormData] = useState<UserFormData>({
    email: "",
    full_name: "",
    department_id: "",
    role_ids: [],
    is_active: true,
  })

  const fetchData = useCallback(async () => {
    try {
      const [usersRes, rolesRes, deptsRes, rbacRes] = await Promise.all([
        supabase
          .from("users")
          .select(`
            id,
            email,
            full_name,
            is_active,
            created_at,
            department:departments(name),
            user_roles(role:roles(id, name))
          `)
          .order("created_at", { ascending: false }),
        supabase.from("roles").select("id, name, description").eq("is_active", true).order("name"),
        supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
        authFetch("/api/rbac").then((res) => (res.ok ? res.json() : null)).catch(() => null),
      ])

      setUsers((usersRes.data || []) as unknown as User[])
      setRoles(rolesRes.data || [])
      setDepartments(deptsRes.data || [])

      if (rbacRes) {
        setPermissions(rbacRes.permissions || [])
        setRolePermissions(rbacRes.rolePermissions || [])
        setRbacModules(rbacRes.modules || [])
        setRbacMenus(rbacRes.menus || [])
        setRoleScopes(rbacRes.roleScopes || [])
        if (!selectedRoleId && rbacRes.roles?.[0]?.id) setSelectedRoleId(rbacRes.roles[0].id)
      }
    } catch (err) {
      console.error("Error loading users:", err)
      setError("Failed to load users")
    } finally {
      setLoading(false)
    }
  }, [selectedRoleId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData()
  }, [fetchData])

  const filteredUsers = users.filter((user) => {
    if (!searchQuery) return true
    const search = searchQuery.toLowerCase()
    return (
      user.email.toLowerCase().includes(search) ||
      user.full_name?.toLowerCase().includes(search) ||
      user.department?.name.toLowerCase().includes(search)
    )
  })

  const resetForm = () => {
    setFormData({
      email: "",
      full_name: "",
      department_id: "",
      role_ids: [],
      is_active: true,
    })
  }

  const toggleRole = (roleId: string) => {
    setFormData((prev) => ({
      ...prev,
      role_ids: prev.role_ids.includes(roleId) ? prev.role_ids.filter((id) => id !== roleId) : [...prev.role_ids, roleId],
    }))
  }

  const handleAddUser = async () => {
    setError("")
    setSuccess("")

    if (!formData.email || !formData.full_name) {
      setError("Email and full name are required")
      return
    }

    try {
      const { data: newUser, error: userError } = await supabase
        .from("users")
        .insert({
          email: formData.email,
          full_name: formData.full_name,
          department_id: formData.department_id || null,
          is_active: formData.is_active,
        })
        .select()
        .single()

      if (userError) throw userError

      if (formData.role_ids.length > 0) {
        const roleAssignments = formData.role_ids.map((roleId) => ({
          user_id: newUser.id,
          role_id: roleId,
        }))

        const { error: roleError } = await supabase.from("user_roles").insert(roleAssignments)
        if (roleError) throw roleError
      }

      setSuccess("User created successfully!")
      setShowAddModal(false)
      resetForm()
      fetchData()
    } catch (err: unknown) {
      console.error("Error creating user:", err)
      setError(err instanceof Error ? err.message : "Failed to create user")
    }
  }

  const handleUpdateUser = async () => {
    if (!selectedUser) return
    setError("")
    setSuccess("")

    try {
      const { error: userError } = await supabase
        .from("users")
        .update({
          full_name: formData.full_name,
          department_id: formData.department_id || null,
          is_active: formData.is_active,
        })
        .eq("id", selectedUser.id)

      if (userError) throw userError

      await supabase.from("user_roles").delete().eq("user_id", selectedUser.id)

      if (formData.role_ids.length > 0) {
        const roleAssignments = formData.role_ids.map((roleId) => ({
          user_id: selectedUser.id,
          role_id: roleId,
        }))

        const { error: roleError } = await supabase.from("user_roles").insert(roleAssignments)
        if (roleError) throw roleError
      }

      setSuccess("User updated successfully!")
      setShowEditModal(false)
      setSelectedUser(null)
      resetForm()
      fetchData()
    } catch (err: unknown) {
      console.error("Error updating user:", err)
      setError(err instanceof Error ? err.message : "Failed to update user")
    }
  }

  const handleToggleActive = async (user: User) => {
    try {
      const { error } = await supabase.from("users").update({ is_active: !user.is_active }).eq("id", user.id)
      if (error) throw error
      fetchData()
    } catch (err) {
      console.error("Error toggling user status:", err)
    }
  }

  const openEditModal = (user: User) => {
    setSelectedUser(user)
    setFormData({
      email: user.email,
      full_name: user.full_name || "",
      department_id: "",
      role_ids: user.user_roles.map((ur) => ur.role.id),
      is_active: user.is_active,
    })
    setShowEditModal(true)
  }

  const rolePermissionSet = (roleId: string) =>
    new Set(
      rolePermissions
        .filter((row) => row.role_id === roleId && row.is_allowed)
        .map((row) => row.permission),
    )

  const toggleRolePermission = async (roleId: string, permission: string) => {
    const current = rolePermissionSet(roleId)
    const next = current.has(permission) ? Array.from(current).filter((code) => code !== permission) : [...Array.from(current), permission]

    setRolePermissions((prev) => [...prev.filter((row) => row.role_id !== roleId), ...next.map((code) => ({ role_id: roleId, permission: code, is_allowed: true }))])

    const res = await authFetch("/api/rbac", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save-role-permissions", roleId, permissions: next }),
    })
    if (!res.ok) {
      setError("Unable to save permission change")
      fetchData()
    }
  }

  const handleCreateRole = async () => {
    setError("")
    setSuccess("")
    const res = await authFetch("/api/rbac", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-role", role: roleForm }),
    })
    const json = await res.json()
    if (!res.ok) {
      setError(json.error || "Unable to create role")
      return
    }
    setSuccess("Role created successfully")
    setRoleForm({ name: "", description: "", data_scope_type: "OWN_RECORDS" })
    fetchData()
  }

  const handleScopeChange = async (roleId: string, scopeType: DataScopeType) => {
    setRoleScopes((prev) => [...prev.filter((row) => row.role_id !== roleId), { role_id: roleId, scope_type: scopeType }])
    const res = await authFetch("/api/rbac", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save-role-scope", roleId, scopeType }),
    })
    if (!res.ok) {
      setError("Unable to save data scope")
      fetchData()
    }
  }

  if (!canAny(["users.manage", "roles.manage", "permissions.manage", "modules.manage", "data_scope.manage", "audit.view"])) {
    return <AccessDenied title="Access Control" />
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Suspense fallback={null}>
        <AdminTabQuerySync onTabChange={setActiveTab} />
      </Suspense>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-png-red">Administration</p>
          <h1 className="text-2xl font-bold text-slate-900">Access Control</h1>
          <p className="text-slate-600 mt-1">
            Configure users, roles, permissions, module access, data scope and access audit controls
          </p>
        </div>
        {activeTab === "users" && can("users.manage") && (
          <button
            onClick={() => {
              resetForm()
              setShowAddModal(true)
            }}
            className="px-4 py-2 bg-png-red text-white rounded-lg font-medium hover:bg-png-maroon flex items-center gap-2"
          >
            <UserPlus className="h-4 w-4" />
            Add User
          </button>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-1 flex flex-wrap gap-1">
        {[
          ["users", "Users"],
          ["roles", "Roles"],
          ["permissions", "Role Permissions"],
          ["modules", "Module Access"],
          ["scope", "Data Scope"],
          ["audit", "Access Audit"],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as AdminTab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === key ? "bg-png-red text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 mt-0.5" />
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
          <p className="text-green-700">{success}</p>
        </div>
      )}

      {activeTab === "users" && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Users" value={users.length} icon={<Users className="h-5 w-5" />} />
            <StatCard
              label="Active"
              value={users.filter((u) => u.is_active).length}
              icon={<CheckCircle2 className="h-5 w-5 text-green-600" />}
            />
            <StatCard
              label="Inactive"
              value={users.filter((u) => !u.is_active).length}
              icon={<XCircle className="h-5 w-5 text-red-600" />}
            />
            <StatCard label="Roles" value={roles.length} icon={<Shield className="h-5 w-5 text-purple-600" />} />
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name, email, or department..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">User</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Department</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Roles</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Created</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-700 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                            <span className="text-sm font-semibold text-blue-600">
                              {user.full_name
                                ?.split(" ")
                                .map((n) => n[0])
                                .join("")
                                .toUpperCase() || user.email.slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-slate-900">{user.full_name || "No Name"}</p>
                            <p className="text-sm text-slate-500">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{user.department?.name || "-"}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {user.user_roles.map((ur, i) => (
                            <span key={i} className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                              {ur.role.name}
                            </span>
                          ))}
                          {user.user_roles.length === 0 && <span className="text-sm text-slate-400">No roles</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleActive(user)}
                          className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                            user.is_active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                          }`}
                        >
                          {user.is_active ? "Active" : "Inactive"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">
                        {new Date(user.created_at).toLocaleDateString("en-GB")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button onClick={() => openEditModal(user)} className="p-2 hover:bg-slate-100 rounded" title="Edit">
                          <Edit className="h-4 w-4 text-slate-600" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
              <Shield className="h-5 w-5 text-purple-600" />
              Available Roles
            </h2>
            <div className="grid md:grid-cols-3 gap-4">
              {roles.map((role) => (
                <div key={role.id} className="p-3 bg-slate-50 rounded-lg">
                  <p className="font-medium text-slate-900">{role.name}</p>
                  <p className="text-sm text-slate-600 mt-1">{role.description || "No description"}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {activeTab === "roles" && (
        <div className="grid lg:grid-cols-[360px_1fr] gap-6">
          <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Create Configurable Role</h2>
            <input
              value={roleForm.name}
              onChange={(e) => setRoleForm((p) => ({ ...p, name: e.target.value }))}
              placeholder="Budget Officer"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg"
            />
            <textarea
              value={roleForm.description}
              onChange={(e) => setRoleForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Role description"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg"
              rows={3}
            />
            <select
              value={roleForm.data_scope_type}
              onChange={(e) => setRoleForm((p) => ({ ...p, data_scope_type: e.target.value as DataScopeType }))}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg"
            >
              {DATA_SCOPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleCreateRole}
              disabled={!can("roles.manage")}
              className="w-full px-4 py-2 bg-png-red text-white rounded-lg font-medium disabled:opacity-50"
            >
              Create Role
            </button>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left p-3 text-xs uppercase">Role</th>
                  <th className="text-left p-3 text-xs uppercase">Description</th>
                  <th className="text-left p-3 text-xs uppercase">Default Scope</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {roles.map((role) => (
                  <tr key={role.id}>
                    <td className="p-3 font-medium">{role.name}</td>
                    <td className="p-3 text-sm text-slate-600">{role.description || "-"}</td>
                    <td className="p-3 text-sm">{roleScopes.find((s) => s.role_id === role.id)?.scope_type || "OWN_RECORDS"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "permissions" && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-3">
            <Shield className="h-5 w-5 text-png-red" />
            <h2 className="font-semibold text-slate-900">Permission Matrix</h2>
            <select
              value={selectedRoleId || roles[0]?.id || ""}
              onChange={(e) => setSelectedRoleId(e.target.value)}
              className="ml-auto px-3 py-2 border border-slate-200 rounded-lg text-sm"
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="p-3 text-left">Module / Function</th>
                  {["view", "create", "edit", "delete", "submit", "verify", "approve", "reject", "print", "export", "manage"].map(
                    (action) => (
                      <th key={action} className="p-3 text-center capitalize">
                        {action}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {Object.entries(
                  permissions.reduce<Record<string, RbacPermission[]>>((acc, permission) => {
                    ;(acc[permission.module_code] ||= []).push(permission)
                    return acc
                  }, {}),
                ).map(([moduleCode, modulePermissions]) =>
                  modulePermissions.map((permission, index) => {
                    const roleId = selectedRoleId || roles[0]?.id || ""
                    const assigned = rolePermissionSet(roleId).has(permission.code)
                    return (
                      <tr key={permission.code} className={assigned ? "bg-green-50/30" : ""}>
                        <td className="p-3">
                          <div className="font-medium text-slate-900">{index === 0 ? moduleCode.replace("_", " ").toUpperCase() : ""}</div>
                          <div className="text-slate-600">{permission.label}</div>
                          <div className="text-xs text-slate-400 font-mono">{permission.code}</div>
                        </td>
                        {["view", "create", "edit", "delete", "submit", "verify", "approve", "reject", "print", "export", "manage"].map(
                          (action) => (
                            <td key={action} className="p-3 text-center">
                              {permission.action === action || (permission.code === "all" && action === "manage") ? (
                                <input
                                  type="checkbox"
                                  checked={assigned}
                                  disabled={!can("permissions.manage")}
                                  onChange={() => toggleRolePermission(roleId, permission.code)}
                                  className="h-4 w-4"
                                />
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          ),
                        )}
                      </tr>
                    )
                  }),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "modules" && (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="font-semibold mb-4">Registered Modules</h2>
            <div className="space-y-3">
              {rbacModules.map((module) => (
                <div key={module.code} className="p-3 border border-slate-200 rounded-lg">
                  <div className="font-medium">{module.name}</div>
                  <div className="text-sm text-slate-500">{module.base_path}</div>
                  <div className="text-xs text-slate-400 mt-1">{module.is_active ? "Active" : "Inactive"}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-6">
            <h2 className="font-semibold mb-4">Permission-Driven Menus</h2>
            <div className="space-y-3">
              {rbacMenus.map((menu) => (
                <div key={menu.code} className="p-3 border border-slate-200 rounded-lg">
                  <div className="font-medium">{menu.label}</div>
                  <div className="text-sm text-slate-500">{menu.href}</div>
                  <div className="text-xs text-slate-400 mt-1">Requires: {menu.required_permissions?.join(", ") || "none"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === "scope" && (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="p-3 text-left text-xs uppercase">Role</th>
                <th className="p-3 text-left text-xs uppercase">Data Scope</th>
                <th className="p-3 text-left text-xs uppercase">Meaning</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {roles.map((role) => {
                const current = roleScopes.find((scope) => scope.role_id === role.id)?.scope_type || "OWN_RECORDS"
                const option = DATA_SCOPE_OPTIONS.find((item) => item.value === current)
                return (
                  <tr key={role.id}>
                    <td className="p-3 font-medium">{role.name}</td>
                    <td className="p-3">
                      <select
                        value={current}
                        disabled={!can("data_scope.manage")}
                        onChange={(e) => handleScopeChange(role.id, e.target.value as DataScopeType)}
                        className="px-3 py-2 border border-slate-200 rounded-lg"
                      >
                        {DATA_SCOPE_OPTIONS.map((scope) => (
                          <option key={scope.value} value={scope.value}>
                            {scope.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-3 text-sm text-slate-600">{option?.description}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === "audit" && (
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-2">Access Audit</h2>
          <p className="text-slate-600 text-sm mb-4">
            Login, logout, unauthorized access attempts, role assignments, permission changes and administrative changes are written to the
            immutable audit log.
          </p>
          <a href="/dashboard/audit-log" className="inline-flex px-4 py-2 rounded-lg bg-slate-900 text-white font-medium">
            Open Audit Log
          </a>
        </div>
      )}

      {showAddModal && (
        <Modal title="Add New User" onClose={() => setShowAddModal(false)} onSubmit={handleAddUser} submitText="Create User">
          <UserForm
            formData={formData}
            setFormData={setFormData}
            roles={roles}
            departments={departments}
            toggleRole={toggleRole}
            isEdit={false}
          />
        </Modal>
      )}

      {showEditModal && selectedUser && (
        <Modal
          title="Edit User"
          onClose={() => {
            setShowEditModal(false)
            setSelectedUser(null)
          }}
          onSubmit={handleUpdateUser}
          submitText="Save Changes"
        >
          <UserForm
            formData={formData}
            setFormData={setFormData}
            roles={roles}
            departments={departments}
            toggleRole={toggleRole}
            isEdit={true}
          />
        </Modal>
      )}
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

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium text-slate-600 uppercase">{label}</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
        </div>
        <div className="p-2 bg-slate-100 rounded-lg">{icon}</div>
      </div>
    </div>
  )
}

function Modal({
  title,
  onClose,
  onSubmit,
  submitText,
  children,
}: {
  title: string
  onClose: () => void
  onSubmit: () => void
  submitText: string
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        </div>
        <div className="p-6">{children}</div>
        <div className="p-6 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button onClick={onSubmit} className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700">
            {submitText}
          </button>
        </div>
      </div>
    </div>
  )
}

function UserForm({
  formData,
  setFormData,
  roles,
  departments,
  toggleRole,
  isEdit,
}: {
  formData: UserFormData
  setFormData: React.Dispatch<React.SetStateAction<UserFormData>>
  roles: Role[]
  departments: Department[]
  toggleRole: (roleId: string) => void
  isEdit: boolean
}) {
  const updateForm = (patch: Partial<UserFormData>) => setFormData((prev) => ({ ...prev, ...patch }))

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Email Address <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="email"
            value={formData.email}
            onChange={(e) => updateForm({ email: e.target.value })}
            disabled={isEdit}
            placeholder="user@pngjudiciary.gov.pg"
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Full Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          value={formData.full_name}
          onChange={(e) => updateForm({ full_name: e.target.value })}
          placeholder="John Doe"
          className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Department</label>
        <div className="relative">
          <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <select
            value={formData.department_id}
            onChange={(e) => updateForm({ department_id: e.target.value })}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select Department</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">Assign Roles</label>
        <div className="grid grid-cols-2 gap-2">
          {roles.map((role) => (
            <label
              key={role.id}
              className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                formData.role_ids.includes(role.id) ? "border-purple-500 bg-purple-50" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <input
                type="checkbox"
                checked={formData.role_ids.includes(role.id)}
                onChange={() => toggleRole(role.id)}
                className="h-4 w-4 text-purple-600 rounded"
              />
              <span className="text-sm">{role.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={formData.is_active}
            onChange={(e) => updateForm({ is_active: e.target.checked })}
            className="h-4 w-4 text-blue-600 rounded"
          />
          <span className="text-sm font-medium text-slate-700">User is active</span>
        </label>
      </div>
    </div>
  )
}
