import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid } from '../db/db'
import type { Goal } from '../db/schema'
import { useActiveAccounts } from '../state/useData'
import { money, parseAmount } from '../lib/money'
import { todayStr, daysBetween } from '../lib/dates'
import { success } from '../lib/haptics'
import { Card, Button, ProgressBar, EmptyState, SectionTitle, accountEmoji } from '../components/ui'
import { Sheet, Field } from './Accounts'

export default function Goals() {
  const goals = useLiveQuery(() => db.goals.toArray(), [], [])
  const contributions = useLiveQuery(() => db.contributions.toArray(), [], [])
  const [editing, setEditing] = useState<Goal | 'new' | null>(null)
  const [contributeTo, setContributeTo] = useState<Goal | null>(null)

  const savedByGoal = new Map<string, number>()
  for (const c of contributions) savedByGoal.set(c.goalId, (savedByGoal.get(c.goalId) ?? 0) + c.amount)

  const active = goals.filter((g) => !g.completedAt)
  const done = goals.filter((g) => g.completedAt)

  return (
    <div className="pt-2">
      <SectionTitle action={<button onClick={() => setEditing('new')} className="text-brand text-sm font-semibold">+ Goal</button>}>
        Savings goals
      </SectionTitle>

      {active.length === 0 && done.length === 0 ? (
        <EmptyState
          emoji="⭐"
          title="Dream a little"
          hint="A trip, a buffer, a new laptop — set a goal and watch it fill up."
          action={<Button onClick={() => setEditing('new')}>Create a goal</Button>}
        />
      ) : (
        <div className="space-y-3">
          {active.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              saved={savedByGoal.get(g.id) ?? 0}
              onEdit={() => setEditing(g)}
              onContribute={() => setContributeTo(g)}
            />
          ))}
        </div>
      )}

      {done.length > 0 && (
        <>
          <SectionTitle>Completed 🎉</SectionTitle>
          <div className="space-y-2">
            {done.map((g) => (
              <Card key={g.id} className="p-4 flex items-center justify-between opacity-80" onClick={() => setEditing(g)}>
                <span className="font-semibold">
                  {g.emoji} {g.name}
                </span>
                <span className="tnum text-pos font-semibold">{money(g.target)} ✓</span>
              </Card>
            ))}
          </div>
        </>
      )}

      {editing && <GoalEditor goal={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {contributeTo && (
        <ContributeSheet
          goal={contributeTo}
          saved={savedByGoal.get(contributeTo.id) ?? 0}
          onClose={() => setContributeTo(null)}
        />
      )}
    </div>
  )
}

function GoalCard({
  goal,
  saved,
  onEdit,
  onContribute,
}: {
  goal: Goal
  saved: number
  onEdit: () => void
  onContribute: () => void
}) {
  const pct = goal.target > 0 ? Math.min(100, (saved / goal.target) * 100) : 0
  const remaining = Math.max(0, goal.target - saved)

  let monthlyNeed: number | null = null
  let dateNote = ''
  if (goal.targetDate) {
    const days = daysBetween(todayStr(), goal.targetDate)
    const months = Math.max(1, Math.ceil(days / 30))
    monthlyNeed = days > 0 ? remaining / months : remaining
    dateNote = days > 0 ? `${months} mo left` : 'past due'
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between" onClick={onEdit}>
        <span className="flex items-center gap-2 font-semibold">
          <span className="text-xl">{goal.emoji ?? '⭐'}</span>
          {goal.name}
        </span>
        <span className="text-sm text-ink-soft tnum">{Math.round(pct)}%</span>
      </div>
      <div className="mt-2">
        <ProgressBar value={saved} max={goal.target} tone="pos" className="h-3" />
      </div>
      <div className="flex justify-between mt-2 text-xs text-ink-faint tnum">
        <span>
          {money(saved)} of {money(goal.target)}
        </span>
        {monthlyNeed != null && <span>{money(monthlyNeed)}/mo · {dateNote}</span>}
      </div>
      <Button variant="soft" className="w-full mt-3 py-2" onClick={onContribute}>
        + Add money
      </Button>
    </Card>
  )
}

function GoalEditor({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const accounts = useActiveAccounts()
  const savings = accounts.filter((a) => a.type === 'savings')
  const [name, setName] = useState(goal?.name ?? '')
  const [emoji, setEmoji] = useState(goal?.emoji ?? '⭐')
  const [targetStr, setTargetStr] = useState(goal ? String(goal.target) : '')
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? '')
  const [accountId, setAccountId] = useState(goal?.accountId ?? '')

  async function save() {
    if (!name.trim()) return
    if (goal) {
      await db.goals.update(goal.id, {
        name: name.trim(),
        emoji,
        target: parseAmount(targetStr),
        targetDate: targetDate || undefined,
        accountId: accountId || undefined,
      })
    } else {
      await db.goals.add({
        id: uid(),
        name: name.trim(),
        emoji,
        target: parseAmount(targetStr),
        targetDate: targetDate || undefined,
        accountId: accountId || undefined,
        createdAt: Date.now(),
      })
    }
    onClose()
  }

  async function remove() {
    if (goal) await db.goals.delete(goal.id)
    onClose()
  }

  return (
    <Sheet title={goal ? 'Edit goal' : 'New goal'} onClose={onClose}>
      <div className="flex gap-2">
        <input
          value={emoji}
          onChange={(e) => setEmoji(e.target.value.slice(0, 2))}
          className="w-16 text-center text-2xl rounded-xl border border-line bg-surface py-3 outline-none focus:border-brand"
        />
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Japan trip"
          className="flex-1 rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        />
      </div>
      <div className="mt-3">
        <Field label="Target amount">
          <input
            inputMode="decimal"
            value={targetStr}
            onChange={(e) => setTargetStr(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-xl border border-line bg-surface px-3 py-3 tnum outline-none focus:border-brand"
          />
        </Field>
      </div>
      <Field label="Target date (optional)">
        <input
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        />
      </Field>
      <Field label="Tied savings account (optional)">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        >
          <option value="">None</option>
          {savings.map((a) => (
            <option key={a.id} value={a.id}>
              {accountEmoji(a.type)} {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Button onClick={save} className="w-full mt-1" disabled={!name.trim()}>
        Save goal
      </Button>
      {goal && (
        <Button variant="danger" onClick={remove} className="w-full mt-2">
          Delete goal
        </Button>
      )}
    </Sheet>
  )
}

function ContributeSheet({ goal, saved, onClose }: { goal: Goal; saved: number; onClose: () => void }) {
  const [amountStr, setAmountStr] = useState('')
  const [celebrate, setCelebrate] = useState(false)

  async function add() {
    const amount = parseAmount(amountStr)
    if (amount <= 0) return
    await db.contributions.add({
      id: uid(),
      goalId: goal.id,
      amount,
      date: todayStr(),
      source: 'manual',
      createdAt: Date.now(),
    })
    const newTotal = saved + amount
    if (newTotal >= goal.target && !goal.completedAt) {
      await db.goals.update(goal.id, { completedAt: Date.now() })
      success()
      setCelebrate(true)
      setTimeout(onClose, 1800)
    } else {
      onClose()
    }
  }

  if (celebrate) {
    return (
      <Sheet title="" onClose={onClose}>
        <div className="text-center py-8 animate-pop">
          <div className="text-6xl mb-3">🎉</div>
          <p className="text-xl font-bold">{goal.name} complete!</p>
          <p className="text-ink-soft mt-1">You saved {money(goal.target)}. Incredible.</p>
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet title={`Add to ${goal.name}`} onClose={onClose}>
      <Field label="Amount">
        <input
          autoFocus
          inputMode="decimal"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 tnum text-xl outline-none focus:border-brand"
        />
      </Field>
      <p className="text-xs text-ink-faint mb-3">
        Earmarks money toward this goal (a virtual envelope over your savings). Move the actual cash with a
        transfer if you like.
      </p>
      <Button onClick={add} className="w-full">
        Add {parseAmount(amountStr) > 0 ? money(parseAmount(amountStr)) : ''}
      </Button>
    </Sheet>
  )
}
