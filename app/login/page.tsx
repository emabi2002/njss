"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Eye, EyeOff, Lock, Mail, AlertCircle, CheckCircle2, Loader2 } from "lucide-react"
import { NJSSLogo } from "../components/NJSSLogo"
import { signIn } from "@/lib/auth"
import { useAuth } from "@/contexts/AuthContext"

const DEMO_PASSWORD = "Crms@2025"
const DEMO_ACCOUNTS = [
  { role: "System Administrator", email: "admin@pngjudiciary.gov.pg" },
  { role: "Finance Manager", email: "finance@pngjudiciary.gov.pg" },
  { role: "Department Head", email: "depthead@pngjudiciary.gov.pg" },
  { role: "Section Head", email: "section@pngjudiciary.gov.pg" },
  { role: "Approver", email: "approver@pngjudiciary.gov.pg" },
  { role: "Requisition Officer", email: "officer@pngjudiciary.gov.pg" },
  { role: "Auditor", email: "auditor@pngjudiciary.gov.pg" },
  { role: "Executive Management", email: "exec@pngjudiciary.gov.pg" },
]

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, loading: authLoading } = useAuth()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState("")

  const redirectTo = searchParams.get('redirect') || '/dashboard'

  // Redirect if already logged in
  useEffect(() => {
    if (!authLoading && user) {
      router.push(redirectTo)
    }
  }, [user, authLoading, router, redirectTo])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setSuccess("")
    setLoading(true)

    try {
      if (!email || !password) {
        throw new Error("Please enter both email and password")
      }

      await signIn(email, password)
      setSuccess("Login successful! Redirecting...")

      // Small delay for UX
      setTimeout(() => {
        router.push(redirectTo)
        router.refresh()
      }, 500)

    } catch (err: unknown) {
      console.error('Login error:', err)
      if (err instanceof Error) {
        if (err.message.includes('Invalid login')) {
          setError("Invalid email or password. Please try again.")
        } else if (err.message.includes('Email not confirmed')) {
          setError("Please verify your email address before signing in.")
        } else {
          setError(err.message)
        }
      } else {
        setError("An error occurred during login. Please try again.")
      }
    } finally {
      setLoading(false)
    }
  }

  // Show loading while checking auth state
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-red-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-red-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-red-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo and Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <NJSSLogo size={80} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">NJSS FREMS</h1>
          <p className="text-slate-600 mt-1">Financial Requisition & Expense Management</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <h2 className="text-xl font-semibold text-slate-900 mb-6 text-center">Sign In</h2>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-6 flex items-center gap-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-6 flex items-center gap-2 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              {success}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@pngjudiciary.gov.pg"
                  autoComplete="email"
                  className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  className="w-full pl-10 pr-12 py-2.5 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 text-red-600 rounded" />
                <span className="text-sm text-slate-600">Remember me</span>
              </label>
              <Link href="/forgot-password" className="text-sm text-red-600 hover:text-red-700">
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-red-700 text-white rounded-lg font-medium hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign In"
              )}
            </button>
          </form>

          {/* Demo accounts — click to fill */}
          <div className="mt-6 p-4 bg-slate-50 border border-slate-200 rounded-lg">
            <p className="text-xs font-medium text-slate-700 mb-2">
              Demo accounts — click to fill (password <span className="font-mono text-slate-900">{DEMO_PASSWORD}</span>)
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {DEMO_ACCOUNTS.map((a) => (
                <button
                  key={a.email}
                  type="button"
                  onClick={() => { setEmail(a.email); setPassword(DEMO_PASSWORD); setError("") }}
                  className="text-left px-2.5 py-1.5 rounded-md border border-slate-200 bg-white hover:border-red-300 hover:bg-red-50 transition-colors"
                >
                  <span className="block text-xs font-medium text-slate-800">{a.role}</span>
                  <span className="block text-[11px] text-slate-500 truncate">{a.email}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-center mt-6">
          <p className="text-sm text-slate-600">
            National Judiciary Staff Services
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Papua New Guinea
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-red-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-red-600" />
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}
