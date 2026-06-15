import { supabase } from './supabase'

// Company / organization profile used to brand every report header and download.
export type OrganizationProfile = {
  name: string
  short_name: string
  subtitle: string
  address_line1: string
  address_line2: string
  city: string
  province: string
  postal_code: string
  country: string
  phone: string
  phone_alt: string
  email: string
  website: string
  logo_url: string
  currency: string
}

export const DEFAULT_ORG: OrganizationProfile = {
  name: 'National Judiciary Staff Services',
  short_name: 'NJSS',
  subtitle: 'Court Registry & Expense Monitoring System',
  address_line1: '',
  address_line2: '',
  city: '',
  province: '',
  postal_code: '',
  country: 'Papua New Guinea',
  phone: '',
  phone_alt: '',
  email: '',
  website: '',
  logo_url: '',
  currency: 'PGK',
}

const LS_KEY = 'njss_org_profile'
const SETTING_KEY = 'organization'
let cache: OrganizationProfile | null = null

// Synchronous accessor used by the (synchronous) PDF / Excel / Print generators.
// Falls back to localStorage, then to sensible defaults.
export function getOrg(): OrganizationProfile {
  if (cache) return cache
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(LS_KEY)
      if (raw) {
        cache = { ...DEFAULT_ORG, ...(JSON.parse(raw) as Partial<OrganizationProfile>) }
        return cache
      }
    } catch {
      /* ignore */
    }
  }
  return DEFAULT_ORG
}

export function setOrgCache(org: OrganizationProfile) {
  cache = org
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(org))
    } catch {
      /* ignore */
    }
  }
}

// Load the profile from the database and refresh the cache.
export async function loadOrganization(): Promise<OrganizationProfile> {
  try {
    const { data } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('setting_key', SETTING_KEY)
      .maybeSingle()
    const value = (data?.setting_value || {}) as Partial<OrganizationProfile>
    const org = { ...DEFAULT_ORG, ...value }
    setOrgCache(org)
    preloadLogo(org.logo_url)
    return org
  } catch {
    return getOrg()
  }
}

// Persist the profile (admin only) and refresh the cache.
export async function saveOrganization(org: OrganizationProfile): Promise<void> {
  const { error } = await supabase
    .from('system_settings')
    .upsert(
      {
        setting_key: SETTING_KEY,
        setting_value: org,
        description: 'Organization profile',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'setting_key' }
    )
  if (error) throw error
  setOrgCache(org)
  preloadLogo(org.logo_url)
}

// --- Logo handling (data-URL uploads or external URLs) ---

let logoCache: { src: string; dataUrl: string; w: number; h: number } | null = null
let logoLoading = false

// Preload the logo and resolve it to a PNG data URL so PDF generators can embed
// it synchronously. External (cross-origin) images are converted via canvas when
// CORS allows; otherwise the PDF logo is skipped (HTML headers still show it).
export function preloadLogo(src?: string) {
  if (typeof window === 'undefined') return
  const url = (src ?? getOrg().logo_url ?? '').trim()
  if (!url) {
    logoCache = null
    return
  }
  if (logoCache?.src === url || logoLoading) return
  logoLoading = true
  const img = new window.Image()
  // NB: we intentionally do NOT set crossOrigin. Setting it makes the browser
  // hard-fail (and log a CORS error) for plain external images that don't send
  // CORS headers. Without it the image still displays in HTML headers; external
  // images just can't be re-encoded for PDF embedding (uploads always can).
  img.onload = () => {
    const w = img.naturalWidth || img.width
    const h = img.naturalHeight || img.height
    let dataUrl = url
    if (!url.startsWith('data:')) {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0)
          dataUrl = canvas.toDataURL('image/png')
        }
      } catch {
        dataUrl = '' // cross-origin image — cannot embed in PDF, only display
      }
    }
    logoCache = { src: url, dataUrl, w, h }
    logoLoading = false
  }
  img.onerror = () => {
    logoLoading = false
  }
  img.src = url
}

// Returns a ready logo (data URL + dimensions) for PDF embedding, or null.
export function getLogoForPdf(): { dataUrl: string; w: number; h: number } | null {
  if (typeof window === 'undefined') return null
  const url = (getOrg().logo_url ?? '').trim()
  if (!url) return null
  if (logoCache && logoCache.src === url && logoCache.dataUrl) {
    return { dataUrl: logoCache.dataUrl, w: logoCache.w, h: logoCache.h }
  }
  preloadLogo(url) // warm the cache for next time
  return null
}

// Read a user-selected image file, downscale it, and return a small PNG data URL.
export function fileToLogoDataUrl(file: File, maxDim = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.onload = () => {
      const img = new window.Image()
      img.onerror = () => reject(new Error('Could not load the image'))
      img.onload = () => {
        const ratio = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * ratio))
        const h = Math.max(1, Math.round(img.height * ratio))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas not supported'))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

// --- Header formatting helpers (shared by PDF / Excel / Print) ---

export function orgAddressLine(org: OrganizationProfile): string {
  return [org.address_line1, org.address_line2, org.city, org.province, org.postal_code, org.country]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(', ')
}

export function orgContactLine(org: OrganizationProfile): string {
  const parts: string[] = []
  if (org.phone) parts.push(`Tel: ${org.phone}${org.phone_alt ? ' / ' + org.phone_alt : ''}`)
  if (org.email) parts.push(`Email: ${org.email}`)
  if (org.website) parts.push(org.website)
  return parts.join('   •   ')
}
