"use client"

import Link from "next/link"
import { ShieldAlert, ArrowLeft } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { getDashboardLandingPath } from "@/lib/rbac/dashboard-landing"

export function AccessDenied({ title, message }: { title?: string; message?: string }) {
  const { role, permissions } = useAuth()
  const landingPath = getDashboardLandingPath(permissions)
  return (
    <div className="flex items-center justify-center py-20">
      <div className="text-center max-w-md">
        <div className="mx-auto w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mb-4">
          <ShieldAlert className="h-7 w-7 text-red-600" />
        </div>
        <h2 className="text-xl font-semibold text-slate-900">Access Restricted</h2>
        <p className="text-slate-600 mt-2">
          {message || (
            <>
              {title ? (
                <>
                  The <span className="font-medium">{title}</span> area is
                </>
              ) : (
                "This area is"
              )}{" "}
              not available for your current role (
              <span className="font-medium" suppressHydrationWarning>
                {role}
              </span>
              ).
            </>
          )}
        </p>
        <p className="text-sm text-slate-500 mt-1">
          Use an available workspace from the navigation or contact a System Administrator for access.
        </p>
        {landingPath !== '/dashboard/no-access' && <Link
          href={landingPath}
          className="inline-flex items-center gap-2 mt-6 px-4 py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Open My Workspace
        </Link>}
      </div>
    </div>
  )
}
