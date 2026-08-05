"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

// TESTING MODE: Bypass landing page and go straight to dashboard
export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/dashboard')
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-700 mx-auto"></div>
        <p className="mt-4 text-slate-600">Loading NJSS CREMS...</p>
      </div>
    </div>
  )
}
