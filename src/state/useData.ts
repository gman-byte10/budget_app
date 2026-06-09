import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { computeBalances } from '../lib/balances'
import { computeMonthBudget } from '../lib/budget'
import { monthBounds, type MonthKey } from '../lib/dates'
import { aiStatus } from '../llm/callLLM'

export function useAccounts() {
  return useLiveQuery(() => db.accounts.orderBy('order').toArray(), [], [])
}

export function useActiveAccounts() {
  return useLiveQuery(
    async () => (await db.accounts.orderBy('order').toArray()).filter((a) => !a.archived),
    [],
    [],
  )
}

export function useCategories() {
  return useLiveQuery(() => db.categories.orderBy('order').toArray(), [], [])
}

export function useActiveCategories() {
  return useLiveQuery(
    async () => (await db.categories.orderBy('order').toArray()).filter((c) => !c.archived),
    [],
    [],
  )
}

/** Live AI status: enabled, key presence, spend vs cap. */
export function useAiStatus() {
  return useLiveQuery(() => aiStatus(), [], null)
}

/** Live monthly budget (rollover-aware) for the given month. */
export function useMonthBudget(monthKey: MonthKey) {
  return useLiveQuery(() => computeMonthBudget(monthKey), [monthKey])
}

/** Income, expenses, and net cash flow for a month. */
export function useCashFlow(monthKey: MonthKey) {
  return useLiveQuery(async () => {
    const { start, end } = monthBounds(monthKey)
    const txns = await db.transactions.where('date').between(start, end, true, true).toArray()
    let income = 0
    let expenses = 0
    for (const t of txns) {
      if (t.type === 'income') income += t.amount
      else if (t.type === 'expense') expenses += t.amount
    }
    return { income, expenses, net: income - expenses }
  }, [monthKey])
}

/** Live current balance per account id + net worth. */
export function useBalances() {
  return useLiveQuery(async () => {
    const [accounts, txns] = await Promise.all([db.accounts.toArray(), db.transactions.toArray()])
    const balances = computeBalances(accounts, txns)
    let net = 0
    for (const a of accounts) net += balances.get(a.id) ?? 0
    return { balances, net }
  }, [])
}
