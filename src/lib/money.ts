// Currency formatting + lightweight parsing. Currency/locale come from settings.

let _currency = 'USD'
let _locale = 'en-US'

export function configureMoney(currency: string, locale: string) {
  _currency = currency
  _locale = locale
}

const fmtCache = new Map<string, Intl.NumberFormat>()
function fmt(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = _locale + _currency + JSON.stringify(opts)
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.NumberFormat(_locale, { style: 'currency', currency: _currency, ...opts })
    fmtCache.set(key, f)
  }
  return f
}

/** $1,234.56 */
export function money(n: number): string {
  return fmt({}).format(n || 0)
}

/** Compact, no cents when whole: $1,234 / $1,234.56 */
export function moneyShort(n: number): string {
  const whole = Number.isInteger(n)
  return fmt({ minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(n || 0)
}

/** Signed, for deltas: +$5.00 / −$5.00 (uses a real minus sign). */
export function moneySigned(n: number): string {
  const s = money(Math.abs(n))
  if (n > 0) return '+' + s
  if (n < 0) return '−' + s
  return s
}

export function currencySymbol(): string {
  const parts = fmt({}).formatToParts(0)
  return parts.find((p) => p.type === 'currency')?.value ?? '$'
}

/** Parse a free-typed amount like "1,234.5" or "$40" into a number. */
export function parseAmount(s: string): number {
  const cleaned = s.replace(/[^0-9.,-]/g, '').replace(/,/g, '')
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : 0
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
