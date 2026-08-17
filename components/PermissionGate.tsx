"use client"

import { AccessDenied } from '@/components/AccessDenied'
import { useAuth } from '@/contexts/AuthContext'
import type { Permission } from '@/lib/permissions'
import type { ScopeableRecord } from '@/lib/rbac/types'

export function PermissionGate({
  permission,
  any,
  all,
  record,
  fallback = null,
  children,
}: {
  permission?: Permission
  any?: Permission[]
  all?: Permission[]
  record?: ScopeableRecord
  fallback?: React.ReactNode
  children: React.ReactNode
}) {
  const { can, canAny, canAll, canOnRecord } = useAuth()

  const allowed = (() => {
    if (permission && record) return canOnRecord(permission, record)
    if (permission) return can(permission)
    if (any) return canAny(any)
    if (all) return canAll(all)
    return false
  })()

  return allowed ? <>{children}</> : <>{fallback}</>
}

export function PagePermissionGate({
  permission,
  any,
  title,
  children,
}: {
  permission?: Permission
  any?: Permission[]
  title: string
  children: React.ReactNode
}) {
  return (
    <PermissionGate permission={permission} any={any} fallback={<AccessDenied title={title} />}>
      {children}
    </PermissionGate>
  )
}
