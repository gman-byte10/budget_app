import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid } from '../db/db'
import type { Category } from '../db/schema'
import { useMonthBudget, useActiveAccounts, useBalances } from '../state/useData'
import { addTransaction } from '../state/actions'
import { useSettings } from '../state/useSettings'
import { currentMonthKey, prevMonth, nextMonth, monthLabel, monthBounds, todayStr } from '../lib/dates'
import { money, moneySigned, parseAmount, round2 } from '../lib/money'
import type { CategoryBudgetRow } from '../lib/budget'
import { reorderWithin } from '../lib/reorder'
import { useToast } from '../components/Toast'
import { Card, ProgressBar, Button, SectionTitle, EmptyState, accountEmoji } from '../components/ui'
import { Sheet, Field } from './Accounts'
import { MonthCloseButton } from '../components/MonthClose'

export default function Budgets() {
  const settings = useSettings()
  const toast = useToast()
  const bal = useBalances()
  const accounts = useActiveAccounts()
  const [mk, setMk] = useState(currentMonthKey())
  const budget = useMonthBudget(mk)
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const [newFundCard, setNewFundCard] = useState<{ id: string; name: string } | undefined>()
  const [acting, setActing] = useState<CategoryBudgetRow | null>(null)
  const [reordering, setReordering] = useState(false)
  const [dismissedNudge, setDismissedNudge] = useState(
    () => localStorage.getItem('budget.cardPlanNudge') === 'off',
  )

  const closed = settings.closedMonths.includes(mk)

  // Credit cards that don't yet have a payment plan (fund) — offer to add one.
  const linkedSet = new Set((budget?.rows ?? []).map((r) => r.category.linkedAccountId).filter(Boolean))
  const cardNeedingPlan = accounts.find((a) => a.type === 'credit' && !linkedSet.has(a.id))

  async function budgetFromLastMonth() {
    const prev = prevMonth(mk)
    if (!confirm(`Set ${monthLabel(mk)}'s budgets to match what you spent in ${monthLabel(prev)}?`)) return
    const { start, end } = monthBounds(prev)
    const [ts, cats] = await Promise.all([
      db.transactions.where('date').between(start, end, true, true).toArray(),
      db.categories.filter((c) => c.kind === 'expense' && !c.archived).toArray(),
    ])
    const spend = new Map<string, number>()
    for (const t of ts) if (t.type === 'expense' && t.categoryId) spend.set(t.categoryId, (spend.get(t.categoryId) ?? 0) + t.amount)
    await db.transaction('rw', db.budgets, async () => {
      for (const c of cats) {
        const s = spend.get(c.id) ?? 0
        if (s > 0) await db.budgets.put({ id: `${c.id}:${mk}`, categoryId: c.id, monthKey: mk, base: round2(s) })
      }
    })
    toast(`Budgets set from ${monthLabel(prev)}`)
  }
  const isActive = (r: CategoryBudgetRow) => !!r.category.linkedAccountId || r.base > 0 || r.carryIn !== 0
  const byOrder = (a: CategoryBudgetRow, b: CategoryBudgetRow) => a.category.order - b.category.order
  const active = (budget?.rows.filter(isActive) ?? []).slice().sort(byOrder)
  const untracked = (budget?.rows.filter((r) => !isActive(r)) ?? []).slice().sort(byOrder)
  const activeCats = active.map((r) => r.category)

  return (
    <div className="pt-2">
      {/* Month switcher */}
      <div className="flex items-center justify-between">
        <button onClick={() => setMk(prevMonth(mk))} className="px-3 py-2 text-ink-soft text-lg active:bg-surface rounded-lg">
          ‹
        </button>
        <div className="text-center">
          <p className="font-semibold">{monthLabel(mk, settings.locale)}</p>
          {closed && <p className="text-[11px] text-ink-faint">🔒 frozen</p>}
        </div>
        <button
          onClick={() => setMk(nextMonth(mk))}
          className="px-3 py-2 text-ink-soft text-lg active:bg-surface rounded-lg"
        >
          ›
        </button>
      </div>

      {/* Summary */}
      <Card className="p-5 mt-2 text-center">
        <p className="text-sm font-medium text-ink-soft">Safe to spend</p>
        <p className={`tnum text-4xl font-bold mt-1 ${(budget?.safeToSpend ?? 0) < 0 ? 'text-neg' : 'text-ink'}`}>
          {money(budget?.safeToSpend ?? 0)}
        </p>
        <div className="flex justify-center gap-4 mt-3 text-xs text-ink-soft">
          <span>Base {money(budget?.totalBase ?? 0)}</span>
          {(budget?.totalCarryIn ?? 0) !== 0 && (
            <span className={(budget?.totalCarryIn ?? 0) >= 0 ? 'text-pos' : 'text-neg'}>
              Rolled {moneySigned(budget?.totalCarryIn ?? 0)}
            </span>
          )}
          <span>Spent {money(budget?.totalSpent ?? 0)}</span>
        </div>
      </Card>

      <div className="mt-3">
        <MonthCloseButton monthKey={mk} rows={budget?.rows ?? []} />
      </div>

      {!closed && (
        <button onClick={budgetFromLastMonth} className="text-brand text-sm font-medium mt-3 px-1">
          ↺ Set budgets from last month's spend
        </button>
      )}

      {!closed && cardNeedingPlan && !dismissedNudge && (
        <Card className="p-4 mt-3 bg-warn-soft border-warn/20">
          <p className="font-semibold text-sm">💳 Plan a payment for {cardNeedingPlan.name}?</p>
          <p className="text-xs text-ink-soft mt-0.5">
            Budget how much you'll pay this card this month so it's counted in your spending.
          </p>
          <div className="flex gap-2 mt-3">
            <Button
              variant="soft"
              className="flex-1 py-2"
              onClick={() => {
                setNewFundCard({ id: cardNeedingPlan.id, name: cardNeedingPlan.name })
                setEditing('new')
              }}
            >
              Add plan
            </Button>
            <Button
              variant="ghost"
              className="py-2 border border-line"
              onClick={() => {
                localStorage.setItem('budget.cardPlanNudge', 'off')
                setDismissedNudge(true)
              }}
            >
              Not now
            </Button>
          </div>
        </Card>
      )}

      <SectionTitle
        action={
          <div className="flex gap-3">
            {active.length > 1 && !closed && (
              <button onClick={() => setReordering((v) => !v)} className="text-brand text-sm font-semibold">
                {reordering ? 'Done' : 'Reorder'}
              </button>
            )}
            <button onClick={() => setEditing('new')} className="text-brand text-sm font-semibold">
              + Category
            </button>
          </div>
        }
      >
        Categories
      </SectionTitle>

      {active.length === 0 && untracked.length === 0 ? (
        <EmptyState emoji="🎯" title="No budgets yet" hint="Add a category and set a monthly amount to start tracking." />
      ) : (
        <div className="space-y-2">
          {active.map((r) => (
            <BudgetRow
              key={r.category.id}
              row={r}
              cardBalance={r.category.linkedAccountId ? bal?.balances.get(r.category.linkedAccountId) : undefined}
              reordering={reordering}
              onUp={() => reorderWithin('categories', activeCats, r.category.id, -1)}
              onDown={() => reorderWithin('categories', activeCats, r.category.id, 1)}
              onClick={() => (r.frozen ? setEditing(r.category) : setActing(r))}
            />
          ))}
        </div>
      )}

      {untracked.length > 0 && (
        <>
          <SectionTitle>Untracked</SectionTitle>
          <Card className="p-2">
            <div className="divide-y divide-line">
              {untracked.map((r) => (
                <button
                  key={r.category.id}
                  onClick={() => setEditing(r.category)}
                  className="w-full flex items-center justify-between py-2.5 px-1 active:bg-canvas rounded-lg"
                >
                  <span className="flex items-center gap-2">
                    <span>{r.category.emoji}</span>
                    <span className="font-medium">{r.category.name}</span>
                  </span>
                  <span className="text-sm text-ink-faint">
                    {r.spent > 0 ? `${money(r.spent)} spent · set budget ›` : 'Set budget ›'}
                  </span>
                </button>
              ))}
            </div>
          </Card>
        </>
      )}

      {editing && (
        <CategoryEditor
          category={editing === 'new' ? null : editing}
          monthKey={mk}
          initialLinkedAccountId={editing === 'new' ? newFundCard?.id : undefined}
          initialLinkedAccountName={editing === 'new' ? newFundCard?.name : undefined}
          onClose={() => {
            setEditing(null)
            setNewFundCard(undefined)
          }}
        />
      )}

      {acting && (
        <RowActionSheet
          row={acting}
          onClose={() => setActing(null)}
          onEdit={() => {
            const c = acting.category
            setActing(null)
            setEditing(c)
          }}
        />
      )}
    </div>
  )
}

function RowActionSheet({
  row,
  onClose,
  onEdit,
}: {
  row: CategoryBudgetRow
  onClose: () => void
  onEdit: () => void
}) {
  const accounts = useActiveAccounts()
  const toast = useToast()
  const isFund = !!row.category.linkedAccountId
  const [mode, setMode] = useState<'menu' | 'log' | 'pay'>('menu')
  // Pre-fill a card payment with what's still planned to pay this month.
  const [amountStr, setAmountStr] = useState(() => {
    const left = round2(row.effective - row.spent)
    return isFund && left > 0 ? String(left) : ''
  })
  const [accountId, setAccountId] = useState(
    row.category.defaultAccountId || accounts.find((a) => a.type !== 'credit')?.id || accounts[0]?.id || '',
  )
  const remaining = round2(row.effective - row.spent)

  async function logExpense() {
    const amount = parseAmount(amountStr)
    if (amount <= 0 || !accountId) return
    await addTransaction({ type: 'expense', amount, date: todayStr(), accountId, categoryId: row.category.id })
    toast(`Logged ${money(amount)} to ${row.category.name}`)
    onClose()
  }
  async function payCard() {
    const amount = parseAmount(amountStr)
    if (amount <= 0 || !accountId || !row.category.linkedAccountId) return
    await addTransaction({
      type: 'transfer',
      amount,
      date: todayStr(),
      accountId,
      toAccountId: row.category.linkedAccountId,
      note: `${row.category.name}`,
    })
    toast(`Paid ${money(amount)} to card`)
    onClose()
  }

  return (
    <Sheet title={`${row.category.emoji ?? ''} ${row.category.name}`} onClose={onClose}>
      <div className="rounded-xl bg-canvas p-3 mb-3 text-center">
        <p className="tnum text-2xl font-bold">{money(remaining)}</p>
        <p className="text-xs text-ink-faint">
          {isFund ? 'left to pay this month' : 'left this month'} · {money(row.spent)} {isFund ? 'paid' : 'spent'} of{' '}
          {money(row.effective)} {isFund ? 'planned' : ''}
        </p>
      </div>

      {mode === 'menu' && (
        <>
          <Button className="w-full" onClick={() => setMode(isFund ? 'pay' : 'log')}>
            {isFund ? '💳 Make a payment' : '＋ Log expense'}
          </Button>
          <Button variant="ghost" className="w-full mt-2 border border-line" onClick={onEdit}>
            Edit category
          </Button>
        </>
      )}

      {(mode === 'log' || mode === 'pay') && (
        <>
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
          <Field label={mode === 'pay' ? 'Pay from' : 'Account'}>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
            >
              {accounts
                .filter((a) => (mode === 'pay' ? a.id !== row.category.linkedAccountId : true))
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {accountEmoji(a.type)} {a.name}
                  </option>
                ))}
            </select>
          </Field>
          <Button className="w-full" onClick={mode === 'pay' ? payCard : logExpense} disabled={parseAmount(amountStr) <= 0}>
            {mode === 'pay' ? 'Pay' : 'Log'} {parseAmount(amountStr) > 0 ? money(parseAmount(amountStr)) : ''}
          </Button>
        </>
      )}
    </Sheet>
  )
}

function BudgetRow({
  row,
  cardBalance,
  reordering,
  onUp,
  onDown,
  onClick,
}: {
  row: CategoryBudgetRow
  cardBalance?: number
  reordering?: boolean
  onUp?: () => void
  onDown?: () => void
  onClick: () => void
}) {
  const isFund = !!row.category.linkedAccountId
  const remaining = row.effective - row.spent
  const tone = remaining < 0 ? 'neg' : row.spent / Math.max(row.effective, 1) > 0.85 ? 'warn' : 'brand'
  return (
    <Card className="p-4" onClick={reordering ? undefined : onClick}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 font-semibold min-w-0">
          <span className="text-lg">{isFund ? '💳' : row.category.emoji}</span>
          <span className="truncate">{row.category.name}</span>
          {isFund ? (
            <span className="text-[10px] text-warn bg-warn-soft px-1.5 py-0.5 rounded-full shrink-0">card payment</span>
          ) : (
            row.category.rollover && <span className="text-[10px] text-brand bg-brand-soft px-1.5 py-0.5 rounded-full shrink-0">envelope</span>
          )}
          {row.frozen && <span className="text-[10px]">🔒</span>}
        </span>
        {reordering ? (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onUp} className="h-9 w-9 rounded-lg border border-line text-ink-soft active:bg-canvas" aria-label="Move up">
              ↑
            </button>
            <button onClick={onDown} className="h-9 w-9 rounded-lg border border-line text-ink-soft active:bg-canvas" aria-label="Move down">
              ↓
            </button>
          </div>
        ) : (
          <span className={`tnum text-sm font-semibold shrink-0 ${isFund ? (remaining > 0 ? 'text-warn' : 'text-pos') : remaining < 0 ? 'text-neg' : 'text-ink-soft'}`}>
            {money(remaining)} {isFund ? 'to pay' : 'left'}
          </span>
        )}
      </div>

      <div className="mt-2">
        <ProgressBar value={row.spent} max={row.effective} tone={isFund ? 'pos' : tone} />
      </div>

      <div className="flex items-center justify-between mt-2 text-xs text-ink-faint tnum">
        <span>
          {isFund
            ? `${money(row.spent)} paid of ${money(row.effective)} planned`
            : `${money(row.spent)} spent of ${money(row.effective)}`}
        </span>
        {isFund && cardBalance != null ? (
          <span className={cardBalance < 0 ? 'text-neg' : 'text-pos'}>
            {cardBalance < 0 ? `owe ${money(-cardBalance)}` : 'paid off'}
          </span>
        ) : (
          row.category.rollover && row.carryIn !== 0 && (
            <span>
              base {money(row.base)} {moneySigned(row.carryIn)} rolled
              {row.capped && ' · capped'}
            </span>
          )
        )}
      </div>
    </Card>
  )
}

function CategoryEditor({
  category,
  monthKey,
  onClose,
  initialLinkedAccountId,
  initialLinkedAccountName,
}: {
  category: Category | null
  monthKey: string
  onClose: () => void
  /** Pre-link a new fund to this card (used by the "add payment plan" nudge). */
  initialLinkedAccountId?: string
  initialLinkedAccountName?: string
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const accounts = useActiveAccounts()
  const creditAccounts = accounts.filter((a) => a.type === 'credit')
  const override = useLiveQuery(
    () => (category ? db.budgets.get(`${category.id}:${monthKey}`) : undefined),
    [category?.id, monthKey],
  )
  const [name, setName] = useState(
    category?.name ?? (initialLinkedAccountName ? `${initialLinkedAccountName} payment` : ''),
  )
  const [emoji, setEmoji] = useState(category?.emoji ?? (initialLinkedAccountId ? '💳' : '🏷️'))
  const [budgetStr, setBudgetStr] = useState(category ? String(category.monthlyBudget) : '')
  const [rollover, setRollover] = useState(category?.rollover ?? false)
  const [capStr, setCapStr] = useState(category?.rolloverCap != null ? String(category.rolloverCap) : '')
  const [overrideStr, setOverrideStr] = useState('')
  const [defaultAccountId, setDefaultAccountId] = useState(category?.defaultAccountId ?? '')
  const [linkedAccountId, setLinkedAccountId] = useState(category?.linkedAccountId ?? initialLinkedAccountId ?? '')
  const isFund = !!linkedAccountId

  // initialize override field once loaded
  const overrideVal = override?.base
  if (overrideVal != null && overrideStr === '') setOverrideStr(String(overrideVal))

  async function save() {
    if (!name.trim()) return
    const cap = capStr.trim() === '' ? null : parseAmount(capStr)
    // A payment fund always rolls over (it's a sinking fund) and can't also be a default account target.
    const fields = {
      name: name.trim(),
      emoji,
      monthlyBudget: parseAmount(budgetStr),
      rollover: isFund ? true : rollover,
      rolloverCap: cap,
      defaultAccountId: defaultAccountId || undefined,
      linkedAccountId: linkedAccountId || undefined,
    }
    if (category) {
      await db.categories.update(category.id, fields)
    } else {
      const order = (await db.categories.count()) + 1
      await db.categories.add({
        id: uid(),
        kind: 'expense',
        order,
        usageCount: 0,
        createdAt: Date.now(),
        ...fields,
      })
    }
    onClose()
  }

  async function saveOverride() {
    if (!category) return
    const id = `${category.id}:${monthKey}`
    if (overrideStr.trim() === '') {
      await db.budgets.delete(id)
    } else {
      await db.budgets.put({ id, categoryId: category.id, monthKey, base: parseAmount(overrideStr) })
    }
    onClose()
  }

  async function archive() {
    if (!category) return
    await db.categories.update(category.id, { archived: true })
    onClose()
    toast(`Archived ${category.name}`, {
      actionLabel: 'Undo',
      onAction: () => db.categories.update(category.id, { archived: false }),
    })
  }

  async function useLastMonthSpend() {
    if (!category) return
    const { start, end } = monthBounds(prevMonth(monthKey))
    const ts = await db.transactions.where('date').between(start, end, true, true).toArray()
    const sum = ts
      .filter((t) => t.type === 'expense' && t.categoryId === category.id)
      .reduce((s, t) => s + t.amount, 0)
    setBudgetStr(String(round2(sum)))
  }

  return (
    <Sheet title={category ? 'Edit category' : 'New category'} onClose={onClose}>
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
          placeholder="Category name"
          className="flex-1 rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        />
      </div>

      {/* Credit-card payment fund link */}
      {creditAccounts.length > 0 && (
        <Field label="Credit-card payment fund (optional)">
          <select
            value={linkedAccountId}
            onChange={(e) => {
              const id = e.target.value
              setLinkedAccountId(id)
              if (id) {
                const acc = creditAccounts.find((a) => a.id === id)
                // Auto-name from the card if the user hasn't typed a custom name yet.
                if (acc && !name.trim()) setName(`${acc.name} payment`)
                setEmoji('💳')
              }
            }}
            className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
          >
            <option value="">No — normal spending category</option>
            {creditAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                💳 Fund for {a.name}
              </option>
            ))}
          </select>
          {isFund && (
            <p className="text-[11px] text-ink-faint mt-1">
              Budget how much you plan to pay this card this month (like a bill). It counts toward your monthly
              spending, and recording a payment checks it off.
            </p>
          )}
        </Field>
      )}

      <div className="mt-1">
        <Field label={isFund ? 'Plan to pay this month (optional)' : 'Monthly budget (base)'}>
          <input
            inputMode="decimal"
            value={budgetStr}
            onChange={(e) => setBudgetStr(e.target.value)}
            placeholder="0.00"
            className="w-full rounded-xl border border-line bg-surface px-3 py-3 tnum outline-none focus:border-brand"
          />
        </Field>
        {category && !isFund && (
          <button onClick={useLastMonthSpend} className="text-xs text-brand font-medium -mt-1 px-1">
            Use last month's spend
          </button>
        )}
      </div>

      {/* Default account for quick entry (normal categories only) */}
      {!isFund && accounts.length > 0 && (
        <Field label="Default account when logging (optional)">
          <select
            value={defaultAccountId}
            onChange={(e) => setDefaultAccountId(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
          >
            <option value="">Last used</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {accountEmoji(a.type)} {a.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {!isFund && (
        <button
          onClick={() => setRollover(!rollover)}
          className="w-full flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-3 mb-3"
        >
          <span className="text-left">
            <span className="font-medium block">Roll over (envelope)</span>
            <span className="text-xs text-ink-faint">Unused/overspent carries to next month</span>
          </span>
          <span className={`relative w-11 h-6 rounded-full transition-colors ${rollover ? 'bg-brand' : 'bg-line'}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${rollover ? 'left-[1.375rem]' : 'left-0.5'}`} />
          </span>
        </button>
      )}

      {rollover && !isFund && (
        <Field label="Cap accumulated rollover (optional)">
          <input
            inputMode="decimal"
            value={capStr}
            onChange={(e) => setCapStr(e.target.value)}
            placeholder="No cap"
            className="w-full rounded-xl border border-line bg-surface px-3 py-3 tnum outline-none focus:border-brand"
          />
        </Field>
      )}

      <Button onClick={save} className="w-full mt-1" disabled={!name.trim()}>
        Save category
      </Button>

      {category && (
        <>
          <div className="mt-5 pt-4 border-t border-line">
            <Field label={`Override budget just for ${monthLabel(monthKey)}`}>
              <div className="flex gap-2">
                <input
                  inputMode="decimal"
                  value={overrideStr}
                  onChange={(e) => setOverrideStr(e.target.value)}
                  placeholder={`Default ${money(category.monthlyBudget)}`}
                  className="flex-1 rounded-xl border border-line bg-surface px-3 py-3 tnum outline-none focus:border-brand"
                />
                <Button variant="soft" onClick={saveOverride}>
                  Apply
                </Button>
              </div>
            </Field>
          </div>
          <Button
            variant="soft"
            className="w-full mt-2"
            onClick={() => navigate(`/transactions?category=${category.id}&type=expense`)}
          >
            View transactions
          </Button>
          <Button variant="danger" onClick={archive} className="w-full mt-2">
            Archive category
          </Button>
        </>
      )}
    </Sheet>
  )
}
