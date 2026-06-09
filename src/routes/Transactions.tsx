import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Transaction } from '../db/schema'
import { deleteTransaction, updateTransaction } from '../state/actions'
import { friendlyDate, monthKeyOf } from '../lib/dates'
import { money, parseAmount } from '../lib/money'
import { Card, EmptyState, Pill, Button } from '../components/ui'
import { TxnRow, makeLookups } from '../components/TxnRow'
import { useToast } from '../components/Toast'
import { Sheet, Field } from './Accounts'

type TypeFilter = 'all' | 'expense' | 'income' | 'transfer'

export default function Transactions() {
  // Initialise filters from the URL so other screens can deep-link here.
  const [params] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [typeF, setTypeF] = useState<TypeFilter>((params.get('type') as TypeFilter) || 'all')
  const [catF, setCatF] = useState(params.get('category') ?? '')
  const [acctF, setAcctF] = useState(params.get('account') ?? '')
  const [editing, setEditing] = useState<Transaction | null>(null)

  const txns = useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), [], [])
  const cats = useLiveQuery(() => db.categories.toArray(), [], [])
  const accts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const lookups = makeLookups(cats, accts)

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    return txns
      .filter((t) => (typeF === 'all' ? true : t.type === typeF))
      .filter((t) => (catF ? t.categoryId === catF : true))
      .filter((t) => (acctF ? t.accountId === acctF || t.toAccountId === acctF : true))
      .filter((t) => {
        if (!ql) return true
        const cat = t.categoryId ? lookups.cats.get(t.categoryId)?.name ?? '' : ''
        return (t.note ?? '').toLowerCase().includes(ql) || cat.toLowerCase().includes(ql)
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
  }, [txns, q, typeF, catF, acctF, lookups])

  // Group by date for headers
  const groups = useMemo(() => {
    const m = new Map<string, Transaction[]>()
    for (const t of filtered) {
      if (!m.has(t.date)) m.set(t.date, [])
      m.get(t.date)!.push(t)
    }
    return [...m.entries()]
  }, [filtered])

  const total = filtered.reduce((s, t) => (t.type === 'expense' ? s + t.amount : t.type === 'income' ? s - t.amount : s), 0)

  return (
    <div className="pt-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search notes & categories…"
        className="w-full rounded-xl border border-line bg-surface px-4 py-3 outline-none focus:border-brand"
      />

      <div className="flex gap-2 overflow-x-auto py-3 -mx-4 px-4 no-scrollbar">
        {(['all', 'expense', 'income', 'transfer'] as TypeFilter[]).map((t) => (
          <Pill key={t} active={typeF === t} onClick={() => setTypeF(t)}>
            <span className="capitalize">{t}</span>
          </Pill>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 mb-1">
        <select
          value={catF}
          onChange={(e) => setCatF(e.target.value)}
          className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand"
        >
          <option value="">All categories</option>
          {cats.filter((c) => !c.archived).map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </select>
        <select
          value={acctF}
          onChange={(e) => setAcctF(e.target.value)}
          className="rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand"
        >
          <option value="">All accounts</option>
          {accts.filter((a) => !a.archived).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>

      {filtered.length > 0 && (
        <p className="text-xs text-ink-faint px-1 my-2">
          {filtered.length} transaction{filtered.length === 1 ? '' : 's'} · net spend {money(total)}
        </p>
      )}

      {groups.length === 0 ? (
        <EmptyState emoji="🔍" title="Nothing here" hint="Try clearing filters or logging a transaction." />
      ) : (
        <div className="space-y-3">
          {groups.map(([date, items]) => (
            <div key={date}>
              <p className="text-xs font-semibold text-ink-faint px-1 mb-1">{friendlyDate(date)}</p>
              <Card className="p-2">
                <div className="divide-y divide-line">
                  {items.map((t) => (
                    <TxnRow key={t.id} txn={t} lookups={lookups} highlight={q} onClick={() => setEditing(t)} />
                  ))}
                </div>
              </Card>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditTxn
          txn={editing}
          cats={cats}
          accts={accts}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function EditTxn({
  txn,
  cats,
  accts,
  onClose,
}: {
  txn: Transaction
  cats: { id: string; name: string; emoji?: string; kind: string }[]
  accts: { id: string; name: string }[]
  onClose: () => void
}) {
  const [amountStr, setAmountStr] = useState(String(txn.amount))
  const [categoryId, setCategoryId] = useState(txn.categoryId ?? '')
  const [accountId, setAccountId] = useState(txn.accountId)
  const [note, setNote] = useState(txn.note ?? '')
  const [date, setDate] = useState(txn.date)
  const toast = useToast()

  const relevantCats = cats.filter((c) => c.kind === (txn.type === 'income' ? 'income' : 'expense'))

  async function save() {
    await updateTransaction(txn.id, {
      amount: parseAmount(amountStr),
      categoryId: txn.type === 'transfer' ? undefined : categoryId,
      accountId,
      note: note.trim() || undefined,
      date,
    })
    onClose()
  }
  async function remove() {
    const snapshot = { ...txn } // keep a copy so we can restore it
    await deleteTransaction(txn.id)
    onClose()
    toast('Transaction deleted', {
      actionLabel: 'Undo',
      onAction: () => {
        db.transactions.add(snapshot)
      },
    })
  }

  return (
    <Sheet title="Edit transaction" onClose={onClose}>
      <Field label="Amount">
        <input
          inputMode="decimal"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 tnum outline-none focus:border-brand"
        />
      </Field>
      {txn.type !== 'transfer' && (
        <Field label="Category">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
          >
            {relevantCats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Account">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        >
          {accts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Note">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        />
      </Field>
      <Field label="Date">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        />
      </Field>
      <Button onClick={save} className="w-full mt-1">
        Save changes
      </Button>
      <Button variant="danger" onClick={remove} className="w-full mt-2">
        Delete
      </Button>
      <p className="text-center text-xs text-ink-faint mt-3">In {monthKeyOf(txn.date)}</p>
    </Sheet>
  )
}
