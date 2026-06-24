"use client"

import { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getUserProfile, type AuthUser } from '@/lib/auth'
import { hasPermission, type Permission } from '@/lib/permissions'

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
  email: 'admin@pngjudiciary.gov.pg',
  name: 'System Administrator',
  role: 'System Administrator',
  department: 'National Judiciary Staff Services',
}

type AuthContextType = {
  user: User | null
  profile: AuthUser | null
  role: string
  can: (perm: Permission) => boolean
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
  can: () => false,
  loading: true,
  isTestingFallback: false,
  signOut: async () => {},
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  // True only while we're showing the default testing identity (no real login).
  const [isTestingFallback, setIsTestingFallback] = useState(false)

  useEffect(() => {
    let mounted = true

    // Apply the default testing identity (used whenever there's no real session).
    const applyTestingFallback = () => {
      if (!TESTING_MODE) return
      setUser(TESTING_USER)
      setProfile(TESTING_PROFILE)
      setIsTestingFallback(true)
    }

    async function loadSession() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!mounted) return
      if (session?.user) {
        setUser(session.user)
        setIsTestingFallback(false)
        const p = await getUserProfile(session.user.id, session.user.email || '')
        if (mounted) setProfile(p)
      } else {
        applyTestingFallback()
      }
      if (mounted) setLoading(false)
    }
    loadSession()

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return
      if (session?.user) {
        setUser(session.user)
        setIsTestingFallback(false)
        const p = await getUserProfile(session.user.id, session.user.email || '')
        if (mounted) setProfile(p)
      } else {
        // No session — fall back to the testing identity instead of logging out.
        if (TESTING_MODE) {
          applyTestingFallback()
        } else {
          setUser(null)
          setProfile(null)
          setIsTestingFallback(false)
        }
      }
      setLoading(false)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const role = profile?.role || ''
  const can = (perm: Permission) => hasPermission(role, perm)

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut()
    } finally {
      setUser(null)
      setProfile(null)
      if (typeof window !== 'undefined') window.location.href = '/login'
    }
  }

  const refreshProfile = async () => {
    if (user) setProfile(await getUserProfile(user.id, user.email || ''))
  }

  return (
    <AuthContext.Provider value={{ user, profile, role, can, loading, isTestingFallback, signOut: handleSignOut, refreshProfile }}>
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
