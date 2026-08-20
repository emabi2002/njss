"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, Eye, EyeOff, KeyRound, Loader2, ShieldAlert, X } from "lucide-react"
import { NJSSLogo } from "../components/NJSSLogo"
import { useAuth } from "@/contexts/AuthContext"
import { authFetch } from "@/lib/auth-fetch"
import { evaluatePassword, validatePassword } from "@/lib/password"

export default function SetPasswordPage() {
  const router = useRouter()
  const { user, loading, mustChangePassword, refreshPasswordState, signOut } = useAuth()

  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [loading, user, router])

  useEffect(() => {
    if (!loading && user && mustChangePassword === false) router.replace("/dashboard")
  }, [loading, user, mustChangePassword, router])

  const rules = evaluatePassword(password)
  const matches = password.length > 0 && password === confirmPassword
  const canSubmit = rules.every((rule) => rule.passed) && matches && !submitting

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError("")

    const problems = validatePassword(password, confirmPassword)
    if (problems.length) {
      setError(problems[0])
      return
    }

    setSubmitting(true)
    try {
      const res = await authFetch("/api/account/password", {
        method: "POST",
        body: JSON.stringify({ password, confirmPassword }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || "Unable to change the password.")
        return
      }
      setPassword("")
      setConfirmPassword("")
      await refreshPasswordState()
      router.replace("/dashboard")
    } catch {
      setError("Unable to reach the server. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-png-red" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-red-50/40 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-8">
          <NJSSLogo className="h-14 w-14" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Set a New Password</h1>
          <p className="mt-1 text-sm text-slate-600">
            Your password was issued by an administrator. Choose a new one before continuing.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-start gap-3 bg-amber-50 border-b border-amber-200 px-6 py-4">
            <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              For your security, NJSS requires a password change on first sign-in and after any
              administrator reset.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                New Password
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  id="new-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full pl-10 pr-11 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red/40 focus:border-png-red"
                  placeholder="Enter a new password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                Confirm New Password
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red/40 focus:border-png-red"
                  placeholder="Re-enter the new password"
                />
              </div>
              {confirmPassword.length > 0 && !matches && (
                <p className="mt-1.5 text-xs text-red-600">Passwords do not match.</p>
              )}
            </div>

            <ul className="space-y-1.5 rounded-lg bg-slate-50 border border-slate-200 p-3">
              {rules.map((rule) => (
                <li key={rule.id} className="flex items-center gap-2 text-xs">
                  {rule.passed ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <X className="h-3.5 w-3.5 text-slate-300" />
                  )}
                  <span className={rule.passed ? "text-slate-700" : "text-slate-500"}>{rule.label}</span>
                </li>
              ))}
            </ul>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-2.5 rounded-lg bg-png-red text-white font-medium hover:bg-png-maroon disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Set Password and Continue
            </button>

            <button
              type="button"
              onClick={() => signOut()}
              className="w-full text-xs text-slate-500 hover:text-slate-700"
            >
              Sign out instead
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
