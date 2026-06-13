import { supabase } from './supabase'
import { toast } from 'sonner'

export type NotificationType =
  | 'FF3_SUBMITTED'
  | 'FF3_ENDORSED'
  | 'FF3_APPROVED'
  | 'FF3_REJECTED'
  | 'FF4_SUBMITTED'
  | 'FF4_VERIFIED'
  | 'FF4_APPROVED'
  | 'FF4_PROCESSED'
  | 'FF4_PAID'
  | 'FF4_CANCELLED'
  | 'BUDGET_LOW'
  | 'BUDGET_EXCEEDED'
  | 'BUDGET_RELEASED'
  | 'COMMITMENT_CREATED'
  | 'COMMITMENT_EXPIRING'
  | 'COMMITMENT_FULLY_PAID'
  | 'SYSTEM_ALERT'
  | 'SYSTEM_INFO'

export type NotificationPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export type SoundType = 'default' | 'chime' | 'bell' | 'alert' | 'success' | 'none'

export type Notification = {
  id: string
  user_id: string | null
  notification_type: NotificationType
  title: string
  message: string
  reference_type: string
  reference_id: string
  is_read: boolean
  is_email_sent: boolean
  priority: NotificationPriority
  created_at: string
}

// Sound configurations
const SOUNDS: Record<SoundType, { frequency: number; duration: number; pattern: number[] }> = {
  default: { frequency: 800, duration: 0.15, pattern: [1] },
  chime: { frequency: 1200, duration: 0.1, pattern: [1, 0.5, 1] },
  bell: { frequency: 600, duration: 0.2, pattern: [1] },
  alert: { frequency: 400, duration: 0.1, pattern: [1, 1, 1] },
  success: { frequency: 1000, duration: 0.1, pattern: [1, 1.5] },
  none: { frequency: 0, duration: 0, pattern: [] },
}

// Get sound preference from localStorage
function getSoundPreference(): SoundType {
  if (typeof window === 'undefined') return 'default'
  try {
    const prefs = localStorage.getItem('notification_preferences')
    if (prefs) {
      const parsed = JSON.parse(prefs)
      return parsed.sound_type || 'default'
    }
  } catch {}
  return 'default'
}

// Play notification sound with customizable type
export function playNotificationSound(soundType?: SoundType) {
  const type = soundType || getSoundPreference()
  if (type === 'none') return

  const sound = SOUNDS[type] || SOUNDS.default

  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const audioContext = new AudioContextClass()

    let time = audioContext.currentTime

    sound.pattern.forEach((freqMultiplier, index) => {
      const oscillator = audioContext.createOscillator()
      const gainNode = audioContext.createGain()

      oscillator.connect(gainNode)
      gainNode.connect(audioContext.destination)

      oscillator.frequency.value = sound.frequency * freqMultiplier
      oscillator.type = 'sine'
      gainNode.gain.value = 0.1

      const startTime = time + (index * (sound.duration + 0.05))
      oscillator.start(startTime)
      oscillator.stop(startTime + sound.duration)

      time = startTime
    })
  } catch {
    // Audio not supported
  }
}

// Show toast notification
export function showToast(
  type: 'success' | 'error' | 'warning' | 'info',
  title: string,
  description?: string
) {
  switch (type) {
    case 'success':
      toast.success(title, { description })
      break
    case 'error':
      toast.error(title, { description })
      break
    case 'warning':
      toast.warning(title, { description })
      break
    case 'info':
      toast.info(title, { description })
      break
  }
}

// Create a notification record in database
export async function createNotification(data: {
  user_id?: string
  notification_type: NotificationType
  title: string
  message: string
  reference_type: 'FF3' | 'FF4' | 'BUDGET' | 'COMMITMENT' | 'SYSTEM'
  reference_id: string
  priority?: NotificationPriority
  show_toast?: boolean
  sound_type?: SoundType
}): Promise<void> {
  // Determine toast type
  const getToastType = (): 'success' | 'error' | 'warning' | 'info' => {
    if (data.notification_type.includes('REJECTED') || data.notification_type.includes('CANCELLED') || data.notification_type.includes('EXCEEDED')) {
      return 'error'
    }
    if (data.notification_type.includes('APPROVED') || data.notification_type.includes('PAID') || data.notification_type.includes('SUCCESS')) {
      return 'success'
    }
    if (data.notification_type.includes('LOW') || data.notification_type.includes('EXPIRING') || data.notification_type.includes('ALERT')) {
      return 'warning'
    }
    return 'info'
  }

  // Show toast if requested
  if (data.show_toast !== false) {
    showToast(getToastType(), data.title, data.message)
  }

  // Play sound based on type
  if (data.sound_type !== 'none') {
    const soundType = data.notification_type.includes('ALERT') || data.notification_type.includes('EXCEEDED')
      ? 'alert'
      : data.notification_type.includes('APPROVED') || data.notification_type.includes('PAID')
        ? 'success'
        : data.sound_type || 'default'
    playNotificationSound(soundType)
  }

  // Save to database
  try {
    const { error } = await supabase
      .from('notifications')
      .insert({
        user_id: data.user_id || null,
        notification_type: data.notification_type,
        title: data.title,
        message: data.message,
        reference_type: data.reference_type,
        reference_id: data.reference_id,
        priority: data.priority || 'MEDIUM',
        is_read: false,
        is_email_sent: false
      })

    if (error) {
      console.error('Error creating notification:', error)
    }
  } catch (err) {
    console.error('Error creating notification:', err)
  }
}

// Get unread notifications for a user
export async function getUnreadNotifications(userId?: string): Promise<Notification[]> {
  let query = supabase
    .from('notifications')
    .select('*')
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(10)

  if (userId) {
    query = query.or(`user_id.eq.${userId},user_id.is.null`)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching notifications:', error)
    return []
  }

  return data || []
}

// Get all notifications for a user
export async function getAllNotifications(userId?: string): Promise<Notification[]> {
  let query = supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (userId) {
    query = query.or(`user_id.eq.${userId},user_id.is.null`)
  }

  const { data, error } = await query

  if (error) {
    console.error('Error fetching notifications:', error)
    return []
  }

  return data || []
}

// Mark notification as read
export async function markAsRead(notificationId: string): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('id', notificationId)

  if (error) {
    console.error('Error marking notification as read:', error)
  }
}

// Mark all notifications as read for a user
export async function markAllAsRead(userId?: string): Promise<void> {
  let query = supabase
    .from('notifications')
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq('is_read', false)

  if (userId) {
    query = query.or(`user_id.eq.${userId},user_id.is.null`)
  }

  const { error } = await query

  if (error) {
    console.error('Error marking all notifications as read:', error)
  }
}

// ==========================================
// FF3 Notification Helpers
// ==========================================

export async function notifyFF3Submitted(ff3Number: string, ff3Id: string, amount: number, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'FF3_SUBMITTED',
    title: 'FF3 Requisition Submitted',
    message: `${ff3Number} for K ${amount.toLocaleString()} submitted for approval`,
    reference_type: 'FF3',
    reference_id: ff3Number,
    priority: 'HIGH'
  })
}

export async function notifyFF3Endorsed(ff3Number: string, ff3Id: string, level: string, userId?: string): Promise<void> {
  const levelName = level.replace(/_/g, ' ').toLowerCase()
  await createNotification({
    user_id: userId,
    notification_type: 'FF3_ENDORSED',
    title: 'FF3 Endorsed',
    message: `${ff3Number} endorsed at ${levelName} level`,
    reference_type: 'FF3',
    reference_id: ff3Number,
    priority: 'MEDIUM'
  })
}

export async function notifyFF3Approved(ff3Number: string, ff3Id: string, amount: number, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'FF3_APPROVED',
    title: 'FF3 Approved',
    message: `${ff3Number} for K ${amount.toLocaleString()} approved. Commitment created.`,
    reference_type: 'FF3',
    reference_id: ff3Number,
    priority: 'HIGH',
    sound_type: 'success'
  })
}

export async function notifyFF3Rejected(ff3Number: string, ff3Id: string, reason: string, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'FF3_REJECTED',
    title: 'FF3 Rejected',
    message: `${ff3Number} rejected: ${reason.slice(0, 100)}`,
    reference_type: 'FF3',
    reference_id: ff3Number,
    priority: 'HIGH',
    sound_type: 'alert'
  })
}

// ==========================================
// FF4 Notification Helpers
// ==========================================

export async function notifyFF4Submitted(ff4Number: string, ff4Id: string, amount: number, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'FF4_SUBMITTED',
    title: 'FF4 Expense Submitted',
    message: `${ff4Number} for K ${amount.toLocaleString()} submitted for verification`,
    reference_type: 'FF4',
    reference_id: ff4Number,
    priority: 'HIGH'
  })
}

export async function notifyFF4Verified(ff4Number: string, ff4Id: string, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'FF4_VERIFIED',
    title: 'FF4 Verified',
    message: `${ff4Number} verified and ready for approval`,
    reference_type: 'FF4',
    reference_id: ff4Number,
    priority: 'MEDIUM'
  })
}

export async function notifyFF4Approved(ff4Number: string, ff4Id: string, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'FF4_APPROVED',
    title: 'FF4 Approved',
    message: `${ff4Number} approved for payment processing`,
    reference_type: 'FF4',
    reference_id: ff4Number,
    priority: 'MEDIUM'
  })
}

export async function notifyFF4Processed(ff4Number: string, ff4Id: string, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'FF4_PROCESSED',
    title: 'FF4 Processed',
    message: `${ff4Number} processed and ready for payment`,
    reference_type: 'FF4',
    reference_id: ff4Number,
    priority: 'MEDIUM'
  })
}

export async function notifyFF4Paid(ff4Number: string, ff4Id: string, amount: number, reference: string, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'FF4_PAID',
    title: 'Payment Completed',
    message: `${ff4Number} paid K ${amount.toLocaleString()}. Ref: ${reference}`,
    reference_type: 'FF4',
    reference_id: ff4Number,
    priority: 'HIGH',
    sound_type: 'success'
  })
}

export async function notifyFF4Cancelled(ff4Number: string, ff4Id: string, reason?: string, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'FF4_CANCELLED',
    title: 'FF4 Cancelled',
    message: `${ff4Number} cancelled${reason ? `: ${reason.slice(0, 80)}` : ''}`,
    reference_type: 'FF4',
    reference_id: ff4Number,
    priority: 'MEDIUM',
    sound_type: 'alert'
  })
}

// ==========================================
// Budget Notification Helpers
// ==========================================

export async function notifyBudgetLow(percentage: number, availableBalance: number, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'BUDGET_LOW',
    title: 'Budget Running Low',
    message: `Only ${percentage}% budget remaining. Available: K ${availableBalance.toLocaleString()}`,
    reference_type: 'BUDGET',
    reference_id: 'budget-alert',
    priority: 'HIGH',
    sound_type: 'alert'
  })
}

export async function notifyBudgetExceeded(requestedAmount: number, availableBalance: number, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'BUDGET_EXCEEDED',
    title: 'Budget Exceeded',
    message: `Request of K ${requestedAmount.toLocaleString()} exceeds available K ${availableBalance.toLocaleString()}`,
    reference_type: 'BUDGET',
    reference_id: 'budget-exceeded',
    priority: 'URGENT',
    sound_type: 'alert'
  })
}

export async function notifyBudgetReleased(quarter: number, amount: number, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'BUDGET_RELEASED',
    title: 'Quarterly Budget Released',
    message: `Q${quarter} budget of K ${amount.toLocaleString()} has been released`,
    reference_type: 'BUDGET',
    reference_id: `q${quarter}-release`,
    priority: 'HIGH',
    sound_type: 'chime'
  })
}

// ==========================================
// Commitment Notification Helpers
// ==========================================

export async function notifyCommitmentCreated(commitmentNumber: string, ff3Number: string, amount: number, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'COMMITMENT_CREATED',
    title: 'Commitment Created',
    message: `${commitmentNumber} created for ${ff3Number} - K ${amount.toLocaleString()}`,
    reference_type: 'COMMITMENT',
    reference_id: commitmentNumber,
    priority: 'MEDIUM',
    sound_type: 'chime'
  })
}

export async function notifyCommitmentExpiring(commitmentNumber: string, daysRemaining: number, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'COMMITMENT_EXPIRING',
    title: 'Commitment Expiring Soon',
    message: `${commitmentNumber} will expire in ${daysRemaining} days`,
    reference_type: 'COMMITMENT',
    reference_id: commitmentNumber,
    priority: 'HIGH',
    sound_type: 'alert'
  })
}

export async function notifyCommitmentFullyPaid(commitmentNumber: string, totalPaid: number, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'COMMITMENT_FULLY_PAID',
    title: 'Commitment Fully Paid',
    message: `${commitmentNumber} fully paid - Total: K ${totalPaid.toLocaleString()}`,
    reference_type: 'COMMITMENT',
    reference_id: commitmentNumber,
    priority: 'MEDIUM',
    sound_type: 'success'
  })
}

// ==========================================
// System Notification Helpers
// ==========================================

export async function notifySystemAlert(title: string, message: string, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'SYSTEM_ALERT',
    title,
    message,
    reference_type: 'SYSTEM',
    reference_id: 'system-alert',
    priority: 'URGENT',
    sound_type: 'alert'
  })
}

export async function notifySystemInfo(title: string, message: string, userId?: string): Promise<void> {
  await createNotification({
    user_id: userId,
    notification_type: 'SYSTEM_INFO',
    title,
    message,
    reference_type: 'SYSTEM',
    reference_id: 'system-info',
    priority: 'LOW',
    sound_type: 'chime'
  })
}

// Get notification count badge
export async function getNotificationCount(userId?: string): Promise<number> {
  let query = supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false)

  if (userId) {
    query = query.or(`user_id.eq.${userId},user_id.is.null`)
  }

  const { count, error } = await query

  if (error) {
    console.error('Error getting notification count:', error)
    return 0
  }

  return count || 0
}

// ==========================================
// Budget Check Helper (call this when creating FF3)
// ==========================================

export async function checkBudgetAndNotify(requestedAmount: number, userId?: string): Promise<boolean> {
  try {
    // Get current budget status
    const { data: releases } = await supabase
      .from('quarterly_releases')
      .select('released_amount')
      .eq('financial_year', 2025)

    const { data: commitments } = await supabase
      .from('ff3_commitments')
      .select('committed_amount, paid_amount')
      .eq('financial_year', 2025)

    const quarterlyReleased = releases?.reduce((sum, r) => sum + (r.released_amount || 0), 0) || 0
    const committedAmount = commitments?.reduce((sum, c) => sum + ((c.committed_amount || 0) - (c.paid_amount || 0)), 0) || 0
    const actualExpenditure = commitments?.reduce((sum, c) => sum + (c.paid_amount || 0), 0) || 0
    const availableBalance = quarterlyReleased - committedAmount - actualExpenditure

    // Check if budget would be exceeded
    if (requestedAmount > availableBalance) {
      await notifyBudgetExceeded(requestedAmount, availableBalance, userId)
      return false
    }

    // Check if budget is running low (less than 20%)
    const percentageRemaining = (availableBalance / quarterlyReleased) * 100
    if (percentageRemaining < 20) {
      await notifyBudgetLow(Math.round(percentageRemaining), availableBalance, userId)
    }

    return true
  } catch (error) {
    console.error('Error checking budget:', error)
    return true // Allow to proceed on error
  }
}
