"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useAuth } from "@/contexts/AuthContext"
import { canAccessRoute } from "@/lib/rbac/client"

export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading, accessReady, permissions, mustChangePassword } = useAuth()

  const shouldEnforceRouteAccess =
    !loading &&
    !!user &&
    accessReady &&
    mustChangePassword !== true &&
    pathname !== "/dashboard/no-access"

  const routeAuthorized =
    !shouldEnforceRouteAccess || canAccessRoute(permissions, pathname)

  useEffect(() => {
    if (
      shouldEnforceRouteAccess &&
      !canAccessRoute(permissions, pathname)
    ) {
      router.replace("/dashboard/no-access")
    }
  }, [pathname, permissions, router, shouldEnforceRouteAccess])

  if (!routeAuthorized) return null

  return <>{children}</>
}
