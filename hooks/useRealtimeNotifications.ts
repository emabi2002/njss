"use client"

import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { toast } from 'sonner'
import type { RealtimeChannel } from '@supabase/supabase-js'

export type RealtimeNotification = {
  id: string
  user_id: string | null
  notification_type: string
  title: string
  message: string
  reference_type: string
  reference_id: string
  is_read: boolean
  priority: string
  created_at: string
}

// Get notification preferences from localStorage
function getPreferences() {
  if (typeof window === 'undefined') return null
  try {
    const saved = localStorage.getItem('notification_preferences')
    return saved ? JSON.parse(saved) : null
  } catch {
    return null
  }
}

// Play notification sound
function playNotificationSound() {
  const prefs = getPreferences()
  if (prefs?.sound_enabled === false) return

  try {
    // Use a simple beep sound via AudioContext
    const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const oscillator = audioContext.createOscillator()
    const gainNode = audioContext.createGain()

    oscillator.connect(gainNode)
    gainNode.connect(audioContext.destination)

    oscillator.frequency.value = 800
    oscillator.type = 'sine'
    gainNode.gain.value = 0.1

    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.15)
  } catch {
    // Audio not supported
  }
}

// Show browser notification
function showBrowserNotification(title: string, body: string, icon?: string) {
  const prefs = getPreferences()
  if (prefs?.push_enabled === false) return

  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: icon || '/png-emblem.png',
      badge: '/png-emblem.png',
      tag: `notification-${Date.now()}`,
      requireInteraction: false,
    })
  }
}

// Get toast type based on notification type
function getToastType(notificationType: string): 'success' | 'error' | 'info' {
  if (notificationType.includes('REJECTED') || notificationType.includes('CANCELLED')) {
    return 'error'
  }
  if (notificationType.includes('APPROVED') || notificationType.includes('PAID')) {
    return 'success'
  }
  return 'info'
}

export function useRealtimeNotifications(userId?: string) {
  const [notifications, setNotifications] = useState<RealtimeNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)

  // Fetch initial notifications
  const fetchNotifications = useCallback(async () => {
    try {
      let query = supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20)

      if (userId) {
        query = query.or(`user_id.eq.${userId},user_id.is.null`)
      }

      const { data, error } = await query

      if (error) throw error

      setNotifications(data || [])
      setUnreadCount(data?.filter(n => !n.is_read).length || 0)
    } catch (err) {
      console.error('Error fetching notifications:', err)
    } finally {
      setLoading(false)
    }
  }, [userId])

  // Mark notification as read
  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId)

      if (error) throw error

      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, is_read: true } : n)
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (err) {
      console.error('Error marking notification as read:', err)
    }
  }, [])

  // Mark all as read
  const markAllAsRead = useCallback(async () => {
    try {
      const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id)

      if (unreadIds.length === 0) return

      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .in('id', unreadIds)

      if (error) throw error

      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
      setUnreadCount(0)
    } catch (err) {
      console.error('Error marking all as read:', err)
    }
  }, [notifications])

  // Handle new notification
  const handleNewNotification = useCallback((notification: RealtimeNotification) => {
    // Check if notification is for this user or is global
    if (!userId || !notification.user_id || notification.user_id === userId) {
      // Add to state
      setNotifications(prev => [notification, ...prev.slice(0, 19)])
      if (!notification.is_read) {
        setUnreadCount(prev => prev + 1)
      }

      // Show toast notification
      const toastType = getToastType(notification.notification_type)
      switch (toastType) {
        case 'success':
          toast.success(notification.title, { description: notification.message })
          break
        case 'error':
          toast.error(notification.title, { description: notification.message })
          break
        default:
          toast.info(notification.title, { description: notification.message })
      }

      // Play sound
      playNotificationSound()

      // Show browser notification
      showBrowserNotification(notification.title, notification.message)
    }
  }, [userId])

  // Set up real-time subscription
  useEffect(() => {
    // Initial load on mount is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchNotifications()

    // Subscribe to real-time changes
    const channel: RealtimeChannel = supabase
      .channel('notifications-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
        },
        (payload) => {
          const newNotification = payload.new as RealtimeNotification
          handleNewNotification(newNotification)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
        },
        (payload) => {
          const updatedNotification = payload.new as RealtimeNotification
          setNotifications(prev =>
            prev.map(n => n.id === updatedNotification.id ? updatedNotification : n)
          )
          // Recalculate unread count
          setNotifications(prev => {
            setUnreadCount(prev.filter(n => !n.is_read).length)
            return prev
          })
        }
      )
      .subscribe()

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      // Don't auto-request, let user enable in settings
    }

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, fetchNotifications, handleNewNotification])

  return {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    refresh: fetchNotifications,
  }
}
