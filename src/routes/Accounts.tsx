import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAccounts, useBalances } from '../state/useData'
import { db, uid } from '../db/db'
import type { Account, AccountType } from '../db/schema'
import { money, parseAmount } from '../lib/money'
import { reorderWithin } from '../lib/reorder'
import { useToast } from '../components/Toast'
import { Card, Button, EmptyState, accountEmoji, SectionTitle } from '../components/ui'

const TYPES: { value: AccountType; label: string }[] = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'cash', label: 'Cash' },
  { value: 'credit', label: 'Credit card' },
]

export default function Accounts() {
  const accounts = useAccounts()
  const bal = useBalances()
  const navigate = useNavigate()
  const [editing, setEditing] = useState<Account | 'new' | null>(null)
  const [fundFor, setFundFor] = useState<{ id: string; name: string } | null>(null)
  const [reordering, setReordering] = useState(false)

  const active = accounts.filter((a) => !a.archived)
  const balOf = (id: string) => bal?.balances.get(id) ?? 0

  // Split into spendable money (cash & bank) vs. debt (credit cards).
  const assets = active.filter((a) => a.type !== 'credit').sort((a, b) => a.order - b.order)
  const debts = active.filter((a) => a.type === 'credit').sort((a, b) => a.order - b.order)
  const cashTotal = assets.reduce((s, a) => s + balOf(a.id), 0)
  const debtTotal = debts.reduce((s, a) => s + balOf(a.id), 0) // negative when owed
  const net = bal?.net ?? 0

  const renderGroup = (group: Account[]) => (
    <div className="space-y-2">
      {group.map((a) => {
        const b = balOf(a.id)
        return (
          <Card
            key={a.id}
            className="p-4 flex items-center justify-between"
            onClick={reordering ? undefined : () => navigate(`/accounts/${a.id}`)}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-2xl">{accountEmoji(a.type)}</span>
              <div className="min-w-0">
                <p className="font-semibold truncate">{a.name}</p>
                <p className="text-xs text-ink-faint capitalize">{a.type}</p>
              </div>
            </div>
            {reordering ? (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => reorderWithin('accounts', group, a.id, -1)}
                  className="h-9 w-9 rounded-lg border border-line text-ink-soft active:bg-canvas"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  onClick={() => reorderWithin('accounts', group, a.id, 1)}
                  className="h-9 w-9 rounded-lg border border-line text-ink-soft active:bg-canvas"
                  aria-label="Move down"
                >
                  ↓
                </button>
              </div>
            ) : (
              <p className={`tnum font-semibold shrink-0 ${b < 0 ? 'text-neg' : 'text-ink'}`}>{money(b)}</p>
            )}
          </Card>
        )
      })}
    </div>
  )

  return (
    <div>
      <Card className="p-5 mt-3 text-center bg-gradient-to-br from-brand to-indigo-600 border-0">
        <p className="text-white/70 text-sm font-medium">Net worth</p>
        <p className="tnum text-white text-4xl font-bold mt-1">{money(net)}</p>
        <div className="flex justify-center gap-6 mt-3 text-white/85">
          <div>
            <p className="text-xs text-white/60">Cash & bank</p>
            <p className="tnum font-semibold">{money(cashTotal)}</p>
          </div>
          {debts.length > 0 && (
            <div>
              <p className="text-xs text-white/60">Debt</p>
              <p className="tnum font-semibold">{money(debtTotal)}</p>
            </div>
          )}
        </div>
      </Card>

      <SectionTitle
        action={
          <div className="flex gap-3">
            {active.length > 1 && (
              <button onClick={() => setReordering((v) => !v)} className="text-brand text-sm font-semibold">
                {reordering ? 'Done' : 'Reorder'}
              </button>
            )}
            <button onClick={() => setEditing('new')} className="text-brand text-sm font-semibold">
              + Add
            </button>
          </div>
        }
      >
        Accounts
      </SectionTitle>

      {active.length === 0 ? (
        <EmptyState emoji="💳" title="No accounts yet" hint="Add checking, savings, cash, or a card to start." />
      ) : (
        <div className="space-y-4">
          {assets.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-1 mb-1.5">
                <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Cash & bank</p>
                <p className="tnum text-xs text-ink-faint">{money(cashTotal)}</p>
              </div>
              {renderGroup(assets)}
            </div>
          )}
          {debts.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-1 mb-1.5">
                <p className="text-xs font-semibold text-ink-soft uppercase tracking-wide">Credit cards</p>
                <p className="tnum text-xs text-neg">{money(debtTotal)}</p>
              </div>
              {renderGroup(debts)}
            </div>
          )}
        </div>
      )}

      {editing && (
        <AccountEditor
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          order={accounts.length}
          onCreated={(c) => {
            if (c.type === 'credit') setFundFor({ id: c.id, name: c.name })
          }}
        />
      )}
      {fundFor && <PaymentFundPrompt account={fundFor} order={accounts.length + 10} onClose={() => setFundFor(null)} />}
    </div>
  )
}

function PaymentFundPrompt({
  account,
  order,
  onClose,
}: {
  account: { id: string; name: string }
  order: number
  onClose: () => void
}) {
  async function create() {
    await db.categories.add({
      id: uid(),
      name: `${account.name} payment`,
      kind: 'expense',
      emoji: '💳',
      monthlyBudget: 0,
      rollover: true,
      rolloverCap: null,
      linkedAccountId: account.id,
      order,
      usageCount: 0,
      createdAt: Date.now(),
    })
    onClose()
  }
  return (
    <Sheet title="Track payments for this card?" onClose={onClose}>
      <p className="text-sm text-ink-soft mb-4">
        Add a payment tracker for <b>{account.name}</b>. It automatically shows what you've charged and still
        need to pay, right on your Budget screen — and updates as you record payments. You can remove it anytime.
      </p>
      <Button onClick={create} className="w-full">
        Add payment tracker
      </Button>
      <Button variant="ghost" onClick={onClose} className="w-full mt-2 border border-line">
        Not now
      </Button>
    </Sheet>
  )
}

export function AccountEditor({
  account,
  order,
  onClose,
  onCreated,
}: {
  account: Account | null
  order: number
  onClose: () => void
  /** Called after a NEW account is created (used to offer a card payment fund). */
  onCreated?: (created: { id: string; name: string; type: AccountType }) => void
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? 'checking')
  const [openingStr, setOpeningStr] = useState(account ? String(account.openingBalance) : '')

  async function save() {
    if (!name.trim()) return
    const opening = parseAmount(openingStr)
    if (account) {
      await db.accounts.update(account.id, { name: name.trim(), type, openingBalance: opening })
      onClose()
    } else {
      const id = uid()
      await db.accounts.add({ id, name: name.trim(), type, openingBalance: opening, order, createdAt: Date.now() })
      onClose()
      onCreated?.({ id, name: name.trim(), type })
    }
  }

  async function archive() {
    if (!account) return
    await db.accounts.update(account.id, { archived: true })
    onClose()
    toast(`Archived ${account.name}`, {
      actionLabel: 'Undo',
      onAction: () => db.accounts.update(account.id, { archived: false }),
    })
  }

  return (
    <Sheet onClose={onClose} title={account ? 'Edit account' : 'New account'}>
      <Field label="Name">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Main Checking"
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        />
      </Field>
      <Field label="Type">
        <div className="grid grid-cols-2 gap-2">
          {TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={`py-2.5 rounded-xl border text-sm font-medium ${
                type === t.value ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink-soft'
              }`}
            >
              {accountEmoji(t.value)} {t.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label={type === 'credit' ? 'Current balance (negative if you owe)' : 'Current balance'}>
        <input
          inputMode="decimal"
          value={openingStr}
          onChange={(e) => setOpeningStr(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 tnum outline-none focus:border-brand"
        />
      </Field>
      <Button onClick={save} className="w-full mt-2" disabled={!name.trim()}>
        Save
      </Button>
      {account && (
        <>
          <Button
            variant="soft"
            className="w-full mt-2"
            onClick={() => navigate(`/transactions?account=${account.id}`)}
          >
            View transactions
          </Button>
          <Button variant="danger" onClick={archive} className="w-full mt-2">
            Archive account
          </Button>
        </>
      )}
    </Sheet>
  )
}

export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative w-full max-w-md bg-surface rounded-t-3xl p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] animate-pop max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-ink-faint text-xl px-2">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="text-xs font-semibold text-ink-faint uppercase tracking-wide">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  )
}
