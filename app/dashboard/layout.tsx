"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LayoutDashboard, Menu, X, ChevronDown, LogOut, Search, Loader2, User } from "lucide-react"
import { NJSSLogo } from "../components/NJSSLogo"
import { useAuth } from "@/contexts/AuthContext"
import { NotificationsDropdown } from "@/components/NotificationsDropdown"
import { ICONS } from "@/lib/rbac/config"
import type { RbacMenuItem, RbacModule } from "@/lib/rbac/types"
import { loadOrganization, DEFAULT_ORG, type OrganizationProfile } from "@/lib/org"

type NavItem = RbacMenuItem
type NavGroup = { module: RbacModule; items: NavItem[] }

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const { user, profile, role, loading, signOut, menus, modules } = useAuth()

  // Redirect to login when there's no authenticated session
  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [loading, user, router])

  // Cache the organization profile so report/export headers are always branded
  const [org, setOrg] = useState<OrganizationProfile>(DEFAULT_ORG)
  // Tracks the last logo URL that failed to load so we can fall back gracefully.
  const [failedLogo, setFailedLogo] = useState("")
  useEffect(() => {
    if (user) loadOrganization().then(setOrg)
  }, [user])

  const visibleNavigation: NavItem[] = menus.filter((item) => !item.parent_code)
  const groupedNavigation: NavGroup[] = modules
    .map((module) => ({
      module,
      items: visibleNavigation
        .filter((item) => item.module_code === module.code)
        .sort((a, b) => a.sort_order - b.sort_order),
    }))
    .filter((group) => group.items.length > 0)
    .sort((a, b) => a.module.sort_order - b.module.sort_order)

  const ungroupedNavigation = visibleNavigation.filter(
    (item) => !modules.some((module) => module.code === item.module_code),
  )

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/")

  const handleLogout = async () => {
    try {
      await signOut()
      router.push("/login")
    } catch (error) {
      console.error("Logout error:", error)
    }
  }

  // Get user initials for avatar
  const getInitials = () => {
    if (profile?.name) {
      return profile.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    }
    if (user?.email) {
      return user.email.slice(0, 2).toUpperCase()
    }
    return "U"
  }

  // Show loading state while checking auth (or while redirecting to login)
  if (loading || !user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-png-red mx-auto" />
          <p className="mt-2 text-sm text-slate-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Navigation */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 print:hidden">
        {/* PNG national-colour accent ribbon */}
        <div className="h-1 bg-gradient-to-r from-png-red via-png-gold to-png-red" />
        <div className="flex items-center justify-between px-3 sm:px-4 py-3">
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-slate-100"
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className="flex items-center gap-2 sm:gap-3">
              {org.logo_url && failedLogo !== org.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={org.logo_url}
                  alt={org.name}
                  className="h-8 w-8 object-contain"
                  onError={() => setFailedLogo(org.logo_url)}
                />
              ) : (
                <NJSSLogo size={32} />
              )}
              <div className="hidden xs:block">
                <h1 className="text-sm font-bold text-slate-900">{org.short_name || "NJSS"} CREMS</h1>
                <p className="text-xs text-slate-500 hidden sm:block">
                  {org.subtitle || "Court Registry & Expense Monitoring System"}
                </p>
              </div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="hidden md:flex items-center gap-2 max-w-md flex-1 mx-4 lg:mx-8">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search requisitions, expenses..."
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-png-red"
              />
            </div>
          </div>

          {/* User Menu */}
          <div className="flex items-center gap-1 sm:gap-3">
            {/* Real-time Notifications Dropdown */}
            <NotificationsDropdown />

            <div className="relative">
              <button
                onClick={() => setUserMenuOpen(!userMenuOpen)}
                className="flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1.5 rounded-lg hover:bg-slate-100"
              >
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-png-red to-png-maroon flex items-center justify-center shadow-sm">
                  <span className="text-sm font-semibold text-white">{getInitials()}</span>
                </div>
                <div className="hidden md:block text-left">
                  <p className="text-sm font-medium text-slate-900">
                    {profile?.name || user?.email?.split("@")[0] || "User"}
                  </p>
                  <p className="text-xs text-slate-500" suppressHydrationWarning>
                    {profile?.role || "Staff"}
                  </p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-slate-400 transition-transform hidden sm:block ${
                    userMenuOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              {/* Dropdown Menu */}
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <p className="text-sm font-medium text-slate-900">{profile?.name || "User"}</p>
                    <p className="text-xs text-slate-500">{user?.email || profile?.email}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-png-red/10 text-png-red">
                        {role || "No role"}
                      </span>
                      {profile?.department && <span className="text-xs text-slate-400">{profile.department}</span>}
                    </div>
                  </div>

                  <Link
                    href="/dashboard/settings"
                    onClick={() => setUserMenuOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <User className="h-4 w-4" />
                    Profile Settings
                  </Link>
                  <button
                    onClick={() => {
                      setUserMenuOpen(false)
                      handleLogout()
                    }}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 w-full"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={`
            fixed lg:static inset-y-0 left-0 z-30 w-64 border-r border-png-gold/30
            bg-[#faf7f1] print:hidden
            transform transition-transform duration-200 ease-in-out
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
            pt-14 lg:pt-0
          `}
        >
          <nav className="h-[calc(100vh-56px)] lg:h-screen overflow-y-auto p-4 space-y-1">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-png-red/60">
              Main Areas
            </p>

            {groupedNavigation.map((group) => (
              <div key={group.module.code} className="pb-3">
                <p className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  {group.module.name}
                </p>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const Icon = ICONS[item.icon || "LayoutDashboard"] || LayoutDashboard
                    const active = isActive(item.href)
                    return (
                      <Link
                        key={item.code}
                        href={item.href}
                        onClick={() => setSidebarOpen(false)}
                        className={`
                          flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium
                          border-l-2 transition-all duration-150
                          ${
                            active
                              ? "bg-png-red/10 text-png-red border-png-gold"
                              : "text-slate-600 border-transparent hover:bg-png-red/5 hover:text-png-red"
                          }
                        `}
                      >
                        <Icon className={`h-5 w-5 ${active ? "text-png-red" : "text-slate-400"}`} />
                        {item.label}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}

            {ungroupedNavigation.length > 0 && (
              <div className="pb-3">
                <p className="px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  Other
                </p>
                <div className="space-y-1">
                  {ungroupedNavigation.map((item) => {
                    const Icon = ICONS[item.icon || "LayoutDashboard"] || LayoutDashboard
                    const active = isActive(item.href)
                    return (
                      <Link
                        key={item.code}
                        href={item.href}
                        onClick={() => setSidebarOpen(false)}
                        className={`
                          flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium
                          border-l-2 transition-all duration-150
                          ${
                            active
                              ? "bg-png-red/10 text-png-red border-png-gold"
                              : "text-slate-600 border-transparent hover:bg-png-red/5 hover:text-png-red"
                          }
                        `}
                      >
                        <Icon className={`h-5 w-5 ${active ? "text-png-red" : "text-slate-400"}`} />
                        {item.label}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="pt-4 mt-4 border-t border-png-gold/20">
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-red-50 hover:text-red-700 w-full transition-colors"
              >
                <LogOut className="h-5 w-5" />
                Sign Out
              </button>
            </div>
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] min-h-[calc(100vh-56px)]">
          {children}
        </main>
      </div>

      {/* Mobile Overlay */}
      {sidebarOpen && <div className="fixed inset-0 bg-black/20 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Click outside to close user menu */}
      {userMenuOpen && <div className="fixed inset-0 z-40" onClick={() => setUserMenuOpen(false)} />}
    </div>
  )
}
