"use client"

import { useState } from "react"
import Link from "next/link"
import {
  Bell, Check, CheckCheck, FileText, DollarSign, AlertCircle,
  Clock, Trash2, ChevronRight, Filter, Loader2, XCircle
} from "lucide-react"
import { useRealtimeNotifications, type RealtimeNotification } from "@/hooks/useRealtimeNotifications"
import { useAuth } from "@/contexts/AuthContext"

export default function NotificationsPage() {
  const { user } = useAuth()
  const { notifications, loading, markAsRead, markAllAsRead, refresh } = useRealtimeNotifications(user?.id)
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all')
  const [typeFilter, setTypeFilter] = useState<string>('')

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread' && n.is_read) return false
    if (filter === 'read' && !n.is_read) return false
    if (typeFilter && !n.notification_type.startsWith(typeFilter)) return false
    return true
  })

  const unreadCount = notifications.filter(n => !n.is_read).length

  const getNotificationIcon = (type: string) => {
    if (type.startsWith('FF3')) return <FileText className="h-5 w-5 text-blue-600" />
    if (type.startsWith('FF4')) return <DollarSign className="h-5 w-5 text-green-600" />
    return <Bell className="h-5 w-5 text-slate-600" />
  }

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'URGENT':
        return <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full font-medium">Urgent</span>
      case 'HIGH':
        return <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full font-medium">High</span>
      default:
        return null
    }
  }

  const getNotificationLink = (notification: RealtimeNotification) => {
    if (notification.reference_type === 'FF3') {
      return `/dashboard/ff3/${notification.reference_id}`
    }
    if (notification.reference_type === 'FF4') {
      return `/dashboard/ff4/${notification.reference_id}`
    }
    return '#'
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins} minutes ago`
    if (diffHours < 24) return `${diffHours} hours ago`
    if (diffDays < 7) return `${diffDays} days ago`
    return date.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const groupNotificationsByDate = (notifications: RealtimeNotification[]) => {
    const groups: Record<string, RealtimeNotification[]> = {}

    notifications.forEach(n => {
      const date = new Date(n.created_at)
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)

      let key: string
      if (date.toDateString() === today.toDateString()) {
        key = 'Today'
      } else if (date.toDateString() === yesterday.toDateString()) {
        key = 'Yesterday'
      } else if (date > new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)) {
        key = 'This Week'
      } else {
        key = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      }

      if (!groups[key]) groups[key] = []
      groups[key].push(n)
    })

    return groups
  }

  const groupedNotifications = groupNotificationsByDate(filteredNotifications)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Bell className="h-7 w-7 text-slate-700" />
            Notifications
          </h1>
          <p className="text-slate-600 mt-1">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}` : 'All caught up!'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <button
              onClick={() => markAllAsRead()}
              className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2"
            >
              <CheckCheck className="h-4 w-4" />
              Mark All Read
            </button>
          )}
          <button
            onClick={() => refresh()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-700">Filter:</span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === 'all' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('unread')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === 'unread' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Unread ({unreadCount})
            </button>
            <button
              onClick={() => setFilter('read')}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === 'read' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Read
            </button>
          </div>

          <div className="border-l border-slate-200 pl-4">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Types</option>
              <option value="FF3">FF3 Requisitions</option>
              <option value="FF4">FF4 Expenses</option>
            </select>
          </div>
        </div>
      </div>

      {/* Notifications List */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
          </div>
        ) : filteredNotifications.length === 0 ? (
          <div className="text-center py-12">
            <Bell className="h-12 w-12 mx-auto text-slate-300 mb-4" />
            <h3 className="text-lg font-medium text-slate-900">No notifications</h3>
            <p className="text-slate-600 mt-1">
              {filter !== 'all' ? 'Try changing your filters' : "You're all caught up!"}
            </p>
          </div>
        ) : (
          <div>
            {Object.entries(groupedNotifications).map(([dateGroup, items]) => (
              <div key={dateGroup}>
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
                  <h3 className="text-sm font-semibold text-slate-700">{dateGroup}</h3>
                </div>
                <div className="divide-y divide-slate-100">
                  {items.map((notification) => (
                    <div
                      key={notification.id}
                      className={`p-4 hover:bg-slate-50 transition-colors ${
                        !notification.is_read ? 'bg-blue-50/30' : ''
                      }`}
                    >
                      <div className="flex items-start gap-4">
                        <div className={`p-2 rounded-full ${
                          notification.notification_type.startsWith('FF3') ? 'bg-blue-100' :
                          notification.notification_type.startsWith('FF4') ? 'bg-green-100' : 'bg-slate-100'
                        }`}>
                          {getNotificationIcon(notification.notification_type)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className={`text-sm ${!notification.is_read ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
                                  {notification.title}
                                </p>
                                {!notification.is_read && (
                                  <span className="h-2 w-2 bg-blue-600 rounded-full" />
                                )}
                                {getPriorityBadge(notification.priority)}
                              </div>
                              <p className="text-sm text-slate-600 mt-1">{notification.message}</p>
                              <div className="flex items-center gap-3 mt-2">
                                <span className="text-xs text-slate-500 flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  {formatDate(notification.created_at)}
                                </span>
                                <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                                  {notification.reference_type}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 flex-shrink-0">
                              {!notification.is_read && (
                                <button
                                  onClick={() => markAsRead(notification.id)}
                                  className="p-2 hover:bg-slate-100 rounded text-slate-500"
                                  title="Mark as read"
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                              )}
                              <Link
                                href={getNotificationLink(notification)}
                                onClick={() => {
                                  if (!notification.is_read) markAsRead(notification.id)
                                }}
                                className="p-2 hover:bg-slate-100 rounded text-blue-600"
                              >
                                <ChevronRight className="h-4 w-4" />
                              </Link>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notification Settings Link */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">Notification Preferences</p>
          <p className="text-sm text-slate-600">Manage email and push notification settings</p>
        </div>
        <Link
          href="/dashboard/settings"
          className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-white"
        >
          Settings
        </Link>
      </div>
    </div>
  )
}
