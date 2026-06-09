import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid } from '../db/db'
import type { Frequency, Recurring as Rule } from '../db/schema'
import { useActiveAccounts, useActiveCategories } from '../state/useData'
import { firstOccurrence, postReminderNow } from '../lib/recurring'
import { money, parseAmount } from '../lib/money'
import { todayStr, friendlyDate } from '../lib/dates'
import { Card, Button, EmptyState, SectionTitle } from '../components/ui'
import { Sheet, Field } from './Accounts'

function freqLabel(r: Rule): string {
  const n = r.interval
  if (r.frequency === 'daily') return n === 1 ? 'Daily' : `Every ${n} days`
  if (r.frequency === 'weekly') return n === 1 ? 'Weekly' : `Every ${n} weeks`
  return n === 1 ? 'Monthly' : `Every ${n} months`
}

export default function Recurring() {
  const rules = useLiveQuery(() => db.recurring.toArray(), [], [])
  const cats = useLiveQuery(() => db.categories.toArray(), [], [])
  const accts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const [editing, setEditing] = useState<Rule | 'new' | null>(null)

  const catName = (id?: string) => cats.find((c) => c.id === id)
  const acctName = (id: string) => accts.find((a) => a.id === id)?.name ?? ''

  const today = todayStr()
  const active = rules.filter((r) => r.active).sort((a, b) => a.nextDate.localeCompare(b.nextDate))
  const dueReminders = active.filter((r) => !r.autoPost && r.nextDate <= today)
  const upcoming = active.filter((r) => !(r.nextDate <= today && !r.autoPost))

  return (
    <div className="pt-2">
      <SectionTitle action={<button onClick={() => setEditing('new')} className="text-brand text-sm font-semibold">+ Add</button>}>
        Recurring
      </SectionTitle>

      {active.length === 0 ? (
        <EmptyState
          emoji="🔁"
          title="No recurring items"
          hint="Add rent, salary, subscriptions — they'll auto-fill so you never forget."
          action={<Button onClick={() => setEditing('new')}>Add recurring</Button>}
        />
      ) : (
        <>
          {dueReminders.length > 0 && (
            <>
              <p className="text-xs font-semibold text-warn px-1 mb-1">Due — confirm to log</p>
              <div className="space-y-2 mb-4">
                {dueReminders.map((r) => (
                  <Card key={r.id} className="p-4 flex items-center justify-between bg-warn-soft border-warn/20">
                    <div onClick={() => setEditing(r)}>
                      <p className="font-semibold">
                        {catName(r.categoryId)?.emoji} {catName(r.categoryId)?.name ?? 'Transfer'}{' '}
                        <span className="text-ink-soft">· {money(r.amount)}</span>
                      </p>
                      <p className="text-xs text-ink-faint">
                        {friendlyDate(r.nextDate)} · {acctName(r.accountId)}
                      </p>
                    </div>
                    <Button variant="soft" onClick={() => postReminderNow(r)}>
                      Log
                    </Button>
                  </Card>
                ))}
              </div>
            </>
          )}

          <div className="space-y-2">
            {upcoming.map((r) => (
              <Card key={r.id} className="p-4 flex items-center justify-between" onClick={() => setEditing(r)}>
                <div>
                  <p className="font-semibold">
                    {r.type === 'income' ? '💵' : catName(r.categoryId)?.emoji ?? '🏷️'}{' '}
                    {catName(r.categoryId)?.name ?? (r.type === 'income' ? 'Income' : 'Expense')}
                  </p>
                  <p className="text-xs text-ink-faint">
                    {freqLabel(r)} · next {friendlyDate(r.nextDate)}
                    {r.autoPost ? ' · auto' : ' · reminder'}
                  </p>
                </div>
                <p className={`tnum font-semibold ${r.type === 'income' ? 'text-pos' : ''}`}>
                  {r.type === 'income' ? '+' : ''}
                  {money(r.amount)}
                </p>
              </Card>
            ))}
          </div>
        </>
      )}

      {editing && <RuleEditor rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function RuleEditor({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const accounts = useActiveAccounts()
  const allCats = useActiveCategories()
  const [type, setType] = useState<'expense' | 'income'>(rule?.type ?? 'expense')
  const [amountStr, setAmountStr] = useState(rule ? String(rule.amount) : '')
  const [accountId, setAccountId] = useState(rule?.accountId ?? '')
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? '')
  const [note, setNote] = useState(rule?.note ?? '')
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? 'monthly')
  const [interval, setIntervalN] = useState(rule?.interval ?? 1)
  const [startDate, setStartDate] = useState(rule?.startDate ?? todayStr())
  const [autoPost, setAutoPost] = useState(rule?.autoPost ?? true)

  const cats = allCats.filter((c) => c.kind === type)
  const effAccountId = accountId || accounts[0]?.id || ''
  const effCategoryId = categoryId || cats[0]?.id || ''

  async function save() {
    const amount = parseAmount(amountStr)
    if (amount <= 0 || !effAccountId) return
    const base = { frequency, interval, startDate }
    if (rule) {
      await db.recurring.update(rule.id, {
        type,
        amount,
        accountId: effAccountId,
        categoryId: effCategoryId,
        note: note.trim() || undefined,
        frequency,
        interval,
        startDate,
        autoPost,
      })
    } else {
      await db.recurring.add({
        id: uid(),
        type,
        amount,
        accountId: effAccountId,
        categoryId: effCategoryId,
        note: note.trim() || undefined,
        frequency,
        interval,
        startDate,
        nextDate: firstOccurrence(base),
        autoPost,
        active: true,
        createdAt: Date.now(),
      })
    }
    onClose()
  }

  async function remove() {
    if (rule) await db.recurring.delete(rule.id)
    onClose()
  }

  return (
    <Sheet title={rule ? 'Edit recurring' : 'New recurring'} onClose={onClose}>
      <div className="flex gap-1 bg-canvas rounded-xl p-1 border border-line mb-3">
        {(['expense', 'income'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold capitalize ${
              type === t ? 'bg-surface shadow-sm' : 'text-ink-faint'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <Field label="Amount">
        <input
          inputMode="decimal"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 tnum outline-none focus:border-brand"
        />
      </Field>
      <Field label="Category">
        <select
          value={effCategoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        >
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Account">
        <select
          value={effAccountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Note (optional)">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Netflix"
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Every">
          <input
            type="number"
            min={1}
            value={interval}
            onChange={(e) => setIntervalN(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full rounded-xl border border-line bg-surface px-3 py-3 tnum outline-none focus:border-brand"
          />
        </Field>
        <Field label="Frequency">
          <select
            value={frequency}
            onChange={(e) => setFrequency(e.target.value as Frequency)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
          >
            <option value="daily">Day(s)</option>
            <option value="weekly">Week(s)</option>
            <option value="monthly">Month(s)</option>
          </select>
        </Field>
      </div>

      <Field label="Starts">
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        />
      </Field>

      <button
        onClick={() => setAutoPost(!autoPost)}
        className="w-full flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-3 mb-3"
      >
        <span className="text-left">
          <span className="font-medium block">{autoPost ? 'Auto-post' : 'Remind me'}</span>
          <span className="text-xs text-ink-faint">
            {autoPost ? 'Creates the transaction automatically' : 'Asks you to confirm when due'}
          </span>
        </span>
        <span className={`relative w-11 h-6 rounded-full transition-colors ${autoPost ? 'bg-brand' : 'bg-line'}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${autoPost ? 'left-[1.375rem]' : 'left-0.5'}`} />
        </span>
      </button>

      <Button onClick={save} className="w-full" disabled={parseAmount(amountStr) <= 0}>
        Save
      </Button>
      {rule && (
        <Button variant="danger" onClick={remove} className="w-full mt-2">
          Delete
        </Button>
      )}
    </Sheet>
  )
}
