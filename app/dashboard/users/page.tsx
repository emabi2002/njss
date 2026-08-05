"use client"

import { useState, useEffect } from "react"
import {
  Users, Plus, Search, Edit, Trash2, Shield, Mail, Building2,
  CheckCircle2, XCircle, Loader2, AlertCircle, UserPlus, Key
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/AuthContext"
import { AccessDenied } from "@/components/AccessDenied"

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

export default function UsersPage() {
  const { can } = useAuth()
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

  // Form state
  const [formData, setFormData] = useState({
    email: "",
    full_name: "",
    department_id: "",
    role_ids: [] as string[],
    is_active: true
  })

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const [usersRes, rolesRes, deptsRes] = await Promise.all([
        supabase
          .from('users')
          .select(`
            id,
            email,
            full_name,
            is_active,
            created_at,
            department:departments(name),
            user_roles(role:roles(id, name))
          `)
          .order('created_at', { ascending: false }),
        supabase
          .from('roles')
          .select('id, name, description')
          .eq('is_active', true)
          .order('name'),
        supabase
          .from('departments')
          .select('id, name')
          .eq('is_active', true)
          .order('name')
      ])

      setUsers((usersRes.data || []) as unknown as User[])
      setRoles(rolesRes.data || [])
      setDepartments(deptsRes.data || [])
    } catch (err) {
      console.error('Error fetching data:', err)
    } finally {
      setLoading(false)
    }
  }

  const filteredUsers = users.filter(user => {
    if (!searchQuery) return true
    const search = searchQuery.toLowerCase()
    return (
      user.email.toLowerCase().includes(search) ||
      user.full_name?.toLowerCase().includes(search) ||
      user.department?.name.toLowerCase().includes(search)
    )
  })

  const handleAddUser = async () => {
    setError("")
    setSuccess("")

    if (!formData.email || !formData.full_name) {
      setError("Email and full name are required")
      return
    }

    try {
      // Create user in users table
      const { data: newUser, error: userError } = await supabase
        .from('users')
        .insert({
          email: formData.email,
          full_name: formData.full_name,
          department_id: formData.department_id || null,
          is_active: formData.is_active
        })
        .select()
        .single()

      if (userError) throw userError

      // Assign roles
      if (formData.role_ids.length > 0) {
        const roleAssignments = formData.role_ids.map(roleId => ({
          user_id: newUser.id,
          role_id: roleId
        }))

        const { error: roleError } = await supabase
          .from('user_roles')
          .insert(roleAssignments)

        if (roleError) throw roleError
      }

      setSuccess("User created successfully!")
      setShowAddModal(false)
      resetForm()
      fetchData()
    } catch (err: unknown) {
      console.error('Error creating user:', err)
      setError(err instanceof Error ? err.message : 'Failed to create user')
    }
  }

  const handleUpdateUser = async () => {
    if (!selectedUser) return
    setError("")
    setSuccess("")

    try {
      // Update user
      const { error: userError } = await supabase
        .from('users')
        .update({
          full_name: formData.full_name,
          department_id: formData.department_id || null,
          is_active: formData.is_active
        })
        .eq('id', selectedUser.id)

      if (userError) throw userError

      // Update roles - delete existing and insert new
      await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', selectedUser.id)

      if (formData.role_ids.length > 0) {
        const roleAssignments = formData.role_ids.map(roleId => ({
          user_id: selectedUser.id,
          role_id: roleId
        }))

        const { error: roleError } = await supabase
          .from('user_roles')
          .insert(roleAssignments)

        if (roleError) throw roleError
      }

      setSuccess("User updated successfully!")
      setShowEditModal(false)
      setSelectedUser(null)
      resetForm()
      fetchData()
    } catch (err: unknown) {
      console.error('Error updating user:', err)
      setError(err instanceof Error ? err.message : 'Failed to update user')
    }
  }

  const handleToggleActive = async (user: User) => {
    try {
      const { error } = await supabase
        .from('users')
        .update({ is_active: !user.is_active })
        .eq('id', user.id)

      if (error) throw error
      fetchData()
    } catch (err) {
      console.error('Error toggling user status:', err)
    }
  }

  const openEditModal = (user: User) => {
    setSelectedUser(user)
    setFormData({
      email: user.email,
      full_name: user.full_name || "",
      department_id: "",
      role_ids: user.user_roles.map(ur => ur.role.id),
      is_active: user.is_active
    })
    setShowEditModal(true)
  }

  const resetForm = () => {
    setFormData({
      email: "",
      full_name: "",
      department_id: "",
      role_ids: [],
      is_active: true
    })
  }

  const toggleRole = (roleId: string) => {
    setFormData(prev => ({
      ...prev,
      role_ids: prev.role_ids.includes(roleId)
        ? prev.role_ids.filter(id => id !== roleId)
        : [...prev.role_ids, roleId]
    }))
  }

  if (!can('users.manage')) {
    return <AccessDenied title="User Management" />
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
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">User Management</h1>
          <p className="text-slate-600 mt-1">Manage system users and their roles</p>
        </div>
        <button
          onClick={() => {
            resetForm()
            setShowAddModal(true)
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 flex items-center gap-2"
        >
          <UserPlus className="h-4 w-4" />
          Add User
        </button>
      </div>

      {/* Messages */}
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

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={users.length} icon={<Users className="h-5 w-5" />} />
        <StatCard label="Active" value={users.filter(u => u.is_active).length} icon={<CheckCircle2 className="h-5 w-5 text-green-600" />} />
        <StatCard label="Inactive" value={users.filter(u => !u.is_active).length} icon={<XCircle className="h-5 w-5 text-red-600" />} />
        <StatCard label="Roles" value={roles.length} icon={<Shield className="h-5 w-5 text-purple-600" />} />
      </div>

      {/* Search */}
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

      {/* Users Table */}
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
                          {user.full_name?.split(' ').map(n => n[0]).join('').toUpperCase() || user.email.slice(0, 2).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{user.full_name || 'No Name'}</p>
                        <p className="text-sm text-slate-500">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {user.department?.name || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {user.user_roles.map((ur, i) => (
                        <span key={i} className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                          {ur.role.name}
                        </span>
                      ))}
                      {user.user_roles.length === 0 && (
                        <span className="text-sm text-slate-400">No roles</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(user)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        user.is_active
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {user.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {new Date(user.created_at).toLocaleDateString('en-GB')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => openEditModal(user)}
                      className="p-2 hover:bg-slate-100 rounded"
                      title="Edit"
                    >
                      <Edit className="h-4 w-4 text-slate-600" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Roles Reference */}
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-purple-600" />
          Available Roles
        </h2>
        <div className="grid md:grid-cols-3 gap-4">
          {roles.map((role) => (
            <div key={role.id} className="p-3 bg-slate-50 rounded-lg">
              <p className="font-medium text-slate-900">{role.name}</p>
              <p className="text-sm text-slate-600 mt-1">{role.description || 'No description'}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <Modal
          title="Add New User"
          onClose={() => setShowAddModal(false)}
          onSubmit={handleAddUser}
          submitText="Create User"
        >
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

      {/* Edit User Modal */}
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

function Modal({ title, onClose, onSubmit, submitText, children }: {
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
        <div className="p-6">
          {children}
        </div>
        <div className="p-6 border-t border-slate-200 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700"
          >
            {submitText}
          </button>
        </div>
      </div>
    </div>
  )
}

function UserForm({ formData, setFormData, roles, departments, toggleRole, isEdit }: {
  formData: { email: string; full_name: string; department_id: string; role_ids: string[]; is_active: boolean }
  setFormData: React.Dispatch<React.SetStateAction<typeof formData>>
  roles: Role[]
  departments: Department[]
  toggleRole: (roleId: string) => void
  isEdit: boolean
}) {
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
            onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
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
          onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
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
            onChange={(e) => setFormData(prev => ({ ...prev, department_id: e.target.value }))}
            className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select Department</option>
            {departments.map(dept => (
              <option key={dept.id} value={dept.id}>{dept.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Assign Roles
        </label>
        <div className="grid grid-cols-2 gap-2">
          {roles.map(role => (
            <label
              key={role.id}
              className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                formData.role_ids.includes(role.id)
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-slate-200 hover:bg-slate-50'
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
            onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
            className="h-4 w-4 text-blue-600 rounded"
          />
          <span className="text-sm font-medium text-slate-700">User is active</span>
        </label>
      </div>
    </div>
  )
}
