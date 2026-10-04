"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/contexts/AuthContext"
import { canAccessRoute } from "@/lib/rbac/client"
import { dashboardAccessState } from "@/lib/rbac/dashboard-access"

export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading, accessReady, permissions, mustChangePassword } = useAuth()
  const state = dashboardAccessState({
    loading, signedIn: !!user, accessReady, mustChangePassword, pathname,
    authorized: canAccessRoute(permissions, pathname),
  })

  useEffect(() => {
    if (state === "denied") router.replace("/dashboard/no-access")
    if (state === "password") router.replace("/set-password")
    if (state === "login") router.replace("/login")
  }, [state, router])

  return state === "allowed" ? <>{children}</> : null
}
