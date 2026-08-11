import { supabase } from './supabase'
import type { User, Session } from '@supabase/supabase-js'

export type AuthUser = {
  id: string
  authUserId?: string | null
  email: string
  name: string
  role: string
  roles?: string[]
  roleIds?: string[]
  department?: string
  departmentId?: string | null
  sectionId?: string | null
  avatar?: string
}

// Sign in with email and password through Supabase Auth only.
export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  })

  if (error) throw error

  // Return immediately after Supabase authentication. Profile/RBAC enrichment is
  // loaded by AuthContext from the database in the background.
  const profile: AuthUser | null = data.user
    ? {
        id: data.user.id,
        authUserId: data.user.id,
        email: data.user.email || email,
        name: data.user.email?.split('@')[0] || email.split('@')[0] || 'User',
        role: 'Staff',
        roles: ['Staff'],
      }
    : null

  return { user: data.user, session: data.session, profile }
}

// Sign out
export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

// Get current session
export async function getSession(): Promise<Session | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

// Get current user
export async function getCurrentUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

type UserRow = {
  id: string
  auth_user_id: string | null
  email: string | null
  full_name: string | null
  department_id: string | null
  section_id: string | null
  department: { name: string } | null
  user_roles: Array<{ role: { id: string; name: string } | null }> | null
}

// Default role when a profile has no role assigned (least privilege).
const FALLBACK_ROLE = 'Executive Viewer'

// Get user profile (with department + all assigned roles) from our users table.
export async function getUserProfile(userId: string, email: string): Promise<AuthUser | null> {
  const selectCols = 'id, auth_user_id, email, full_name, department_id, section_id, department:departments(name), user_roles(role:roles(id, name))'

  const buildProfile = (row: UserRow): AuthUser => {
    const assignedRoles = (row.user_roles || [])
      .map((ur) => ur.role)
      .filter((role): role is { id: string; name: string } => Boolean(role?.id && role.name))
    const roleNames = assignedRoles.map((role) => role.name)
    const primaryRole = roleNames[0] || FALLBACK_ROLE
    return {
      id: row.id,
      authUserId: row.auth_user_id,
      email: row.email || email,
      name: row.full_name || email.split('@')[0],
      role: primaryRole,
      roles: roleNames.length ? roleNames : [FALLBACK_ROLE],
      roleIds: assignedRoles.map((role) => role.id),
      department: row.department?.name,
      departmentId: row.department_id,
      sectionId: row.section_id,
    }
  }

  try {
    // Prefer matching by the linked auth user id
    const { data: byAuth } = await supabase
      .from('users')
      .select(selectCols)
      .eq('auth_user_id', userId)
      .limit(1)
      .maybeSingle()
    if (byAuth) return buildProfile(byAuth as unknown as UserRow)

    // Fall back to matching by email
    const { data: byEmail } = await supabase
      .from('users')
      .select(selectCols)
      .eq('email', email)
      .limit(1)
      .maybeSingle()
    if (byEmail) return buildProfile(byEmail as unknown as UserRow)
  } catch (e) {
    console.log('Users table query failed:', e)
  }

  // Fallback: minimal profile from the auth user
  return {
    id: userId,
    authUserId: userId,
    email,
    name: email.split('@')[0] || 'User',
    role: FALLBACK_ROLE,
    roles: [FALLBACK_ROLE],
  }
}

// Request password reset
export async function resetPassword(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/reset-password`,
  })
  if (error) throw error
}

// Update password
export async function updatePassword(newPassword: string) {
  const { error } = await supabase.auth.updateUser({
    password: newPassword,
  })
  if (error) throw error
}

// Subscribe to auth state changes
export function onAuthStateChange(callback: (user: User | null) => void) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user || null)
  })
}
