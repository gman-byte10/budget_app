import type { Account, Category, Transaction } from '../db/schema'
import { money } from '../lib/money'
import { friendlyDate } from '../lib/dates'
import { accountEmoji } from './ui'

export interface Lookups {
  cats: Map<string, Category>
  accts: Map<string, Account>
}

// eslint-disable-next-line react-refresh/only-export-components
export function makeLookups(cats: Category[], accts: Account[]): Lookups {
  return {
    cats: new Map(cats.map((c) => [c.id, c])),
    accts: new Map(accts.map((a) => [a.id, a])),
  }
}

/** Wrap occurrences of `q` in <mark> for search highlighting. */
function Highlight({ text, q }: { text: string; q?: string }) {
  if (!q || !q.trim()) return <>{text}</>
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-warn-soft text-ink rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  )
}

export function TxnRow({
  txn,
  lookups,
  onClick,
  highlight,
  hideAccount,
}: {
  txn: Transaction
  lookups: Lookups
  onClick?: () => void
  highlight?: string
  /** Hide the account name in the meta line (redundant on an account's own screen). */
  hideAccount?: boolean
}) {
  const cat = txn.categoryId ? lookups.cats.get(txn.categoryId) : undefined
  const acct = lookups.accts.get(txn.accountId)
  const toAcct = txn.toAccountId ? lookups.accts.get(txn.toAccountId) : undefined

  let emoji = cat?.emoji ?? '🏷️'
  let title = cat?.name ?? 'Uncategorized'
  let sign = ''
  let amountClass = 'text-ink'

  if (txn.type === 'income') {
    emoji = cat?.emoji ?? '💵'
    sign = '+'
    amountClass = 'text-pos'
  } else if (txn.type === 'transfer') {
    emoji = '🔄'
    title = `${acct?.name ?? '?'} → ${toAcct?.name ?? '?'}`
    amountClass = 'text-ink-soft'
  }

  const prefix =
    txn.type === 'transfer' || hideAccount
      ? friendlyDate(txn.date)
      : `${friendlyDate(txn.date)} · ${accountEmoji(acct?.type ?? '')} ${acct?.name ?? ''}`

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 py-2.5 px-1 text-left active:bg-canvas rounded-lg"
    >
      <span className="grid place-items-center h-9 w-9 rounded-full bg-canvas text-lg shrink-0">{emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">
          <Highlight text={title} q={highlight} />
        </p>
        <p className="text-xs text-ink-faint truncate">
          {prefix}
          {txn.note && (
            <>
              {' · '}
              <Highlight text={txn.note} q={highlight} />
            </>
          )}
        </p>
      </div>
      <p className={`tnum font-semibold shrink-0 ${amountClass}`}>
        {sign}
        {money(txn.amount)}
      </p>
    </button>
  )
}
