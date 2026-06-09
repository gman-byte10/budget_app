import { db, uid } from '../db/db'
import type { Transaction } from '../db/schema'
import { addMonths, currentMonthKey, daysInMonth, todayStr } from './dates'
import { computeMonthBudget } from './budget'
import { firstOccurrence } from './recurring'

const pad = (n: number) => String(n).padStart(2, '0')
const rand = (min: number, max: number) => Math.round((min + Math.random() * (max - min)) * 100) / 100
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

/**
 * Populate the app with ~3 months of realistic sample data so every screen,
 * chart, and the rollover carry-over are immediately visible. Adds to existing
 * (seeded) accounts & categories. Closes the two prior months to demonstrate
 * frozen rollover flowing into the current month.
 */
export async function loadDemoData(): Promise<void> {
  const [accounts, categories] = await Promise.all([db.accounts.toArray(), db.categories.toArray()])
  const acct = (type: string) => accounts.find((a) => a.type === type)
  const cat = (name: string) => categories.find((c) => c.name === name)

  const checking = acct('checking')
  const savings = acct('savings')
  const cash = acct('cash')
  const credit = acct('credit')
  if (!checking || !savings || !cash || !credit) return

  // Give accounts a starting position.
  await db.accounts.update(checking.id, { openingBalance: 1800 })
  await db.accounts.update(savings.id, { openingBalance: 6000 })
  await db.accounts.update(cash.id, { openingBalance: 60 })
  await db.accounts.update(credit.id, { openingBalance: -320 })

  const cur = currentMonthKey()
  const months = [addMonths(cur, -2), addMonths(cur, -1), cur]
  const txns: Transaction[] = []
  const day = (mk: string, d: number) => `${mk}-${pad(Math.min(d, daysInMonth(mk)))}`
  const add = (t: Omit<Transaction, 'id' | 'createdAt'>) =>
    txns.push({ ...t, id: uid(), createdAt: Date.now() })

  // Don't post into the future within the current month.
  const todayDay = parseInt(todayStr().slice(8), 10)
  const maxDay = (mk: string) => (mk === cur ? todayDay : daysInMonth(mk))

  for (const mk of months) {
    const cap = maxDay(mk)
    // Income
    if (cat('Salary')) add({ type: 'income', amount: 4200, date: day(mk, 1), accountId: checking.id, categoryId: cat('Salary')!.id, note: 'Paycheck' })
    // Fixed bills (non-rollover)
    if (cat('Rent')) add({ type: 'expense', amount: 1500, date: day(mk, 2), accountId: checking.id, categoryId: cat('Rent')!.id, note: 'Rent' })
    if (cat('Utilities')) add({ type: 'expense', amount: rand(150, 220), date: day(mk, 5), accountId: checking.id, categoryId: cat('Utilities')!.id, note: 'Electric + water' })
    if (cat('Subscriptions')) add({ type: 'expense', amount: 45, date: day(mk, 3), accountId: credit.id, categoryId: cat('Subscriptions')!.id, note: 'Streaming' })

    // Variable, rollover categories — vary so some months are under/over budget.
    const groceryNotes = ['Trader Joe’s', 'Costco', 'Safeway', 'Whole Foods']
    for (let i = 0; i < 5 && i * 6 + 4 <= cap; i++)
      if (cat('Groceries')) add({ type: 'expense', amount: rand(28, 85), date: day(mk, 4 + i * 6), accountId: pick([checking, credit]).id, categoryId: cat('Groceries')!.id, note: pick(groceryNotes) })

    const diningNotes = ['Coffee', 'Lunch', 'Dinner out', 'Chipotle', 'Pizza']
    for (let i = 0; i < 7 && i * 4 + 3 <= cap; i++)
      if (cat('Dining')) add({ type: 'expense', amount: rand(6, 38), date: day(mk, 3 + i * 4), accountId: pick([checking, cash, credit]).id, categoryId: cat('Dining')!.id, note: pick(diningNotes) })

    for (let i = 0; i < 4 && i * 7 + 6 <= cap; i++)
      if (cat('Transport')) add({ type: 'expense', amount: rand(18, 55), date: day(mk, 6 + i * 7), accountId: pick([checking, credit]).id, categoryId: cat('Transport')!.id, note: pick(['Gas', 'Uber', 'Parking']) })

    if (cat('Entertainment') && 12 <= cap) add({ type: 'expense', amount: rand(20, 70), date: day(mk, 12), accountId: credit.id, categoryId: cat('Entertainment')!.id, note: pick(['Movie', 'Concert', 'Game']) })
    if (cat('Shopping') && 15 <= cap) add({ type: 'expense', amount: rand(25, 120), date: day(mk, 15), accountId: pick([checking, credit]).id, categoryId: cat('Shopping')!.id, note: pick(['Clothes', 'Amazon', 'Shoes']) })
    if (cat('Health') && 20 <= cap) add({ type: 'expense', amount: rand(15, 60), date: day(mk, 20), accountId: checking.id, categoryId: cat('Health')!.id, note: pick(['Pharmacy', 'Gym']) })

    // Monthly transfer to savings (not counted as spending).
    if (18 <= cap) add({ type: 'transfer', amount: 400, date: day(mk, 18), accountId: checking.id, toAccountId: savings.id, note: 'Auto-save' })
  }

  // A savings goal with contributions.
  const goalId = uid()
  await db.goals.add({
    id: goalId,
    name: 'Emergency fund',
    target: 9000,
    targetDate: `${addMonths(cur, 6)}-01`,
    accountId: savings.id,
    emoji: '🛟',
    createdAt: Date.now(),
  })
  const contribs = months.map((mk, i) => ({
    id: uid(),
    goalId,
    amount: 400,
    date: day(mk, 18),
    source: 'manual' as const,
    note: 'Monthly save',
    createdAt: Date.now() + i,
  }))
  await db.contributions.bulkAdd(contribs)

  // Recurring rules (upcoming items + auto-fill demo).
  const recBase = { startDate: `${cur}-01`, frequency: 'monthly' as const, interval: 1 }
  await db.recurring.bulkAdd([
    {
      id: uid(), type: 'income', amount: 4200, accountId: checking.id, categoryId: cat('Salary')?.id,
      note: 'Paycheck', ...recBase, nextDate: firstOccurrence(recBase), autoPost: false, active: true, createdAt: Date.now(),
    },
    {
      id: uid(), type: 'expense', amount: 45, accountId: credit.id, categoryId: cat('Subscriptions')?.id,
      note: 'Streaming', ...recBase, nextDate: firstOccurrence(recBase), autoPost: true, active: true, createdAt: Date.now(),
    },
  ])

  // Insert all transactions, bump category usage, set a friendly streak.
  await db.transactions.bulkAdd(txns)
  const usage = new Map<string, number>()
  for (const t of txns) if (t.categoryId) usage.set(t.categoryId, (usage.get(t.categoryId) ?? 0) + 1)
  await db.transaction('rw', db.categories, db.settings, async () => {
    for (const [id, n] of usage) await db.categories.update(id, { usageCount: n, lastUsedAt: Date.now() })
    const s = (await db.settings.get('app'))!
    await db.settings.put({ ...s, streak: { current: 4, longest: 9, lastLogDate: todayStr() }, onboarded: true })
  })

  // Freeze the two prior months so rollover carries into the current month.
  for (const mk of [months[0], months[1]]) {
    const b = await computeMonthBudget(mk)
    const now = Date.now()
    await db.transaction('rw', db.snapshots, db.settings, async () => {
      for (const r of b.rows) {
        await db.snapshots.put({
          id: `${r.category.id}:${mk}`,
          categoryId: r.category.id,
          monthKey: mk,
          base: r.base,
          carryIn: r.carryIn,
          spent: r.spent,
          effective: r.effective,
          carryOut: r.carryOut,
          closedAt: now,
        })
      }
      const s = (await db.settings.get('app'))!
      if (!s.closedMonths.includes(mk)) await db.settings.put({ ...s, closedMonths: [...s.closedMonths, mk] })
    })
  }
}
