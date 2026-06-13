"use client"

import { useState, useEffect } from "react"
import {
  Settings, Bell, Mail, User, Shield, Save, Loader2,
  CheckCircle2, AlertCircle, Volume2, VolumeX, Smartphone,
  Play, Wallet, FileText, DollarSign
} from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { toast } from "sonner"
import { playNotificationSound, type SoundType } from "@/lib/notifications"

type NotificationPreferences = {
  // Notification types
  ff3_submitted: boolean
  ff3_approved: boolean
  ff3_rejected: boolean
  ff4_submitted: boolean
  ff4_paid: boolean
  budget_low: boolean
  budget_exceeded: boolean
  commitment_expiring: boolean
  // Delivery methods
  email_enabled: boolean
  push_enabled: boolean
  sound_enabled: boolean
  sound_type: SoundType
}

const defaultPreferences: NotificationPreferences = {
  ff3_submitted: true,
  ff3_approved: true,
  ff3_rejected: true,
  ff4_submitted: true,
  ff4_paid: true,
  budget_low: true,
  budget_exceeded: true,
  commitment_expiring: true,
  email_enabled: true,
  push_enabled: true,
  sound_enabled: true,
  sound_type: 'default',
}

const SOUND_OPTIONS: { value: SoundType; label: string; description: string }[] = [
  { value: 'default', label: 'Default', description: 'Standard notification tone' },
  { value: 'chime', label: 'Chime', description: 'Pleasant multi-tone chime' },
  { value: 'bell', label: 'Bell', description: 'Single bell sound' },
  { value: 'alert', label: 'Alert', description: 'Urgent alert pattern' },
  { value: 'success', label: 'Success', description: 'Success confirmation tone' },
  { value: 'none', label: 'None', description: 'No sound' },
]

export default function SettingsPage() {
  const { user, profile } = useAuth()
  const [saving, setSaving] = useState(false)
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences)
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default')
  const [activeTab, setActiveTab] = useState<'notifications' | 'profile' | 'security'>('notifications')

  useEffect(() => {
    // Load preferences from localStorage
    const saved = localStorage.getItem('notification_preferences')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        // Loading once from localStorage on mount is intentional here.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPreferences({ ...defaultPreferences, ...parsed })
      } catch {
        // Use defaults
      }
    }

    // Check push notification permission
    if ('Notification' in window) {
      setPushPermission(Notification.permission)
    }
  }, [])

  const handleSavePreferences = async () => {
    setSaving(true)
    try {
      localStorage.setItem('notification_preferences', JSON.stringify(preferences))
      toast.success('Settings saved', { description: 'Your notification preferences have been updated' })
    } catch {
      toast.error('Error', { description: 'Failed to save preferences' })
    } finally {
      setSaving(false)
    }
  }

  const requestPushPermission = async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission()
      setPushPermission(permission)
      if (permission === 'granted') {
        toast.success('Push notifications enabled')
        setPreferences(prev => ({ ...prev, push_enabled: true }))
      } else {
        toast.error('Push notifications blocked', {
          description: 'Please enable notifications in your browser settings'
        })
      }
    }
  }

  const togglePreference = (key: keyof NotificationPreferences) => {
    setPreferences(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const previewSound = (soundType: SoundType) => {
    playNotificationSound(soundType)
  }

  const tabs = [
    { id: 'notifications' as const, label: 'Notifications', icon: Bell },
    { id: 'profile' as const, label: 'Profile', icon: User },
    { id: 'security' as const, label: 'Security', icon: Shield },
  ]

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Settings className="h-7 w-7 text-slate-700" />
          Settings
        </h1>
        <p className="text-slate-600 mt-1">Manage your account and notification preferences</p>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg border border-slate-200">
        <div className="flex border-b border-slate-200">
          {tabs.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            )
          })}
        </div>

        <div className="p-6">
          {/* Notifications Tab */}
          {activeTab === 'notifications' && (
            <div className="space-y-6">
              {/* Sound Customization Section */}
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Volume2 className="h-5 w-5 text-slate-600" />
                  Sound Settings
                </h3>

                <div className="space-y-4">
                  {/* Enable/Disable Sound */}
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      {preferences.sound_enabled ? (
                        <Volume2 className="h-5 w-5 text-slate-600" />
                      ) : (
                        <VolumeX className="h-5 w-5 text-slate-400" />
                      )}
                      <div>
                        <p className="font-medium text-slate-900">Sound Alerts</p>
                        <p className="text-sm text-slate-600">Play sound for new notifications</p>
                      </div>
                    </div>
                    <ToggleSwitch
                      enabled={preferences.sound_enabled}
                      onChange={() => togglePreference('sound_enabled')}
                    />
                  </div>

                  {/* Sound Type Selection */}
                  {preferences.sound_enabled && (
                    <div className="border border-slate-200 rounded-lg p-4">
                      <label className="block text-sm font-medium text-slate-700 mb-3">
                        Choose Notification Sound
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {SOUND_OPTIONS.map((sound) => (
                          <div
                            key={sound.value}
                            className={`relative flex items-center p-3 rounded-lg border cursor-pointer transition-all ${
                              preferences.sound_type === sound.value
                                ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                                : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                            }`}
                            onClick={() => setPreferences(prev => ({ ...prev, sound_type: sound.value }))}
                          >
                            <input
                              type="radio"
                              name="sound_type"
                              value={sound.value}
                              checked={preferences.sound_type === sound.value}
                              onChange={() => setPreferences(prev => ({ ...prev, sound_type: sound.value }))}
                              className="h-4 w-4 text-blue-600 border-slate-300"
                            />
                            <div className="ml-3 flex-1">
                              <p className="text-sm font-medium text-slate-900">{sound.label}</p>
                              <p className="text-xs text-slate-500">{sound.description}</p>
                            </div>
                            {sound.value !== 'none' && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  previewSound(sound.value)
                                }}
                                className="p-1.5 rounded-full hover:bg-blue-100 text-blue-600"
                                title="Preview sound"
                              >
                                <Play className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Delivery Methods */}
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Delivery Methods</h3>
                <div className="space-y-3">
                  {/* Push Notifications */}
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Smartphone className="h-5 w-5 text-slate-600" />
                      <div>
                        <p className="font-medium text-slate-900">Push Notifications</p>
                        <p className="text-sm text-slate-600">Receive browser notifications</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {pushPermission !== 'granted' && (
                        <button
                          onClick={requestPushPermission}
                          className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                        >
                          Enable
                        </button>
                      )}
                      <ToggleSwitch
                        enabled={preferences.push_enabled && pushPermission === 'granted'}
                        onChange={() => togglePreference('push_enabled')}
                        disabled={pushPermission !== 'granted'}
                      />
                    </div>
                  </div>

                  {/* Email Notifications */}
                  <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <Mail className="h-5 w-5 text-slate-600" />
                      <div>
                        <p className="font-medium text-slate-900">Email Notifications</p>
                        <p className="text-sm text-slate-600">Receive email alerts for important updates</p>
                      </div>
                    </div>
                    <ToggleSwitch
                      enabled={preferences.email_enabled}
                      onChange={() => togglePreference('email_enabled')}
                    />
                  </div>
                </div>
              </div>

              {/* FF3 Notifications */}
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  <FileText className="h-5 w-5 text-blue-600" />
                  FF3 Requisitions
                </h3>
                <div className="space-y-2">
                  <NotificationOption
                    label="Requisition Submitted"
                    description="When a new FF3 is submitted for approval"
                    enabled={preferences.ff3_submitted}
                    onChange={() => togglePreference('ff3_submitted')}
                  />
                  <NotificationOption
                    label="Requisition Approved"
                    description="When an FF3 is approved and commitment created"
                    enabled={preferences.ff3_approved}
                    onChange={() => togglePreference('ff3_approved')}
                  />
                  <NotificationOption
                    label="Requisition Rejected"
                    description="When an FF3 is rejected"
                    enabled={preferences.ff3_rejected}
                    onChange={() => togglePreference('ff3_rejected')}
                  />
                </div>
              </div>

              {/* FF4 Notifications */}
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-green-600" />
                  FF4 Expenses
                </h3>
                <div className="space-y-2">
                  <NotificationOption
                    label="Expense Submitted"
                    description="When a new FF4 is submitted for verification"
                    enabled={preferences.ff4_submitted}
                    onChange={() => togglePreference('ff4_submitted')}
                  />
                  <NotificationOption
                    label="Payment Completed"
                    description="When an FF4 payment is processed"
                    enabled={preferences.ff4_paid}
                    onChange={() => togglePreference('ff4_paid')}
                  />
                </div>
              </div>

              {/* Budget Alerts */}
              <div>
                <h3 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-amber-600" />
                  Budget Alerts
                </h3>
                <div className="space-y-2">
                  <NotificationOption
                    label="Budget Running Low"
                    description="When available budget falls below 20%"
                    enabled={preferences.budget_low}
                    onChange={() => togglePreference('budget_low')}
                  />
                  <NotificationOption
                    label="Budget Exceeded"
                    description="When a request exceeds available budget"
                    enabled={preferences.budget_exceeded}
                    onChange={() => togglePreference('budget_exceeded')}
                  />
                  <NotificationOption
                    label="Commitment Expiring"
                    description="When a commitment is about to expire"
                    enabled={preferences.commitment_expiring}
                    onChange={() => togglePreference('commitment_expiring')}
                  />
                </div>
              </div>

              {/* Save Button */}
              <div className="pt-4 border-t border-slate-200">
                <button
                  onClick={handleSavePreferences}
                  disabled={saving}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Save Preferences
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Profile Tab */}
          {activeTab === 'profile' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <User className="h-5 w-5 text-slate-600" />
                Profile Information
              </h3>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    value={profile?.name || ''}
                    disabled
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                  <input
                    type="email"
                    value={user?.email || ''}
                    disabled
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                  <input
                    type="text"
                    value={profile?.role || 'Staff'}
                    disabled
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-600"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Department</label>
                  <input
                    type="text"
                    value={profile?.department || '-'}
                    disabled
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-600"
                  />
                </div>
              </div>
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-900">Profile Updates</p>
                    <p className="text-sm text-amber-700 mt-1">
                      To update your profile information, please contact your system administrator.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Security Tab */}
          {activeTab === 'security' && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <Shield className="h-5 w-5 text-slate-600" />
                Security Settings
              </h3>
              <div className="space-y-4">
                <div className="p-4 bg-slate-50 rounded-lg">
                  <p className="font-medium text-slate-900">Change Password</p>
                  <p className="text-sm text-slate-600 mt-1">
                    To change your password, please use the &quot;Forgot Password&quot; link on the login page.
                  </p>
                  <a
                    href="/forgot-password"
                    className="inline-block mt-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
                  >
                    Reset Password →
                  </a>
                </div>
                <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-green-900">Session Active</p>
                      <p className="text-sm text-green-700 mt-1">
                        Your session is secure and managed by Supabase Auth.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-slate-50 rounded-lg">
                  <p className="font-medium text-slate-900">Two-Factor Authentication</p>
                  <p className="text-sm text-slate-600 mt-1">
                    Two-factor authentication adds an extra layer of security to your account.
                  </p>
                  <p className="text-xs text-slate-500 mt-2">Coming soon</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ToggleSwitch({
  enabled,
  onChange,
  disabled = false
}: {
  enabled: boolean
  onChange: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onChange}
      disabled={disabled}
      className={`
        relative inline-flex h-6 w-11 items-center rounded-full transition-colors
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${enabled ? 'bg-blue-600' : 'bg-slate-300'}
      `}
    >
      <span
        className={`
          inline-block h-4 w-4 transform rounded-full bg-white transition-transform
          ${enabled ? 'translate-x-6' : 'translate-x-1'}
        `}
      />
    </button>
  )
}

function NotificationOption({
  label,
  description,
  enabled,
  onChange
}: {
  label: string
  description: string
  enabled: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:bg-slate-50">
      <div>
        <p className="font-medium text-slate-900">{label}</p>
        <p className="text-sm text-slate-600">{description}</p>
      </div>
      <ToggleSwitch enabled={enabled} onChange={onChange} />
    </div>
  )
}
