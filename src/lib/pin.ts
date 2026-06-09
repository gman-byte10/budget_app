// Lightweight PIN gate. The PIN hash lives in localStorage (device-specific, never
// exported), with a per-session unlock flag in sessionStorage. This is a privacy
// DETERRENT for a public URL — not encryption; data already lives only on-device.

const HASH_KEY = 'budget.pinHash'
const UNLOCK_KEY = 'budget.unlocked'
const SALT = 'budget-pin-v1:'

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SALT + s))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function hasPin(): boolean {
  return !!localStorage.getItem(HASH_KEY)
}

export async function setPin(pin: string): Promise<void> {
  localStorage.setItem(HASH_KEY, await sha256(pin))
  sessionStorage.setItem(UNLOCK_KEY, '1')
}

export function clearPin(): void {
  localStorage.removeItem(HASH_KEY)
  sessionStorage.removeItem(UNLOCK_KEY)
}

export async function verifyPin(pin: string): Promise<boolean> {
  const stored = localStorage.getItem(HASH_KEY)
  if (!stored) return true
  return (await sha256(pin)) === stored
}

/** Unlocked if there's no PIN set, or it's been entered this session. */
export function isUnlocked(): boolean {
  return !hasPin() || sessionStorage.getItem(UNLOCK_KEY) === '1'
}

export function markUnlocked(): void {
  sessionStorage.setItem(UNLOCK_KEY, '1')
}
