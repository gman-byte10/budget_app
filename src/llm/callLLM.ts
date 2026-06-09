import { db, uid } from '../db/db'
import { currentMonthKey } from '../lib/dates'
import { resolveModel, type LlmTask, type Provider } from './config'
import { TASK_SYSTEM } from './tasks'
import { estimateCost } from './pricing'

export class AiError extends Error {}
export class AiDisabledError extends AiError {}
export class AiNoKeyError extends AiError {}
export class AiCapError extends AiError {}

export interface LlmResult {
  text: string
  cached: boolean
  cost: number
}

// In-flight dedupe: identical (task,input) requests share one network call.
const inflight = new Map<string, Promise<LlmResult>>()

function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(36)
}

function availableProviders(keys: Record<string, string | undefined>): Provider[] {
  return (['google', 'openai', 'anthropic'] as Provider[]).filter((p) => keys[p]?.trim())
}

/** Sum of estimated AI spend for the current month. */
export async function monthlySpend(): Promise<number> {
  const mk = currentMonthKey()
  const rows = await db.llmUsage.where('monthKey').equals(mk).toArray()
  return rows.reduce((s, r) => s + r.costUsd, 0)
}

export interface AiStatus {
  enabled: boolean
  hasKey: boolean
  providers: Provider[]
  spent: number
  cap: number
  capReached: boolean
}

export async function aiStatus(): Promise<AiStatus> {
  const settings = await db.settings.get('app')
  const ai = settings?.ai
  const providers = ai ? availableProviders(ai.keys) : []
  const spent = await monthlySpend()
  const cap = ai?.monthlyCapUsd ?? 0
  return {
    enabled: !!ai?.enabled,
    hasKey: providers.length > 0,
    providers,
    spent,
    cap,
    capReached: cap > 0 && spent >= cap,
  }
}

/**
 * The ONE entry point for all LLM calls. Handles provider selection, tiering,
 * caching, in-flight dedupe, the monthly cost cap, and usage recording.
 * Throws a typed AiError if AI is off, unconfigured, or over budget.
 */
export async function callLLM(task: LlmTask, input: string, opts?: { bypassCache?: boolean }): Promise<LlmResult> {
  const settings = await db.settings.get('app')
  if (!settings?.ai?.enabled) throw new AiDisabledError('AI is turned off.')

  const providers = availableProviders(settings.ai.keys)
  if (providers.length === 0) throw new AiNoKeyError('No API key set. Add one in Settings → AI.')

  const cp = settings.ai.coachProvider
  const runtimeOverrides = cp && cp !== 'auto' ? { coach: cp as Provider } : undefined
  const choice = resolveModel(task, providers, runtimeOverrides)
  if (!choice) throw new AiNoKeyError('No model available for this task.')

  // Cost cap (guardrail): block before spending past the monthly limit.
  const cap = settings.ai.monthlyCapUsd
  if (cap > 0) {
    const spent = await monthlySpend()
    if (spent >= cap) throw new AiCapError(`Monthly AI cap of $${cap} reached. Raise it in Settings.`)
  }

  const key = `${task}:${hash(input)}`

  // 1) Cache: same merchant/note/input never re-queries.
  if (!opts?.bypassCache) {
    const hit = await db.llmCache.get(key)
    if (hit) return { text: hit.result, cached: true, cost: 0 }
    const pending = inflight.get(key)
    if (pending) return pending
  }

  const apiKey = settings.ai.keys[choice.provider]!
  const run = (async (): Promise<LlmResult> => {
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: choice.provider,
        model: choice.model,
        system: TASK_SYSTEM[task],
        prompt: input, // minimal: only what's needed, never full history
        maxTokens: choice.maxTokens,
        apiKey,
      }),
    })
    if (!res.ok) {
      const msg = await res.text().catch(() => res.statusText)
      throw new AiError(`Provider error (${res.status}): ${msg.slice(0, 200)}`)
    }
    const data = (await res.json()) as { text: string; inputTokens: number; outputTokens: number }
    const cost = estimateCost(choice.model, data.inputTokens || 0, data.outputTokens || 0)

    await db.llmUsage.add({
      id: uid(),
      task,
      provider: choice.provider,
      model: choice.model,
      inputTokens: data.inputTokens || 0,
      outputTokens: data.outputTokens || 0,
      costUsd: cost,
      monthKey: currentMonthKey(),
      createdAt: Date.now(),
    })
    await db.llmCache.put({ id: key, task, result: data.text, createdAt: Date.now() })

    return { text: data.text, cached: false, cost }
  })()

  inflight.set(key, run)
  try {
    return await run
  } finally {
    inflight.delete(key)
  }
}
