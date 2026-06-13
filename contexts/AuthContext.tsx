"use client"

import { createContext, useContext, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { getUserProfile, type AuthUser } from '@/lib/auth'
import { hasPermission, type Permission } from '@/lib/permissions'

type AuthContextType = {
  user: User | null
  profile: AuthUser | null
  role: string
  can: (perm: Permission) => boolean
  loading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  role: '',
  can: () => false,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    async function loadSession() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!mounted) return
      if (session?.user) {
        setUser(session.user)
        const p = await getUserProfile(session.user.id, session.user.email || '')
        if (mounted) setProfile(p)
      }
      if (mounted) setLoading(false)
    }
    loadSession()

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return
      if (session?.user) {
        setUser(session.user)
        const p = await getUserProfile(session.user.id, session.user.email || '')
        if (mounted) setProfile(p)
      } else {
        setUser(null)
        setProfile(null)
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
    <AuthContext.Provider value={{ user, profile, role, can, loading, signOut: handleSignOut, refreshProfile }}>
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
