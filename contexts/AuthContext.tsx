"use client"

import { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase, isSupabaseNetworkEnabled } from '@/lib/supabase'
import { getUserProfile, type AuthUser } from '@/lib/auth'
import type { Permission } from '@/lib/permissions'
import type { RbacDataScope, RbacMenuItem } from '@/lib/rbac/types'
import {
  canAccessRecord,
  canPerformAction,
  canPerformAllActions,
  canPerformAnyAction,
  getUserDataScopes,
  getUserPermissions,
  getUserRoles,
  loadRbacNavigation,
  logAccessEvent,
} from '@/lib/rbac/client'

// ----------------------------------------------------------------------------
// TESTING MODE
// Mirrors the testing-mode bypass already used in `middleware.ts` and
// `app/page.tsx`. When there is no real Supabase session we fall back to a
// default "System Administrator" identity so the whole dashboard is usable and
// EVERY module is visible + routable without first logging in. A real login
// (any demo account) overrides this with that user's actual role/permissions.
// To return to strict auth, set TESTING_MODE to false and restore the redirects.
// ----------------------------------------------------------------------------
const TESTING_MODE = true

// Use the real "System Administrator" auth user id so id-keyed features
// (notifications, realtime, etc.) behave exactly like a genuine admin login.
const TESTING_ADMIN_ID = '50eade2c-8b50-47d5-ad6b-0fd05e6916f2'

const TESTING_USER = {
  id: TESTING_ADMIN_ID,
  email: 'admin@pngjudiciary.gov.pg',
  app_metadata: { provider: 'testing' },
  user_metadata: { full_name: 'System Administrator' },
  aud: 'authenticated',
  created_at: new Date(0).toISOString(),
} as unknown as User

const TESTING_PROFILE: AuthUser = {
  id: TESTING_ADMIN_ID,
  authUserId: TESTING_ADMIN_ID,
  email: 'admin@pngjudiciary.gov.pg',
  name: 'System Administrator',
  role: 'System Administrator',
  roles: ['System Administrator'],
  department: 'National Judiciary Staff Services',
}

type AuthContextType = {
  user: User | null
  profile: AuthUser | null
  role: string
  roles: string[]
  permissions: string[]
  scopes: RbacDataScope[]
  menus: RbacMenuItem[]
  can: (perm: Permission) => boolean
  canAny: (perms: Permission[]) => boolean
  canAll: (perms: Permission[]) => boolean
  canOnRecord: (perm: Permission, record: Parameters<typeof canAccessRecord>[1]) => boolean
  loading: boolean
  /** True when the current identity is the testing-mode placeholder (no real login). */
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
  can: () => false,
  canAny: () => false,
  canAll: () => false,
  canOnRecord: () => false,
  loading: true,
  isTestingFallback: false,
  signOut: async () => {},
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const useOfflineTestingFallback = TESTING_MODE && !isSupabaseNetworkEnabled
  const [user, setUser] = useState<User | null>(useOfflineTestingFallback ? TESTING_USER : null)
  const [profile, setProfile] = useState<AuthUser | null>(useOfflineTestingFallback ? TESTING_PROFILE : null)
  const [permissions, setPermissions] = useState<string[]>(useOfflineTestingFallback ? ['all'] : [])
  const [scopes, setScopes] = useState<RbacDataScope[]>(useOfflineTestingFallback ? [{ scope_type: 'SYSTEM_WIDE' } as RbacDataScope] : [])
  const [menus, setMenus] = useState<RbacMenuItem[]>([])
  const [loading, setLoading] = useState(!useOfflineTestingFallback)
  // True only while we're showing the default testing identity (no real login).
  const [isTestingFallback, setIsTestingFallback] = useState(useOfflineTestingFallback)

  useEffect(() => {
    loadRbacNavigation(permissions).then(setMenus)
  }, [permissions])

  useEffect(() => {
    let mounted = true

    const loadAccessContext = async (authUser: User, fallbackEmail: string) => {
      const p = await getUserProfile(authUser.id, fallbackEmail)
      if (!mounted || !p) return

      const roles = p.roles?.length ? p.roles : [p.role].filter(Boolean)
      const roleRows = await getUserRoles(p.id).catch(() => [])
      const effectivePermissions = await getUserPermissions(p.id, roles)
      const effectiveScopes = await getUserDataScopes(
        p.id,
        roleRows.length ? roleRows : roles.map((name) => ({ id: name, name, description: null })),
      )

      if (!mounted) return
      setProfile(p)
      setPermissions(effectivePermissions)
      setScopes(effectiveScopes)
    }

    // Apply the default testing identity (used whenever there's no real session).
    const applyTestingFallback = () => {
      if (!TESTING_MODE) return
      setUser(TESTING_USER)
      setProfile(TESTING_PROFILE)
      setPermissions(['all'])
      setScopes([{ scope_type: 'SYSTEM_WIDE' } as RbacDataScope])
      setIsTestingFallback(true)
    }

    if (useOfflineTestingFallback) {
      return () => {
        mounted = false
      }
    }

    async function loadSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!mounted) return

      if (session?.user) {
        setUser(session.user)
        setIsTestingFallback(false)
        await loadAccessContext(session.user, session.user.email || '')
        await logAccessEvent({
          userId: session.user.id,
          userEmail: session.user.email,
          action: 'LOGIN',
          module: 'AUTH',
        })
      } else {
        applyTestingFallback()
      }

      if (mounted) setLoading(false)
    }

    loadSession()

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return

      if (session?.user) {
        setUser(session.user)
        setIsTestingFallback(false)
        await loadAccessContext(session.user, session.user.email || '')
        if (event === 'SIGNED_IN') {
          await logAccessEvent({
            userId: session.user.id,
            userEmail: session.user.email,
            action: 'LOGIN',
            module: 'AUTH',
          })
        }
      } else {
        // No session — fall back to the testing identity instead of logging out.
        if (TESTING_MODE) {
          applyTestingFallback()
        } else {
          setUser(null)
          setProfile(null)
          setPermissions([])
          setScopes([])
          setIsTestingFallback(false)
        }
      }

      setLoading(false)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [useOfflineTestingFallback])

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
        setPermissions(await getUserPermissions(p.id, roleNames))
        setScopes(
          await getUserDataScopes(
            p.id,
            roleRows.length ? roleRows : roleNames.map((name) => ({ id: name, name, description: null })),
          ),
        )
      }
    }
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
        can,
        canAny,
        canAll,
        canOnRecord,
        loading,
        isTestingFallback,
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
