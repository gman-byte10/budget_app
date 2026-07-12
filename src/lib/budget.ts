import { db } from '../db/db'
import type { Category, Transaction, BudgetOverride, MonthlySnapshot } from '../db/schema'
import { monthKeyOf, prevMonth, type MonthKey } from './dates'
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
  /** Goal contributions per month: `${goalId}:${mk}` -> sum. */
  contribByGoalMonth: Map<string, number>
  firstContribByGoal: Map<string, MonthKey>
  /** Expenses CHARGED on an account per month: `${accountId}:${mk}` -> sum. */
  chargedToAccountMonth: Map<string, number>
  overrides: Map<string, number> // `${catId}:${mk}` -> base
  snapshots: Map<string, MonthlySnapshot> // `${catId}:${mk}`
  firstMonthByCat: Map<string, MonthKey>
}

async function gather(): Promise<Gathered> {
  const [categories, groups, expenses, transfers, contributions, overrides, snaps] = await Promise.all([
    db.categories.toArray(),
    db.groups.toArray(),
    db.transactions.where('type').equals('expense').toArray() as Promise<Transaction[]>,
    db.transactions.where('type').equals('transfer').toArray() as Promise<Transaction[]>,
    db.contributions.toArray(),
    db.budgets.toArray() as Promise<BudgetOverride[]>,
    db.snapshots.toArray() as Promise<MonthlySnapshot[]>,
  ])

  const spentByCatMonth = new Map<string, number>()
  const firstMonthByCat = new Map<string, MonthKey>()
  const chargedToAccountMonth = new Map<string, number>()
  for (const t of expenses) {
    const mk = monthKeyOf(t.date)
    // Charges per account (card funds auto-plan from last month's charges).
    const akey = `${t.accountId}:${mk}`
    chargedToAccountMonth.set(akey, round2((chargedToAccountMonth.get(akey) ?? 0) + t.amount))
    if (!t.categoryId) continue
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

  // Goal contributions per month (used by goal-linked savings categories).
  const contribByGoalMonth = new Map<string, number>()
  const firstContribByGoal = new Map<string, MonthKey>()
  for (const c of contributions) {
    const mk = monthKeyOf(c.date)
    const key = `${c.goalId}:${mk}`
    contribByGoalMonth.set(key, round2((contribByGoalMonth.get(key) ?? 0) + c.amount))
    const first = firstContribByGoal.get(c.goalId)
    if (!first || mk < first) firstContribByGoal.set(c.goalId, mk)
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
    contribByGoalMonth,
    firstContribByGoal,
    chargedToAccountMonth,
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
    // Spending source for the envelope:
    //  • card payment fund  → transfers made TO that card
    //  • goal savings line  → contributions made to that goal
    //  • normal category    → expenses in that category
    const card = cat.linkedAccountId
    const goal = cat.linkedGoalId
    let spentFor: (mk: MonthKey) => number
    let baseFor: (mk: MonthKey) => number
    let anchor: MonthKey
    let rollover: boolean
    if (card) {
      // Credit-card fund: "to pay this month" auto-fills from what you CHARGED on
      // that card LAST month (real statement behaviour), with a per-month override.
      // "Spent" = payments (transfers) made to the card this month.
      baseFor = (mk) => g.overrides.get(`${cat.id}:${mk}`) ?? g.chargedToAccountMonth.get(`${card}:${prevMonth(mk)}`) ?? 0
      spentFor = (mk) => g.paidToAccountMonth.get(`${card}:${mk}`) ?? 0
      rollover = false
      anchor = monthKey
    } else if (goal) {
      baseFor = (mk) => baseForCategory(g, cat, mk)
      spentFor = (mk) => g.contribByGoalMonth.get(`${goal}:${mk}`) ?? 0
      rollover = cat.rollover
      anchor = g.firstContribByGoal.get(goal) ?? g.firstMonthByCat.get(cat.id) ?? monthKey
    } else {
      baseFor = (mk) => baseForCategory(g, cat, mk)
      spentFor = (mk) => g.spentByCatMonth.get(`${cat.id}:${mk}`) ?? 0
      rollover = cat.rollover
      anchor = g.firstMonthByCat.get(cat.id) ?? monthKey
    }
    const result = computeCategoryMonth(
      {
        rollover,
        rolloverCap: cat.rolloverCap,
        baseFor,
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
    if (committed) {
      committedSpent += r.spent
      if (active) committedEffective += r.effective
    } else {
      // Safe-to-spend = flexible budgeted remaining, MINUS all flexible spend —
      // including UNBUDGETED spending (categories with no budget still subtract),
      // so the number reconciles and goes negative when you overspend.
      safeToSpend += r.effective - r.spent
    }
    if (active) {
      totalEffective += r.effective
      totalBase += r.base
      totalCarryIn += r.carryIn
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
