import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { updateSettings } from '../state/useSettings'
import { parseAmount, money } from '../lib/money'
import { Button, accountEmoji } from './ui'

const CURRENCIES = [
  { code: 'USD', locale: 'en-US' },
  { code: 'EUR', locale: 'de-DE' },
  { code: 'GBP', locale: 'en-GB' },
  { code: 'CAD', locale: 'en-CA' },
  { code: 'AUD', locale: 'en-AU' },
  { code: 'INR', locale: 'en-IN' },
  { code: 'JPY', locale: 'ja-JP' },
]

export default function Onboarding({ onDone }: { onDone: () => void }) {
  const accounts = useLiveQuery(() => db.accounts.orderBy('order').toArray(), [], [])
  const [step, setStep] = useState(0)
  const [currency, setCurrency] = useState('USD')
  const [balances, setBalances] = useState<Record<string, string>>({})

  async function finish() {
    const c = CURRENCIES.find((x) => x.code === currency)!
    await db.transaction('rw', db.accounts, db.settings, async () => {
      for (const a of accounts) {
        const v = balances[a.id]
        if (v != null && v.trim() !== '') {
          await db.accounts.update(a.id, { openingBalance: parseAmount(v) })
        }
      }
      await updateSettings({ currency: c.code, locale: c.locale, onboarded: true })
    })
    onDone()
  }

  async function skip() {
    await updateSettings({ onboarded: true })
    onDone()
  }

  return (
    <div className="fixed inset-0 z-50 bg-canvas overflow-y-auto">
      <div className="max-w-md mx-auto min-h-full flex flex-col px-6 pt-10 pb-8">
        {/* progress */}
        <div className="flex gap-1.5 justify-center mb-8">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-brand' : 'w-1.5 bg-line'}`}
            />
          ))}
        </div>

        {step === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center animate-pop">
            <div className="text-6xl mb-4">💸</div>
            <h1 className="text-2xl font-bold">Welcome to Budget</h1>
            <p className="text-ink-soft mt-3 max-w-xs">
              Fast, private, and built so you'll actually keep using it. Everything stays on your
              device. Let's set up in about 30 seconds.
            </p>
            <Button onClick={() => setStep(1)} className="w-full mt-8">
              Get started
            </Button>
            <button onClick={skip} className="text-ink-faint text-sm mt-3">
              Skip setup
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="flex-1 flex flex-col animate-pop">
            <h2 className="text-xl font-bold">Your currency</h2>
            <p className="text-ink-soft mt-1 mb-5 text-sm">You can change this later in Settings.</p>
            <div className="space-y-2">
              {CURRENCIES.map((c) => (
                <button
                  key={c.code}
                  onClick={() => setCurrency(c.code)}
                  className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 ${
                    currency === c.code ? 'border-brand bg-brand-soft' : 'border-line bg-surface'
                  }`}
                >
                  <span className="font-medium">{c.code}</span>
                  <span className="tnum text-ink-soft">
                    {new Intl.NumberFormat(c.locale, { style: 'currency', currency: c.code }).format(1234.5)}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-auto pt-6">
              <Button onClick={() => setStep(2)} className="w-full">
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex-1 flex flex-col animate-pop">
            <h2 className="text-xl font-bold">Starting balances</h2>
            <p className="text-ink-soft mt-1 mb-5 text-sm">
              What's in each account right now? Leave blank for zero — you can edit or add accounts
              anytime.
            </p>
            <div className="space-y-3">
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center gap-3">
                  <span className="text-2xl w-8 text-center">{accountEmoji(a.type)}</span>
                  <span className="flex-1 font-medium">{a.name}</span>
                  <input
                    inputMode="decimal"
                    value={balances[a.id] ?? ''}
                    onChange={(e) => setBalances((s) => ({ ...s, [a.id]: e.target.value }))}
                    placeholder={a.type === 'credit' ? '0 (− if owed)' : '0.00'}
                    className="w-32 rounded-xl border border-line bg-surface px-3 py-2.5 tnum text-right outline-none focus:border-brand"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-ink-faint mt-4">
              Tip: for a credit card, enter a negative number for what you currently owe.
            </p>
            <div className="mt-auto pt-6">
              <Button onClick={finish} className="w-full">
                {(() => {
                  const total = accounts.reduce((s, a) => s + parseAmount(balances[a.id] ?? '0'), 0)
                  return total !== 0 ? `Start with ${money(total)} net worth` : "Let's go"
                })()}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
