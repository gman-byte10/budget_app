// ---------------------------------------------------------------------------
// Cross-device sync. Whole-document, last-write-wins. Your data is encrypted on
// THIS device with your passphrase before it's sent up, so the server only ever
// stores ciphertext it can't read. The passphrase also derives the server key
// (its hash), so the same passphrase on another device reaches the same blob.
//
//   pull  : fetch ciphertext → decrypt → import (replaces local) if newer
//   push  : export all tables → encrypt → store (debounced after edits)
// ---------------------------------------------------------------------------
import { db } from '../db/db'
import { exportAll, importAll } from './backup'

const PASS_KEY = 'budget.syncPass'
const AT_KEY = 'budget.syncUpdatedAt'

export interface SyncState {
  configured: boolean
  syncing: boolean
  lastSyncedAt: number | null
  error: string | null
}

let state: SyncState = { configured: false, syncing: false, lastSyncedAt: null, error: null }
let listeners: Array<() => void> = []
let dirty = false
let suppress = false // true while applying a remote import (don't re-mark dirty)
let pushTimer: ReturnType<typeof setTimeout> | null = null
let inited = false

function emit() {
  for (const l of listeners) l()
}
export function onSyncChange(l: () => void): () => void {
  listeners.push(l)
  return () => {
    listeners = listeners.filter((x) => x !== l)
  }
}
export function getSyncState(): SyncState {
  return state
}

export function syncConfigured(): boolean {
  return !!localStorage.getItem(PASS_KEY)
}
function getPass(): string | null {
  return localStorage.getItem(PASS_KEY)
}
function localUpdatedAt(): number {
  return parseInt(localStorage.getItem(AT_KEY) || '0', 10)
}
function setLocalUpdatedAt(ms: number) {
  localStorage.setItem(AT_KEY, String(ms))
  state = { ...state, lastSyncedAt: ms }
  emit()
}

// ---- crypto (PBKDF2 → AES-GCM) ----
const enc = new TextEncoder()
const dec = new TextDecoder()
const b64 = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

async function aesKey(pass: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('budget-sync-salt-v1'), iterations: 100_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}
async function keyIdFor(pass: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', enc.encode('budget-sync-id-v1:' + pass))
  return Array.from(new Uint8Array(h))
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('')
}
async function encryptStr(pass: string, plain: string): Promise<string> {
  const key = await aesKey(pass)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain))
  const out = new Uint8Array(iv.length + ct.byteLength)
  out.set(iv, 0)
  out.set(new Uint8Array(ct), iv.length)
  return b64(out.buffer)
}
async function decryptStr(pass: string, payload: string): Promise<string> {
  const key = await aesKey(pass)
  const data = unb64(payload)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, key, data.slice(12))
  return dec.decode(pt)
}

// ---- network ----
interface Blob {
  payload: string
  updatedAt: number
}
async function remoteGet(pass: string): Promise<Blob | null> {
  const key = await keyIdFor(pass)
  const r = await fetch('/api/sync/get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
  if (!r.ok) throw new Error((await r.text().catch(() => '')) || `Sync server error (${r.status})`)
  return (await r.json()) as Blob | null
}
async function remotePut(pass: string, payload: string, updatedAt: number) {
  const key = await keyIdFor(pass)
  const r = await fetch('/api/sync/put', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, payload, updatedAt }),
  })
  if (!r.ok) throw new Error((await r.text().catch(() => '')) || `Sync server error (${r.status})`)
  return (await r.json()) as { ok: boolean; stale?: boolean; server?: Blob; updatedAt?: number }
}

// ---- apply / push ----
async function applyRemote(backupJson: string, updatedAt: number) {
  suppress = true
  try {
    await importAll(backupJson)
  } finally {
    suppress = false
  }
  dirty = false
  setLocalUpdatedAt(updatedAt)
}

export async function pushLocal(): Promise<void> {
  const pass = getPass()
  if (!pass) return
  state = { ...state, syncing: true, error: null }
  emit()
  try {
    const json = JSON.stringify(await exportAll())
    const payload = await encryptStr(pass, json)
    const updatedAt = Date.now()
    const res = await remotePut(pass, payload, updatedAt)
    if (res.ok) {
      dirty = false
      setLocalUpdatedAt(updatedAt)
    } else if (res.stale && res.server) {
      // Another device wrote a newer copy first — adopt it.
      const remoteJson = await decryptStr(pass, res.server.payload)
      await applyRemote(remoteJson, res.server.updatedAt)
    }
  } catch (e) {
    state = { ...state, error: String((e as Error).message || e) }
  } finally {
    state = { ...state, syncing: false }
    emit()
  }
}

export async function syncPull(): Promise<void> {
  const pass = getPass()
  if (!pass) return
  state = { ...state, syncing: true, error: null }
  emit()
  try {
    const rec = await remoteGet(pass)
    if (rec && rec.updatedAt > localUpdatedAt()) {
      const json = await decryptStr(pass, rec.payload)
      await applyRemote(json, rec.updatedAt)
    }
  } catch (e) {
    state = { ...state, error: String((e as Error).message || e) }
  } finally {
    state = { ...state, syncing: false }
    emit()
  }
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    if (dirty) pushLocal()
  }, 2500)
}

function markDirty() {
  if (suppress || !syncConfigured()) return
  dirty = true
  schedulePush()
}

/**
 * Enable sync. Returns 'pushed' if the cloud was empty (this device's data was
 * uploaded — the migration case), or 'remote-exists' so the caller can ask the
 * user which side should win.
 */
export async function enableSync(pass: string): Promise<'pushed' | 'remote-exists'> {
  localStorage.setItem(PASS_KEY, pass)
  state = { ...state, configured: true, error: null }
  emit()
  const rec = await remoteGet(pass)
  if (!rec) {
    await pushLocal()
    return 'pushed'
  }
  return 'remote-exists'
}

/** Replace this device's data with the cloud copy. */
export async function adoptRemote(): Promise<void> {
  const pass = getPass()
  if (!pass) return
  const rec = await remoteGet(pass)
  if (rec) {
    const json = await decryptStr(pass, rec.payload)
    await applyRemote(json, rec.updatedAt)
  }
}

/** Overwrite the cloud with this device's data. */
export async function overwriteRemote(): Promise<void> {
  await pushLocal()
}

export function disableSync(): void {
  localStorage.removeItem(PASS_KEY)
  localStorage.removeItem(AT_KEY)
  state = { ...state, configured: false, lastSyncedAt: null, error: null }
  emit()
}

/** Manual "Sync now" — push local changes, then pull anything newer. */
export async function syncNow(): Promise<void> {
  await pushLocal()
  await syncPull()
}

/** Wire Dexie write hooks + focus/online pulling. Safe to call once at startup. */
export function initSync(): void {
  state = { ...state, configured: syncConfigured(), lastSyncedAt: localUpdatedAt() || null }
  emit()
  if (inited) return
  inited = true
  for (const table of db.tables) {
    table.hook('creating', () => markDirty())
    table.hook('updating', () => markDirty())
    table.hook('deleting', () => markDirty())
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncPull()
  })
  window.addEventListener('online', () => {
    if (dirty) pushLocal()
  })
}
