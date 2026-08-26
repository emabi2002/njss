import { supabase } from './supabase'

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  const headers = new Headers(init.headers)
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  // User-register reads remain on the RLS-protected Next API. Privileged user
  // mutations are routed to the dedicated server proxy, which forwards the
  // caller JWT to a permission-checking Supabase Edge Function.
  const method = String(init.method || 'GET').toUpperCase()
  const requestInput =
    typeof input === 'string' && input === '/api/admin/users' && method !== 'GET'
      ? '/api/admin/users/write'
      : input

  return fetch(requestInput, { ...init, headers })
}
