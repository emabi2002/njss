"use client"

import { useState } from "react"
import { Archive, DatabaseBackup, Loader2, ShieldCheck } from "lucide-react"
import { authFetch } from "@/lib/auth-fetch"
import { useAuth } from "@/contexts/AuthContext"
import type { Permission } from "@/lib/permissions"

type BackupType = "FULL" | "DIFFERENTIAL"

const BACKUP_PERMISSIONS = ["operations.manage", "settings.manage", "all"] as Permission[]

export function DatabaseBackupControls() {
  const { canAny, loading } = useAuth()
  const [busyType, setBusyType] = useState<BackupType | null>(null)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")

  if (loading || !canAny(BACKUP_PERMISSIONS)) return null

  const createBackup = async (backupType: BackupType) => {
    setBusyType(backupType)
    setError("")
    setStatus(
      backupType === "FULL"
        ? "Creating a consistent Full database ZIP backup..."
        : "Creating a Differential ZIP backup from the latest successful Full backup...",
    )

    try {
      const res = await authFetch("/api/operations/housekeeping/backup", {
        method: "POST",
        body: JSON.stringify({ backupType }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Backup request failed with status ${res.status}`)
      }

      const blob = await res.blob()
      const fallback = backupType === "FULL" ? "NJSS_FULL_Backup.zip" : "NJSS_DIFFERENTIAL_Backup.zip"
      const filename = res.headers.get("X-NJSS-Backup-Filename") || fallback
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)

      const backupId = res.headers.get("X-NJSS-Backup-Id")
      setStatus(`${backupType === "FULL" ? "Full" : "Differential"} backup downloaded: ${filename}${backupId ? ` • ${backupId}` : ""}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create database backup.")
      setStatus("")
    } finally {
      setBusyType(null)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <DatabaseBackup className="h-5 w-5 text-png-red" />
            <h2 className="text-lg font-semibold text-slate-900">Database Backup</h2>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Download secure NJSS logical database backups to this computer. Full captures every application table and schema metadata; Differential captures all inserts, updates and deletes since the latest successful Full backup.
          </p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Differential requires a completed Full backup baseline.
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 text-green-700" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Full ZIP Backup</h3>
              <p className="mt-1 text-sm text-slate-600">Creates a consistent snapshot of all NJSS public application tables plus schema metadata and SHA-256 checksums.</p>
              <button
                type="button"
                onClick={() => createBackup("FULL")}
                disabled={busyType !== null}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {busyType === "FULL" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />}
                {busyType === "FULL" ? "Creating Full backup..." : "Full ZIP Backup"}
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-start gap-3">
            <Archive className="mt-0.5 h-5 w-5 text-blue-700" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Differential ZIP Backup</h3>
              <p className="mt-1 text-sm text-slate-600">Captures every tracked row change since the latest Full backup, including deleted records needed for recovery.</p>
              <button
                type="button"
                onClick={() => createBackup("DIFFERENTIAL")}
                disabled={busyType !== null}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
              >
                {busyType === "DIFFERENTIAL" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
                {busyType === "DIFFERENTIAL" ? "Creating Differential..." : "Differential ZIP Backup"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {status && <p className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{status}</p>}
      {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    </section>
  )
}
