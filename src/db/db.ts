import Dexie, { type Table } from 'dexie'
import type {
  Account,
  Category,
  Group,
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
import { DEFAULT_GROUPS, CATEGORY_GROUP, CC_GROUP } from './defaults'

export class BudgetDB extends Dexie {
  accounts!: Table<Account, string>
  categories!: Table<Category, string>
  groups!: Table<Group, string>
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

    // v2: budget sections (groups). Create defaults and sort existing categories
    // into them so upgrading users immediately see organised sections.
    this.version(2)
      .stores({
        categories: 'id, kind, order, archived, lastUsedAt, groupId',
        groups: 'id, order, archived',
      })
      .upgrade(async (tx) => {
        const now = Date.now()
        const groups = DEFAULT_GROUPS.map((g, i) => ({
          id: crypto.randomUUID(),
          name: g.name,
          emoji: g.emoji,
          committed: g.committed ?? false,
          order: i,
          createdAt: now,
        }))
        await tx.table('groups').bulkAdd(groups)
        const byName: Record<string, string> = Object.fromEntries(groups.map((g) => [g.name, g.id]))
        await tx
          .table('categories')
          .toCollection()
          .modify((c: Category) => {
            if (c.kind !== 'expense') return
            if (c.linkedAccountId) c.groupId = byName[CC_GROUP]
            else if (CATEGORY_GROUP[c.name]) c.groupId = byName[CATEGORY_GROUP[c.name]]
          })
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
