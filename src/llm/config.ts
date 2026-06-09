// ===========================================================================
// LLM ROUTING CONFIG — the single place to change which model runs each task.
//
// Philosophy: local-first. Every task is attempted with plain code/heuristics
// first; an LLM is only called when that fails or the user explicitly asks.
// When we do call out, route to the CHEAPEST model (across whatever providers
// you've added a key for) that does the job well — and let you force a specific
// provider per task when you care about quality (e.g. the Coach).
// ===========================================================================
import { estimateCost } from './pricing'

export type Provider = 'openai' | 'anthropic' | 'google'

/** Logical task names used throughout the app. */
export type LlmTask = 'categorize' | 'parse' | 'coach' | 'summary'

export interface ModelChoice {
  provider: Provider
  model: string
  /** Soft cap on output tokens — keeps cost + latency down. */
  maxTokens: number
}

// Tiers: "small" = cheap/fast classifiers & parsers; "large" = reasoning/advice.
// One model per provider per tier. Edit these to use different model versions.
export const TIERS: Record<'small' | 'large', Record<Provider, string>> = {
  small: {
    openai: 'gpt-4o-mini',
    anthropic: 'claude-haiku-4-5-20251001',
    google: 'gemini-2.0-flash',
  },
  large: {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4-6',
    google: 'gemini-2.5-pro',
  },
}

/** Per-task tier. Cheap tasks → small; advice/summaries → large. */
export const TASK_TIER: Record<LlmTask, 'small' | 'large'> = {
  categorize: 'small', // classification — a small model nails it
  parse: 'small', // structured extraction — small model is plenty
  coach: 'large', // reasoning over the month — worth a stronger model
  summary: 'small', // short plain-English recap — small is fine
}

/**
 * Optional: force a task to a specific provider (only applied if you have that
 * provider's key). Leave a task out to auto-pick the CHEAPEST available model
 * for its tier. Example — send only the Coach to Claude, keep the rest cheap:
 *
 *   export const TASK_PROVIDER_OVERRIDE = { coach: 'anthropic' }
 */
export const TASK_PROVIDER_OVERRIDE: Partial<Record<LlmTask, Provider>> = {
  // coach: 'anthropic',
  // coach: 'openai',
}

/** Rough blended $ for ranking (typical small request shape). Lower = cheaper. */
function blendedPrice(model: string): number {
  return estimateCost(model, 1000, 500)
}

/**
 * Resolve the concrete model for a task given which providers have keys.
 *  1) if a per-task override exists AND that provider has a key → use it
 *  2) otherwise pick the cheapest available model for the task's tier
 */
export function resolveModel(
  task: LlmTask,
  available: Provider[],
  runtimeOverrides?: Partial<Record<LlmTask, Provider>>,
): ModelChoice | null {
  if (available.length === 0) return null
  const tier = TASK_TIER[task]

  // Runtime (Settings UI) override wins over the code-level one.
  const override = runtimeOverrides?.[task] ?? TASK_PROVIDER_OVERRIDE[task]
  let provider: Provider
  if (override && available.includes(override)) {
    provider = override
  } else {
    provider = [...available].sort(
      (a, b) => blendedPrice(TIERS[tier][a]) - blendedPrice(TIERS[tier][b]),
    )[0]
  }

  const maxTokens = task === 'coach' ? 400 : task === 'summary' ? 220 : 120
  return { provider, model: TIERS[tier][provider], maxTokens }
}
