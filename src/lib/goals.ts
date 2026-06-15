import { db, uid } from '../db/db'
import type { Goal } from '../db/schema'
import { todayStr, currentMonthKey } from './dates'

/**
 * Add money to a goal. If a source account is given AND the goal is tied to a
 * savings account, also record a real transfer (source → savings) so balances
 * reflect it; otherwise it's a virtual earmark. Returns the contribution id.
 */
export async function contributeToGoal(opts: {
  goal: Goal
  amount: number
  fromAccountId?: string
  date?: string
  source?: 'manual' | 'auto' | 'rollover'
  note?: string
}): Promise<void> {
  const { goal, amount, fromAccountId } = opts
  if (amount <= 0) return
  const date = opts.date ?? todayStr()
  await db.transaction('rw', db.transactions, db.contributions, async () => {
    let txnId: string | undefined
    if (fromAccountId && goal.accountId && fromAccountId !== goal.accountId) {
      txnId = uid()
      await db.transactions.add({
        id: txnId,
        type: 'transfer',
        amount,
        date,
        accountId: fromAccountId,
        toAccountId: goal.accountId,
        note: `Goal: ${goal.name}`,
        createdAt: Date.now(),
      })
    }
    await db.contributions.add({
      id: uid(),
      goalId: goal.id,
      amount,
      date,
      source: opts.source ?? 'manual',
      txnId,
      note: opts.note,
      createdAt: Date.now(),
    })
  })
}

/**
 * Fire auto-contributions for any goal set to auto-contribute that hasn't run
 * this month yet. Runs once on app load. Skips completed goals.
 */
export async function processDueGoals(): Promise<number> {
  const mk = currentMonthKey()
  const goals = await db.goals.filter((g) => !!g.autoContribute && !g.completedAt).toArray()
  let n = 0
  for (const g of goals) {
    if (g.lastAutoMonth === mk) continue
    const amount = g.autoAmount ?? 0
    if (amount > 0) {
      await contributeToGoal({ goal: g, amount, fromAccountId: g.autoFromAccountId, source: 'auto', note: 'Auto-contribution' })
      n++
    }
    await db.goals.update(g.id, { lastAutoMonth: mk })
  }
  return n
}
