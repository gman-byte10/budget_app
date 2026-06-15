import { db, uid, DEFAULT_SETTINGS } from '../db/db'
import type { Transaction, TxnType } from '../db/schema'
import { todayStr, daysBetween } from '../lib/dates'

export interface NewTxn {
  type: TxnType
  amount: number
  date: string
  accountId: string
  toAccountId?: string
  categoryId?: string
  note?: string
  recurringId?: string
}

/** Add a transaction, bump category usage, and advance the logging streak. */
export async function addTransaction(input: NewTxn): Promise<string> {
  const id = uid()
  const txn: Transaction = { ...input, id, createdAt: Date.now() }
  await db.transaction('rw', db.transactions, db.categories, db.settings, async () => {
    await db.transactions.add(txn)
    if (input.categoryId) {
      const cat = await db.categories.get(input.categoryId)
      if (cat) {
        await db.categories.update(input.categoryId, {
          usageCount: (cat.usageCount ?? 0) + 1,
          lastUsedAt: Date.now(),
        })
      }
    }
    await bumpStreak()
  })
  return id
}

export async function updateTransaction(id: string, patch: Partial<Transaction>): Promise<void> {
  await db.transactions.update(id, patch)
}

export async function deleteTransaction(id: string): Promise<void> {
  await db.transactions.delete(id)
}

/** Reconciliation: log a one-off adjustment so tracked balance matches reality. */
export async function adjustAccountBalance(accountId: string, diff: number): Promise<void> {
  if (diff === 0) return
  await db.transactions.add({
    id: uid(),
    type: diff > 0 ? 'income' : 'expense',
    amount: Math.abs(diff),
    date: todayStr(),
    accountId,
    note: 'Balance adjustment',
    createdAt: Date.now(),
  })
}

/** Advance the daily logging streak. Idempotent within the same day. */
export async function bumpStreak(): Promise<void> {
  const cur = (await db.settings.get('app')) ?? DEFAULT_SETTINGS
  const today = todayStr()
  const last = cur.streak.lastLogDate
  if (last === today) return
  let current = 1
  if (last) {
    const gap = daysBetween(last, today)
    if (gap === 1) current = cur.streak.current + 1
    else current = 1
  }
  const longest = Math.max(cur.streak.longest, current)
  await db.settings.put({ ...cur, streak: { current, longest, lastLogDate: today } })
}

/** A streak only "counts" today if logged today; otherwise show as at-risk. */
export function streakLoggedToday(lastLogDate?: string): boolean {
  return lastLogDate === todayStr()
}
