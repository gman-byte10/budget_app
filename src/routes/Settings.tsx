import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid } from '../db/db'
import { useSettings, updateSettings } from '../state/useSettings'
import { downloadBackup, importAll } from '../lib/backup'
import { loadDemoData } from '../lib/demo'
import { hasPin, setPin, clearPin } from '../lib/pin'
import { money } from '../lib/money'
import { currentMonthKey } from '../lib/dates'
import { resolveModel, TASK_TIER, TIERS, type LlmTask, type Provider } from '../llm/config'
import { Card, Button, SectionTitle, ProgressBar } from '../components/ui'
import { Sheet, Field } from './Accounts'
import type { QuickAdd } from '../db/schema'

const CURRENCIES = [
  { code: 'USD', locale: 'en-US' },
  { code: 'EUR', locale: 'de-DE' },
  { code: 'GBP', locale: 'en-GB' },
  { code: 'CAD', locale: 'en-CA' },
  { code: 'AUD', locale: 'en-AU' },
  { code: 'INR', locale: 'en-IN' },
  { code: 'JPY', locale: 'ja-JP' },
]

export default function Settings() {
  const settings = useSettings()
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [importMsg, setImportMsg] = useState('')
  const [editingQA, setEditingQA] = useState<QuickAdd | 'new' | null>(null)

  async function onImport(file: File) {
    try {
      await importAll(await file.text())
      setImportMsg('✅ Imported. Reloading…')
      setTimeout(() => location.reload(), 800)
    } catch (e) {
      setImportMsg('❌ ' + (e as Error).message)
    }
  }

  return (
    <div className="pt-2 pb-6">
      <SectionTitle>Streak</SectionTitle>
      <Card className="p-4 flex items-center justify-around text-center">
        <div>
          <p className="text-2xl font-bold text-warn">🔥 {settings.streak.current}</p>
          <p className="text-xs text-ink-faint">current</p>
        </div>
        <div>
          <p className="text-2xl font-bold">🏆 {settings.streak.longest}</p>
          <p className="text-xs text-ink-faint">longest</p>
        </div>
      </Card>

      <SectionTitle>Appearance</SectionTitle>
      <Card className="p-2">
        <div className="flex gap-1">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button
              key={t}
              onClick={() => updateSettings({ theme: t })}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-colors ${
                (settings.theme ?? 'system') === t ? 'bg-brand text-white' : 'text-ink-soft'
              }`}
            >
              {t === 'system' ? '🌓 System' : t === 'light' ? '☀️ Light' : '🌙 Dark'}
            </button>
          ))}
        </div>
      </Card>

      <SectionTitle>Currency</SectionTitle>
      <Card className="p-4">
        <select
          value={settings.currency}
          onChange={(e) => {
            const c = CURRENCIES.find((x) => x.code === e.target.value)!
            updateSettings({ currency: c.code, locale: c.locale })
          }}
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {money(1234.5)}
            </option>
          ))}
        </select>
      </Card>

      <SectionTitle action={<button onClick={() => setEditingQA('new')} className="text-brand text-sm font-semibold">+ Add</button>}>
        Quick-add buttons
      </SectionTitle>
      <Card className="p-2">
        <div className="divide-y divide-line">
          {settings.quickAdds.length === 0 && (
            <p className="text-sm text-ink-faint p-3 text-center">No quick-adds. Add your most common expenses.</p>
          )}
          {settings.quickAdds.map((qa) => (
            <button
              key={qa.id}
              onClick={() => setEditingQA(qa)}
              className="w-full flex items-center justify-between py-2.5 px-2 active:bg-canvas rounded-lg"
            >
              <span className="font-medium">
                {qa.emoji} {qa.label}
              </span>
              <span className="text-sm text-ink-faint">{qa.amount != null ? money(qa.amount) : 'no preset'} ›</span>
            </button>
          ))}
        </div>
      </Card>

      <SectionTitle>Automate</SectionTitle>
      <Card className="p-4 flex items-center justify-between active:bg-canvas" onClick={() => navigate('/recurring')}>
        <div>
          <p className="font-medium">🔁 Recurring transactions</p>
          <p className="text-xs text-ink-faint">Rent, salary, subscriptions — auto-fill or remind</p>
        </div>
        <span className="text-ink-faint">›</span>
      </Card>

      <SectionTitle>AI assist</SectionTitle>
      <AiSettings />

      <SectionTitle>Security</SectionTitle>
      <SecuritySection />

      <SectionTitle>Backup</SectionTitle>
      <Card className="p-4 space-y-2">
        <Button variant="soft" className="w-full" onClick={downloadBackup}>
          ⬇️ Export all data (JSON)
        </Button>
        <Button variant="ghost" className="w-full border border-line" onClick={() => fileRef.current?.click()}>
          ⬆️ Import from backup
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
        />
        {importMsg && <p className="text-sm text-center">{importMsg}</p>}
        <p className="text-xs text-ink-faint text-center">
          All data lives only on this device (IndexedDB). Back up regularly.
        </p>
      </Card>

      <ArchivedItems />

      <SectionTitle>Try it out</SectionTitle>
      <Card className="p-4">
        <Button
          variant="soft"
          className="w-full"
          onClick={async () => {
            if (confirm('Add ~3 months of sample data so you can explore the charts and rollover? This adds to your current data.')) {
              await loadDemoData()
              location.reload()
            }
          }}
        >
          🎲 Load demo data
        </Button>
        <p className="text-xs text-ink-faint text-center mt-2">
          Great on a fresh install. Use “Reset everything” below to clear it out.
        </p>
      </Card>

      <SectionTitle>Danger zone</SectionTitle>
      <Card className="p-4">
        <Button
          variant="danger"
          className="w-full"
          onClick={async () => {
            if (confirm('Erase ALL data on this device? This cannot be undone.')) {
              await db.delete()
              location.reload()
            }
          }}
        >
          Reset everything
        </Button>
      </Card>

      {editingQA && <QuickAddEditor qa={editingQA === 'new' ? null : editingQA} onClose={() => setEditingQA(null)} />}
    </div>
  )
}

function QuickAddEditor({ qa, onClose }: { qa: QuickAdd | null; onClose: () => void }) {
  const settings = useSettings()
  const cats = useLiveQuery(() => db.categories.filter((c) => c.kind === 'expense' && !c.archived).toArray(), [], [])
  const accts = useLiveQuery(() => db.accounts.filter((a) => !a.archived).toArray(), [], [])
  const [label, setLabel] = useState(qa?.label ?? '')
  const [emoji, setEmoji] = useState(qa?.emoji ?? '⚡')
  const [amountStr, setAmountStr] = useState(qa?.amount != null ? String(qa.amount) : '')
  const [categoryId, setCategoryId] = useState(qa?.categoryId ?? '')
  const [accountId, setAccountId] = useState(qa?.accountId ?? '')

  async function save() {
    if (!label.trim() || !categoryId) return
    const next: QuickAdd = {
      id: qa?.id ?? uid(),
      label: label.trim(),
      emoji,
      amount: amountStr.trim() ? parseFloat(amountStr) : undefined,
      categoryId,
      accountId: accountId || undefined,
    }
    const list = qa
      ? settings.quickAdds.map((x) => (x.id === qa.id ? next : x))
      : [...settings.quickAdds, next]
    await updateSettings({ quickAdds: list })
    onClose()
  }

  async function remove() {
    if (!qa) return
    await updateSettings({ quickAdds: settings.quickAdds.filter((x) => x.id !== qa.id) })
    onClose()
  }

  return (
    <Sheet title={qa ? 'Edit quick-add' : 'New quick-add'} onClose={onClose}>
      <div className="flex gap-2">
        <input
          value={emoji}
          onChange={(e) => setEmoji(e.target.value.slice(0, 2))}
          className="w-16 text-center text-2xl rounded-xl border border-line bg-surface py-3 outline-none focus:border-brand"
        />
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Coffee"
          className="flex-1 rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        />
      </div>
      <div className="mt-3">
        <Field label="Preset amount (optional)">
          <input
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder="Leave blank to type each time"
            className="w-full rounded-xl border border-line bg-surface px-3 py-3 tnum outline-none focus:border-brand"
          />
        </Field>
      </div>
      <Field label="Category">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        >
          <option value="">Choose…</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.emoji} {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Default account (optional)">
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 outline-none focus:border-brand"
        >
          <option value="">Last used</option>
          {accts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Button onClick={save} className="w-full mt-1" disabled={!label.trim() || !categoryId}>
        Save
      </Button>
      {qa && (
        <Button variant="danger" onClick={remove} className="w-full mt-2">
          Remove
        </Button>
      )}
    </Sheet>
  )
}

const PROVIDERS: { id: Provider; label: string; hint: string; getUrl: string }[] = [
  { id: 'google', label: 'Google Gemini', hint: 'cheapest for small tasks', getUrl: 'aistudio.google.com/apikey' },
  { id: 'openai', label: 'OpenAI', hint: 'GPT-4o / mini', getUrl: 'platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic Claude', hint: 'Haiku / Sonnet', getUrl: 'console.anthropic.com' },
]

const TASK_LABELS: Record<LlmTask, string> = {
  categorize: 'Smart categorize',
  parse: 'Natural-language entry',
  coach: 'Coach',
  summary: 'Weekly summary',
}

function AiSettings() {
  const settings = useSettings()
  const ai = settings.ai
  const usage = useLiveQuery(
    () => db.llmUsage.where('monthKey').equals(currentMonthKey()).toArray(),
    [],
    [],
  )

  const [keys, setKeys] = useState<Record<string, string>>({ ...ai.keys } as Record<string, string>)
  const [capStr, setCapStr] = useState(String(ai.monthlyCapUsd))

  const available = PROVIDERS.map((p) => p.id).filter((id) => (keys[id] ?? '').trim())
  const spent = usage.reduce((s, r) => s + r.costUsd, 0)
  const calls = usage.length

  function patchAi(patch: Partial<typeof ai>) {
    updateSettings({ ai: { ...ai, ...patch } })
  }
  function saveKey(id: Provider) {
    patchAi({ keys: { ...ai.keys, [id]: keys[id]?.trim() || undefined } })
  }
  function saveCap() {
    patchAi({ monthlyCapUsd: Math.max(0, parseFloat(capStr) || 0) })
  }

  return (
    <>
      <Card className="p-4">
        <button
          onClick={() => patchAi({ enabled: !ai.enabled })}
          className="w-full flex items-center justify-between"
        >
          <span className="text-left">
            <span className="font-medium block">AI features {ai.enabled ? 'on' : 'off'}</span>
            <span className="text-xs text-ink-faint">App is 100% functional with this off</span>
          </span>
          <span className={`relative w-11 h-6 rounded-full transition-colors ${ai.enabled ? 'bg-brand' : 'bg-line'}`}>
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${ai.enabled ? 'left-[1.375rem]' : 'left-0.5'}`} />
          </span>
        </button>
      </Card>

      {ai.enabled && (
        <>
          {/* Usage / cost guardrail */}
          <Card className="p-4 mt-2">
            <div className="flex justify-between text-sm mb-1">
              <span className="text-ink-soft">This month</span>
              <span className="tnum font-semibold">
                ${spent.toFixed(4)} {ai.monthlyCapUsd > 0 && <span className="text-ink-faint">/ ${ai.monthlyCapUsd}</span>}
              </span>
            </div>
            {ai.monthlyCapUsd > 0 && <ProgressBar value={spent} max={ai.monthlyCapUsd} tone={spent >= ai.monthlyCapUsd ? 'neg' : 'brand'} />}
            <p className="text-xs text-ink-faint mt-2">
              {calls} call{calls === 1 ? '' : 's'} · cached & deduped automatically
            </p>
          </Card>

          <Field label="Monthly spend cap (USD) — AI disables when hit">
            <input
              inputMode="decimal"
              value={capStr}
              onChange={(e) => setCapStr(e.target.value)}
              onBlur={saveCap}
              className="w-full rounded-xl border border-line bg-surface px-3 py-3 tnum outline-none focus:border-brand mt-2"
            />
          </Field>

          {/* Keys per provider — stored locally on this device only */}
          <p className="text-xs text-ink-faint px-1 mb-2">
            Paste your own API keys. Stored locally on this device; sent only to your local proxy, never hardcoded.
          </p>
          {PROVIDERS.map((p) => (
            <Card key={p.id} className="p-4 mb-2">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm">{p.label}</span>
                <span className="text-[11px] text-ink-faint">{p.hint}</span>
              </div>
              <input
                type="password"
                value={keys[p.id] ?? ''}
                onChange={(e) => setKeys((s) => ({ ...s, [p.id]: e.target.value }))}
                onBlur={() => saveKey(p.id)}
                placeholder={ai.keys[p.id] ? '•••••• saved' : `Paste ${p.label} key`}
                className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand"
              />
              <p className="text-[11px] text-ink-faint mt-1">Get one at {p.getUrl}</p>
            </Card>
          ))}

          {/* Coach quality override — the one task where vendor choice matters */}
          <Card className="p-4">
            <p className="text-sm font-medium">Coach model</p>
            <p className="text-xs text-ink-faint mb-2">
              Cheap tasks always use the cheapest model. Pick a stronger vendor for the Coach if you like its
              advice better.
            </p>
            <select
              value={ai.coachProvider ?? 'auto'}
              onChange={(e) => patchAi({ coachProvider: e.target.value as typeof ai.coachProvider })}
              className="w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand"
            >
              <option value="auto">Auto — cheapest available</option>
              {PROVIDERS.filter((p) => available.includes(p.id)).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({TIERS.large[p.id]})
                </option>
              ))}
            </select>
          </Card>

          {/* Model-per-task routing — reflects your keys + Coach choice */}
          <Card className="p-4">
            <p className="text-sm font-medium mb-2">Active routing</p>
            <div className="space-y-1.5">
              {(Object.keys(TASK_LABELS) as LlmTask[]).map((t) => {
                const overrides =
                  ai.coachProvider && ai.coachProvider !== 'auto'
                    ? { coach: ai.coachProvider as Provider }
                    : undefined
                const choice = resolveModel(t, available, overrides)
                return (
                  <div key={t} className="flex justify-between text-xs">
                    <span className="text-ink-soft">
                      {TASK_LABELS[t]} <span className="text-ink-faint">· {TASK_TIER[t]}</span>
                    </span>
                    <span className="tnum text-ink-faint">{choice ? choice.model : 'needs a key'}</span>
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-ink-faint mt-2">Tiers/models are editable in src/llm/config.ts</p>
          </Card>

          <p className="text-xs text-ink-faint text-center mt-3 px-2">
            AI only fires on explicit actions (✨ buttons, Coach). Start the proxy with <b>npm run dev:ai</b>.
          </p>
        </>
      )}
    </>
  )
}

function ArchivedItems() {
  const accts = useLiveQuery(() => db.accounts.filter((a) => !!a.archived).toArray(), [], [])
  const cats = useLiveQuery(() => db.categories.filter((c) => !!c.archived).toArray(), [], [])
  if (accts.length === 0 && cats.length === 0) return null
  return (
    <>
      <SectionTitle>Archived</SectionTitle>
      <Card className="p-2">
        <div className="divide-y divide-line">
          {accts.map((a) => (
            <div key={a.id} className="flex items-center justify-between py-2.5 px-2">
              <span className="text-sm">🗄️ {a.name} <span className="text-ink-faint">· account</span></span>
              <button onClick={() => db.accounts.update(a.id, { archived: false })} className="text-brand text-sm font-semibold">
                Unarchive
              </button>
            </div>
          ))}
          {cats.map((c) => (
            <div key={c.id} className="flex items-center justify-between py-2.5 px-2">
              <span className="text-sm">{c.emoji} {c.name} <span className="text-ink-faint">· category</span></span>
              <button onClick={() => db.categories.update(c.id, { archived: false })} className="text-brand text-sm font-semibold">
                Unarchive
              </button>
            </div>
          ))}
        </div>
      </Card>
    </>
  )
}

function SecuritySection() {
  const [enabled, setEnabled] = useState(hasPin())
  const [editing, setEditing] = useState(false)
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-medium">App PIN</p>
          <p className="text-xs text-ink-faint">{enabled ? 'On — asked on open' : 'Off'}</p>
        </div>
        <Button variant="soft" className="py-2" onClick={() => setEditing(true)}>
          {enabled ? 'Change' : 'Set PIN'}
        </Button>
      </div>
      {enabled && (
        <Button
          variant="danger"
          className="w-full mt-3 py-2"
          onClick={() => {
            if (confirm('Remove the PIN lock?')) {
              clearPin()
              setEnabled(false)
            }
          }}
        >
          Remove PIN
        </Button>
      )}
      <p className="text-xs text-ink-faint mt-2">
        A light lock for when the app is on a public URL. It protects access on this device only —
        your data already lives only here.
      </p>
      {editing && (
        <PinSetSheet
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEnabled(true)
            setEditing(false)
          }}
        />
      )}
    </Card>
  )
}

function PinSetSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [pin, setPinVal] = useState('')
  const [confirm, setConfirm] = useState('')
  const valid = /^\d{4}$/.test(pin) && pin === confirm
  return (
    <Sheet title="Set a 4-digit PIN" onClose={onClose}>
      <Field label="New PIN">
        <input
          autoFocus
          inputMode="numeric"
          type="password"
          maxLength={4}
          value={pin}
          onChange={(e) => setPinVal(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="••••"
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 tnum text-center text-2xl tracking-[0.5em] outline-none focus:border-brand"
        />
      </Field>
      <Field label="Confirm PIN">
        <input
          inputMode="numeric"
          type="password"
          maxLength={4}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="••••"
          className="w-full rounded-xl border border-line bg-surface px-3 py-3 tnum text-center text-2xl tracking-[0.5em] outline-none focus:border-brand"
        />
      </Field>
      {confirm.length === 4 && pin !== confirm && (
        <p className="text-xs text-neg mb-2">PINs don't match.</p>
      )}
      <Button
        className="w-full"
        disabled={!valid}
        onClick={async () => {
          await setPin(pin)
          onSaved()
        }}
      >
        Save PIN
      </Button>
    </Sheet>
  )
}
