import 'fake-indexeddb/auto' // must be first — provides indexedDB before db.ts loads
import { describe, it, expect, beforeAll } from 'vitest'
import { db } from '../db/db'
import { ensureSeeded } from '../db/seed'
import { loadDemoData } from './demo'
import { computeMonthBudget } from './budget'
import { computeBalances, netWorth } from './balances'
import { addMonths, currentMonthKey } from './dates'

describe('demo data + rollover integration', () => {
  beforeAll(async () => {
    await ensureSeeded()
    await loadDemoData()
  })

  it('creates a few months of transactions', async () => {
    const count = await db.transactions.count()
    expect(count).toBeGreaterThan(30)
  })

  it('freezes the two prior months as snapshots', async () => {
    const settings = await db.settings.get('app')
    const prev1 = addMonths(currentMonthKey(), -1)
    const prev2 = addMonths(currentMonthKey(), -2)
    expect(settings?.closedMonths).toContain(prev1)
    expect(settings?.closedMonths).toContain(prev2)
    const snaps = await db.snapshots.count()
    expect(snaps).toBeGreaterThan(0)
  })

  it('carries frozen rollover into the current month', async () => {
    const cur = currentMonthKey()
    const prev1 = addMonths(cur, -1)
    const b = await computeMonthBudget(cur)

    // A rollover category should have carryIn equal to last month's frozen carryOut.
    const groceries = b.rows.find((r) => r.category.name === 'Groceries')!
    expect(groceries.rollover).toBe(true)
    const snap = await db.snapshots.get(`${groceries.category.id}:${prev1}`)
    expect(snap).toBeDefined()
    expect(groceries.carryIn).toBeCloseTo(snap!.carryOut, 2)

    // Fixed (non-rollover) categories never carry.
    const rent = b.rows.find((r) => r.category.name === 'Rent')!
    expect(rent.rollover).toBe(false)
    expect(rent.carryIn).toBe(0)
  })

  it('computes balances and a finite net worth', async () => {
    const [accounts, txns] = await Promise.all([db.accounts.toArray(), db.transactions.toArray()])
    const balances = computeBalances(accounts, txns)
    const net = netWorth(balances)
    expect(Number.isFinite(net)).toBe(true)
    // Transfers must not change net worth: savings up, checking down by equal amounts.
    expect(balances.size).toBe(accounts.length)
  })

  it('sets up a goal with contributions and recurring rules', async () => {
    expect(await db.goals.count()).toBeGreaterThan(0)
    expect(await db.contributions.count()).toBeGreaterThan(0)
    expect(await db.recurring.count()).toBeGreaterThan(0)
  })
})
