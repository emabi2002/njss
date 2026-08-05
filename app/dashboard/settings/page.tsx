"use client"

import { useState, useEffect, useRef } from "react"
import {
  Settings, Bell, Mail, User, Shield, Save, Loader2,
  CheckCircle2, AlertCircle, Volume2, VolumeX, Smartphone,
  Play, Wallet, FileText, DollarSign, Building2, MapPin, Phone, Globe,
  Upload, Trash2, ImagePlus
} from "lucide-react"
import { useAuth } from "@/contexts/AuthContext"
import { toast } from "sonner"
import { playNotificationSound, type SoundType } from "@/lib/notifications"
import {
  loadOrganization, saveOrganization, orgAddressLine, orgContactLine,
  fileToLogoDataUrl, DEFAULT_ORG, type OrganizationProfile
} from "@/lib/org"

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
  const { user, profile, can } = useAuth()
  const canManageOrg = can('masterdata.manage')
  const [saving, setSaving] = useState(false)
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences)
  const [pushPermission, setPushPermission] = useState<NotificationPermission>('default')
  const [activeTab, setActiveTab] = useState<'organization' | 'notifications' | 'profile' | 'security'>(
    canManageOrg ? 'organization' : 'notifications'
  )

  // Organization profile (admin-managed) — drives report/export headers
  const [org, setOrg] = useState<OrganizationProfile>(DEFAULT_ORG)
  const [orgLoading, setOrgLoading] = useState(true)
  const [orgSaving, setOrgSaving] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  // Tracks the last logo URL that failed to load, to show fallback + guidance.
  const [failedLogo, setFailedLogo] = useState('')
  const logoInputRef = useRef<HTMLInputElement>(null)
  const logoPreviewError = !!org.logo_url && failedLogo === org.logo_url

  useEffect(() => {
    loadOrganization()
      .then((o) => setOrg(o))
      .finally(() => setOrgLoading(false))
  }, [])

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

  const updateOrg = (key: keyof OrganizationProfile, value: string) =>
    setOrg((prev) => ({ ...prev, [key]: value }))

  const handleLogoFile = async (file: File | undefined | null) => {
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image too large', { description: 'Please choose an image under 5MB' })
      return
    }
    setLogoBusy(true)
    try {
      const dataUrl = await fileToLogoDataUrl(file, 256)
      updateOrg('logo_url', dataUrl)
      toast.success('Logo added', { description: "Click 'Save Organization' to apply it everywhere" })
    } catch (e) {
      toast.error('Could not load image', {
        description: e instanceof Error ? e.message : 'Please try a different file',
      })
    } finally {
      setLogoBusy(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

  const handleSaveOrg = async () => {
    setOrgSaving(true)
    try {
      await saveOrganization(org)
      toast.success('Organization saved', {
        description: 'Company details will now appear on all reports and downloads',
      })
    } catch {
      toast.error('Error', { description: 'Failed to save organization details' })
    } finally {
      setOrgSaving(false)
    }
  }

  const tabs = [
    ...(canManageOrg ? [{ id: 'organization' as const, label: 'Organization', icon: Building2 }] : []),
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
        <p className="text-slate-600 mt-1">
          {canManageOrg
            ? 'Manage organization details, account and notification preferences'
            : 'Manage your account and notification preferences'}
        </p>
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
          {/* Organization Tab (admin only) */}
          {activeTab === 'organization' && canManageOrg && (
            <div className="space-y-8">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-png-red" />
                  Organization Profile
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  These details form the header of every report, PDF, Excel export and printout.
                </p>
              </div>

              {orgLoading ? (
                <div className="flex items-center gap-2 text-slate-500 py-8">
                  <Loader2 className="h-5 w-5 animate-spin" /> Loading organization details...
                </div>
              ) : (
                <>
                  {/* Live header preview */}
                  <div className="rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                    <div className="h-1 bg-gradient-to-r from-png-red via-png-gold to-png-red" />
                    <div className="bg-png-red text-white px-5 py-4 text-center">
                      {org.logo_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={org.logo_url} alt="" className="h-10 mx-auto mb-2 object-contain" />
                      )}
                      <p className="text-base font-bold tracking-wide uppercase">
                        {org.name || 'Organization Name'}
                      </p>
                      {orgAddressLine(org) && (
                        <p className="text-[11px] text-white/90 mt-0.5">{orgAddressLine(org)}</p>
                      )}
                      {orgContactLine(org) && (
                        <p className="text-[11px] text-white/90">{orgContactLine(org)}</p>
                      )}
                    </div>
                    <p className="text-center text-xs text-slate-400 py-1.5 bg-slate-50">
                      Live report-header preview
                    </p>
                  </div>

                  {/* Identity */}
                  <section className="space-y-4">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Identity</h4>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="sm:col-span-2">
                        <OrgInput label="Organization Name *" value={org.name} onChange={(v) => updateOrg('name', v)} placeholder="National Judiciary Staff Services" icon={Building2} />
                      </div>
                      <OrgInput label="Short Name / Abbreviation" value={org.short_name} onChange={(v) => updateOrg('short_name', v)} placeholder="NJSS" />
                      <OrgInput label="Tagline / Subtitle" value={org.subtitle} onChange={(v) => updateOrg('subtitle', v)} placeholder="Court Registry & Expense Monitoring System" />
                    </div>
                  </section>

                  {/* Address */}
                  <section className="space-y-4">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5" /> Address
                    </h4>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="sm:col-span-2">
                        <OrgInput label="Address Line 1" value={org.address_line1} onChange={(v) => updateOrg('address_line1', v)} placeholder="P.O. Box 123 / Street address" />
                      </div>
                      <div className="sm:col-span-2">
                        <OrgInput label="Address Line 2" value={org.address_line2} onChange={(v) => updateOrg('address_line2', v)} placeholder="Building, floor, suite (optional)" />
                      </div>
                      <OrgInput label="City / Town" value={org.city} onChange={(v) => updateOrg('city', v)} placeholder="Port Moresby" />
                      <OrgInput label="Province / Region" value={org.province} onChange={(v) => updateOrg('province', v)} placeholder="National Capital District" />
                      <OrgInput label="Postal Code" value={org.postal_code} onChange={(v) => updateOrg('postal_code', v)} placeholder="111" />
                      <OrgInput label="Country" value={org.country} onChange={(v) => updateOrg('country', v)} placeholder="Papua New Guinea" />
                    </div>
                  </section>

                  {/* Contact */}
                  <section className="space-y-4">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Phone className="h-3.5 w-3.5" /> Contact
                    </h4>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <OrgInput label="Primary Phone" value={org.phone} onChange={(v) => updateOrg('phone', v)} placeholder="+675 000 0000" icon={Phone} type="tel" />
                      <OrgInput label="Alternate Phone" value={org.phone_alt} onChange={(v) => updateOrg('phone_alt', v)} placeholder="+675 000 0001" icon={Phone} type="tel" />
                      <OrgInput label="Email" value={org.email} onChange={(v) => updateOrg('email', v)} placeholder="info@njss.gov.pg" icon={Mail} type="email" />
                      <OrgInput label="Website" value={org.website} onChange={(v) => updateOrg('website', v)} placeholder="www.njss.gov.pg" icon={Globe} />
                    </div>
                  </section>

                  {/* Branding */}
                  <section className="space-y-4">
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                      <ImagePlus className="h-3.5 w-3.5" /> Branding
                    </h4>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Organization Logo</label>
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="h-20 w-20 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                          {org.logo_url && !logoPreviewError ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={org.logo_url}
                              alt="Logo preview"
                              className="h-full w-full object-contain"
                              onError={() => setFailedLogo(org.logo_url)}
                            />
                          ) : (
                            <ImagePlus className="h-7 w-7 text-slate-300" />
                          )}
                        </div>
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => logoInputRef.current?.click()}
                              disabled={logoBusy}
                              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              {logoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                              {org.logo_url ? 'Change logo' : 'Upload logo'}
                            </button>
                            {org.logo_url && (
                              <button
                                type="button"
                                onClick={() => updateOrg('logo_url', '')}
                                className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                              >
                                <Trash2 className="h-4 w-4" /> Remove
                              </button>
                            )}
                          </div>
                          {logoPreviewError ? (
                            <p className="text-xs text-red-600">
                              Couldn&apos;t load an image from that link. Upload a file instead, or use a direct image URL ending in .png / .jpg (a website address won&apos;t work).
                            </p>
                          ) : (
                            <p className="text-xs text-slate-500">
                              PNG or JPG, up to 5MB. Uploading is recommended — it also embeds into PDFs.
                            </p>
                          )}
                        </div>
                        <input
                          ref={logoInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => handleLogoFile(e.target.files?.[0])}
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <OrgInput
                        label="Or paste a direct image URL (.png / .jpg)"
                        value={org.logo_url.startsWith('data:') ? '' : org.logo_url}
                        onChange={(v) => updateOrg('logo_url', v)}
                        placeholder="https://example.com/logo.png"
                        icon={Globe}
                      />
                      <OrgInput label="Currency Code" value={org.currency} onChange={(v) => updateOrg('currency', v)} placeholder="PGK" />
                    </div>
                  </section>

                  {/* Save */}
                  <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center gap-3">
                    <button
                      onClick={handleSaveOrg}
                      disabled={orgSaving || !org.name.trim()}
                      className="px-6 py-2.5 bg-png-red text-white rounded-lg font-medium hover:bg-png-maroon disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      {orgSaving ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Saving...
                        </>
                      ) : (
                        <>
                          <Save className="h-4 w-4" /> Save Organization
                        </>
                      )}
                    </button>
                    <span className="text-xs text-slate-500">
                      Applies to all users&apos; reports and downloads.
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

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

function OrgInput({
  label,
  value,
  onChange,
  placeholder,
  icon: Icon,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  icon?: typeof Building2
  type?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <div className="relative">
        {Icon && <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full ${Icon ? 'pl-9' : 'pl-3'} pr-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-png-red`}
        />
      </div>
    </div>
  )
}
