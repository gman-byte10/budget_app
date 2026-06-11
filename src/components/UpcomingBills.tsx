import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { money } from '../lib/money'
import { todayStr, toDateStr, friendlyDate } from '../lib/dates'
import { Card } from './ui'

/** Recurring items (bills, subscriptions, card payments) due within `days`. */
export function UpcomingBills({ days = 7 }: { days?: number }) {
  const navigate = useNavigate()
  const rules = useLiveQuery(() => db.recurring.filter((r) => r.active).toArray(), [], [])
  const cats = useLiveQuery(() => db.categories.toArray(), [], [])

  const today = todayStr()
  const horizon = (() => {
    const d = new Date()
    d.setDate(d.getDate() + days)
    return toDateStr(d)
  })()

  const due = rules
    .filter((r) => r.type === 'expense' && r.nextDate <= horizon)
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate))

  if (due.length === 0) return null

  const cat = (id?: string) => cats.find((c) => c.id === id)
  const overdueCount = due.filter((r) => r.nextDate < today).length

  return (
    <Card className="p-4 mt-3" onClick={() => navigate('/recurring')}>
      <div className="flex items-center justify-between mb-2">
        <p className="font-semibold text-sm">📅 Due this week</p>
        {overdueCount > 0 && (
          <span className="text-[11px] text-neg font-semibold">{overdueCount} overdue</span>
        )}
      </div>
      <div className="space-y-1.5">
        {due.slice(0, 4).map((r) => {
          const c = cat(r.categoryId)
          const od = r.nextDate < today
          return (
            <div key={r.id} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 min-w-0">
                <span>{c?.emoji ?? '🧾'}</span>
                <span className="truncate">{c?.name ?? 'Bill'}</span>
                <span className={`text-xs shrink-0 ${od ? 'text-neg' : 'text-ink-faint'}`}>
                  {od ? 'overdue' : friendlyDate(r.nextDate)}
                </span>
              </span>
              <span className="tnum text-ink-soft shrink-0">{money(r.amount)}</span>
            </div>
          )
        })}
        {due.length > 4 && <p className="text-xs text-ink-faint pt-0.5">+{due.length - 4} more ›</p>}
      </div>
    </Card>
  )
}
