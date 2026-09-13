"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { AlertCircle, Check, Eye, EyeOff, KeyRound, Loader2, ShieldCheck, X } from "lucide-react"
import { NJSSLogo } from "../../components/NJSSLogo"
import { supabase } from "@/lib/supabase"
import { evaluatePassword, validatePassword } from "@/lib/password"

export default function ResetPasswordPage() {
  const router = useRouter()
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")

  useEffect(() => {
    let active = true

    const loadRecoverySession = async () => {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()

      if (!active) return
      if (sessionError) setError("Unable to verify the password reset link. Please request a new one.")
      if (session) setRecoveryReady(true)
      setCheckingSession(false)
    }

    void loadRecoverySession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return
      if (event === "PASSWORD_RECOVERY" && session) {
        setRecoveryReady(true)
        setCheckingSession(false)
        setError("")
      }
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const rules = evaluatePassword(password)
  const matches = password.length > 0 && password === confirmPassword
  const canSubmit = recoveryReady && rules.every((rule) => rule.passed) && matches && !submitting

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError("")

    if (!recoveryReady) {
      setError("This password reset link is invalid or has expired. Please request a new one.")
      return
    }

    const problems = validatePassword(password, confirmPassword)
    if (problems.length) {
      setError(problems[0])
      return
    }

    setSubmitting(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: password })
      if (updateError) {
        setError(updateError.message || "Unable to reset the password.")
        return
      }

      await supabase.auth.signOut()
      router.replace("/login?password-reset=success")
    } catch {
      setError("Unable to complete the password reset. Please request a new reset link and try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-red-50/40 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-8">
          <NJSSLogo className="h-14 w-14" />
          <h1 className="mt-4 text-2xl font-bold text-slate-900">Reset Your Password</h1>
          <p className="mt-1 text-sm text-slate-600">
            Choose a new password for your NJSS account.
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-start gap-3 bg-slate-50 border-b border-slate-200 px-6 py-4">
            <ShieldCheck className="h-5 w-5 text-green-600 shrink-0 mt-0.5" />
            <p className="text-sm text-slate-700">
              This page uses the secure password-recovery session created by the link sent to your email.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {checkingSession ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying password reset link...
              </div>
            ) : !recoveryReady ? (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-3 text-sm text-amber-800">
                This reset link is invalid or has expired. Request a new password reset email and use the newest link.
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="recovery-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                    New Password
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      id="recovery-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      className="w-full pl-10 pr-11 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-600"
                      placeholder="Enter a new password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="recovery-confirm-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                    Confirm New Password
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      id="recovery-confirm-password"
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-600"
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

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full py-2.5 rounded-lg bg-red-700 text-white font-medium hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save New Password
                </button>
              </>
            )}

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="text-center">
              <Link href="/forgot-password" className="text-xs text-slate-500 hover:text-slate-700">
                Request another reset link
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
