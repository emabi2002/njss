"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  FileText,
  DollarSign,
  Users,
  Settings,
  Menu,
  X,
  ChevronDown,
  LogOut,
  Search,
  FileCheck,
  Wallet,
  BarChart3,
  FolderOpen,
  Calendar,
  Loader2,
  User,
  ClipboardList
} from "lucide-react"
import { NJSSLogo } from "../components/NJSSLogo"
import { useAuth } from "@/contexts/AuthContext"
import { NotificationsDropdown } from "@/components/NotificationsDropdown"
import { hasAnyPermission, type Permission } from "@/lib/permissions"

type NavItem = { name: string; href: string; icon: typeof LayoutDashboard; perms?: Permission[] }

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()
  const { user, profile, role, loading, signOut } = useAuth()

  // Redirect to login when there's no authenticated session
  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [loading, user, router])

  const navigation: NavItem[] = [
    { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, perms: ["dashboard.view"] },
    { name: "FF3 Requisitions", href: "/dashboard/ff3", icon: FileText, perms: ["ff3.create", "ff3.endorse", "ff3.approve", "ff3.reject"] },
    { name: "FF4 Expenses", href: "/dashboard/ff4", icon: DollarSign, perms: ["ff4.create", "ff4.verify", "ff4.process"] },
    { name: "Commitments", href: "/dashboard/commitments", icon: FileCheck, perms: ["budget.view", "ff4.verify", "ff4.process"] },
    { name: "Budget Control", href: "/dashboard/budget", icon: Wallet, perms: ["budget.view"] },
    { name: "Annual Plans", href: "/dashboard/plans", icon: Calendar, perms: ["budget.view"] },
    { name: "Reports", href: "/dashboard/reports", icon: BarChart3, perms: ["reports.view"] },
    { name: "Audit Log", href: "/dashboard/audit-log", icon: ClipboardList, perms: ["audit.view"] },
    { name: "Master Data", href: "/dashboard/master", icon: FolderOpen, perms: ["users.manage"] },
    { name: "Users & Roles", href: "/dashboard/users", icon: Users, perms: ["users.manage"] },
    { name: "Settings", href: "/dashboard/settings", icon: Settings },
  ]

  const visibleNavigation = navigation.filter((item) => !item.perms || hasAnyPermission(role, item.perms))

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  const handleLogout = async () => {
    try {
      await signOut()
      router.push('/login')
    } catch (error) {
      console.error('Logout error:', error)
    }
  }

  // Get user initials for avatar
  const getInitials = () => {
    if (profile?.name) {
      return profile.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    }
    if (user?.email) {
      return user.email.slice(0, 2).toUpperCase()
    }
    return 'U'
  }

  // Show loading state while checking auth (or while redirecting to login)
  if (loading || !user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600 mx-auto" />
          <p className="mt-2 text-sm text-slate-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Navigation */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="flex items-center justify-between px-3 sm:px-4 py-3">
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-slate-100"
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className="flex items-center gap-2 sm:gap-3">
              <NJSSLogo size={32} />
              <div className="hidden xs:block">
                <h1 className="text-sm font-bold text-slate-900">NJSS FREMS</h1>
                <p className="text-xs text-slate-500 hidden sm:block">Financial Management System</p>
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
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <span className="text-sm font-semibold text-blue-600">{getInitials()}</span>
                </div>
                <div className="hidden md:block text-left">
                  <p className="text-sm font-medium text-slate-900">{profile?.name || user?.email?.split('@')[0] || 'User'}</p>
                  <p className="text-xs text-slate-500" suppressHydrationWarning>{profile?.role || 'Staff'}</p>
                </div>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform hidden sm:block ${userMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Dropdown Menu */}
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-50">
                  <div className="px-4 py-3 border-b border-slate-100">
                    <p className="text-sm font-medium text-slate-900">{profile?.name || 'User'}</p>
                    <p className="text-xs text-slate-500">{user?.email || profile?.email}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-50 text-blue-700">
                        {role || 'No role'}
                      </span>
                      {profile?.department && (
                        <span className="text-xs text-slate-400">{profile.department}</span>
                      )}
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
            fixed lg:static inset-y-0 left-0 z-30 w-64 bg-white border-r border-slate-200
            transform transition-transform duration-200 ease-in-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
            pt-14 lg:pt-0
          `}
        >
          <nav className="h-[calc(100vh-56px)] lg:h-screen overflow-y-auto p-4 space-y-1">
            {visibleNavigation.map((item) => {
              const Icon = item.icon
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setSidebarOpen(false)}
                  className={`
                    flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium
                    transition-colors
                    ${isActive(item.href)
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-slate-700 hover:bg-slate-100'
                    }
                  `}
                >
                  <Icon className="h-5 w-5" />
                  {item.name}
                </Link>
              )
            })}

            <div className="pt-4 mt-4 border-t border-slate-200">
              <button
                onClick={handleLogout}
                className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100 w-full"
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
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Click outside to close user menu */}
      {userMenuOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setUserMenuOpen(false)}
        />
      )}
    </div>
  )
}
