import { db } from '../db/db'
import type { Category, Transaction, BudgetOverride, MonthlySnapshot } from '../db/schema'
import { monthKeyOf, type MonthKey } from './dates'
import { computeCategoryMonth, type CatMonthResult } from './rollover'
import { round2 } from './money'

export interface CategoryBudgetRow extends CatMonthResult {
  category: Category
}

export interface MonthBudget {
  monthKey: MonthKey
  rows: CategoryBudgetRow[]
  /** Active envelopes only (base > 0 or has carry-in) — ALL sections. */
  totalEffective: number
  totalSpent: number
  /** Headline "safe to spend": flexible money left, EXCLUDING committed sections. */
  safeToSpend: number
  /** Effective budgeted in committed sections (bills/savings/card payments). */
  committedEffective: number
  committedSpent: number
  totalBase: number
  totalCarryIn: number
}

interface Gathered {
  categories: Category[]
  committedGroupIds: Set<string>
  spentByCatMonth: Map<string, number> // `${catId}:${mk}`
  /** Money transferred INTO an account per month: `${accountId}:${mk}` -> sum. */
  paidToAccountMonth: Map<string, number>
  firstPaymentByAccount: Map<string, MonthKey>
  overrides: Map<string, number> // `${catId}:${mk}` -> base
  snapshots: Map<string, MonthlySnapshot> // `${catId}:${mk}`
  firstMonthByCat: Map<string, MonthKey>
}

async function gather(): Promise<Gathered> {
  const [categories, groups, expenses, transfers, overrides, snaps] = await Promise.all([
    db.categories.toArray(),
    db.groups.toArray(),
    db.transactions.where('type').equals('expense').toArray() as Promise<Transaction[]>,
    db.transactions.where('type').equals('transfer').toArray() as Promise<Transaction[]>,
    db.budgets.toArray() as Promise<BudgetOverride[]>,
    db.snapshots.toArray() as Promise<MonthlySnapshot[]>,
  ])

  const spentByCatMonth = new Map<string, number>()
  const firstMonthByCat = new Map<string, MonthKey>()
  for (const t of expenses) {
    if (!t.categoryId) continue
    const mk = monthKeyOf(t.date)
    const key = `${t.categoryId}:${mk}`
    spentByCatMonth.set(key, round2((spentByCatMonth.get(key) ?? 0) + t.amount))
    const first = firstMonthByCat.get(t.categoryId)
    if (!first || mk < first) firstMonthByCat.set(t.categoryId, mk)
  }

  // Payments = transfers INTO an account (used by credit-card payment funds).
  const paidToAccountMonth = new Map<string, number>()
  const firstPaymentByAccount = new Map<string, MonthKey>()
  for (const t of transfers) {
    if (!t.toAccountId) continue
    const mk = monthKeyOf(t.date)
    const key = `${t.toAccountId}:${mk}`
    paidToAccountMonth.set(key, round2((paidToAccountMonth.get(key) ?? 0) + t.amount))
    const first = firstPaymentByAccount.get(t.toAccountId)
    if (!first || mk < first) firstPaymentByAccount.set(t.toAccountId, mk)
  }

  const committedGroupIds = new Set(groups.filter((g) => g.committed).map((g) => g.id))

  const overrideMap = new Map<string, number>()
  for (const o of overrides) overrideMap.set(`${o.categoryId}:${o.monthKey}`, o.base)

  const snapMap = new Map<string, MonthlySnapshot>()
  for (const s of snaps) {
    snapMap.set(`${s.categoryId}:${s.monthKey}`, s)
    const first = firstMonthByCat.get(s.categoryId)
    if (!first || s.monthKey < first) firstMonthByCat.set(s.categoryId, s.monthKey)
  }

  return {
    categories,
    committedGroupIds,
    spentByCatMonth,
    paidToAccountMonth,
    firstPaymentByAccount,
    overrides: overrideMap,
    snapshots: snapMap,
    firstMonthByCat,
  }
}

export function baseForCategory(g: Gathered, cat: Category, mk: MonthKey): number {
  return g.overrides.get(`${cat.id}:${mk}`) ?? cat.monthlyBudget
}


export async function computeMonthBudget(monthKey: MonthKey): Promise<MonthBudget> {
  const g = await gather()
  const rows: CategoryBudgetRow[] = []

  for (const cat of g.categories) {
    if (cat.kind !== 'expense' || cat.archived) continue
    // A credit-card payment fund is a bill: base = the amount you PLAN to pay
    // (its budget), and "spending" = payments (transfers) you make TO that card.
    const linked = cat.linkedAccountId
    const spentFor = linked
      ? (mk: MonthKey) => g.paidToAccountMonth.get(`${linked}:${mk}`) ?? 0
      : (mk: MonthKey) => g.spentByCatMonth.get(`${cat.id}:${mk}`) ?? 0
    const anchor =
      (linked
        ? g.firstPaymentByAccount.get(linked) ?? g.firstMonthByCat.get(cat.id)
        : g.firstMonthByCat.get(cat.id)) ?? monthKey
    const result = computeCategoryMonth(
      {
        rollover: cat.rollover,
        rolloverCap: cat.rolloverCap,
        baseFor: (mk) => baseForCategory(g, cat, mk),
        spentFor,
        snapshotFor: (mk) => g.snapshots.get(`${cat.id}:${mk}`),
        anchorMonth: anchor,
      },
      monthKey,
    )
    rows.push({ ...result, category: cat })
  }

  // Sort: active envelopes first (by spend), then untracked.
  rows.sort((a, b) => {
    const aActive = a.base > 0 || a.carryIn !== 0 ? 1 : 0
    const bActive = b.base > 0 || b.carryIn !== 0 ? 1 : 0
    if (aActive !== bActive) return bActive - aActive
    return b.spent - a.spent
  })

  let totalEffective = 0
  let totalSpent = 0
  let totalBase = 0
  let totalCarryIn = 0
  let safeToSpend = 0
  let committedEffective = 0
  let committedSpent = 0
  for (const r of rows) {
    const active = r.base > 0 || r.carryIn !== 0
    const committed = !!r.category.groupId && g.committedGroupIds.has(r.category.groupId)
    totalSpent += r.spent
    if (committed) committedSpent += r.spent
    if (active) {
      totalEffective += r.effective
      totalBase += r.base
      totalCarryIn += r.carryIn
      if (committed) committedEffective += r.effective
      // Safe-to-spend only counts FLEXIBLE money (not bills/savings/card payments).
      else safeToSpend += r.effective - r.spent
    }
  }

  return {
    monthKey,
    rows,
    totalEffective: round2(totalEffective),
    totalSpent: round2(totalSpent),
    totalBase: round2(totalBase),
    totalCarryIn: round2(totalCarryIn),
    safeToSpend: round2(safeToSpend),
    committedEffective: round2(committedEffective),
    committedSpent: round2(committedSpent),
  }
}
