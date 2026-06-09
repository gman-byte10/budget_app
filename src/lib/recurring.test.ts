import 'fake-indexeddb/auto' // recurring.ts imports db (Dexie); give it an indexedDB
import { describe, it, expect } from 'vitest'
import { nextOccurrence, firstOccurrence } from './recurring'
import { todayStr } from './dates'

describe('recurring date math', () => {
  it('advances monthly by interval', () => {
    expect(nextOccurrence({ frequency: 'monthly', interval: 1, startDate: '2026-01-15' }, '2026-01-15')).toBe('2026-02-15')
    expect(nextOccurrence({ frequency: 'monthly', interval: 3, startDate: '2026-01-15' }, '2026-01-15')).toBe('2026-04-15')
  })

  it('advances weekly and daily by interval', () => {
    expect(nextOccurrence({ frequency: 'weekly', interval: 1, startDate: '2026-01-01' }, '2026-01-01')).toBe('2026-01-08')
    expect(nextOccurrence({ frequency: 'daily', interval: 3, startDate: '2026-01-01' }, '2026-01-01')).toBe('2026-01-04')
  })

  it('returns the start date when asked before it begins', () => {
    expect(nextOccurrence({ frequency: 'monthly', interval: 1, startDate: '2026-06-01' }, '2026-01-01')).toBe('2026-06-01')
  })

  it('firstOccurrence in the future is the start itself', () => {
    const future = '2099-01-01'
    expect(firstOccurrence({ frequency: 'monthly', interval: 1, startDate: future })).toBe(future)
  })

  it('firstOccurrence catches up to today for a past start', () => {
    const next = firstOccurrence({ frequency: 'monthly', interval: 1, startDate: '2020-01-10' })
    expect(next >= todayStr()).toBe(true)
    expect(next.endsWith('-10')).toBe(true) // keeps the day-of-month
  })
})
