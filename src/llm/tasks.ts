import { db } from '../db/db'
import type { Category } from '../db/schema'
import { callLLM, AiError } from './callLLM'
import { matchCategoryLocal, parseLocal, type ParsedTxn } from './local'
import { currentMonthKey, monthLabel } from '../lib/dates'
import { computeMonthBudget } from '../lib/budget'
import { getWeeklySummary } from '../lib/stats'
import { money } from '../lib/money'
import type { LlmTask } from './config'

// Minimal system prompts — we keep them short and send only what's needed.
export const TASK_SYSTEM: Record<LlmTask, string> = {
  categorize:
    'You assign ONE category to a transaction. Reply with only the exact category name from the provided list — no punctuation, no explanation.',
  parse:
    'Extract a single transaction from the user text. Reply ONLY with minified JSON: {"amount":number,"category":string,"note":string,"date":"YYYY-MM-DD"}. Pick category from the provided list. If the date is not stated, use the provided today value.',
  coach:
    'You are a warm, concise personal-finance coach. Given a month summary, give 2-3 specific, encouraging, actionable suggestions as short markdown bullets. No preamble, no judgement, no disclaimers.',
  summary:
    'You write a friendly 2-3 sentence plain-English recap of the user\'s spending week. Encouraging, never guilt-inducing. No bullet points.',
}

async function loadContext() {
  const [categories, history] = await Promise.all([
    db.categories.filter((c) => !c.archived).toArray(),
    db.transactions.orderBy('createdAt').reverse().limit(300).toArray(),
  ])
  return { categories, history }
}

function findByName(categories: Category[], name: string): Category | undefined {
  const n = name.trim().toLowerCase()
  return categories.find((c) => c.name.toLowerCase() === n) ?? categories.find((c) => n.includes(c.name.toLowerCase()))
}

export interface CategorySuggestion {
  categoryId?: string
  source: 'history' | 'keyword' | 'name' | 'ai' | 'none'
  cached?: boolean
}

/**
 * Suggest a category for a note. LOCAL FIRST: only calls the LLM when local
 * matching is uncertain AND AI is available. Results are cached by callLLM.
 */
export async function suggestCategory(text: string): Promise<CategorySuggestion> {
  const { categories, history } = await loadContext()
  const local = matchCategoryLocal(text, categories, history)
  if (local.confidence === 'high' && local.categoryId) {
    return { categoryId: local.categoryId, source: local.reason as 'history' | 'keyword' | 'name' }
  }

  // Local was uncertain — try the LLM if it's configured/enabled.
  try {
    const expense = categories.filter((c) => c.kind === 'expense')
    const prompt = `Categories: ${expense.map((c) => c.name).join(', ')}\nTransaction: ${text}`
    const res = await callLLM('categorize', prompt)
    const cat = findByName(expense, res.text)
    if (cat) return { categoryId: cat.id, source: 'ai', cached: res.cached }
  } catch (e) {
    if (!(e instanceof AiError)) throw e // surface real bugs; swallow AI-off/cap/no-key
  }
  return { categoryId: local.categoryId, source: 'none' }
}

export interface ParseResult extends ParsedTxn {
  source: 'local' | 'ai'
  cached?: boolean
}

/**
 * Natural-language entry. Tries the regex/heuristic parser first; only falls
 * back to an LLM if the local parse fails to find an amount.
 */
export async function parseEntry(text: string): Promise<ParseResult> {
  const { categories, history } = await loadContext()
  const local = parseLocal(text, categories, history)
  if (local.ok) return { ...local, source: 'local' }

  // Local couldn't get an amount — try the LLM.
  const expense = categories.filter((c) => c.kind === 'expense')
  const prompt = `Today is ${new Date().toISOString().slice(0, 10)}. Categories: ${expense
    .map((c) => c.name)
    .join(', ')}\nText: ${text}`
  const res = await callLLM('parse', prompt)
  try {
    const json = JSON.parse(res.text.replace(/```json|```/g, '').trim())
    const cat = json.category ? findByName(expense, String(json.category)) : undefined
    return {
      amount: typeof json.amount === 'number' ? json.amount : parseFloat(json.amount),
      categoryId: cat?.id,
      note: String(json.note ?? text),
      date: /^\d{4}-\d{2}-\d{2}$/.test(json.date) ? json.date : local.date,
      ok: true,
      source: 'ai',
      cached: res.cached,
    }
  } catch {
    // If even the LLM reply is unparseable, return the local best-effort.
    return { ...local, source: 'local' }
  }
}

/** Build a compact month summary string — only the numbers the coach needs. */
async function monthBrief(): Promise<string> {
  const mk = currentMonthKey()
  const b = await computeMonthBudget(mk)
  const top = b.rows
    .filter((r) => r.spent > 0)
    .slice(0, 6)
    .map((r) => `${r.category.name}: spent ${money(r.spent)} of ${money(r.effective)}`)
  return [
    `Month: ${monthLabel(mk)}`,
    `Total budget ${money(b.totalEffective)}, spent ${money(b.totalSpent)}, safe-to-spend ${money(b.safeToSpend)}`,
    `Categories:`,
    ...top,
    b.rows.some((r) => r.effective - r.spent < 0)
      ? `Over budget in: ${b.rows.filter((r) => r.effective - r.spent < 0).map((r) => r.category.name).join(', ')}`
      : 'No categories over budget.',
  ].join('\n')
}

/** On-demand "Coach" — analyses the month and returns 2-3 suggestions. */
export async function runCoach(bypassCache = false): Promise<{ text: string; cached: boolean; cost: number }> {
  const brief = await monthBrief()
  const res = await callLLM('coach', brief, { bypassCache })
  return { text: res.text, cached: res.cached, cost: res.cost }
}

/** On-demand plain-English weekly summary. */
export async function runWeeklySummary(bypassCache = false): Promise<{ text: string; cached: boolean; cost: number }> {
  const s = await getWeeklySummary()
  const brief = [
    `Spent this week ${money(s.spentThisWeek)} (last week ${money(s.spentPrevWeek)})`,
    `Income ${money(s.income)}, net ${money(s.net)}`,
    `Logged ${s.daysLogged}/7 days`,
    s.topCategory ? `Biggest: ${s.topCategory.name} ${money(s.topCategory.amount)}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const res = await callLLM('summary', brief, { bypassCache })
  return { text: res.text, cached: res.cached, cost: res.cost }
}
