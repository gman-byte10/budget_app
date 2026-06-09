import type { Category, Transaction } from '../db/schema'
import { todayStr, toDateStr } from '../lib/dates'

// ---------------------------------------------------------------------------
// LOCAL-FIRST intelligence. No network, no cost. The LLM is only a fallback
// when these return low confidence / null.
// ---------------------------------------------------------------------------

export function normalizeNote(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

// Keyword → canonical category name (matches the default seed names, but we
// resolve by name against whatever categories actually exist).
const LEXICON: Record<string, string> = {
  coffee: 'Dining', starbucks: 'Dining', latte: 'Dining', cafe: 'Dining', restaurant: 'Dining',
  lunch: 'Dining', dinner: 'Dining', breakfast: 'Dining', mcdonald: 'Dining', chipotle: 'Dining',
  pizza: 'Dining', bar: 'Dining', doordash: 'Dining', ubereats: 'Dining',
  grocery: 'Groceries', groceries: 'Groceries', supermarket: 'Groceries', costco: 'Groceries',
  walmart: 'Groceries', aldi: 'Groceries', trader: 'Groceries', safeway: 'Groceries', kroger: 'Groceries',
  gas: 'Transport', fuel: 'Transport', uber: 'Transport', lyft: 'Transport', transit: 'Transport',
  parking: 'Transport', metro: 'Transport', train: 'Transport', bus: 'Transport', shell: 'Transport',
  rent: 'Rent', mortgage: 'Rent', landlord: 'Rent',
  electric: 'Utilities', water: 'Utilities', internet: 'Utilities', utility: 'Utilities',
  phone: 'Utilities', gas_bill: 'Utilities', wifi: 'Utilities',
  netflix: 'Subscriptions', spotify: 'Subscriptions', subscription: 'Subscriptions', hulu: 'Subscriptions',
  disney: 'Subscriptions', icloud: 'Subscriptions', prime: 'Subscriptions',
  movie: 'Entertainment', cinema: 'Entertainment', game: 'Entertainment', concert: 'Entertainment',
  amazon: 'Shopping', target: 'Shopping', clothes: 'Shopping', shoes: 'Shopping', mall: 'Shopping',
  pharmacy: 'Health', doctor: 'Health', gym: 'Health', dentist: 'Health', medicine: 'Health',
  flight: 'Travel', hotel: 'Travel', airbnb: 'Travel', vacation: 'Travel',
  salary: 'Salary', paycheck: 'Salary', payroll: 'Salary',
}

export interface CategoryGuess {
  categoryId?: string
  confidence: 'high' | 'low'
  reason: 'history' | 'name' | 'keyword' | 'none'
}

/** Try to categorize from text using history + keywords. No LLM. */
export function matchCategoryLocal(
  text: string,
  categories: Category[],
  history: Transaction[],
): CategoryGuess {
  const norm = normalizeNote(text)
  if (!norm) return { confidence: 'low', reason: 'none' }

  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]))

  // 1) Exact note match in history → reuse that category (strongest signal).
  const past = history.find((t) => t.categoryId && normalizeNote(t.note ?? '') === norm)
  if (past?.categoryId) return { categoryId: past.categoryId, confidence: 'high', reason: 'history' }

  // 2) A category name appears in the text.
  for (const c of categories) {
    if (c.kind !== 'expense') continue
    if (norm.includes(c.name.toLowerCase())) return { categoryId: c.id, confidence: 'high', reason: 'name' }
  }

  // 3) Keyword lexicon → canonical name → existing category.
  for (const word of norm.split(/[^a-z]+/)) {
    const canon = LEXICON[word]
    if (canon) {
      const c = byName.get(canon.toLowerCase())
      if (c) return { categoryId: c.id, confidence: 'high', reason: 'keyword' }
    }
  }

  return { confidence: 'low', reason: 'none' }
}

export interface ParsedTxn {
  amount?: number
  categoryId?: string
  note: string
  date: string
  /** Did we get the essentials (an amount) locally? */
  ok: boolean
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function resolveDate(text: string): string {
  const t = text.toLowerCase()
  if (/\byesterday\b/.test(t)) {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return toDateStr(d)
  }
  if (/\btoday\b/.test(t)) return todayStr()
  const ago = t.match(/(\d+)\s+days?\s+ago/)
  if (ago) {
    const d = new Date()
    d.setDate(d.getDate() - parseInt(ago[1]))
    return toDateStr(d)
  }
  // "last <weekday>" or "<weekday>"
  const wd = WEEKDAYS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(t))
  if (wd >= 0) {
    const d = new Date()
    const cur = d.getDay()
    let diff = cur - wd
    if (diff <= 0) diff += 7 // most recent past occurrence
    d.setDate(d.getDate() - diff)
    return toDateStr(d)
  }
  return todayStr()
}

/**
 * Parse natural language like "$40 groceries at Target yesterday" locally.
 * Returns ok:false (so the caller can fall back to an LLM) if no amount found.
 */
export function parseLocal(text: string, categories: Category[], history: Transaction[]): ParsedTxn {
  const date = resolveDate(text)
  const amountMatch = text.replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/)
  const amount = amountMatch ? parseFloat(amountMatch[1]) : undefined

  // Strip amount + date words to form a clean note.
  let note = text
    .replace(/\$?\d+(?:\.\d{1,2})?/g, '')
    .replace(/\b(yesterday|today)\b/gi, '')
    .replace(/\d+\s+days?\s+ago/gi, '')
    .replace(/\b(on|at|for|the|a|an)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const guess = matchCategoryLocal(note || text, categories, history)
  if (!note) note = guess.categoryId ? categories.find((c) => c.id === guess.categoryId)?.name ?? '' : ''

  return { amount, categoryId: guess.categoryId, note, date, ok: amount != null }
}
