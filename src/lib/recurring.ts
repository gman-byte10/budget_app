import { db, uid } from '../db/db'
import type { Recurring } from '../db/schema'
import { todayStr, toDateStr } from './dates'

function parse(d: string): Date {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day)
}

/** The next occurrence strictly after `fromDate` for a recurring rule. */
export function nextOccurrence(rule: Pick<Recurring, 'frequency' | 'interval' | 'startDate'>, fromDate: string): string {
  const start = parse(rule.startDate)
  const d = parse(fromDate)
  const step = (date: Date) => {
    if (rule.frequency === 'daily') date.setDate(date.getDate() + rule.interval)
    else if (rule.frequency === 'weekly') date.setDate(date.getDate() + rule.interval * 7)
    else date.setMonth(date.getMonth() + rule.interval)
  }
  // If fromDate is before the start, the first occurrence is the start itself.
  if (d < start) return rule.startDate
  step(d)
  return toDateStr(d)
}

/** First occurrence on/after the start date (for newly created rules). */
export function firstOccurrence(rule: Pick<Recurring, 'frequency' | 'interval' | 'startDate'>): string {
  const today = todayStr()
  if (rule.startDate >= today) return rule.startDate
  // Walk forward from start until we reach today or later.
  let next = rule.startDate
  let guard = 0
  while (next < today && guard++ < 1000) {
    next = nextOccurrence(rule, next)
  }
  return next
}

/**
 * Auto-post any due auto-post rules up to today, advancing their schedule.
 * Pure local logic — runs once on app load. Reminders (autoPost=false) are
 * left in place so the UI can surface them as "due".
 */
export async function processDueRecurring(): Promise<number> {
  const today = todayStr()
  const rules = await db.recurring.filter((r) => r.active && r.autoPost).toArray()
  let posted = 0
  for (const r of rules) {
    let guard = 0
    while (r.nextDate <= today && guard++ < 366) {
      await db.transactions.add({
        id: uid(),
        type: r.type,
        amount: r.amount,
        date: r.nextDate,
        accountId: r.accountId,
        categoryId: r.categoryId,
        note: r.note,
        recurringId: r.id,
        createdAt: Date.now(),
      })
      posted++
      r.lastPostedDate = r.nextDate
      r.nextDate = nextOccurrence(r, r.nextDate)
    }
    await db.recurring.update(r.id, { lastPostedDate: r.lastPostedDate, nextDate: r.nextDate })
  }
  return posted
}

/** Post a reminder-type recurring now (user confirmed), then advance it. */
export async function postReminderNow(r: Recurring): Promise<void> {
  await db.transactions.add({
    id: uid(),
    type: r.type,
    amount: r.amount,
    date: r.nextDate,
    accountId: r.accountId,
    categoryId: r.categoryId,
    note: r.note,
    recurringId: r.id,
    createdAt: Date.now(),
  })
  await db.recurring.update(r.id, {
    lastPostedDate: r.nextDate,
    nextDate: nextOccurrence(r, r.nextDate),
  })
}
