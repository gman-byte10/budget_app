// Approximate USD pricing per 1M tokens (input/output). Used only to ESTIMATE
// running cost for the in-app spend cap & usage display. Update if prices change.
// These are intentionally conservative; the cap is a guardrail, not billing.

interface Price {
  in: number // $ per 1M input tokens
  out: number // $ per 1M output tokens
}

const PRICES: Record<string, Price> = {
  // OpenAI
  'gpt-4o-mini': { in: 0.15, out: 0.6 },
  'gpt-4o': { in: 2.5, out: 10 },
  // Anthropic
  'claude-haiku-4-5-20251001': { in: 1.0, out: 5.0 },
  'claude-sonnet-4-6': { in: 3.0, out: 15.0 },
  // Google
  'gemini-2.0-flash': { in: 0.1, out: 0.4 },
  'gemini-2.5-pro': { in: 1.25, out: 10.0 },
}

const FALLBACK: Price = { in: 1.0, out: 5.0 }

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? FALLBACK
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000
}
