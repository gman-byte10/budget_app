import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll } from 'vitest'
import { db, uid } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { contributeToGoal, processDueGoals } from './goals'
import { computeMonthBudget } from './budget'
import { currentMonthKey, monthBounds } from './dates'

describe('goal ↔ savings connection', () => {
  const goalId = uid()
  const autoGoalId = uid()
  const catId = uid()
  const mk = currentMonthKey()

  beforeAll(async () => {
    await ensureSeeded()
    await db.goals.add({ id: goalId, name: 'Trip', target: 3000, createdAt: Date.now() })
    // A savings budget line that tracks the goal.
    await db.categories.add({
      id: catId,
      name: 'Trip savings',
      kind: 'expense',
      monthlyBudget: 300,
      rollover: false,
      linkedGoalId: goalId,
      order: 99,
      usageCount: 0,
      createdAt: Date.now(),
    })
    // Contribute toward the goal this month (earmark).
    await contributeToGoal({ goal: (await db.goals.get(goalId))!, amount: 120, date: monthBounds(mk).start })

    // Auto-contributing goal.
    await db.goals.add({
      id: autoGoalId,
      name: 'Buffer',
      target: 1000,
      autoContribute: true,
      autoAmount: 50,
      createdAt: Date.now(),
    })
  })

  it('counts goal contributions as the linked category’s spend', async () => {
    const b = await computeMonthBudget(mk)
    const row = b.rows.find((r) => r.category.id === catId)!
    expect(row.base).toBe(300) // planned monthly saving
    expect(row.spent).toBe(120) // from the contribution, not an expense
    expect(row.effective - row.spent).toBe(180) // still to save this month
  })

  it('moving real money creates a transfer into the linked savings account', async () => {
    const savings = (await db.accounts.toArray()).find((a) => a.type === 'savings')!
    const g = await db.goals.get(goalId)
    await db.goals.update(goalId, { accountId: savings.id })
    const checking = (await db.accounts.toArray()).find((a) => a.type === 'checking')!
    const before = await db.transactions.where('type').equals('transfer').count()
    await contributeToGoal({ goal: { ...g!, accountId: savings.id }, amount: 200, fromAccountId: checking.id })
    const after = await db.transactions.where('type').equals('transfer').count()
    expect(after).toBe(before + 1)
  })

  it('auto-contributes once per month (no duplicates on repeat runs)', async () => {
    await processDueGoals()
    await processDueGoals() // second call same month must be a no-op
    const count = await db.contributions.where('goalId').equals(autoGoalId).count()
    expect(count).toBe(1)
    const g = await db.goals.get(autoGoalId)
    expect(g?.lastAutoMonth).toBe(mk)
  })
})
