"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ChevronDown,
  ChevronRight,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  X,
} from "lucide-react"
import { NJSSLogo } from "../components/NJSSLogo"
import { useAuth } from "@/contexts/AuthContext"
import { NotificationsDropdown } from "@/components/NotificationsDropdown"
import { ICONS } from "@/lib/rbac/config"
import type { RbacMenuItem, RbacModule } from "@/lib/rbac/types"
import { loadOrganization, DEFAULT_ORG, type OrganizationProfile } from "@/lib/org"

type NavItem = RbacMenuItem
type NavGroup = { module: RbacModule; items: NavItem[]; active: boolean; collapsible: boolean }

const SIDEBAR_EXPANDED_WIDTH = "w-64"
const SIDEBAR_COLLAPSED_WIDTH = "w-[72px]"
const COLLAPSIBLE_MODULES = new Set(["budget", "finance", "reports", "administration", "system", "transactions", "systems_administration"])

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const pathname = usePathname()
  const router = useRouter()
  const { user, profile, role, loading, signOut, menus, modules } = useAuth()

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [loading, user, router])

  const [org, setOrg] = useState<OrganizationProfile>(DEFAULT_ORG)
  const [failedLogo, setFailedLogo] = useState("")

  useEffect(() => {
    if (user) loadOrganization().then(setOrg)
  }, [user])

  useEffect(() => {
    const savedCollapsed = window.localStorage.getItem("njss-sidebar-collapsed")
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (savedCollapsed) setSidebarCollapsed(savedCollapsed === "true")

    const savedGroups = window.localStorage.getItem("njss-sidebar-groups")
    if (savedGroups) {
      try {
        setExpandedGroups(JSON.parse(savedGroups) as Record<string, boolean>)
      } catch {
        setExpandedGroups({})
      }
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem("njss-sidebar-collapsed", String(sidebarCollapsed))
  }, [sidebarCollapsed])

  useEffect(() => {
    window.localStorage.setItem("njss-sidebar-groups", JSON.stringify(expandedGroups))
  }, [expandedGroups])

  const isActive = useCallback((href: string) => pathname === href || pathname.startsWith(href + "/"), [pathname])

  const visibleNavigation: NavItem[] = useMemo(
    () => menus.filter((item) => !item.parent_code).sort((a, b) => a.sort_order - b.sort_order),
    [menus],
  )

  const groupedNavigation: NavGroup[] = useMemo(() => {
    const groups = modules
      .map((module) => {
        const items = visibleNavigation
          .filter((item) => item.module_code === module.code)
          .sort((a, b) => a.sort_order - b.sort_order)
        const active = items.some((item) => isActive(item.href))
        return {
          module,
          items,
          active,
          collapsible: COLLAPSIBLE_MODULES.has(module.code),
        }
      })
      .filter((group) => group.items.length > 0)
      .sort((a, b) => a.module.sort_order - b.module.sort_order)

    const ungroupedItems = visibleNavigation.filter(
      (item) => !modules.some((module) => module.code === item.module_code),
    )

    if (ungroupedItems.length > 0) {
      groups.push({
        module: {
          code: "other",
          name: "Other",
          base_path: "/dashboard",
          icon: "LayoutDashboard",
          sort_order: 999,
          is_active: true,
        },
        items: ungroupedItems,
        active: ungroupedItems.some((item) => isActive(item.href)),
        collapsible: false,
      })
    }

    return groups
  }, [modules, visibleNavigation, isActive])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedGroups((current) => {
      const next = { ...current }
      for (const group of groupedNavigation) {
        if (group.active) next[group.module.code] = true
      }
      return next
    })
  }, [groupedNavigation])

  const handleLogout = async () => {
    try {
      await signOut()
      router.push("/login")
    } catch (error) {
      console.error("Logout error:", error)
    }
  }

  const getInitials = () => {
    if (profile?.name) {
      return profile.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    }
    if (user?.email) return user.email.slice(0, 2).toUpperCase()
    return "U"
  }

  const toggleGroup = (code: string) => {
    setExpandedGroups((current) => ({ ...current, [code]: !current[code] }))
  }

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-[#F6F8FB] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[#132A44] mx-auto" />
          <p className="mt-2 text-sm text-slate-600">Loading...</p>
        </div>
      </div>
    )
  }

  const sidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH

  return (
    <div className="min-h-screen bg-[#F6F8FB]">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20 print:hidden lg:hidden">
        <div className="h-1 bg-[#132A44]" />
        <div className="flex items-center justify-between px-3 sm:px-4 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg hover:bg-slate-100"
              aria-label="Open navigation"
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className="flex items-center gap-2">
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
              <div>
                <h1 className="text-sm font-bold text-slate-900">{org.short_name || "NJSS"}</h1>
                <p className="text-xs text-slate-500">CREMS</p>
              </div>
            </div>
          </div>
          <NotificationsDropdown />
        </div>
      </header>

      <div className="flex">
        <aside
          className={`
            fixed lg:sticky inset-y-0 left-0 z-30 h-screen ${sidebarWidth}
            bg-[#132A44] text-white print:hidden shadow-2xl lg:shadow-none
            transform transition-[width,transform] duration-200 ease-in-out
            ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
          `}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4 min-h-[72px]">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/95 shadow-sm">
                {org.logo_url && failedLogo !== org.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={org.logo_url}
                    alt={org.name}
                    className="h-8 w-8 object-contain"
                    onError={() => setFailedLogo(org.logo_url)}
                  />
                ) : (
                  <NJSSLogo size={30} />
                )}
              </div>
              {!sidebarCollapsed && (
                <div className="min-w-0">
                  <p className="text-base font-bold tracking-wide text-white">{org.short_name || "NJSS"}</p>
                  <p className="text-[11px] leading-tight text-slate-300">
                    {org.subtitle || "Court Registry & Expense Monitoring System"}
                  </p>
                </div>
              )}
              <button
                onClick={() => setSidebarCollapsed((value) => !value)}
                className="ml-auto hidden rounded-lg p-1.5 text-slate-300 hover:bg-white/10 hover:text-white lg:inline-flex"
                aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              >
                {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-4">
              {!sidebarCollapsed && (
                <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#94A3B8]">
                  Navigation
                </p>
              )}

              <div className="space-y-3">
                {groupedNavigation.map((group) => {
                  const GroupIcon = ICONS[group.module.icon || "LayoutDashboard"] || LayoutDashboard
                  const expanded = !group.collapsible || group.active || expandedGroups[group.module.code]

                  return (
                    <div key={group.module.code}>
                      {group.collapsible ? (
                        <button
                          onClick={() => toggleGroup(group.module.code)}
                          className={`group flex h-11 w-full items-center rounded-lg text-sm font-medium transition-colors duration-200 ease-in-out ${
                            group.active
                              ? "bg-[#1C3B5A] text-white"
                              : "text-[#CBD5E1] hover:bg-white/[0.07] hover:text-white"
                          } ${sidebarCollapsed ? "justify-center px-0" : "gap-3 px-3"}`}
                          title={sidebarCollapsed ? group.module.name : undefined}
                        >
                          <span
                            className={`h-5 w-1 rounded-full ${group.active ? "bg-[#D4A62A]" : "bg-transparent"} ${
                              sidebarCollapsed ? "hidden" : "block"
                            }`}
                          />
                          <GroupIcon className={`h-5 w-5 shrink-0 ${group.active ? "text-[#D4A62A]" : "text-[#CBD5E1] group-hover:text-[#D4A62A]"}`} />
                          {!sidebarCollapsed && (
                            <>
                              <span className="flex-1 text-left">{group.module.name}</span>
                              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </>
                          )}
                        </button>
                      ) : !sidebarCollapsed ? (
                        <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#94A3B8]">
                          {group.module.name}
                        </p>
                      ) : null}

                      {expanded && !sidebarCollapsed && (
                        <div className={group.collapsible ? "mt-1 space-y-1 pl-5" : "space-y-1"}>
                          {group.items.map((item) => {
                            const Icon = ICONS[item.icon || "LayoutDashboard"] || LayoutDashboard
                            const active = isActive(item.href)
                            return (
                              <Link
                                key={item.code}
                                href={item.href}
                                onClick={() => setSidebarOpen(false)}
                                className={`group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-200 ease-in-out ${
                                  active
                                    ? "bg-[#1C3B5A] font-semibold text-white"
                                    : "font-medium text-[#CBD5E1] hover:bg-white/[0.07] hover:text-white"
                                }`}
                              >
                                <span className={`absolute left-0 h-6 w-1 rounded-r-full ${active ? "bg-[#D4A62A]" : "bg-transparent"}`} />
                                <Icon className={`h-4.5 w-4.5 shrink-0 ${active ? "text-[#D4A62A]" : "text-[#CBD5E1] group-hover:text-[#D4A62A]"}`} />
                                <span className="truncate">{item.label}</span>
                              </Link>
                            )
                          })}
                        </div>
                      )}

                      {expanded && sidebarCollapsed && (
                        <div className="mt-1 space-y-1">
                          {group.items.map((item) => {
                            const Icon = ICONS[item.icon || "LayoutDashboard"] || LayoutDashboard
                            const active = isActive(item.href)
                            return (
                              <Link
                                key={item.code}
                                href={item.href}
                                onClick={() => setSidebarOpen(false)}
                                title={item.label}
                                className={`group relative flex h-10 items-center justify-center rounded-lg transition-colors duration-200 ease-in-out ${
                                  active ? "bg-[#1C3B5A] text-white" : "text-[#CBD5E1] hover:bg-white/[0.07] hover:text-white"
                                }`}
                              >
                                <span className={`absolute left-0 h-6 w-1 rounded-r-full ${active ? "bg-[#D4A62A]" : "bg-transparent"}`} />
                                <Icon className={`h-5 w-5 ${active ? "text-[#D4A62A]" : "text-[#CBD5E1] group-hover:text-[#D4A62A]"}`} />
                              </Link>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </nav>

            <div className="border-t border-white/10 p-3">
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className={`flex w-full items-center rounded-xl transition-colors duration-200 hover:bg-white/[0.07] ${
                    sidebarCollapsed ? "justify-center p-2" : "gap-3 p-2"
                  }`}
                  title={sidebarCollapsed ? profile?.name || user?.email || "User" : undefined}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#7A1F2B] ring-1 ring-white/15">
                    <span className="text-xs font-semibold text-white">{getInitials()}</span>
                  </div>
                  {!sidebarCollapsed && (
                    <>
                      <div className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-semibold text-white">{profile?.name || user?.email?.split("@")[0] || "User"}</p>
                        <p className="truncate text-xs text-slate-300" suppressHydrationWarning>{role || "No role assigned"}</p>
                      </div>
                      <ChevronDown className={`h-4 w-4 text-slate-300 transition-transform ${userMenuOpen ? "rotate-180" : ""}`} />
                    </>
                  )}
                </button>

                {userMenuOpen && (
                  <div className={`absolute bottom-14 rounded-xl border border-slate-200 bg-white py-1 shadow-2xl ${sidebarCollapsed ? "left-14 w-56" : "left-0 right-0"}`}>
                    <div className="border-b border-slate-100 px-4 py-3">
                      <p className="truncate text-sm font-semibold text-slate-900">{profile?.name || "User"}</p>
                      <p className="truncate text-xs text-slate-500">{user?.email || profile?.email}</p>
                      <p className="mt-1 truncate text-[11px] font-medium text-[#7A1F2B]" suppressHydrationWarning>{role || "No role assigned"}</p>
                    </div>
                    <Link
                      href="/dashboard/settings"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <Settings className="h-4 w-4" />
                      My Profile
                    </Link>
                    <button
                      onClick={() => {
                        setUserMenuOpen(false)
                        handleLogout()
                      }}
                      className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[#7A1F2B] hover:bg-red-50"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] min-h-screen">
          <div className="hidden lg:mb-4 lg:flex lg:items-center lg:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search requisitions, expenses..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-[#132A44]"
              />
            </div>
            <NotificationsDropdown />
          </div>
          {children}
        </main>
      </div>

      {sidebarOpen && <div className="fixed inset-0 bg-black/40 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      {userMenuOpen && <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />}
    </div>
  )
}
