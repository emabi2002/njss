"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, Database, GitCommitHorizontal, Info, Loader2, RefreshCw, Server } from "lucide-react"
import { PagePermissionGate } from "@/components/PermissionGate"
import { supabase } from "@/lib/supabase"

type SystemInfo = {
  commitSha: string
  buildTime: string | null
  environment: string
  supabaseProjectRef: string | null
  phase: string
}

async function authHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined
}

export default function SystemInfoPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/system-info", { cache: "no-store", headers: await authHeaders() })
      if (!res.ok) throw new Error(`System info request failed with status ${res.status}`)
      setInfo((await res.json()) as SystemInfo)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load system information.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  return (
    <PagePermissionGate any={["operations.view", "operations.manage", "settings.manage", "all"]} title="System Information">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Server className="h-7 w-7 text-png-red" /> System Information
            </h1>
            <p className="text-slate-600 mt-1">Deployed build, environment and Supabase project currently serving this application.</p>
          </div>
          <button onClick={load} className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-png-red" /></div>
        ) : info ? (
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <InfoCard label="Commit SHA" value={info.commitSha} mono icon={<GitCommitHorizontal className="h-5 w-5" />} tone="maroon" />
            <InfoCard label="Build Time" value={info.buildTime ? new Date(info.buildTime).toLocaleString("en-GB") : "Not recorded"} icon={<Info className="h-5 w-5" />} tone="gold" />
            <InfoCard label="Environment" value={info.environment} icon={<Server className="h-5 w-5" />} tone="slate" />
            <InfoCard label="Supabase Project" value={info.supabaseProjectRef || "Not configured"} mono icon={<Database className="h-5 w-5" />} tone="green" />
            <InfoCard label="Release Phase" value={info.phase} icon={<CheckCircle2 className="h-5 w-5" />} tone="maroon" />
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 xl:col-span-3">
              Database passwords, service keys, API secrets, SMTP passwords and access tokens are intentionally never displayed on this page.
            </div>
          </div>
        ) : (
          <div className="text-center py-16 text-slate-500 bg-white rounded-lg border border-slate-200">
            <Server className="h-12 w-12 mx-auto text-slate-300 mb-3" />
            <p className="text-sm">No system information available.</p>
          </div>
        )}
      </div>
    </PagePermissionGate>
  )
}

function InfoCard({ label, value, icon, tone, mono = false }: {
  label: string; value: string; icon: React.ReactNode; tone: "maroon" | "gold" | "green" | "slate"; mono?: boolean
}) {
  const tones = {
    maroon: "bg-png-maroon/10 text-png-maroon",
    gold: "bg-png-gold/20 text-png-maroon",
    green: "bg-green-100 text-green-700",
    slate: "bg-slate-100 text-slate-600",
  }
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${tones[tone]}`}>{icon}</div>
      <p className="mt-3 text-xs uppercase tracking-wide text-slate-500 font-medium">{label}</p>
      <p className={`mt-1 text-lg font-bold text-slate-900 break-all ${mono ? "font-mono text-base" : ""}`}>{value}</p>
    </div>
  )
}
