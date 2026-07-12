import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll } from 'vitest'
import { db, uid } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { computeMonthBudget } from './budget'
import { currentMonthKey, prevMonth, monthBounds } from './dates'

describe('credit-card payment fund (auto from last month’s charges)', () => {
  let cardId = ''
  let checkingId = ''
  let groceriesId = ''
  const fundId = uid()
  const mk = currentMonthKey()
  const prev = prevMonth(mk)

  beforeAll(async () => {
    await ensureSeeded()
    const accounts = await db.accounts.toArray()
    cardId = accounts.find((a) => a.type === 'credit')!.id
    checkingId = accounts.find((a) => a.type === 'checking')!.id
    groceriesId = (await db.categories.toArray()).find((c) => c.name === 'Groceries')!.id

    await db.categories.add({
      id: fundId,
      name: 'Visa payment',
      kind: 'expense',
      monthlyBudget: 0,
      rollover: false,
      linkedAccountId: cardId,
      order: 99,
      usageCount: 0,
      createdAt: Date.now(),
    })

    // LAST month: charged $200 groceries on the card → this month you owe $200.
    await db.transactions.add({ id: uid(), type: 'expense', amount: 200, date: `${prev}-15`, accountId: cardId, categoryId: groceriesId, createdAt: Date.now() })
    // THIS month: pay $50 toward the card.
    await db.transactions.add({ id: uid(), type: 'transfer', amount: 50, date: monthBounds(mk).start, accountId: checkingId, toAccountId: cardId, createdAt: Date.now() })
  })

  it('auto-fills "to pay" from last month’s charges; payments draw it down', async () => {
    const b = await computeMonthBudget(mk)
    const fund = b.rows.find((r) => r.category.id === fundId)!
    expect(fund.base).toBe(200) // last month's charges on the card
    expect(fund.effective).toBe(200)
    expect(fund.spent).toBe(50) // the payment this month
    expect(fund.effective - fund.spent).toBe(150) // still to pay
  })

  it('a per-month override replaces the auto amount', async () => {
    await db.budgets.put({ id: `${fundId}:${mk}`, categoryId: fundId, monthKey: mk, base: 120 })
    const b = await computeMonthBudget(mk)
    const fund = b.rows.find((r) => r.category.id === fundId)!
    expect(fund.base).toBe(120) // override wins over the auto value
    await db.budgets.delete(`${fundId}:${mk}`)
  })
})

describe('unbudgeted spending reduces safe-to-spend (#11)', () => {
  it('spending in a category with no budget still pulls safe-to-spend negative', async () => {
    await ensureSeeded()
    const mk = currentMonthKey()
    const checking = (await db.accounts.toArray()).find((a) => a.type === 'checking')!.id
    // "Other" seed category has monthlyBudget 0 (unbudgeted).
    const other = (await db.categories.toArray()).find((c) => c.name === 'Other')!
    expect(other.monthlyBudget).toBe(0)

    const before = (await computeMonthBudget(mk)).safeToSpend
    await db.transactions.add({ id: uid(), type: 'expense', amount: 75, date: monthBounds(mk).start, accountId: checking, categoryId: other.id, createdAt: Date.now() })
    const after = (await computeMonthBudget(mk)).safeToSpend
    expect(after).toBeCloseTo(before - 75, 2) // unbudgeted spend is subtracted
  })
})
