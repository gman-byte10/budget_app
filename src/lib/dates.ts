// All dates are handled in LOCAL time. Calendar dates are stored as 'YYYY-MM-DD'
// strings; month keys are 'YYYY-MM'. Months are calendar months (start day 1).

export type MonthKey = string // 'YYYY-MM'
export type DateStr = string // 'YYYY-MM-DD'

const pad = (n: number) => String(n).padStart(2, '0')

export function todayStr(): DateStr {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function toDateStr(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function monthKeyOf(dateStr: DateStr): MonthKey {
  return dateStr.slice(0, 7)
}

export function currentMonthKey(): MonthKey {
  return todayStr().slice(0, 7)
}

export function parseMonthKey(mk: MonthKey): { year: number; month: number } {
  const [y, m] = mk.split('-').map(Number)
  return { year: y, month: m } // month is 1-based
}

export function addMonths(mk: MonthKey, delta: number): MonthKey {
  const { year, month } = parseMonthKey(mk)
  const d = new Date(year, month - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

export function prevMonth(mk: MonthKey): MonthKey {
  return addMonths(mk, -1)
}
export function nextMonth(mk: MonthKey): MonthKey {
  return addMonths(mk, 1)
}

/** Inclusive date-string bounds for a month, for range queries. */
export function monthBounds(mk: MonthKey): { start: DateStr; end: DateStr } {
  const { year, month } = parseMonthKey(mk)
  const last = new Date(year, month, 0).getDate()
  return { start: `${mk}-01`, end: `${mk}-${pad(last)}` }
}

export function daysInMonth(mk: MonthKey): number {
  const { year, month } = parseMonthKey(mk)
  return new Date(year, month, 0).getDate()
}

export function monthLabel(mk: MonthKey, locale = 'en-US'): string {
  const { year, month } = parseMonthKey(mk)
  return new Date(year, month - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
}

export function monthLabelShort(mk: MonthKey, locale = 'en-US'): string {
  const { year, month } = parseMonthKey(mk)
  return new Date(year, month - 1, 1).toLocaleDateString(locale, { month: 'short', year: '2-digit' })
}

/** For the current month: days elapsed (incl today) and days left (incl today). */
export function monthProgress(mk: MonthKey): { elapsed: number; remaining: number; total: number } {
  const total = daysInMonth(mk)
  if (mk !== currentMonthKey()) {
    // past or future month: fully elapsed / not started
    const isPast = mk < currentMonthKey()
    return { elapsed: isPast ? total : 0, remaining: isPast ? 0 : total, total }
  }
  const today = new Date().getDate()
  return { elapsed: today, remaining: total - today + 1, total }
}

export function friendlyDate(dateStr: DateStr, locale = 'en-US'): string {
  const t = todayStr()
  if (dateStr === t) return 'Today'
  const [y, m, d] = dateStr.split('-').map(Number)
  const yest = new Date()
  yest.setDate(yest.getDate() - 1)
  if (dateStr === toDateStr(yest)) return 'Yesterday'
  return new Date(y, m - 1, d).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Difference in whole days, b - a (date strings). */
export function daysBetween(a: DateStr, b: DateStr): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const da = Date.UTC(ay, am - 1, ad)
  const db = Date.UTC(by, bm - 1, bd)
  return Math.round((db - da) / 86400000)
}
