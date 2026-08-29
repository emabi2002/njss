"use client"

import { usePathname } from "next/navigation"
import { useAuth } from "@/contexts/AuthContext"
import type { Permission } from "@/lib/permissions"
import { AccessDenied } from "@/components/AccessDenied"
import { DatabaseBackupControls } from "./database-backup-controls"

const OPERATIONS_PERMISSIONS = ["operations.view", "operations.manage", "settings.manage", "all"] as Permission[]
const TRANSACTION_MONITOR_PERMISSIONS = ["audit.view", ...OPERATIONS_PERMISSIONS] as Permission[]

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { canAny, loading, accessReady } = useAuth()
  const requiredPermissions = pathname.endsWith("/transactions")
    ? TRANSACTION_MONITOR_PERMISSIONS
    : OPERATIONS_PERMISSIONS

  if (loading || !accessReady) return null
  if (!canAny(requiredPermissions)) {
    return <AccessDenied title="System Support & Operations" />
  }

  return (
    <div className="space-y-6">
      <DatabaseBackupControls />
      {children}
    </div>
  )
}
