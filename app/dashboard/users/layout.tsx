"use client"

import { Loader2 } from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"

export default function UsersAccessLayout({ children }: { children: React.ReactNode }) {
  const { accessReady } = useAuth()

  if (!accessReady) {
    return (
      <div className="flex h-64 items-center justify-center" aria-label="Loading access permissions">
        <Loader2 className="h-8 w-8 animate-spin text-png-red" />
      </div>
    )
  }

  return <>{children}</>
}
