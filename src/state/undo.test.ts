import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll } from 'vitest'
import { db, uid } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { installUndoHooks, enableUndo, undo, redo, canUndo, canRedo } from './undo'

// let the microtask-batched journal flush
const settle = () => new Promise((r) => setTimeout(r, 0))

describe('multi-step undo/redo', () => {
  beforeAll(async () => {
    installUndoHooks()
    await ensureSeeded()
    enableUndo() // only track writes after seeding
  })

  it('undoes and redoes a create', async () => {
    const id = uid()
    await db.transactions.add({ id, type: 'expense', amount: 9, date: '2026-07-01', accountId: 'x', createdAt: Date.now() })
    await settle()
    expect(await db.transactions.get(id)).toBeTruthy()
    expect(canUndo()).toBe(true)

    await undo()
    expect(await db.transactions.get(id)).toBeUndefined()
    expect(canRedo()).toBe(true)

    await redo()
    expect(await db.transactions.get(id)).toBeTruthy()
  })

  it('undoes an update back to the prior value', async () => {
    const id = uid()
    await db.transactions.add({ id, type: 'expense', amount: 10, date: '2026-07-01', accountId: 'x', createdAt: Date.now() })
    await settle()
    await db.transactions.update(id, { amount: 20 })
    await settle()
    expect((await db.transactions.get(id))!.amount).toBe(20)

    await undo() // revert the update
    expect((await db.transactions.get(id))!.amount).toBe(10)
    await redo()
    expect((await db.transactions.get(id))!.amount).toBe(20)
  })

  it('steps back through multiple actions in order', async () => {
    const a = uid()
    const b = uid()
    await db.goals.add({ id: a, name: 'A', target: 1, createdAt: Date.now() })
    await settle()
    await db.goals.add({ id: b, name: 'B', target: 1, createdAt: Date.now() })
    await settle()
    await undo() // removes B
    expect(await db.goals.get(b)).toBeUndefined()
    expect(await db.goals.get(a)).toBeTruthy()
    await undo() // removes A
    expect(await db.goals.get(a)).toBeUndefined()
  })
})
