// Default budget sections (groups) and the mapping of seed categories into them.
// Kept dependency-free so both seed.ts and the db.ts migration can import it.

export const CC_GROUP = 'Credit card payments'

// `committed` sections (bills, savings, card payments) are excluded from the
// "safe to spend" figure — that money is already spoken for.
export const DEFAULT_GROUPS: { name: string; emoji: string; committed?: boolean }[] = [
  { name: CC_GROUP, emoji: '💳', committed: true },
  { name: 'Bills', emoji: '🧾', committed: true },
  { name: 'Needs', emoji: '🛒' },
  { name: 'Wants', emoji: '🎉' },
  { name: 'Savings', emoji: '🐷', committed: true },
]

/** Which default section each seed category belongs to. */
export const CATEGORY_GROUP: Record<string, string> = {
  Rent: 'Bills',
  Utilities: 'Bills',
  Subscriptions: 'Bills',
  Groceries: 'Needs',
  Transport: 'Needs',
  Health: 'Needs',
  Dining: 'Wants',
  Entertainment: 'Wants',
  Shopping: 'Wants',
  Travel: 'Wants',
  Other: 'Wants',
}
