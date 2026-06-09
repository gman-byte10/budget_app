// ---------------------------------------------------------------------------
// Core data model. Everything is stored locally in IndexedDB (via Dexie).
// Money is stored as a number of major currency units (e.g. dollars), always
// a positive magnitude on transactions; direction is derived from `type`.
// ---------------------------------------------------------------------------

export type ID = string

export type AccountType = 'checking' | 'savings' | 'cash' | 'credit'

export interface Account {
  id: ID
  name: string
  type: AccountType
  /** Balance at the moment the account was created; live balance adds postings. */
  openingBalance: number
  color?: string
  archived?: boolean
  order: number
  createdAt: number
}

export type CategoryKind = 'expense' | 'income'

export interface Category {
  id: ID
  name: string
  kind: CategoryKind
  emoji?: string
  color?: string
  /** Recurring monthly base budget (expense categories). 0 = untracked. */
  monthlyBudget: number
  /** Envelope rollover on/off (expense only). */
  rollover: boolean
  /** Optional cap on how much positive carryover may accumulate. */
  rolloverCap?: number | null
  /** Default account pre-selected when logging in this category (quick entry). */
  defaultAccountId?: ID
  /**
   * If set, this category is a credit-card PAYMENT FUND tied to that account.
   * Its "spending" is money transferred *to* that card (i.e. payments), and the
   * envelope balance is what you've set aside for the card's next payment.
   */
  linkedAccountId?: ID
  archived?: boolean
  order: number
  /** Surfacing: recently-used categories float to the top of the picker. */
  usageCount: number
  lastUsedAt?: number
  createdAt: number
}

export type TxnType = 'expense' | 'income' | 'transfer'

export interface Transaction {
  id: ID
  type: TxnType
  /** Positive magnitude. */
  amount: number
  /** Local calendar date, 'YYYY-MM-DD'. */
  date: string
  /** For transfers, this is the SOURCE account. */
  accountId: ID
  /** Transfer destination. */
  toAccountId?: ID
  categoryId?: ID
  note?: string
  recurringId?: ID
  createdAt: number
}

/** Per-month base-budget override for a category (preserves history). */
export interface BudgetOverride {
  id: ID // `${categoryId}:${monthKey}`
  categoryId: ID
  monthKey: string // 'YYYY-MM'
  base: number
}

/** Frozen rollover figures for a closed month — past views never shift. */
export interface MonthlySnapshot {
  id: ID // `${categoryId}:${monthKey}`
  categoryId: ID
  monthKey: string
  base: number
  carryIn: number
  spent: number
  carryOut: number
  effective: number
  routedToGoal?: number
  closedAt: number
}

export interface Goal {
  id: ID
  name: string
  target: number
  targetDate?: string // 'YYYY-MM-DD'
  /** Savings account this goal is earmarked against (virtual envelope). */
  accountId?: ID
  emoji?: string
  color?: string
  createdAt: number
  completedAt?: number
}

export interface Contribution {
  id: ID
  goalId: ID
  amount: number
  date: string
  source: 'manual' | 'rollover'
  note?: string
  createdAt: number
}

export type Frequency = 'daily' | 'weekly' | 'monthly'

export interface Recurring {
  id: ID
  type: 'expense' | 'income'
  amount: number
  accountId: ID
  categoryId?: ID
  note?: string
  frequency: Frequency
  interval: number // every N units
  dayOfMonth?: number
  weekday?: number // 0=Sun
  startDate: string
  nextDate: string
  /** Auto-create the transaction when due, or just remind. */
  autoPost: boolean
  lastPostedDate?: string
  active: boolean
  createdAt: number
}

export interface QuickAdd {
  id: ID
  label: string
  emoji?: string
  amount?: number
  categoryId: ID
  accountId?: ID
}

export interface AiSettings {
  enabled: boolean
  monthlyCapUsd: number
  /** Keys are kept locally only; the proxy reads them, never the bundle. */
  keys: { openai?: string; anthropic?: string; google?: string }
  /** Force the Coach to a specific provider; 'auto' = cheapest available. */
  coachProvider?: 'auto' | 'openai' | 'anthropic' | 'google'
}

export type ThemePref = 'system' | 'light' | 'dark'

export interface Settings {
  id: 'app'
  currency: string
  locale: string
  theme?: ThemePref
  quickAdds: QuickAdd[]
  streak: { current: number; longest: number; lastLogDate?: string }
  lastWeeklyCheckin?: string
  lastBackupAt?: string
  closedMonths: string[]
  ai: AiSettings
  onboarded: boolean
}

/** Cache of LLM results so the same merchant/note never re-queries. */
export interface LlmCacheEntry {
  id: ID // hash of task+input
  task: string
  result: string
  createdAt: number
}

export interface LlmUsage {
  id: ID
  task: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  monthKey: string
  createdAt: number
}
