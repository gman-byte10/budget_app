import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { runCoach } from '../llm/tasks'
import { AiDisabledError, AiNoKeyError, AiCapError, AiError } from '../llm/callLLM'
import { useAiStatus } from '../state/useData'
import { Card, Button } from './ui'
import { Sheet } from '../routes/Accounts'

export function CoachCard() {
  const ai = useAiStatus()
  const [open, setOpen] = useState(false)
  return (
    <>
      <Card
        className="p-4 mt-3 flex items-center justify-between bg-brand-soft active:scale-[0.99] transition-transform"
        onClick={() => setOpen(true)}
      >
        <div>
          <p className="font-semibold text-sm">🤖 Ask the Coach</p>
          <p className="text-xs text-ink-soft">2-3 tailored tips on this month — on demand only</p>
        </div>
        <span className="text-brand font-semibold text-sm">Run ›</span>
      </Card>
      {open && <CoachSheet onClose={() => setOpen(false)} aiEnabled={!!ai?.enabled && !!ai?.hasKey} capReached={!!ai?.capReached} />}
    </>
  )
}

function CoachSheet({
  onClose,
  aiEnabled,
  capReached,
}: {
  onClose: () => void
  aiEnabled: boolean
  capReached: boolean
}) {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [meta, setMeta] = useState<{ cached: boolean; cost: number } | null>(null)

  async function run(bypassCache = false) {
    setBusy(true)
    setErr('')
    try {
      const r = await runCoach(bypassCache)
      setText(r.text)
      setMeta({ cached: r.cached, cost: r.cost })
    } catch (e) {
      if (e instanceof AiDisabledError) setErr('AI is turned off. Turn it on in Settings → AI.')
      else if (e instanceof AiNoKeyError) setErr('No API key yet. Add one in Settings → AI.')
      else if (e instanceof AiCapError) setErr('Monthly AI spend cap reached. Raise it in Settings → AI.')
      else if (e instanceof AiError) setErr(e.message)
      else setErr('Something went wrong. Is the proxy running? (npm run dev:ai)')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title="🤖 Coach" onClose={onClose}>
      {!text && !busy && !err && (
        <div className="text-center py-4">
          <p className="text-ink-soft text-sm mb-4">
            I'll look at this month's spending vs budgets and suggest 2-3 concrete, encouraging moves.
            One click, one call.
          </p>
          {!aiEnabled ? (
            <>
              <p className="text-sm text-warn mb-3">AI isn't set up yet.</p>
              <Button onClick={() => navigate('/settings')} className="w-full">
                Set up AI in Settings
              </Button>
            </>
          ) : capReached ? (
            <p className="text-sm text-warn">Monthly spend cap reached — raise it in Settings.</p>
          ) : (
            <Button onClick={() => run(false)} className="w-full">
              Analyze my month
            </Button>
          )}
        </div>
      )}

      {busy && <p className="text-center text-ink-faint py-8">Thinking…</p>}

      {err && (
        <div className="py-4">
          <p className="text-sm text-neg mb-3">{err}</p>
          <Button variant="soft" onClick={() => navigate('/settings')} className="w-full">
            Open Settings
          </Button>
        </div>
      )}

      {text && (
        <div className="py-1">
          <div className="space-y-2 text-sm leading-relaxed">
            {text.split('\n').filter(Boolean).map((line, i) => (
              <p key={i} className="flex gap-2">
                {/^[-*•]/.test(line.trim()) && <span className="text-brand">•</span>}
                <span>{line.replace(/^[-*•]\s*/, '')}</span>
              </p>
            ))}
          </div>
          <p className="text-[11px] text-ink-faint mt-4 text-center">
            {meta?.cached ? 'From cache · $0.00' : `≈ $${(meta?.cost ?? 0).toFixed(4)} this call`}
          </p>
          <Button variant="ghost" onClick={() => run(true)} disabled={busy} className="w-full border border-line mt-2">
            ↻ Regenerate
          </Button>
        </div>
      )}
    </Sheet>
  )
}
