"use client"

import { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { AuthUser } from '@/lib/auth'
import { authFetch } from '@/lib/auth-fetch'
import type { Permission } from '@/lib/permissions'
import type { RbacDataScope, RbacMenuItem, RbacModule } from '@/lib/rbac/types'
import {
  canAccessRecord,
  canPerformAction,
  canPerformAllActions,
  canPerformAnyAction,
  loadRbacModules,
  loadRbacNavigation,
  logAccessEvent,
} from '@/lib/rbac/client'

// Authentication is provided exclusively by Supabase Auth. RBAC profile, roles,
// permissions, menus and data scopes are loaded from the database after login.

type AuthContextType = {
  user: User | null
  profile: AuthUser | null
  role: string
  roles: string[]
  permissions: string[]
  scopes: RbacDataScope[]
  menus: RbacMenuItem[]
  modules: RbacModule[]
  can: (perm: Permission) => boolean
  canAny: (perms: Permission[]) => boolean
  canAll: (perms: Permission[]) => boolean
  canOnRecord: (perm: Permission, record: Parameters<typeof canAccessRecord>[1]) => boolean
  loading: boolean
  /** true only after the database-backed profile, permissions and scopes have resolved. */
  accessReady: boolean
  /** null while unknown, true when an administrator-issued password is still in force. */
  mustChangePassword: boolean | null
  refreshPasswordState: () => Promise<void>
  /** Deprecated compatibility flag; always false because placeholder login is disabled. */
  isTestingFallback: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

type ServerAccessResponse = {
  userId: string
  authUserId?: string | null
  email: string
  name: string
  roles?: Array<{ id: string; name: string }>
  roleNames?: string[]
  permissions?: string[]
  scopes?: RbacDataScope[]
  departmentId?: string | null
  sectionId?: string | null
}

const FALLBACK_ROLE = 'Executive Viewer'

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  role: '',
  roles: [],
  permissions: [],
  scopes: [],
  menus: [],
  modules: [],
  can: () => false,
  canAny: () => false,
  canAll: () => false,
  canOnRecord: () => false,
  loading: true,
  accessReady: false,
  mustChangePassword: null,
  refreshPasswordState: async () => {},
  isTestingFallback: false,
  signOut: async () => {},
  refreshProfile: async () => {},
})

async function fetchServerAccess(authUser: User, fallbackEmail: string) {
  const response = await authFetch('/api/account/access')
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || 'Unable to load account access.')
  }

  const access = (await response.json()) as ServerAccessResponse
  const roleNames = access.roleNames?.length
    ? access.roleNames
    : (access.roles || []).map((role) => role.name).filter(Boolean)
  const effectiveRoles = roleNames.length ? roleNames : [FALLBACK_ROLE]

  const profile: AuthUser = {
    id: access.userId,
    authUserId: access.authUserId || authUser.id,
    email: access.email || fallbackEmail,
    name: access.name || fallbackEmail.split('@')[0] || 'User',
    role: effectiveRoles[0],
    roles: effectiveRoles,
    roleIds: (access.roles || []).map((role) => role.id),
    departmentId: access.departmentId ?? null,
    sectionId: access.sectionId ?? null,
  }

  return {
    profile,
    permissions: access.permissions || [],
    scopes: access.scopes || [],
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<AuthUser | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [scopes, setScopes] = useState<RbacDataScope[]>([])
  const [menus, setMenus] = useState<RbacMenuItem[]>([])
  const [modules, setModules] = useState<RbacModule[]>([])
  const [loading, setLoading] = useState(true)
  const [accessReady, setAccessReady] = useState(false)
  const [mustChangePassword, setMustChangePassword] = useState<boolean | null>(null)

  const loadPasswordState = async () => {
    try {
      const res = await authFetch('/api/account/password')
      if (!res.ok) {
        setMustChangePassword(false)
        return
      }
      const json = await res.json()
      setMustChangePassword(Boolean(json.mustChangePassword))
    } catch {
      // Never block the session on this check.
      setMustChangePassword(false)
    }
  }

  useEffect(() => {
    // Navigation metadata is authenticated-only (migrations 016/029 revoke anon
    // access), so skip the round-trip entirely when there is no session and clear
    // any menus left over from a previous one.
    if (!user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMenus([])
      setModules([])
      return
    }
    loadRbacNavigation(permissions).then(setMenus)
    loadRbacModules().then(setModules)
  }, [permissions, user])

  useEffect(() => {
    let mounted = true

    const loadAccessContext = async (authUser: User, fallbackEmail: string) => {
      setAccessReady(false)
      try {
        const access = await fetchServerAccess(authUser, fallbackEmail)
        if (!mounted) return
        setProfile(access.profile)
        setPermissions(access.permissions)
        setScopes(access.scopes)
      } catch (error) {
        if (!mounted) return
        console.warn('Server RBAC access load failed:', error)
        setPermissions([])
        setScopes([])
      } finally {
        if (mounted) setAccessReady(true)
      }
    }

    async function loadSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!mounted) return

      if (session?.user) {
        setAccessReady(false)
        setUser(session.user)
        setProfile({
          id: session.user.id,
          authUserId: session.user.id,
          email: session.user.email || '',
          name: session.user.email?.split('@')[0] || 'User',
          role: 'Staff',
          roles: ['Staff'],
        })
        setLoading(false)
        loadAccessContext(session.user, session.user.email || '').catch((error) =>
          console.warn('RBAC profile load failed:', error),
        )
        loadPasswordState().catch((error) => console.warn('Password state load failed:', error))
      } else {
        setUser(null)
        setProfile(null)
        setPermissions([])
        setScopes([])
        setAccessReady(true)
        setMustChangePassword(null)
        setLoading(false)
      }
    }

    loadSession()

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return

      if (session?.user) {
        setAccessReady(false)
        setUser(session.user)
        setProfile({
          id: session.user.id,
          authUserId: session.user.id,
          email: session.user.email || '',
          name: session.user.email?.split('@')[0] || 'User',
          role: 'Staff',
          roles: ['Staff'],
        })
        setLoading(false)
        loadAccessContext(session.user, session.user.email || '').catch((error) =>
          console.warn('RBAC profile load failed:', error),
        )
        loadPasswordState().catch((error) => console.warn('Password state load failed:', error))
      } else {
        setUser(null)
        setProfile(null)
        setPermissions([])
        setScopes([])
        setAccessReady(true)
        setMustChangePassword(null)
      }

      setLoading(false)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const role = profile?.role || ''
  const roles = profile?.roles?.length ? profile.roles : role ? [role] : []
  const can = (perm: Permission) => canPerformAction(permissions, perm)
  const canAny = (perms: Permission[]) => canPerformAnyAction(permissions, perms)
  const canAll = (perms: Permission[]) => canPerformAllActions(permissions, perms)
  const canOnRecord = (perm: Permission, record: Parameters<typeof canAccessRecord>[1]) =>
    can(perm) &&
    !!profile &&
    canAccessRecord(
      {
        userId: profile.id,
        departmentId: profile.departmentId,
        sectionId: profile.sectionId,
        scopes,
        permissions,
      },
      record,
    )

  const handleSignOut = async () => {
    try {
      if (profile) {
        await logAccessEvent({
          userId: profile.id,
          userEmail: profile.email,
          userName: profile.name,
          action: 'LOGOUT',
          module: 'AUTH',
        })
      }
      await supabase.auth.signOut()
    } finally {
      setUser(null)
      setProfile(null)
      setPermissions([])
      setScopes([])
      setAccessReady(true)
      setMustChangePassword(null)
      if (typeof window !== 'undefined') window.location.href = '/login'
    }
  }

  const refreshProfile = async () => {
    if (!user) return

    setAccessReady(false)
    try {
      const access = await fetchServerAccess(user, user.email || '')
      setProfile(access.profile)
      setPermissions(access.permissions)
      setScopes(access.scopes)
    } catch (error) {
      console.warn('Server RBAC refresh failed:', error)
      setPermissions([])
      setScopes([])
    } finally {
      setAccessReady(true)
    }
  }

  const refreshPasswordState = async () => {
    await loadPasswordState()
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role,
        roles,
        permissions,
        scopes,
        menus,
        modules,
        can,
        canAny,
        canAll,
        canOnRecord,
        loading,
        accessReady,
        mustChangePassword,
        refreshPasswordState,
        isTestingFallback: false,
        signOut: handleSignOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
