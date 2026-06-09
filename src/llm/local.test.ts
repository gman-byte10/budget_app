import { describe, it, expect } from 'vitest'
import { matchCategoryLocal, parseLocal } from './local'
import type { Category, Transaction } from '../db/schema'
import { todayStr, toDateStr } from '../lib/dates'

function cat(name: string): Category {
  return { id: name, name, kind: 'expense', monthlyBudget: 0, rollover: true, order: 0, usageCount: 0, createdAt: 0 }
}
const categories = [cat('Groceries'), cat('Dining'), cat('Shopping'), cat('Transport')]

describe('local category matching', () => {
  it('reuses category from an exact note match in history (strongest signal)', () => {
    const history: Transaction[] = [
      { id: 'h1', type: 'expense', amount: 10, date: '2026-01-01', accountId: 'a', categoryId: 'Dining', note: 'Blue Bottle', createdAt: 0 },
    ]
    const g = matchCategoryLocal('Blue Bottle', categories, history)
    expect(g.categoryId).toBe('Dining')
    expect(g.confidence).toBe('high')
    expect(g.reason).toBe('history')
  })

  it('matches via keyword lexicon', () => {
    const g = matchCategoryLocal('starbucks coffee', categories, [])
    expect(g.categoryId).toBe('Dining')
    expect(g.confidence).toBe('high')
  })

  it('matches a category name appearing in the text', () => {
    const g = matchCategoryLocal('weekly groceries', categories, [])
    expect(g.categoryId).toBe('Groceries')
  })

  it('returns low confidence for unknown text', () => {
    const g = matchCategoryLocal('zxqw mystery', categories, [])
    expect(g.confidence).toBe('low')
    expect(g.categoryId).toBeUndefined()
  })
})

describe('local natural-language parsing', () => {
  it('parses amount, category, and "yesterday"', () => {
    const r = parseLocal('$40 groceries at Target yesterday', categories, [])
    expect(r.amount).toBe(40)
    expect(r.categoryId).toBe('Groceries')
    expect(r.ok).toBe(true)
    const y = new Date()
    y.setDate(y.getDate() - 1)
    expect(r.date).toBe(toDateStr(y))
  })

  it('parses a simple "12 lunch" entry as today', () => {
    const r = parseLocal('12 lunch', categories, [])
    expect(r.amount).toBe(12)
    expect(r.categoryId).toBe('Dining')
    expect(r.date).toBe(todayStr())
    expect(r.ok).toBe(true)
  })

  it('flags ok:false when no amount is present (so caller can use the LLM)', () => {
    const r = parseLocal('coffee', categories, [])
    expect(r.ok).toBe(false)
    expect(r.categoryId).toBe('Dining') // still guesses a category locally
  })

  it('handles "N days ago"', () => {
    const r = parseLocal('25 shopping 3 days ago', categories, [])
    expect(r.amount).toBe(25)
    const d = new Date()
    d.setDate(d.getDate() - 3)
    expect(r.date).toBe(toDateStr(d))
  })
})
