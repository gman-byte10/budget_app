import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid } from '../db/db'
import type { CategoryBudgetRow } from '../lib/budget'
import { useSettings } from '../state/useSettings'
import { currentMonthKey, monthLabel, todayStr } from '../lib/dates'
import { money } from '../lib/money'
import { Button } from './ui'
import { Sheet } from '../routes/Accounts'

/** Routing choice per category at month-end: carry forward, or send to a goal. */
type Route = { mode: 'carry' } | { mode: 'goal'; goalId: string }

/** Undo a month close: delete its snapshots, reverse leftover-to-goal contributions. */
async function reopenMonth(monthKey: string): Promise<void> {
  const label = monthLabel(monthKey)
  await db.transaction('rw', db.snapshots, db.contributions, db.settings, async () => {
    await db.snapshots.where('monthKey').equals(monthKey).delete()
    // Rollover contributions created during this close are tagged "... · <Month Year>".
    const keys = await db.contributions
      .filter((c) => c.source === 'rollover' && (c.note ?? '').endsWith(`· ${label}`))
      .primaryKeys()
    if (keys.length) await db.contributions.bulkDelete(keys)
    const s = (await db.settings.get('app'))!
    await db.settings.put({ ...s, closedMonths: s.closedMonths.filter((m) => m !== monthKey) })
  })
}

export function MonthCloseButton({ monthKey, rows }: { monthKey: string; rows: CategoryBudgetRow[] }) {
  const settings = useSettings()
  const [open, setOpen] = useState(false)
  const closed = settings.closedMonths.includes(monthKey)

  // You can close any month up to and including the current one.
  if (monthKey > currentMonthKey()) return null

  if (closed) {
    return (
      <div className="text-center">
        <p className="text-xs text-ink-faint">🔒 {monthLabel(monthKey)} is closed & frozen</p>
        <button
          onClick={async () => {
            if (confirm(`Reopen ${monthLabel(monthKey)}? This unfreezes it and reverses any leftovers that were sent to goals during close.`)) {
              await reopenMonth(monthKey)
            }
          }}
          className="text-xs text-brand font-medium mt-1"
        >
          Reopen month
        </button>
      </div>
    )
  }

  const isCurrent = monthKey === currentMonthKey()
  return (
    <>
      <Button variant="soft" className="w-full" onClick={() => setOpen(true)}>
        {isCurrent ? 'Close month early…' : `Close ${monthLabel(monthKey)} & roll over`}
      </Button>
      {open && <MonthCloseSheet monthKey={monthKey} rows={rows} onClose={() => setOpen(false)} />}
    </>
  )
}

function MonthCloseSheet({
  monthKey,
  rows,
  onClose,
}: {
  monthKey: string
  rows: CategoryBudgetRow[]
  onClose: () => void
}) {
  const settings = useSettings()
  const goals = useLiveQuery(() => db.goals.filter((g) => !g.completedAt).toArray(), [], [])
  const [routes, setRoutes] = useState<Record<string, Route>>({})
  const [busy, setBusy] = useState(false)

  // Categories with positive leftover that *could* be routed to a goal.
  const rollovers = rows.filter((r) => r.rollover && r.effective - r.spent > 0)
  const totalLeftover = rollovers.reduce((s, r) => s + (r.effective - r.spent), 0)

  function routeFor(catId: string): Route {
    return routes[catId] ?? { mode: 'carry' }
  }

  async function commit() {
    setBusy(true)
    const now = Date.now()
    await db.transaction('rw', db.snapshots, db.contributions, db.settings, async () => {
      for (const r of rows) {
        let carryOut = r.carryOut
        let routedToGoal: number | undefined
        const leftover = r.effective - r.spent
        const route = routeFor(r.category.id)
        if (r.rollover && leftover > 0 && route.mode === 'goal') {
          routedToGoal = leftover
          carryOut = 0
          await db.contributions.add({
            id: uid(),
            goalId: route.goalId,
            amount: leftover,
            date: todayStr(),
            source: 'rollover',
            note: `${r.category.name} leftover · ${monthLabel(monthKey)}`,
            createdAt: now,
          })
        }
        await db.snapshots.put({
          id: `${r.category.id}:${monthKey}`,
          categoryId: r.category.id,
          monthKey,
          base: r.base,
          carryIn: r.carryIn,
          spent: r.spent,
          effective: r.effective,
          carryOut,
          routedToGoal,
          closedAt: now,
        })
      }
      const cur = (await db.settings.get('app'))!
      if (!cur.closedMonths.includes(monthKey)) {
        await db.settings.put({ ...cur, closedMonths: [...cur.closedMonths, monthKey] })
      }
    })
    setBusy(false)
    onClose()
  }

  return (
    <Sheet title={`Close ${monthLabel(monthKey)}`} onClose={onClose}>
      <p className="text-sm text-ink-soft mb-4">
        Freeze this month's numbers so past views never change. Rollover envelopes carry their balance
        forward — or send a leftover to a savings goal instead.
      </p>

      {rollovers.length === 0 ? (
        <p className="text-sm text-ink-faint mb-4">No positive leftovers to route — everything carries as-is.</p>
      ) : (
        <>
          <div className="rounded-xl bg-pos-soft border border-pos/20 p-3 mb-3 text-center">
            <p className="text-xs text-ink-soft">Total left in envelopes</p>
            <p className="tnum text-2xl font-bold text-pos">{money(totalLeftover)}</p>
          </div>
          <div className="space-y-2 mb-4">
            {rollovers.map((r) => {
              const leftover = r.effective - r.spent
              const route = routeFor(r.category.id)
              return (
                <div key={r.category.id} className="rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {r.category.emoji} {r.category.name}
                    </span>
                    <span className="tnum font-semibold text-pos">{money(leftover)}</span>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => setRoutes((s) => ({ ...s, [r.category.id]: { mode: 'carry' } }))}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                        route.mode === 'carry' ? 'border-brand bg-brand-soft text-brand' : 'border-line text-ink-soft'
                      }`}
                    >
                      Carry over
                    </button>
                    <select
                      value={route.mode === 'goal' ? route.goalId : ''}
                      onChange={(e) =>
                        setRoutes((s) => ({
                          ...s,
                          [r.category.id]: e.target.value ? { mode: 'goal', goalId: e.target.value } : { mode: 'carry' },
                        }))
                      }
                      className={`flex-1 py-2 rounded-lg text-sm border outline-none ${
                        route.mode === 'goal' ? 'border-brand bg-brand-soft text-brand' : 'border-line text-ink-soft'
                      }`}
                    >
                      <option value="">Send to goal…</option>
                      {goals.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.emoji} {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
          {goals.length === 0 && (
            <p className="text-xs text-ink-faint mb-3">Create a savings goal first to route leftovers there.</p>
          )}
        </>
      )}

      {/* Show overspent envelopes that will carry a debt */}
      {rows.some((r) => r.rollover && r.effective - r.spent < 0) && (
        <p className="text-xs text-ink-faint mb-3">
          Overspent envelopes carry their shortfall into next month (you'll start that much in the hole).
        </p>
      )}

      <Button onClick={commit} disabled={busy} className="w-full">
        {busy ? 'Closing…' : `Close & freeze ${monthLabel(monthKey)}`}
      </Button>
      <p className="text-center text-[11px] text-ink-faint mt-2">
        Streak: 🔥 {settings.streak.current} days
      </p>
    </Sheet>
  )
}
