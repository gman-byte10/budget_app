import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import type { Account } from '../db/schema'
import { useBalances } from '../state/useData'
import { adjustAccountBalance } from '../state/actions'
import { getAccountBalanceSeries } from '../lib/stats'
import { money, parseAmount, moneySigned, round2 } from '../lib/money'
import { monthLabelShort } from '../lib/dates'
import { useToast } from '../components/Toast'
import { Card, Button, EmptyState, accountEmoji, SectionTitle } from '../components/ui'
import { Sparkline } from '../components/Sparkline'
import { Sheet, Field } from './Accounts'
import { TxnRow, makeLookups } from '../components/TxnRow'
import { AccountEditor } from './Accounts'

export default function AccountDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const account = useLiveQuery(() => db.accounts.get(id), [id])
  const bal = useBalances()
  const series = useLiveQuery(() => getAccountBalanceSeries(id, 6), [id], [])
  const accts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const cats = useLiveQuery(() => db.categories.toArray(), [], [])
  const txns = useLiveQuery(
    async () => {
      const out = await db.transactions
        .filter((t) => t.accountId === id || t.toAccountId === id)
        .toArray()
      return out.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
    },
    [id],
    [],
  )
  const [editing, setEditing] = useState(false)
  const [reconciling, setReconciling] = useState(false)

  if (account === undefined) return <p className="text-center text-ink-faint py-12">Loading…</p>
  if (account === null)
    return <EmptyState emoji="🤷" title="Account not found" hint="It may have been archived." />

  const balance = bal?.balances.get(id) ?? 0
  const lookups = makeLookups(cats, accts)
  const first = series[0]?.net ?? balance
  const change = balance - first

  return (
    <div className="pt-2">
      <button onClick={() => navigate('/accounts')} className="text-ink-soft text-sm mb-1">
        ‹ Accounts
      </button>

      <Card className="p-5 text-center">
        <div className="text-3xl">{accountEmoji(account.type)}</div>
        <p className="font-semibold mt-1">{account.name}</p>
        <p className="text-xs text-ink-faint capitalize">{account.type}</p>
        <p className={`tnum text-4xl font-bold mt-2 ${balance < 0 ? 'text-neg' : 'text-ink'}`}>{money(balance)}</p>
        {series.length > 1 && (
          <>
            <div className="mt-3">
              <Sparkline values={series.map((s) => s.net)} stroke={balance < 0 ? '#e11d48' : '#4f46e5'} />
            </div>
            <div className="flex justify-between text-[11px] text-ink-faint mt-1">
              <span>{monthLabelShort(series[0].monthKey)}</span>
              <span className={change >= 0 ? 'text-pos' : 'text-neg'}>
                {change >= 0 ? '▲' : '▼'} {money(Math.abs(change))} over 6 mo
              </span>
              <span>now</span>
            </div>
          </>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <Button variant="soft" onClick={() => setReconciling(true)}>
          Reconcile
        </Button>
        <Button variant="ghost" className="border border-line" onClick={() => setEditing(true)}>
          Edit account
        </Button>
      </div>
      <Button variant="ghost" className="w-full mt-2 text-sm" onClick={() => navigate(`/transactions?account=${id}`)}>
        View all transactions ›
      </Button>

      <SectionTitle>Transactions</SectionTitle>
      {txns.length === 0 ? (
        <EmptyState emoji="🌱" title="No transactions yet" hint="Add one with the + button." />
      ) : (
        <Card className="p-2">
          <div className="divide-y divide-line">
            {txns.slice(0, 50).map((t) => (
              <TxnRow key={t.id} txn={t} lookups={lookups} />
            ))}
          </div>
        </Card>
      )}

      {editing && <AccountEditor account={account} order={account.order} onClose={() => setEditing(false)} />}
      {reconciling && (
        <ReconcileSheet account={account} tracked={balance} onClose={() => setReconciling(false)} />
      )}
    </div>
  )
}

function ReconcileSheet({
  account,
  tracked,
  onClose,
}: {
  account: Account
  tracked: number
  onClose: () => void
}) {
  const toast = useToast()
  const [actualStr, setActualStr] = useState('')
  const actual = parseAmount(actualStr)
  const diff = actualStr.trim() === '' ? 0 : round2(actual - tracked)

  async function apply() {
    if (diff === 0) {
      onClose()
      return
    }
    // Log an adjustment so the tracked balance matches reality (not budget-counted).
    await adjustAccountBalance(account.id, diff)
    toast(`Adjusted ${account.name} by ${moneySigned(diff)}`)
    onClose()
  }

  return (
    <Sheet title={`Reconcile ${account.name}`} onClose={onClose}>
      <div className="rounded-xl bg-canvas p-3 mb-3 text-center">
        <p className="text-xs text-ink-faint">Tracked balance</p>
        <p className="tnum text-xl font-bold">{money(tracked)}</p>
      </div>
      <Field label="Actual balance (from your bank/wallet)">
        <input
          autoFocus
          inputMode="decimal"
          value={actualStr}
          onChange={(e) => setActualStr(e.target.value)}
          placeholder="0.00"
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 tnum text-xl outline-none focus:border-brand"
        />
      </Field>
      {actualStr.trim() !== '' && (
        <p className="text-sm text-center mb-3">
          {diff === 0 ? (
            <span className="text-pos">✓ Already matches — nothing to adjust.</span>
          ) : (
            <>
              Adjustment:{' '}
              <span className={`tnum font-semibold ${diff > 0 ? 'text-pos' : 'text-neg'}`}>{moneySigned(diff)}</span>
            </>
          )}
        </p>
      )}
      <p className="text-[11px] text-ink-faint mb-3">
        Logs a one-off “Balance adjustment” so your tracked balance matches reality. It updates net worth but
        isn’t counted against any budget.
      </p>
      <Button onClick={apply} className="w-full" disabled={actualStr.trim() === ''}>
        {diff === 0 ? 'Done' : `Adjust ${moneySigned(diff)}`}
      </Button>
    </Sheet>
  )
}
