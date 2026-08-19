"use client"

import { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getUserProfile, type AuthUser } from '@/lib/auth'
import { authFetch } from '@/lib/auth-fetch'
import type { Permission } from '@/lib/permissions'
import type { RbacDataScope, RbacMenuItem, RbacModule } from '@/lib/rbac/types'
import {
  canAccessRecord,
  canPerformAction,
  canPerformAllActions,
  canPerformAnyAction,
  getUserDataScopes,
  getUserPermissions,
  getUserRoles,
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
  /** null while unknown, true when an administrator-issued password is still in force. */
  mustChangePassword: boolean | null
  refreshPasswordState: () => Promise<void>
  /** Deprecated compatibility flag; always false because placeholder login is disabled. */
  isTestingFallback: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

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
  mustChangePassword: null,
  refreshPasswordState: async () => {},
  isTestingFallback: false,
  signOut: async () => {},
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<AuthUser | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [scopes, setScopes] = useState<RbacDataScope[]>([])
  const [menus, setMenus] = useState<RbacMenuItem[]>([])
  const [modules, setModules] = useState<RbacModule[]>([])
  const [loading, setLoading] = useState(true)
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
      const p = await getUserProfile(authUser.id, fallbackEmail)
      if (!mounted || !p) return

      const roles = p.roles?.length ? p.roles : [p.role].filter(Boolean)
      const roleRows = await getUserRoles(p.id).catch(() => [])
      const effectivePermissions = await getUserPermissions(p.id)
      const effectiveScopes = await getUserDataScopes(
        p.id,
        roleRows.length ? roleRows : roles.map((name) => ({ id: name, name, description: null })),
      )

      if (!mounted) return
      setProfile(p)
      setPermissions(effectivePermissions)
      setScopes(effectiveScopes)
    }

    async function loadSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!mounted) return

      if (session?.user) {
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
        logAccessEvent({
          userId: session.user.id,
          userEmail: session.user.email,
          action: 'LOGIN',
          module: 'AUTH',
        }).catch((error) => console.warn('Login audit failed:', error))
      } else {
        setUser(null)
        setProfile(null)
        setPermissions([])
        setScopes([])
        setMustChangePassword(null)
        setLoading(false)
      }
    }

    loadSession()

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return

      if (session?.user) {
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
        if (event === 'SIGNED_IN') {
          logAccessEvent({
            userId: session.user.id,
            userEmail: session.user.email,
            action: 'LOGIN',
            module: 'AUTH',
          }).catch((error) => console.warn('Login audit failed:', error))
        }
      } else {
        setUser(null)
        setProfile(null)
        setPermissions([])
        setScopes([])
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
      setMustChangePassword(null)
      if (typeof window !== 'undefined') window.location.href = '/login'
    }
  }

  const refreshProfile = async () => {
    if (user) {
      const p = await getUserProfile(user.id, user.email || '')
      setProfile(p)
      if (p) {
        const roleNames = p.roles?.length ? p.roles : [p.role]
        const roleRows = await getUserRoles(p.id).catch(() => [])
        setPermissions(await getUserPermissions(p.id))
        setScopes(
          await getUserDataScopes(
            p.id,
            roleRows.length ? roleRows : roleNames.map((name) => ({ id: name, name, description: null })),
          ),
        )
      }
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
