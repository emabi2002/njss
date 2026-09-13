"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  BadgeCheck, Bell, CheckCheck, ClipboardCheck, FileText, DollarSign,
  Clock, X, ChevronRight
} from "lucide-react"
import { useRealtimeNotifications, type RealtimeNotification } from "@/hooks/useRealtimeNotifications"
import { useAuth } from "@/contexts/AuthContext"
import { authFetch } from "@/lib/auth-fetch"

type TaskSummary = {
  isAdministrator: boolean
  actionRequiredTotal: number
  systemWideTotal: number
  actionSummary: Array<{ label: string; count: number; sourceType: "FF3" | "FF4" }>
}

export function NotificationsDropdown() {
  const [isOpen, setIsOpen] = useState(false)
  const [taskSummary, setTaskSummary] = useState<TaskSummary | null>(null)
  const { profile } = useAuth()
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useRealtimeNotifications(profile?.id)

  useEffect(() => {
    if (!profile?.id) return
    let active = true
    const load = async () => {
      try {
        const response = await authFetch('/api/workflow/tasks?summary=1')
        if (!response.ok) return
        const payload = await response.json() as TaskSummary
        if (active) setTaskSummary(payload)
      } catch {
        // Task counts are supplemental; notification rendering should continue.
      }
    }
    void load()
    const timer = window.setInterval(() => void load(), 60_000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [profile?.id])

  const getNotificationIcon = (type: string) => {
    if (type.startsWith('FF3')) return <FileText className="h-4 w-4 text-blue-600" />
    if (type.startsWith('FF4')) return <DollarSign className="h-4 w-4 text-green-600" />
    if (type.startsWith('BUDGET_ACTIVATION') || type === 'BUDGET_ACTIVATED') return <BadgeCheck className="h-4 w-4 text-emerald-700" />
    return <Bell className="h-4 w-4 text-slate-600" />
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'URGENT': return 'border-l-red-500'
      case 'HIGH': return 'border-l-orange-500'
      case 'MEDIUM': return 'border-l-amber-500'
      default: return 'border-l-slate-300'
    }
  }

  const getTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString('en-GB')
  }

  const getNotificationLink = (notification: RealtimeNotification) => {
    if (notification.reference_type === 'FF3') return `/dashboard/ff3/${notification.reference_id}`
    if (notification.reference_type === 'FF4') return `/dashboard/ff4/${notification.reference_id}`
    if (notification.reference_type === 'BUDGET_ACTIVATION') return `/dashboard/budget/activation?batch=${encodeURIComponent(notification.reference_id)}`
    if (notification.reference_type === 'BUDGET_REVISION') return `/dashboard/budget/revisions?revision=${encodeURIComponent(notification.reference_id)}`
    return '/dashboard'
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg hover:bg-slate-100 transition-colors"
        aria-label="Notifications and workflow tasks"
      >
        <Bell className="h-5 w-5 text-slate-600" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-5 min-w-5 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
        {(taskSummary?.actionRequiredTotal || 0) > 0 && (
          <span className="absolute -bottom-1 -left-1 h-5 min-w-5 px-1 bg-amber-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center" title="Pending workflow tasks">
            {(taskSummary?.actionRequiredTotal || 0) > 9 ? '9+' : taskSummary?.actionRequiredTotal}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          <div className="absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] bg-white rounded-lg shadow-lg border border-slate-200 z-50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
              <h3 className="font-semibold text-slate-900">Notifications & Tasks</h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button onClick={() => markAllAsRead()} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                    <CheckCheck className="h-3.5 w-3.5" /> Mark all read
                  </button>
                )}
                <button onClick={() => setIsOpen(false)} className="p-1 hover:bg-slate-200 rounded">
                  <X className="h-4 w-4 text-slate-500" />
                </button>
              </div>
            </div>

            {taskSummary && (
              <Link
                href="/dashboard/tasks"
                onClick={() => setIsOpen(false)}
                className="block border-b border-slate-200 bg-amber-50/60 px-4 py-3 hover:bg-amber-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="rounded-lg bg-amber-100 p-2"><ClipboardCheck className="h-4 w-4 text-amber-700" /></span>
                    <div>
                      <p className="text-sm font-semibold text-slate-900">My Tasks</p>
                      <p className="text-xs text-slate-600">{taskSummary.actionRequiredTotal} pending action{taskSummary.actionRequiredTotal === 1 ? '' : 's'}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </div>
                {taskSummary.actionSummary.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {taskSummary.actionSummary.slice(0, 3).map((item) => (
                      <div key={item.label} className="flex items-center justify-between text-xs text-slate-600">
                        <span className="truncate pr-3">{item.label}</span><span className="font-bold text-slate-800">{item.count}</span>
                      </div>
                    ))}
                  </div>
                )}
                {taskSummary.isAdministrator && (
                  <p className="mt-2 text-[11px] font-medium text-[#8A1420]">System-wide pending work: {taskSummary.systemWideTotal}</p>
                )}
              </Link>
            )}

            <div className="max-h-[360px] overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell className="h-12 w-12 mx-auto text-slate-200 mb-3" />
                  <p className="text-slate-500 text-sm">No notifications yet</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {notifications.map((notification) => (
                    <Link
                      key={notification.id}
                      href={getNotificationLink(notification)}
                      onClick={() => {
                        if (!notification.is_read) markAsRead(notification.id)
                        setIsOpen(false)
                      }}
                      className={`block px-4 py-3 hover:bg-slate-50 transition-colors border-l-4 ${getPriorityColor(notification.priority)} ${!notification.is_read ? 'bg-blue-50/50' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5">{getNotificationIcon(notification.notification_type)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className={`text-sm truncate ${!notification.is_read ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{notification.title}</p>
                            {!notification.is_read && <span className="h-2 w-2 bg-blue-600 rounded-full flex-shrink-0" />}
                          </div>
                          <p className="text-sm text-slate-600 mt-0.5 line-clamp-2">{notification.message}</p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <Clock className="h-3 w-3 text-slate-400" />
                            <span className="text-xs text-slate-400">{getTimeAgo(notification.created_at)}</span>
                            {notification.priority === 'URGENT' && <span className="px-1.5 py-0.5 bg-red-100 text-red-700 text-xs rounded font-medium">Urgent</span>}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-400 mt-1 flex-shrink-0" />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 border-t border-slate-200 bg-slate-50">
              <Link href="/dashboard/tasks" onClick={() => setIsOpen(false)} className="border-r border-slate-200 px-3 py-3 text-center text-sm font-medium text-amber-700 hover:bg-amber-50">My Tasks</Link>
              <Link href="/dashboard/notifications" onClick={() => setIsOpen(false)} className="px-3 py-3 text-center text-sm font-medium text-blue-600 hover:bg-blue-50">All Notifications</Link>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
