import Dexie, { type Table } from 'dexie'
import type {
  Account,
  Category,
  Transaction,
  BudgetOverride,
  MonthlySnapshot,
  Goal,
  Contribution,
  Recurring,
  Settings,
  LlmCacheEntry,
  LlmUsage,
} from './schema'

export class BudgetDB extends Dexie {
  accounts!: Table<Account, string>
  categories!: Table<Category, string>
  transactions!: Table<Transaction, string>
  budgets!: Table<BudgetOverride, string>
  snapshots!: Table<MonthlySnapshot, string>
  goals!: Table<Goal, string>
  contributions!: Table<Contribution, string>
  recurring!: Table<Recurring, string>
  settings!: Table<Settings, string>
  llmCache!: Table<LlmCacheEntry, string>
  llmUsage!: Table<LlmUsage, string>

  constructor() {
    super('budget')
    this.version(1).stores({
      accounts: 'id, order, archived',
      categories: 'id, kind, order, archived, lastUsedAt',
      transactions: 'id, date, accountId, toAccountId, categoryId, type, recurringId',
      budgets: 'id, [categoryId+monthKey], monthKey',
      snapshots: 'id, [categoryId+monthKey], monthKey, categoryId',
      goals: 'id, completedAt',
      contributions: 'id, goalId, date',
      recurring: 'id, active, nextDate',
      settings: 'id',
      llmCache: 'id, task',
      llmUsage: 'id, monthKey, task',
    })
  }
}

export const db = new BudgetDB()

export const uid = () => crypto.randomUUID()

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  currency: 'USD',
  locale: 'en-US',
  theme: 'system',
  quickAdds: [],
  streak: { current: 0, longest: 0 },
  closedMonths: [],
  ai: { enabled: false, monthlyCapUsd: 2, keys: {}, coachProvider: 'auto' },
  onboarded: false,
}
