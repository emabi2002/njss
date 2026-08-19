/**
 * NJSS password policy.
 *
 * Shared by the browser (live form feedback) and the server-side administration
 * API (authoritative enforcement). Nothing in this module logs, returns or
 * persists a password value.
 */

export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnopqrstuvwxyz'
const DIGIT = '23456789'
const SPECIAL = '!@#$%^&*()-_=+[]{}:,.?'

export type PasswordRule = {
  id: 'length' | 'upper' | 'lower' | 'number' | 'special'
  label: string
  passed: boolean
}

export function evaluatePassword(password: string): PasswordRule[] {
  const value = password || ''
  return [
    { id: 'length', label: `At least ${PASSWORD_MIN_LENGTH} characters`, passed: value.length >= PASSWORD_MIN_LENGTH },
    { id: 'upper', label: 'One upper-case letter', passed: /[A-Z]/.test(value) },
    { id: 'lower', label: 'One lower-case letter', passed: /[a-z]/.test(value) },
    { id: 'number', label: 'One number', passed: /[0-9]/.test(value) },
    { id: 'special', label: 'One special character', passed: /[^A-Za-z0-9]/.test(value) },
  ]
}

/**
 * Authoritative policy check. Returns a list of human-readable failures.
 * The password itself is never included in the returned messages.
 */
export function validatePassword(password: string, confirmation?: string): string[] {
  const errors: string[] = []
  const value = password || ''

  if (value.length > PASSWORD_MAX_LENGTH) {
    errors.push(`Password must not exceed ${PASSWORD_MAX_LENGTH} characters.`)
  }

  for (const rule of evaluatePassword(value)) {
    if (!rule.passed) errors.push(`Password must contain: ${rule.label.toLowerCase()}.`)
  }

  if (confirmation !== undefined && value !== confirmation) {
    errors.push('Password and confirmation do not match.')
  }

  return errors
}

export function isPasswordCompliant(password: string) {
  return validatePassword(password).length === 0
}

function randomBytes(length: number): Uint8Array {
  const buffer = new Uint8Array(length)
  const cryptoObj = globalThis.crypto
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(buffer)
    return buffer
  }
  // Extremely defensive fallback; every supported runtime provides Web Crypto.
  for (let i = 0; i < length; i += 1) buffer[i] = Math.floor(Math.random() * 256)
  return buffer
}

function pick(alphabet: string) {
  const [byte] = randomBytes(1)
  return alphabet[byte % alphabet.length]
}

/**
 * Generates a compliant temporary password.
 * Ambiguous glyphs (O/0, I/l/1) are excluded so the value can be read aloud or
 * transcribed accurately when handed over through a separate secure channel.
 */
export function generateTemporaryPassword(length = 16): string {
  const target = Math.max(PASSWORD_MIN_LENGTH, Math.min(length, 32))
  const all = UPPER + LOWER + DIGIT + SPECIAL

  const characters = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SPECIAL)]
  while (characters.length < target) characters.push(pick(all))

  // Fisher-Yates shuffle so the guaranteed characters are not always leading.
  for (let i = characters.length - 1; i > 0; i -= 1) {
    const [byte] = randomBytes(1)
    const j = byte % (i + 1)
    ;[characters[i], characters[j]] = [characters[j], characters[i]]
  }

  const candidate = characters.join('')
  return isPasswordCompliant(candidate) ? candidate : generateTemporaryPassword(target)
}

/**
 * Strips anything password-shaped from an object before it is audited, logged
 * or returned to a client. Used as a last line of defence in the admin API.
 */
const SENSITIVE_KEY = /pass|secret|token|credential|otp|pin/i

export function redactSensitive<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item)) as unknown as T
  }
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(source)) {
      if (SENSITIVE_KEY.test(key)) continue
      output[key] = redactSensitive(item)
    }
    return output as unknown as T
  }
  return value
}
