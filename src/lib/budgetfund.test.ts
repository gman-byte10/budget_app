import 'fake-indexeddb/auto'
import { describe, it, expect, beforeAll } from 'vitest'
import { db, uid } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { computeMonthBudget } from './budget'
import { currentMonthKey, monthBounds } from './dates'

describe('credit-card payment fund', () => {
  let cardId = ''
  let checkingId = ''
  const fundId = uid()
  const mk = currentMonthKey()

  beforeAll(async () => {
    await ensureSeeded()
    const accounts = await db.accounts.toArray()
    cardId = accounts.find((a) => a.type === 'credit')!.id
    checkingId = accounts.find((a) => a.type === 'checking')!.id

    // A planned card-payment bill: plan to pay $300 this month, no rollover.
    await db.categories.add({
      id: fundId,
      name: 'Visa payment',
      kind: 'expense',
      monthlyBudget: 300,
      rollover: false,
      linkedAccountId: cardId,
      order: 99,
      usageCount: 0,
      createdAt: Date.now(),
    })

    const { start } = monthBounds(mk)
    // Pay $200 toward the card (transfer) → counts as the bill being paid down.
    await db.transactions.add({ id: uid(), type: 'transfer', amount: 200, date: start, accountId: checkingId, toAccountId: cardId, createdAt: Date.now() })
    // A grocery charge ON the card must NOT count as a payment.
    const groceries = (await db.categories.toArray()).find((c) => c.name === 'Groceries')!.id
    await db.transactions.add({ id: uid(), type: 'expense', amount: 50, date: start, accountId: cardId, categoryId: groceries, createdAt: Date.now() })
  })

  it('treats the planned payment as a bill: base = plan, paid = transfers to card', async () => {
    const b = await computeMonthBudget(mk)
    const fund = b.rows.find((r) => r.category.id === fundId)!
    expect(fund.base).toBe(300) // the amount you plan to pay
    expect(fund.effective).toBe(300)
    expect(fund.spent).toBe(200) // the transfer payment, not the $50 charge
    expect(fund.effective - fund.spent).toBe(100) // $100 left to pay this month
  })

  it('counts the planned payment toward the monthly budget (safe-to-spend)', async () => {
    const b = await computeMonthBudget(mk)
    // The grocery charge still lands in Groceries, separately.
    expect(b.rows.find((r) => r.category.name === 'Groceries')!.spent).toBe(50)
    // The fund is an active budget line (included in totals), not hidden.
    expect(b.rows.find((r) => r.category.id === fundId && (r.base > 0 || r.carryIn !== 0))).toBeTruthy()
  })
})
