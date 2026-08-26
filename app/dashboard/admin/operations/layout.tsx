import { DatabaseBackupControls } from "./database-backup-controls"

export default function OperationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <DatabaseBackupControls />
      {children}
    </div>
  )
}
