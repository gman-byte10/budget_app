import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid } from '../db/db'
import { CC_GROUP } from '../db/defaults'
import type { Category, Group } from '../db/schema'
import { useMonthBudget, useActiveAccounts, useBalances } from '../state/useData'
import { addTransaction } from '../state/actions'
import { contributeToGoal } from '../lib/goals'
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
  const groups = useLiveQuery(() => db.groups.filter((g) => !g.archived).sortBy('order'), [], [])
  const [editing, setEditing] = useState<Category | 'new' | null>(null)
  const [editingGroup, setEditingGroup] = useState<Group | 'new' | null>(null)
  const [newFundCard, setNewFundCard] = useState<{ id: string; name: string } | undefined>()
  const [newCatGroupId, setNewCatGroupId] = useState<string | undefined>()
  const [addToGroup, setAddToGroup] = useState<Group | null>(null)
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
  const allRows = (budget?.rows ?? []).slice().sort(byOrder)

  // Bucket rows into their budget sections.
  const UNGROUPED = '__ungrouped__'
  const rowsByGroup = new Map<string, CategoryBudgetRow[]>()
  for (const r of allRows) {
    let gid = r.category.groupId
    if (!gid || !groups.some((g) => g.id === gid)) gid = UNGROUPED
    const arr = rowsByGroup.get(gid) ?? []
    arr.push(r)
    rowsByGroup.set(gid, arr)
  }

  const renderSection = (group: Group | null) => {
    const gid = group ? group.id : UNGROUPED
    const rows = rowsByGroup.get(gid) ?? []
    if (!group && rows.length === 0) return null
    const act = rows.filter(isActive)
    const untr = rows.filter((r) => !isActive(r))
    const actCats = act.map((r) => r.category)
    const subSpent = act.reduce((s, r) => s + r.spent, 0)
    const subEff = act.reduce((s, r) => s + r.effective, 0)
    const left = round2(subEff - subSpent)
    return (
      <div key={gid} className="mt-4">
        <div className="flex items-center justify-between px-1 mb-1.5">
          <button
            onClick={group && !reordering ? () => setEditingGroup(group) : undefined}
            className="flex items-center gap-2 flex-wrap text-left flex-1 min-w-0 pr-2"
          >
            <span>{group?.emoji ?? '📂'}</span>
            <span className="font-semibold">{group?.name ?? 'Ungrouped'}</span>
            {group?.committed && (
              <span className="text-[10px] text-ink-faint border border-line rounded-full px-1.5 py-0.5 shrink-0">committed</span>
            )}
            {group && !reordering && <span className="text-ink-faint text-xs">✎</span>}
          </button>
          <div className="flex items-center gap-2 shrink-0">
            {reordering && group ? (
              <>
                <button onClick={() => reorderWithin('groups', groups, group.id, -1)} className="h-8 w-8 rounded-lg border border-line text-ink-soft active:bg-canvas" aria-label="Section up">↑</button>
                <button onClick={() => reorderWithin('groups', groups, group.id, 1)} className="h-8 w-8 rounded-lg border border-line text-ink-soft active:bg-canvas" aria-label="Section down">↓</button>
              </>
            ) : (
              <>
                {subEff > 0 && (
                  <span className={`tnum text-xs ${left < 0 ? 'text-neg' : 'text-ink-faint'}`}>{money(left)} left</span>
                )}
                {group && !closed && (
                  <button
                    onClick={() => setAddToGroup(group)}
                    className="text-brand text-base font-bold w-7 leading-none"
                    aria-label="Add category to section"
                  >
                    +
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {rows.length === 0 ? (
          <Card className="p-3">
            <p className="text-xs text-ink-faint text-center">No categories yet — tap + to add one.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {act.map((r) => (
              <BudgetRow
                key={r.category.id}
                row={r}
                cardBalance={r.category.linkedAccountId ? bal?.balances.get(r.category.linkedAccountId) : undefined}
                reordering={reordering}
                onUp={() => reorderWithin('categories', actCats, r.category.id, -1)}
                onDown={() => reorderWithin('categories', actCats, r.category.id, 1)}
                onClick={() => (r.frozen ? setEditing(r.category) : setActing(r))}
              />
            ))}
            {untr.length > 0 && (
              <Card className="p-2">
                <div className="divide-y divide-line">
                  {untr.map((r) => (
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
            )}
          </div>
        )}
      </div>
    )
  }

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
        <p className="text-[11px] text-ink-faint mt-0.5">flexible money left (bills, savings & card payments set aside)</p>
        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-line text-center">
          <div>
            <p className="tnum text-sm font-semibold">{money(budget?.totalEffective ?? 0)}</p>
            <p className="text-[10px] text-ink-faint">Total budgeted</p>
          </div>
          <div>
            <p className="tnum text-sm font-semibold">{money(budget?.committedEffective ?? 0)}</p>
            <p className="text-[10px] text-ink-faint">Committed</p>
          </div>
          <div>
            <p className="tnum text-sm font-semibold">{money(budget?.totalSpent ?? 0)}</p>
            <p className="text-[10px] text-ink-faint">Spent</p>
          </div>
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
            {!closed && allRows.length > 0 && (
              <button onClick={() => setReordering((v) => !v)} className="text-brand text-sm font-semibold">
                {reordering ? 'Done' : 'Reorder'}
              </button>
            )}
            {!closed && <button onClick={() => setEditingGroup('new')} className="text-brand text-sm font-semibold">+ Section</button>}
            <button onClick={() => setEditing('new')} className="text-brand text-sm font-semibold">
              + Category
            </button>
          </div>
        }
      >
        Sections
      </SectionTitle>

      {allRows.length === 0 && groups.length === 0 ? (
        <EmptyState emoji="🎯" title="No budgets yet" hint="Add a category and set a monthly amount to start tracking." />
      ) : (
        <>
          {groups.map((g) => renderSection(g))}
          {renderSection(null)}
        </>
      )}

      <GoalsStrip />

      {editing && (
        <CategoryEditor
          category={editing === 'new' ? null : editing}
          monthKey={mk}
          initialLinkedAccountId={editing === 'new' ? newFundCard?.id : undefined}
          initialLinkedAccountName={editing === 'new' ? newFundCard?.name : undefined}
          initialGroupId={editing === 'new' ? newCatGroupId : undefined}
          onClose={() => {
            setEditing(null)
            setNewFundCard(undefined)
            setNewCatGroupId(undefined)
          }}
        />
      )}

      {editingGroup && (
        <GroupEditor group={editingGroup === 'new' ? null : editingGroup} onClose={() => setEditingGroup(null)} />
      )}

      {addToGroup && (
        <AddToSectionSheet
          group={addToGroup}
          onClose={() => setAddToGroup(null)}
          onNewCategory={() => {
            setNewCatGroupId(addToGroup.id)
            setAddToGroup(null)
            setEditing('new')
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
  const groups = useLiveQuery(() => db.groups.filter((g) => !g.archived).sortBy('order'), [], [])
  const goal = useLiveQuery(
    () => (row.category.linkedGoalId ? db.goals.get(row.category.linkedGoalId) : undefined),
    [row.category.linkedGoalId],
  )
  const toast = useToast()
  const isFund = !!row.category.linkedAccountId
  const isGoal = !!row.category.linkedGoalId
  const [mode, setMode] = useState<'menu' | 'log' | 'pay' | 'contribute' | 'move'>('menu')

  async function moveToSection(groupId: string | undefined) {
    await db.categories.update(row.category.id, { groupId })
    const g = groups.find((x) => x.id === groupId)
    toast(g ? `Moved to ${g.name}` : 'Removed from section')
    onClose()
  }
  // Pre-fill a card payment / goal contribution with what's still planned this month.
  const [amountStr, setAmountStr] = useState(() => {
    const left = round2(row.effective - row.spent)
    return (isFund || isGoal) && left > 0 ? String(left) : ''
  })
  // null = "not chosen yet"; we fall back to a sensible default that stays valid
  // even though `accounts` loads asynchronously (avoids a stuck-empty select).
  const [accountId, setAccountId] = useState<string | null>(null)
  // For goal contributions: '' = just earmark (no transfer).
  const [fromAccountId, setFromAccountId] = useState('')
  const remaining = round2(row.effective - row.spent)

  // The account to use if the user hasn't explicitly picked one.
  const defaultFrom =
    row.category.defaultAccountId || accounts.find((a) => a.type !== 'credit')?.id || accounts[0]?.id || ''
  const effAccountId = accountId ?? defaultFrom

  async function logExpense() {
    const amount = parseAmount(amountStr)
    if (amount <= 0 || !effAccountId) return
    try {
      await addTransaction({ type: 'expense', amount, date: todayStr(), accountId: effAccountId, categoryId: row.category.id })
      toast(`Logged ${money(amount)} to ${row.category.name}`)
      onClose()
    } catch (e) {
      toast("Couldn't save — " + String((e as Error)?.message || e))
    }
  }
  async function payCard() {
    const amount = parseAmount(amountStr)
    if (amount <= 0 || !effAccountId || !row.category.linkedAccountId) return
    try {
      await addTransaction({
        type: 'transfer',
        amount,
        date: todayStr(),
        accountId: effAccountId,
        toAccountId: row.category.linkedAccountId,
        note: `${row.category.name}`,
      })
      toast(`Paid ${money(amount)} to card`)
      onClose()
    } catch (e) {
      toast("Couldn't save — " + String((e as Error)?.message || e))
    }
  }
  async function addToGoal() {
    const amount = parseAmount(amountStr)
    if (amount <= 0 || !goal) return
    try {
      await contributeToGoal({ goal, amount, fromAccountId: fromAccountId || undefined })
      toast(`Added ${money(amount)} to ${goal.name}`)
      onClose()
    } catch (e) {
      toast("Couldn't save — " + String((e as Error)?.message || e))
    }
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
          <Button className="w-full" onClick={() => setMode(isFund ? 'pay' : isGoal ? 'contribute' : 'log')}>
            {isFund ? '💳 Make a payment' : isGoal ? '⭐ Add to goal' : '＋ Log expense'}
          </Button>
          <Button variant="soft" className="w-full mt-2" onClick={() => setMode('move')}>
            ↪ Move to section
          </Button>
          <Button variant="ghost" className="w-full mt-2 border border-line" onClick={onEdit}>
            Edit category
          </Button>
        </>
      )}

      {mode === 'move' && (
        <div className="space-y-2">
          <p className="text-xs text-ink-faint px-1">Move “{row.category.name}” to:</p>
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={() => moveToSection(g.id)}
              disabled={g.id === row.category.groupId}
              className="w-full flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-3 active:bg-canvas disabled:opacity-40"
            >
              <span className="font-medium">
                {g.emoji} {g.name}
              </span>
              {g.id === row.category.groupId && <span className="text-xs text-ink-faint">current</span>}
            </button>
          ))}
          <button
            onClick={() => moveToSection(undefined)}
            disabled={!row.category.groupId}
            className="w-full flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-3 active:bg-canvas disabled:opacity-40"
          >
            <span className="font-medium">📂 Ungrouped (remove from section)</span>
          </button>
          <Button variant="ghost" className="w-full border border-line" onClick={() => setMode('menu')}>
            Back
          </Button>
        </div>
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
              value={effAccountId}
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

      {mode === 'contribute' && (
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
          {goal?.accountId && (
            <Field label="Move money from">
              <select
                value={fromAccountId}
                onChange={(e) => setFromAccountId(e.target.value)}
                className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
              >
                <option value="">Just earmark (no transfer)</option>
                {accounts
                  .filter((a) => a.id !== goal.accountId)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountEmoji(a.type)} {a.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          <Button className="w-full" onClick={addToGoal} disabled={parseAmount(amountStr) <= 0}>
            Add {parseAmount(amountStr) > 0 ? money(parseAmount(amountStr)) : ''} to goal
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
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold min-w-0 flex-wrap flex-1 pr-1">
          <span className="text-lg">{isFund ? '💳' : row.category.emoji}</span>
          <span className="break-words">{row.category.name}</span>
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
  initialGroupId,
}: {
  category: Category | null
  monthKey: string
  onClose: () => void
  /** Pre-link a new fund to this card (used by the "add payment plan" nudge). */
  initialLinkedAccountId?: string
  initialLinkedAccountName?: string
  /** Pre-assign a new category to this section. */
  initialGroupId?: string
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const accounts = useActiveAccounts()
  const creditAccounts = accounts.filter((a) => a.type === 'credit')
  const groups = useLiveQuery(() => db.groups.filter((g) => !g.archived).sortBy('order'), [], [])
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
  const [linkedGoalId, setLinkedGoalId] = useState(category?.linkedGoalId ?? '')
  const [groupId, setGroupId] = useState(category?.groupId ?? initialGroupId ?? '')
  const activeGoals = useLiveQuery(() => db.goals.filter((g) => !g.completedAt).toArray(), [], [])
  const isFund = !!linkedAccountId
  const isGoalLine = !!linkedGoalId

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
      linkedGoalId: linkedGoalId || undefined,
      groupId: groupId || undefined,
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

      {groups.length > 0 && (
        <div className="mt-3">
          <Field label="Section">
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
            >
              <option value="">Ungrouped</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.emoji} {g.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {/* Savings goal link — this category tracks contributions to a goal */}
      {!isFund && activeGoals.length > 0 && (
        <Field label="Track a savings goal (optional)">
          <select
            value={linkedGoalId}
            onChange={(e) => setLinkedGoalId(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
          >
            <option value="">No — normal spending category</option>
            {activeGoals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.emoji ?? '⭐'} {g.name}
              </option>
            ))}
          </select>
          {isGoalLine && (
            <p className="text-[11px] text-ink-faint mt-1">
              Budget how much you plan to save toward this goal each month. Contributions to the goal count as
              this line's progress.
            </p>
          )}
        </Field>
      )}

      {/* Credit-card payment fund link */}
      {!isGoalLine && creditAccounts.length > 0 && (
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
                // Drop it in the Credit card payments section by default.
                const cc = groups.find((g) => g.name === CC_GROUP)
                if (cc) setGroupId(cc.id)
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

function GroupEditor({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const [name, setName] = useState(group?.name ?? '')
  const [emoji, setEmoji] = useState(group?.emoji ?? '📂')
  const [committed, setCommitted] = useState(group?.committed ?? false)

  async function save() {
    if (!name.trim()) return
    if (group) {
      await db.groups.update(group.id, { name: name.trim(), emoji, committed })
    } else {
      const order = (await db.groups.count()) + 1
      await db.groups.add({ id: uid(), name: name.trim(), emoji, committed, order, createdAt: Date.now() })
    }
    onClose()
  }

  async function remove() {
    if (!group) return
    if (!confirm(`Delete the "${group.name}" section? Its categories become ungrouped (not deleted).`)) return
    await db.transaction('rw', db.categories, db.groups, async () => {
      await db.categories
        .where('groupId')
        .equals(group.id)
        .modify((c) => {
          c.groupId = undefined
        })
      await db.groups.delete(group.id)
    })
    onClose()
  }

  return (
    <Sheet title={group ? 'Edit section' : 'New section'} onClose={onClose}>
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
          placeholder="e.g. Bills"
          className="flex-1 rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        />
      </div>

      <button
        onClick={() => setCommitted((v) => !v)}
        className="w-full flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-3 mt-3"
      >
        <span className="text-left">
          <span className="font-medium block">Committed money</span>
          <span className="text-xs text-ink-faint">Excluded from “safe to spend” (e.g. bills, savings, card payments)</span>
        </span>
        <span className={`relative w-11 h-6 rounded-full transition-colors ${committed ? 'bg-brand' : 'bg-line'}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${committed ? 'left-[1.375rem]' : 'left-0.5'}`} />
        </span>
      </button>

      <Button onClick={save} className="w-full mt-4" disabled={!name.trim()}>
        Save section
      </Button>
      {group && (
        <Button variant="danger" onClick={remove} className="w-full mt-2">
          Delete section
        </Button>
      )}
    </Sheet>
  )
}

function GoalsStrip() {
  const navigate = useNavigate()
  const goals = useLiveQuery(() => db.goals.filter((g) => !g.completedAt).toArray(), [], [])
  const contributions = useLiveQuery(() => db.contributions.toArray(), [], [])
  if (goals.length === 0) return null
  const saved = new Map<string, number>()
  for (const c of contributions) saved.set(c.goalId, (saved.get(c.goalId) ?? 0) + c.amount)
  return (
    <>
      <SectionTitle
        action={
          <button onClick={() => navigate('/goals')} className="text-brand text-sm font-semibold">
            All ›
          </button>
        }
      >
        Goals
      </SectionTitle>
      <div className="space-y-2">
        {goals.map((g) => {
          const s = saved.get(g.id) ?? 0
          return (
            <Card key={g.id} className="p-3" onClick={() => navigate('/goals')}>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium truncate">
                  {g.emoji ?? '⭐'} {g.name}
                </span>
                <span className="tnum text-ink-faint shrink-0">
                  {money(s)} / {money(g.target)}
                </span>
              </div>
              <div className="mt-2">
                <ProgressBar value={s} max={g.target} tone="pos" />
              </div>
            </Card>
          )
        })}
      </div>
    </>
  )
}

function AddToSectionSheet({
  group,
  onClose,
  onNewCategory,
}: {
  group: Group
  onClose: () => void
  onNewCategory: () => void
}) {
  const toast = useToast()
  const cats = useLiveQuery(
    () =>
      db.categories
        .filter((c) => c.kind === 'expense' && !c.archived && c.groupId !== group.id)
        .sortBy('order'),
    [group.id],
    [],
  )
  return (
    <Sheet title={`Add to ${group.emoji ?? ''} ${group.name}`} onClose={onClose}>
      <Button className="w-full" onClick={onNewCategory}>
        ＋ New category
      </Button>
      {cats.length > 0 && (
        <>
          <p className="text-xs text-ink-faint mt-4 mb-1 px-1">Or move an existing one here:</p>
          <div className="space-y-2">
            {cats.map((c) => (
              <button
                key={c.id}
                onClick={async () => {
                  await db.categories.update(c.id, { groupId: group.id })
                  toast(`Moved ${c.name} to ${group.name}`)
                  onClose()
                }}
                className="w-full flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-3 active:bg-canvas"
              >
                <span>{c.emoji}</span>
                <span className="font-medium">{c.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  )
}
