import { db } from '../db/db'
import { todayStr, toDateStr, monthKeyOf, monthBounds, addMonths, currentMonthKey, type MonthKey } from './dates'
import { round2 } from './money'
import { computeBalances } from './balances'

export interface WeeklySummary {
  spentThisWeek: number
  spentPrevWeek: number
  deltaPct: number | null
  income: number
  net: number
  daysLogged: number
  topCategory?: { name: string; emoji?: string; amount: number }
  txnCount: number
}

function daysAgoStr(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toDateStr(d)
}

/** Local, no-AI summary of the last 7 days vs the prior 7. */
export async function getWeeklySummary(): Promise<WeeklySummary> {
  const today = todayStr()
  const weekStart = daysAgoStr(6) // last 7 days incl today
  const prevStart = daysAgoStr(13)
  const prevEnd = daysAgoStr(7)

  const [thisWeek, prevWeek, cats] = await Promise.all([
    db.transactions.where('date').between(weekStart, today, true, true).toArray(),
    db.transactions.where('date').between(prevStart, prevEnd, true, true).toArray(),
    db.categories.toArray(),
  ])
  const catMap = new Map(cats.map((c) => [c.id, c]))

  let spentThisWeek = 0
  let income = 0
  const byCat = new Map<string, number>()
  const loggedDays = new Set<string>()
  for (const t of thisWeek) {
    loggedDays.add(t.date)
    if (t.type === 'expense') {
      spentThisWeek += t.amount
      if (t.categoryId) byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + t.amount)
    } else if (t.type === 'income') {
      income += t.amount
    }
  }
  const spentPrevWeek = prevWeek.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0)

  let topCategory: WeeklySummary['topCategory']
  let topAmt = 0
  for (const [id, amt] of byCat) {
    if (amt > topAmt) {
      topAmt = amt
      const c = catMap.get(id)
      topCategory = { name: c?.name ?? 'Other', emoji: c?.emoji, amount: round2(amt) }
    }
  }

  const deltaPct = spentPrevWeek > 0 ? round2(((spentThisWeek - spentPrevWeek) / spentPrevWeek) * 100) : null

  return {
    spentThisWeek: round2(spentThisWeek),
    spentPrevWeek: round2(spentPrevWeek),
    deltaPct,
    income: round2(income),
    net: round2(income - spentThisWeek),
    daysLogged: loggedDays.size,
    topCategory,
    txnCount: thisWeek.length,
  }
}

export interface CategorySlice {
  id: string
  name: string
  emoji?: string
  value: number
  color: string
}

const PALETTE = [
  '#4f46e5', '#0891b2', '#059669', '#d97706', '#e11d48',
  '#7c3aed', '#db2777', '#65a30d', '#ea580c', '#0d9488',
  '#9333ea', '#2563eb',
]

/** Expense breakdown by category for a month (descending, with colors). */
export async function getCategoryBreakdown(monthKey: MonthKey): Promise<CategorySlice[]> {
  const { start, end } = monthBounds(monthKey)
  const [txns, cats] = await Promise.all([
    db.transactions.where('date').between(start, end, true, true).toArray(),
    db.categories.toArray(),
  ])
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const byCat = new Map<string, number>()
  for (const t of txns) {
    if (t.type !== 'expense' || !t.categoryId) continue
    byCat.set(t.categoryId, (byCat.get(t.categoryId) ?? 0) + t.amount)
  }
  return [...byCat.entries()]
    .map(([id, value]) => ({ id, value: round2(value) }))
    .sort((a, b) => b.value - a.value)
    .map((row, i) => {
      const c = catMap.get(row.id)
      return { id: row.id, name: c?.name ?? 'Other', emoji: c?.emoji, value: row.value, color: PALETTE[i % PALETTE.length] }
    })
}

export interface TrendPoint {
  monthKey: MonthKey
  income: number
  expenses: number
  net: number
}

/** Income vs expenses for the last `n` months (oldest → newest). */
export async function getMonthlyTrend(n = 6): Promise<TrendPoint[]> {
  const cur = currentMonthKey()
  const months: MonthKey[] = []
  for (let i = n - 1; i >= 0; i--) months.push(addMonths(cur, -i))
  const earliest = monthBounds(months[0]).start
  const txns = await db.transactions.where('date').aboveOrEqual(earliest).toArray()
  const map = new Map<string, TrendPoint>(
    months.map((mk) => [mk, { monthKey: mk, income: 0, expenses: 0, net: 0 }]),
  )
  for (const t of txns) {
    const mk = monthKeyOf(t.date)
    const p = map.get(mk)
    if (!p) continue
    if (t.type === 'income') p.income += t.amount
    else if (t.type === 'expense') p.expenses += t.amount
  }
  return months.map((mk) => {
    const p = map.get(mk)!
    p.income = round2(p.income)
    p.expenses = round2(p.expenses)
    p.net = round2(p.income - p.expenses)
    return p
  })
}

export interface NetWorthPoint {
  monthKey: MonthKey
  net: number
}

/** Net worth at each month-end for the last `n` months. */
export async function getNetWorthSeries(n = 6): Promise<NetWorthPoint[]> {
  const [accounts, txns] = await Promise.all([db.accounts.toArray(), db.transactions.toArray()])
  const cur = currentMonthKey()
  const points: NetWorthPoint[] = []
  for (let i = n - 1; i >= 0; i--) {
    const mk = addMonths(cur, -i)
    const end = monthBounds(mk).end
    const upto = txns.filter((t) => t.date <= end)
    const balances = computeBalances(accounts, upto)
    let net = 0
    for (const v of balances.values()) net += v
    points.push({ monthKey: mk, net: round2(net) })
  }
  return points
}

/** Month-end balance of a single account for the last `n` months. */
export async function getAccountBalanceSeries(accountId: string, n = 6): Promise<NetWorthPoint[]> {
  const [account, txns] = await Promise.all([db.accounts.get(accountId), db.transactions.toArray()])
  if (!account) return []
  const cur = currentMonthKey()
  const out: NetWorthPoint[] = []
  for (let i = n - 1; i >= 0; i--) {
    const mk = addMonths(cur, -i)
    const end = monthBounds(mk).end
    let bal = account.openingBalance
    for (const t of txns) {
      if (t.date > end) continue
      if (t.accountId === accountId) {
        if (t.type === 'income') bal += t.amount
        else bal -= t.amount // expense or transfer-out
      } else if (t.toAccountId === accountId && t.type === 'transfer') {
        bal += t.amount
      }
    }
    out.push({ monthKey: mk, net: round2(bal) })
  }
  return out
}

/** Expense total per calendar day for a month (index 0 = day 1). */
export async function getMonthDailySpend(monthKey: MonthKey): Promise<number[]> {
  const { start, end } = monthBounds(monthKey)
  const days = new Date(parseInt(monthKey.slice(0, 4)), parseInt(monthKey.slice(5)) , 0).getDate()
  const txns = await db.transactions.where('date').between(start, end, true, true).toArray()
  const out = new Array(days).fill(0)
  for (const t of txns) {
    if (t.type !== 'expense') continue
    const d = parseInt(t.date.slice(8, 10), 10) - 1
    if (d >= 0 && d < days) out[d] = round2(out[d] + t.amount)
  }
  return out
}

export interface DayDot {
  date: string
  label: string // single letter weekday
  logged: boolean
  isToday: boolean
}

/** Last 7 days (oldest → today) with whether anything was logged each day. */
export async function getConsistencyDots(): Promise<DayDot[]> {
  const start = daysAgoStr(6)
  const today = todayStr()
  const txns = await db.transactions.where('date').between(start, today, true, true).toArray()
  const logged = new Set(txns.map((t) => t.date))
  const out: DayDot[] = []
  const L = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const ds = toDateStr(d)
    out.push({ date: ds, label: L[d.getDay()], logged: logged.has(ds), isToday: ds === today })
  }
  return out
}

/** Whole days since the last weekly check-in (large if never). */
export function daysSinceCheckin(last?: string): number {
  if (!last) return 999
  const [y, m, d] = last.split('-').map(Number)
  const then = Date.UTC(y, m - 1, d)
  const [ty, tm, td] = todayStr().split('-').map(Number)
  const now = Date.UTC(ty, tm - 1, td)
  return Math.round((now - then) / 86400000)
}

export interface MonthCompare {
  thisTotal: number
  lastTotal: number
  movers: { id: string; name: string; emoji?: string; thisV: number; lastV: number; delta: number }[]
}

/** This month vs last month: totals + the biggest category movers. */
export async function getMonthComparison(mk: MonthKey): Promise<MonthCompare> {
  const [cur, prev] = await Promise.all([getCategoryBreakdown(mk), getCategoryBreakdown(addMonths(mk, -1))])
  const map = new Map<string, { name: string; emoji?: string; thisV: number; lastV: number }>()
  for (const s of cur) map.set(s.id, { name: s.name, emoji: s.emoji, thisV: s.value, lastV: 0 })
  for (const s of prev) {
    const e = map.get(s.id)
    if (e) e.lastV = s.value
    else map.set(s.id, { name: s.name, emoji: s.emoji, thisV: 0, lastV: s.value })
  }
  const movers = Array.from(map.entries())
    .map(([id, v]) => ({ id, ...v, delta: round2(v.thisV - v.lastV) }))
    .filter((m) => m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  return {
    thisTotal: cur.reduce((s, x) => s + x.value, 0),
    lastTotal: prev.reduce((s, x) => s + x.value, 0),
    movers,
  }
}
