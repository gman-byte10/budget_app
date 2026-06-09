import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useActiveAccounts, useActiveCategories } from '../state/useData'
import { useSettings } from '../state/useSettings'
import { addTransaction } from '../state/actions'
import { parseEntry, suggestCategory } from '../llm/tasks'
import { AiError } from '../llm/callLLM'
import type { Category, TxnType } from '../db/schema'
import { money, parseAmount } from '../lib/money'
import { todayStr } from '../lib/dates'
import { tap, success } from '../lib/haptics'
import { useToast } from '../components/Toast'
import { Button, accountEmoji } from '../components/ui'

const LAST_ACCT = 'budget.lastAccountId'

export default function AddTxn() {
  const navigate = useNavigate()
  const accounts = useActiveAccounts()
  const categories = useActiveCategories()
  const settings = useSettings()

  const [type, setType] = useState<TxnType>('expense')
  const [nlText, setNlText] = useState('')
  const [nlBusy, setNlBusy] = useState(false)
  const [nlMsg, setNlMsg] = useState('')
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [amountStr, setAmountStr] = useState('')
  const [categoryId, setCategoryId] = useState<string | undefined>()
  const [accountId, setAccountId] = useState<string | undefined>(
    () => localStorage.getItem(LAST_ACCT) ?? undefined,
  )
  const [toAccountId, setToAccountId] = useState<string | undefined>()
  const [note, setNote] = useState('')
  const [date, setDate] = useState(todayStr())
  const [saved, setSaved] = useState(false)
  const toast = useToast()

  // Resolve a sensible default account once accounts load.
  const effAccountId = accountId ?? accounts[0]?.id
  const effToAccountId = toAccountId ?? accounts.find((a) => a.id !== effAccountId)?.id

  // Categories ordered by recency, then frequency — recents surface first.
  const kind = type === 'income' ? 'income' : 'expense'
  const orderedCats = useMemo(() => {
    return categories
      .filter((c) => c.kind === kind && !c.linkedAccountId) // card-payment funds are paid via transfer
      .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || b.usageCount - a.usageCount)
  }, [categories, kind])

  // Picking a category auto-selects its default account (less friction).
  function pickCategory(id: string) {
    setCategoryId(id)
    const c = categories.find((x) => x.id === id)
    if (c?.defaultAccountId) setAccountId(c.defaultAccountId)
  }

  const amount = parseAmount(amountStr)
  const canSave =
    amount > 0 &&
    !!effAccountId &&
    (type === 'transfer' ? !!effToAccountId && effToAccountId !== effAccountId : !!categoryId)

  async function save() {
    if (!canSave || !effAccountId) return
    try {
      await addTransaction({
        type,
        amount,
        date,
        accountId: effAccountId,
        toAccountId: type === 'transfer' ? effToAccountId : undefined,
        categoryId: type === 'transfer' ? undefined : categoryId,
        note: note.trim() || undefined,
      })
    } catch (e) {
      toast("Couldn't save — " + String((e as Error)?.message || e))
      return
    }
    localStorage.setItem(LAST_ACCT, effAccountId)
    success()
    setSaved(true)
    setTimeout(() => navigate('/'), 550)
  }

  function applyQuickAdd(qa: (typeof settings.quickAdds)[number]) {
    tap()
    setType('expense')
    setCategoryId(qa.categoryId)
    if (qa.accountId) setAccountId(qa.accountId)
    if (qa.amount != null) setAmountStr(String(qa.amount))
  }

  // Natural-language entry. Local regex parser first; LLM only if that fails.
  async function parseNl() {
    if (!nlText.trim()) return
    setNlBusy(true)
    setNlMsg('')
    try {
      const r = await parseEntry(nlText)
      setType('expense')
      if (r.amount != null) setAmountStr(String(r.amount))
      if (r.categoryId) setCategoryId(r.categoryId)
      if (r.note) setNote(r.note)
      if (r.date) setDate(r.date)
      setNlText('')
      setNlMsg(r.source === 'ai' ? '✨ Parsed with AI' : '⚡ Parsed locally')
    } catch (e) {
      setNlMsg(
        e instanceof AiError
          ? "Couldn't read that locally. Add an API key in Settings for smarter parsing, or fill it in below."
          : 'Parse failed — fill it in below.',
      )
    } finally {
      setNlBusy(false)
    }
  }

  // Smart categorize: local match first, LLM fallback only if uncertain.
  async function suggest() {
    const text = note.trim()
    if (!text) return
    setSuggestBusy(true)
    try {
      const r = await suggestCategory(text)
      if (r.categoryId) setCategoryId(r.categoryId)
    } catch {
      /* AI off / no key — silently ignore, local already tried */
    } finally {
      setSuggestBusy(false)
    }
  }

  if (saved) {
    return (
      <div className="min-h-[60vh] grid place-items-center animate-pop">
        <div className="text-center">
          <div className="text-6xl mb-2">✅</div>
          <p className="font-semibold text-lg">Logged {money(amount)}</p>
          <p className="text-ink-soft text-sm">Nice — streak alive 🔥</p>
        </div>
      </div>
    )
  }

  return (
    <div className="pt-1">
      {/* Type switch */}
      <div className="flex gap-1 bg-canvas rounded-xl p-1 border border-line">
        {(['expense', 'income', 'transfer'] as TxnType[]).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold capitalize transition-colors ${
              type === t ? 'bg-surface shadow-sm text-ink' : 'text-ink-faint'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Natural-language quick entry (works offline; AI only as fallback) */}
      {type !== 'transfer' && (
        <div className="mt-2">
          <div className="flex gap-2">
            <input
              value={nlText}
              onChange={(e) => setNlText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && parseNl()}
              placeholder='Type it: "$12 lunch at Chipotle yesterday"'
              className="flex-1 rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand"
            />
            <Button variant="soft" onClick={parseNl} disabled={!nlText.trim() || nlBusy}>
              {nlBusy ? '…' : '✨'}
            </Button>
          </div>
          {nlMsg && <p className="text-xs text-ink-faint mt-1 px-1">{nlMsg}</p>}
        </div>
      )}

      {/* Amount display */}
      <div className="text-center py-6">
        <div className="tnum text-5xl font-bold tracking-tight">
          {amountStr === '' ? <span className="text-ink-faint">{money(0)}</span> : money(amount)}
        </div>
      </div>

      {/* Quick-add chips (expense only) */}
      {type === 'expense' && settings.quickAdds.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 no-scrollbar">
          {settings.quickAdds.map((qa) => (
            <button
              key={qa.id}
              onClick={() => applyQuickAdd(qa)}
              className="shrink-0 rounded-full bg-surface border border-line px-3 py-2 text-sm font-medium active:bg-canvas"
            >
              <span className="mr-1">{qa.emoji}</span>
              {qa.label}
              {qa.amount != null && <span className="text-ink-faint"> · {money(qa.amount)}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Category picker (expense/income) */}
      {type !== 'transfer' ? (
        <CategoryPicker cats={orderedCats} value={categoryId} onChange={pickCategory} />
      ) : (
        <div className="grid grid-cols-2 gap-2 mt-2">
          <AccountSelect label="From" accounts={accounts} value={effAccountId} onChange={setAccountId} />
          <AccountSelect label="To" accounts={accounts} value={effToAccountId} onChange={setToAccountId} />
        </div>
      )}

      {/* Account + note (expense/income) */}
      {type !== 'transfer' && (
        <div className="mt-3">
          <AccountSelect label="Account" accounts={accounts} value={effAccountId} onChange={setAccountId} />
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="flex-1 rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        />
        {type !== 'transfer' && note.trim() && !categoryId && (
          <Button variant="soft" onClick={suggest} disabled={suggestBusy} className="px-3 whitespace-nowrap">
            {suggestBusy ? '…' : '✨ Category'}
          </Button>
        )}
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-xl border border-line bg-surface px-3 py-3 text-ink-soft outline-none focus:border-brand"
        />
      </div>

      {/* Keypad */}
      <Keypad value={amountStr} onChange={setAmountStr} />

      <Button onClick={save} disabled={!canSave} className="w-full mt-3 text-lg py-4">
        {type === 'transfer' ? 'Transfer' : 'Save'} {amount > 0 ? money(amount) : ''}
      </Button>
    </div>
  )
}

function CategoryPicker({
  cats,
  value,
  onChange,
}: {
  cats: Category[]
  value?: string
  onChange: (id: string) => void
}) {
  return (
    <div className="grid grid-cols-4 gap-2 mt-2">
      {cats.map((c) => (
        <button
          key={c.id}
          onClick={() => onChange(c.id)}
          className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-medium transition-colors ${
            value === c.id ? 'border-brand bg-brand-soft text-brand' : 'border-line bg-surface text-ink-soft'
          }`}
        >
          <span className="text-xl leading-none">{c.emoji ?? '🏷️'}</span>
          <span className="truncate w-full text-center px-0.5">{c.name}</span>
        </button>
      ))}
    </div>
  )
}

function AccountSelect({
  label,
  accounts,
  value,
  onChange,
}: {
  label: string
  accounts: { id: string; name: string; type: string }[]
  value?: string
  onChange: (id: string) => void
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-ink-faint uppercase tracking-wide">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {accountEmoji(a.type)} {a.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  function press(k: string) {
    tap()
    if (k === '⌫') return onChange(value.slice(0, -1))
    if (k === '.') {
      if (value.includes('.')) return
      return onChange((value || '0') + '.')
    }
    // limit to 2 decimals
    if (value.includes('.') && value.split('.')[1]?.length >= 2) return
    onChange(value + k)
  }
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫']
  return (
    <div className="grid grid-cols-3 gap-2 mt-3">
      {keys.map((k) => (
        <button
          key={k}
          onClick={() => press(k)}
          className="py-4 rounded-xl bg-surface border border-line text-2xl font-medium active:bg-canvas tnum"
        >
          {k}
        </button>
      ))}
    </div>
  )
}
