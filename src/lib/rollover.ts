import type { MonthlySnapshot } from '../db/schema'
import { addMonths, type MonthKey } from './dates'
import { round2 } from './money'

// ---------------------------------------------------------------------------
// Rollover envelope engine (pure).
//
// For each rollover category we walk months forward from an anchor:
//   carryIn(M)   = rollover ? carryOut(M-1) : 0
//   effective(M) = base(M) + carryIn(M)
//   carryOut(M)  = effective(M) − spent(M)          (may be negative = "in the hole")
//   if cap set and carryOut(M) > cap → carryOut(M) = cap   (cap limits only positive build-up)
//
// Closed months are FROZEN: if a snapshot exists for a month we adopt its
// carryOut verbatim and never recompute it, so past views never shift.
// ---------------------------------------------------------------------------

export interface CatMonthResult {
  monthKey: MonthKey
  base: number
  carryIn: number
  spent: number
  effective: number
  carryOut: number
  /** True if this month was read from a frozen snapshot. */
  frozen: boolean
  /** Positive carryover was clipped by the cap. */
  capped: boolean
  rollover: boolean
}

export interface RolloverInputs {
  rollover: boolean
  rolloverCap?: number | null
  /** Base budget for a given month (override or category default). */
  baseFor: (mk: MonthKey) => number
  /** Expense total for the category in a given month. */
  spentFor: (mk: MonthKey) => number
  /** Frozen snapshot for a given month, if the month is closed. */
  snapshotFor: (mk: MonthKey) => MonthlySnapshot | undefined
  /** Earliest month with data — where the walk begins. */
  anchorMonth: MonthKey
}

function stepLive(
  base: number,
  spent: number,
  prevCarry: number,
  rollover: boolean,
  cap: number | null | undefined,
): { carryIn: number; effective: number; carryOut: number; capped: boolean } {
  const carryIn = rollover ? prevCarry : 0
  const effective = round2(base + carryIn)
  let carryOut = round2(effective - spent)
  let capped = false
  if (rollover && cap != null && carryOut > cap) {
    carryOut = round2(cap)
    capped = true
  }
  // Non-rollover categories never carry anything forward.
  if (!rollover) carryOut = 0
  return { carryIn, effective, carryOut, capped }
}

/** Compute the full series of month results from anchor → target (inclusive). */
export function computeCategorySeries(
  inputs: RolloverInputs,
  target: MonthKey,
): CatMonthResult[] {
  const { rollover, rolloverCap, baseFor, spentFor, snapshotFor, anchorMonth } = inputs
  const out: CatMonthResult[] = []
  let prevCarry = 0
  let mk = anchorMonth <= target ? anchorMonth : target

  while (mk <= target) {
    const snap = snapshotFor(mk)
    const base = baseFor(mk)
    const spent = spentFor(mk)

    if (snap) {
      // Frozen: trust the snapshot exactly as recorded.
      out.push({
        monthKey: mk,
        base: snap.base,
        carryIn: snap.carryIn,
        spent: snap.spent,
        effective: snap.effective,
        carryOut: snap.carryOut,
        frozen: true,
        capped: false,
        rollover,
      })
      prevCarry = snap.carryOut
    } else {
      const r = stepLive(base, spent, prevCarry, rollover, rolloverCap)
      out.push({
        monthKey: mk,
        base,
        carryIn: r.carryIn,
        spent,
        effective: r.effective,
        carryOut: r.carryOut,
        frozen: false,
        capped: r.capped,
        rollover,
      })
      prevCarry = r.carryOut
    }
    if (mk === target) break
    mk = addMonths(mk, 1)
  }
  return out
}

/** Just the target month's envelope state. */
export function computeCategoryMonth(inputs: RolloverInputs, target: MonthKey): CatMonthResult {
  const series = computeCategorySeries(inputs, target)
  return series[series.length - 1]
}
