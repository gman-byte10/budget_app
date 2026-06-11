import { db } from '../db/db'
import { todayStr } from './dates'

const LAST_KEY = 'budget.lastBillNotify'

export function notificationsSupported(): boolean {
  return typeof Notification !== 'undefined'
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false
  if (Notification.permission === 'granted') return true
  const res = await Notification.requestPermission()
  return res === 'granted'
}

/**
 * If enabled & permitted, show ONE notification per day listing bills due today
 * or overdue. Fires when the app is opened (a private, encrypted PWA can't do
 * server-side push), so it complements the in-app "Due this week" list.
 */
export async function maybeNotifyDueBills(): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  const settings = await db.settings.get('app')
  if (!settings?.notifyBills) return

  const today = todayStr()
  if (localStorage.getItem(LAST_KEY) === today) return

  const rules = await db.recurring.filter((r) => r.active && r.type === 'expense' && r.nextDate <= today).toArray()
  if (rules.length === 0) return

  const cats = await db.categories.toArray()
  const names = rules
    .slice(0, 3)
    .map((r) => cats.find((c) => c.id === r.categoryId)?.name ?? 'Bill')
    .join(', ')
  const more = rules.length > 3 ? ` +${rules.length - 3} more` : ''

  localStorage.setItem(LAST_KEY, today)
  new Notification('Bills due', {
    body: `${rules.length} due: ${names}${more}`,
    icon: '/icon.svg',
    tag: 'budget-bills',
  })
}
