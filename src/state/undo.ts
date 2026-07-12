import type { Table } from 'dexie'
import { db } from '../db/db'

// ---------------------------------------------------------------------------
// Multi-step undo/redo. A change journal records every row create/update/delete
// across the data tables (via Dexie hooks), groups all changes that happen in
// the same tick into ONE user "action", and lets you step back/forward through
// them. Applying an undo/redo does not itself get journaled, and bulk system
// writes (seeding, sync import, demo load) are suppressed so they never pollute
// the history.
// ---------------------------------------------------------------------------

interface Change {
  table: string
  key: string
  before: unknown // undefined = row didn't exist
  after: unknown // undefined = row was deleted
}
type Action = Change[]

const TABLES = [
  'accounts',
  'categories',
  'groups',
  'transactions',
  'budgets',
  'snapshots',
  'goals',
  'contributions',
  'recurring',
] as const

const MAX_HISTORY = 60

let enabled = false
let suppress = 0
let applying = false
let installed = false
let pending: Change[] = []
let flushScheduled = false
const undoStack: Action[] = []
const redoStack: Action[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}
export function subscribeUndo(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
export function canUndo(): boolean {
  return undoStack.length > 0
}
export function canRedo(): boolean {
  return redoStack.length > 0
}

function record(change: Change) {
  if (!enabled || suppress > 0 || applying) return
  pending.push(change)
  if (!flushScheduled) {
    flushScheduled = true
    queueMicrotask(flush)
  }
}

function flush() {
  flushScheduled = false
  if (pending.length === 0) return
  undoStack.push(pending)
  pending = []
  redoStack.length = 0 // a new action invalidates the redo branch
  while (undoStack.length > MAX_HISTORY) undoStack.shift()
  emit()
}

function tableOf(name: string): Table<unknown, string> {
  return (db as unknown as Record<string, Table<unknown, string>>)[name]
}

/** Install the Dexie hooks once. Journaling stays OFF until enableUndo(). */
export function installUndoHooks() {
  if (installed) return
  installed = true
  for (const name of TABLES) {
    const table = tableOf(name)
    table.hook('creating', function (primKey: unknown, obj: unknown) {
      const key = (obj as { id?: string })?.id ?? String(primKey)
      record({ table: name, key, before: undefined, after: structuredClone(obj) })
    })
    table.hook('updating', function (mods: unknown, primKey: unknown, obj: unknown) {
      record({
        table: name,
        key: String(primKey),
        before: structuredClone(obj),
        after: { ...(structuredClone(obj) as object), ...(mods as object) },
      })
    })
    table.hook('deleting', function (primKey: unknown, obj: unknown) {
      record({ table: name, key: String(primKey), before: structuredClone(obj), after: undefined })
    })
  }
}

export function enableUndo() {
  enabled = true
}

/** Run a bulk/system write without journaling it (seed, sync import, demo, reset). */
export async function runUnjournaled<T>(fn: () => Promise<T>): Promise<T> {
  suppress++
  try {
    return await fn()
  } finally {
    suppress--
  }
}

export function resetUndo() {
  undoStack.length = 0
  redoStack.length = 0
  pending = []
  emit()
}

async function applyChange(c: Change, dir: 'before' | 'after') {
  const table = tableOf(c.table)
  const target = dir === 'before' ? c.before : c.after
  if (target === undefined) await table.delete(c.key)
  else await table.put(target)
}

export async function undo(): Promise<boolean> {
  const action = undoStack.pop()
  if (!action) return false
  applying = true
  try {
    for (let i = action.length - 1; i >= 0; i--) await applyChange(action[i], 'before')
  } finally {
    applying = false
  }
  redoStack.push(action)
  emit()
  return true
}

export async function redo(): Promise<boolean> {
  const action = redoStack.pop()
  if (!action) return false
  applying = true
  try {
    for (const c of action) await applyChange(c, 'after')
  } finally {
    applying = false
  }
  undoStack.push(action)
  emit()
  return true
}
