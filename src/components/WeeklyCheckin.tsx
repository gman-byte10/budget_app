import { useEffect, useState } from 'react'
import { getWeeklySummary, type WeeklySummary } from '../lib/stats'
import { updateSettings, useSettings } from '../state/useSettings'
import { useAiStatus } from '../state/useData'
import { runWeeklySummary } from '../llm/tasks'
import { AiError } from '../llm/callLLM'
import { todayStr } from '../lib/dates'
import { money } from '../lib/money'
import { Card, Button } from './ui'
import { Sheet } from '../routes/Accounts'

export function WeeklyCheckinCard({ ready }: { ready: boolean }) {
  const [open, setOpen] = useState(false)
  if (!ready) return null
  return (
    <>
      <Card className="p-4 mt-3 flex items-center justify-between bg-brand-soft border-brand/15" onClick={() => setOpen(true)}>
        <div>
          <p className="font-semibold text-sm">📊 Your weekly check-in is ready</p>
          <p className="text-xs text-ink-soft">Takes about 30 seconds</p>
        </div>
        <span className="text-brand font-semibold text-sm">Open ›</span>
      </Card>
      {open && <WeeklyCheckinSheet onClose={() => setOpen(false)} />}
    </>
  )
}

export function WeeklyCheckinSheet({ onClose }: { onClose: () => void }) {
  const settings = useSettings()
  const ai = useAiStatus()
  const [data, setData] = useState<WeeklySummary | null>(null)
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiErr, setAiErr] = useState('')

  useEffect(() => {
    getWeeklySummary().then(setData)
  }, [])

  async function genSummary() {
    setAiBusy(true)
    setAiErr('')
    try {
      const r = await runWeeklySummary()
      setAiText(r.text)
    } catch (e) {
      setAiErr(e instanceof AiError ? e.message : 'Could not generate. Is the proxy running?')
    } finally {
      setAiBusy(false)
    }
  }

  async function done() {
    await updateSettings({ lastWeeklyCheckin: todayStr() })
    onClose()
  }

  const trend =
    data?.deltaPct == null
      ? null
      : data.deltaPct <= 0
        ? { txt: `${Math.abs(data.deltaPct)}% less than last week`, good: true }
        : { txt: `${data.deltaPct}% more than last week`, good: false }

  return (
    <Sheet title="Weekly check-in" onClose={onClose}>
      {!data ? (
        <p className="text-ink-faint text-center py-8">Crunching your week…</p>
      ) : (
        <div className="space-y-3">
          <div className="text-center py-2">
            <p className="text-sm text-ink-soft">You spent</p>
            <p className="tnum text-4xl font-bold">{money(data.spentThisWeek)}</p>
            <p className="text-sm text-ink-soft">in the last 7 days</p>
            {trend && (
              <p className={`text-sm font-medium mt-1 ${trend.good ? 'text-pos' : 'text-warn'}`}>
                {trend.good ? '📉' : '📈'} {trend.txt}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <MiniStat label="Logged" value={`${data.daysLogged}/7 days`} />
            <MiniStat label="Streak" value={`🔥 ${settings.streak.current}`} />
            <MiniStat label="Income" value={money(data.income)} />
            <MiniStat
              label="Net"
              value={money(data.net)}
              tone={data.net >= 0 ? 'pos' : 'neg'}
            />
          </div>

          {data.topCategory && (
            <Card className="p-4 text-center">
              <p className="text-xs text-ink-faint">Biggest category this week</p>
              <p className="font-semibold mt-0.5">
                {data.topCategory.emoji} {data.topCategory.name} · {money(data.topCategory.amount)}
              </p>
            </Card>
          )}

          <p className="text-center text-sm text-ink-soft px-2">
            {data.daysLogged >= 5
              ? 'Great consistency this week. Keep it rolling. 💪'
              : data.daysLogged === 0
                ? 'Fresh start — log something today to get going. ✨'
                : "Nice — a few entries make next week's picture even clearer. 🙂"}
          </p>

          {/* On-demand plain-English AI summary (manual trigger only) */}
          {aiText ? (
            <Card className="p-4 bg-brand-soft border-brand/15">
              <p className="text-sm leading-relaxed">{aiText}</p>
            </Card>
          ) : ai?.enabled && ai?.hasKey ? (
            <Button variant="ghost" onClick={genSummary} disabled={aiBusy} className="w-full border border-line">
              {aiBusy ? 'Writing…' : '✨ Plain-English summary'}
            </Button>
          ) : null}
          {aiErr && <p className="text-xs text-neg text-center">{aiErr}</p>}

          <Button onClick={done} className="w-full">
            Got it
          </Button>
        </div>
      )}
    </Sheet>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <Card className="p-3 text-center">
      <p className="text-[11px] text-ink-faint">{label}</p>
      <p className={`font-bold mt-0.5 tnum ${tone === 'pos' ? 'text-pos' : tone === 'neg' ? 'text-neg' : ''}`}>{value}</p>
    </Card>
  )
}
