import { supabase, isSupabaseNetworkEnabled } from './supabase'
import type { User, Session } from '@supabase/supabase-js'

export type AuthUser = {
  id: string
  email: string
  name: string
  role: string
  department?: string
  avatar?: string
}

const DEMO_PASSWORD = 'Crms@2025'
const DEMO_PROFILES: Record<string, AuthUser> = {
  'admin@pngjudiciary.gov.pg': {
    id: '50eade2c-8b50-47d5-ad6b-0fd05e6916f2',
    email: 'admin@pngjudiciary.gov.pg',
    name: 'System Administrator',
    role: 'System Administrator',
    department: 'National Judiciary Staff Services',
  },
  'finance@pngjudiciary.gov.pg': {
    id: 'demo-finance-manager',
    email: 'finance@pngjudiciary.gov.pg',
    name: 'Finance Manager',
    role: 'Finance Manager',
    department: 'Finance',
  },
  'depthead@pngjudiciary.gov.pg': {
    id: 'demo-department-head',
    email: 'depthead@pngjudiciary.gov.pg',
    name: 'Department Head',
    role: 'Department Head',
    department: 'Operations',
  },
  'section@pngjudiciary.gov.pg': {
    id: 'demo-section-head',
    email: 'section@pngjudiciary.gov.pg',
    name: 'Section Head',
    role: 'Section Head',
    department: 'Registry',
  },
  'approver@pngjudiciary.gov.pg': {
    id: 'demo-approver',
    email: 'approver@pngjudiciary.gov.pg',
    name: 'Approver',
    role: 'Approver',
    department: 'Approvals',
  },
  'officer@pngjudiciary.gov.pg': {
    id: 'demo-requisition-officer',
    email: 'officer@pngjudiciary.gov.pg',
    name: 'Requisition Officer',
    role: 'Requisition Officer',
    department: 'Registry',
  },
  'auditor@pngjudiciary.gov.pg': {
    id: 'demo-auditor',
    email: 'auditor@pngjudiciary.gov.pg',
    name: 'Auditor',
    role: 'Auditor',
    department: 'Internal Audit',
  },
  'exec@pngjudiciary.gov.pg': {
    id: 'demo-executive-management',
    email: 'exec@pngjudiciary.gov.pg',
    name: 'Executive Management',
    role: 'Executive Management',
    department: 'Executive',
  },
}

// Sign in with email and password
export async function signIn(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase()

  if (!isSupabaseNetworkEnabled) {
    const profile = DEMO_PROFILES[normalizedEmail]
    if (!profile || password !== DEMO_PASSWORD) {
      throw new Error('Invalid login credentials')
    }

    return {
      user: {
        id: profile.id,
        email: profile.email,
        app_metadata: { provider: 'offline-demo' },
        user_metadata: { full_name: profile.name },
        aud: 'authenticated',
        created_at: new Date(0).toISOString(),
      } as User,
      session: null,
      profile,
    }
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) throw error

  // Get user profile from our users table (optional - app works without it)
  let profile: AuthUser | null = null
  if (data.user) {
    // Always create a fallback profile first
    profile = {
      id: data.user.id,
      email: data.user.email || email,
      name: data.user.email?.split('@')[0] || email.split('@')[0] || 'User',
      role: 'Staff'
    }

    // Try to get enhanced profile from users table (non-blocking)
    try {
      const enhancedProfile = await getUserProfile(data.user.id, data.user.email || email)
      if (enhancedProfile) {
        profile = enhancedProfile
      }
    } catch (e) {
      console.log('Could not fetch enhanced user profile, using basic auth data:', e)
    }
  }

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
  email: string | null
  full_name: string | null
  department: { name: string } | null
  user_roles: Array<{ role: { name: string } | null }> | null
}

// Default role when a profile has no role assigned (least privilege).
const FALLBACK_ROLE = 'Executive Management'

// Get user profile (with department + role) from our users table.
export async function getUserProfile(userId: string, email: string): Promise<AuthUser | null> {
  const selectCols = 'id, email, full_name, department:departments(name), user_roles(role:roles(name))'

  const buildProfile = (row: UserRow): AuthUser => {
    const roleName = row.user_roles?.find((ur) => ur.role?.name)?.role?.name || FALLBACK_ROLE
    return {
      id: row.id,
      email: row.email || email,
      name: row.full_name || email.split('@')[0],
      role: roleName,
      department: row.department?.name,
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
    email,
    name: email.split('@')[0] || 'User',
    role: FALLBACK_ROLE,
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
