import { describe, it, expect } from 'vitest'
import { computeCategorySeries, computeCategoryMonth, type RolloverInputs } from './rollover'
import type { MonthlySnapshot } from '../db/schema'

function makeInputs(
  rollover: boolean,
  base: Record<string, number>,
  spent: Record<string, number>,
  opts: { cap?: number | null; snapshots?: Record<string, MonthlySnapshot>; anchor?: string } = {},
): RolloverInputs {
  return {
    rollover,
    rolloverCap: opts.cap ?? null,
    baseFor: (mk) => base[mk] ?? 0,
    spentFor: (mk) => spent[mk] ?? 0,
    snapshotFor: (mk) => opts.snapshots?.[mk],
    anchorMonth: opts.anchor ?? Object.keys(base).sort()[0],
  }
}

describe('rollover engine', () => {
  it('rollover ON: under budget accumulates into next month', () => {
    const inputs = makeInputs(
      true,
      { '2026-01': 200, '2026-02': 200, '2026-03': 200 },
      { '2026-01': 150, '2026-02': 250, '2026-03': 0 },
    )
    const series = computeCategorySeries(inputs, '2026-03')
    // Jan: eff 200, spent 150 → carry +50
    expect(series[0].carryOut).toBe(50)
    // Feb: carryIn 50, eff 250, spent 250 → carry 0
    expect(series[1].carryIn).toBe(50)
    expect(series[1].effective).toBe(250)
    expect(series[1].carryOut).toBe(0)
    // Mar: carryIn 0, eff 200, spent 0 → carry 200
    expect(series[2].carryIn).toBe(0)
    expect(series[2].effective).toBe(200)
  })

  it('rollover ON: overspend carries a negative (in the hole)', () => {
    const inputs = makeInputs(
      true,
      { '2026-01': 100, '2026-02': 100 },
      { '2026-01': 160, '2026-02': 0 },
    )
    const series = computeCategorySeries(inputs, '2026-02')
    expect(series[0].carryOut).toBe(-60)
    expect(series[1].carryIn).toBe(-60)
    expect(series[1].effective).toBe(40) // 100 + (-60)
  })

  it('rollover OFF: never carries; resets each month', () => {
    const inputs = makeInputs(
      false,
      { '2026-01': 100, '2026-02': 100 },
      { '2026-01': 20, '2026-02': 0 },
    )
    const series = computeCategorySeries(inputs, '2026-02')
    expect(series[0].carryOut).toBe(0)
    expect(series[1].carryIn).toBe(0)
    expect(series[1].effective).toBe(100)
  })

  it('cap limits positive accumulation but not overspend debt', () => {
    const inputs = makeInputs(
      true,
      { '2026-01': 100, '2026-02': 100 },
      { '2026-01': 0, '2026-02': 0 },
      { cap: 120 },
    )
    const series = computeCategorySeries(inputs, '2026-02')
    expect(series[0].carryOut).toBe(100)
    // Feb: carryIn 100, eff 200, spent 0 → 200 but capped at 120
    expect(series[1].carryOut).toBe(120)
    expect(series[1].capped).toBe(true)
  })

  it('frozen snapshot is trusted verbatim and seeds the next month', () => {
    const snap: MonthlySnapshot = {
      id: 'c:2026-01',
      categoryId: 'c',
      monthKey: '2026-01',
      base: 200,
      carryIn: 0,
      spent: 0,
      effective: 200,
      carryOut: 75, // deliberately not what live math would give
      closedAt: 0,
    }
    const inputs = makeInputs(
      true,
      { '2026-01': 200, '2026-02': 200 },
      { '2026-01': 999, '2026-02': 0 },
      { snapshots: { '2026-01': snap } },
    )
    const feb = computeCategoryMonth(inputs, '2026-02')
    expect(feb.carryIn).toBe(75) // from frozen snapshot, not recomputed
    expect(feb.effective).toBe(275)
  })
})
