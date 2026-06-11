import { db, uid, DEFAULT_SETTINGS } from './db'
import type { Account, Category, Group, QuickAdd } from './schema'
import { DEFAULT_GROUPS, CATEGORY_GROUP } from './defaults'

// First-run defaults. Conservative budgets; the user adjusts in-app.
// "Flexible" categories roll over (envelope); "fixed" bills don't.
const seedCategories: Array<Omit<Category, 'id' | 'order' | 'usageCount' | 'createdAt'>> = [
  { name: 'Groceries', kind: 'expense', emoji: '🛒', monthlyBudget: 400, rollover: true },
  { name: 'Dining', kind: 'expense', emoji: '🍽️', monthlyBudget: 200, rollover: true },
  { name: 'Transport', kind: 'expense', emoji: '🚗', monthlyBudget: 120, rollover: true },
  { name: 'Rent', kind: 'expense', emoji: '🏠', monthlyBudget: 1500, rollover: false },
  { name: 'Utilities', kind: 'expense', emoji: '⚡', monthlyBudget: 200, rollover: false },
  { name: 'Entertainment', kind: 'expense', emoji: '🎬', monthlyBudget: 100, rollover: true },
  { name: 'Shopping', kind: 'expense', emoji: '🛍️', monthlyBudget: 150, rollover: true },
  { name: 'Health', kind: 'expense', emoji: '💊', monthlyBudget: 80, rollover: true },
  { name: 'Subscriptions', kind: 'expense', emoji: '📱', monthlyBudget: 50, rollover: false },
  { name: 'Travel', kind: 'expense', emoji: '✈️', monthlyBudget: 0, rollover: true },
  { name: 'Other', kind: 'expense', emoji: '📦', monthlyBudget: 0, rollover: true },
  { name: 'Salary', kind: 'income', emoji: '💰', monthlyBudget: 0, rollover: false },
  { name: 'Other income', kind: 'income', emoji: '💵', monthlyBudget: 0, rollover: false },
]

const seedAccounts: Array<Omit<Account, 'id' | 'order' | 'createdAt'>> = [
  { name: 'Checking', type: 'checking', openingBalance: 0 },
  { name: 'Savings', type: 'savings', openingBalance: 0 },
  { name: 'Cash', type: 'cash', openingBalance: 0 },
  { name: 'Credit Card', type: 'credit', openingBalance: 0 },
]

export async function ensureSeeded(): Promise<void> {
  const existing = await db.settings.get('app')
  if (existing) return

  const now = Date.now()

  const accounts: Account[] = seedAccounts.map((a, i) => ({
    ...a,
    id: uid(),
    order: i,
    createdAt: now,
  }))

  const groups: Group[] = DEFAULT_GROUPS.map((g, i) => ({
    id: uid(),
    name: g.name,
    emoji: g.emoji,
    committed: g.committed ?? false,
    order: i,
    createdAt: now,
  }))
  const groupByName = (n: string) => groups.find((g) => g.name === n)?.id

  const categories: Category[] = seedCategories.map((c, i) => ({
    ...c,
    id: uid(),
    order: i,
    usageCount: 0,
    createdAt: now,
    groupId: c.kind === 'expense' ? groupByName(CATEGORY_GROUP[c.name]) : undefined,
  }))

  const byName = (n: string) => categories.find((c) => c.name === n)!.id
  const checkingId = accounts[0].id

  const quickAdds: QuickAdd[] = [
    { id: uid(), label: 'Coffee', emoji: '☕', amount: 5, categoryId: byName('Dining'), accountId: checkingId },
    { id: uid(), label: 'Lunch', emoji: '🥪', amount: 12, categoryId: byName('Dining'), accountId: checkingId },
    { id: uid(), label: 'Groceries', emoji: '🛒', categoryId: byName('Groceries'), accountId: checkingId },
    { id: uid(), label: 'Gas', emoji: '⛽', categoryId: byName('Transport'), accountId: checkingId },
  ]

  await db.transaction('rw', db.accounts, db.categories, db.groups, db.settings, async () => {
    await db.accounts.bulkAdd(accounts)
    await db.groups.bulkAdd(groups)
    await db.categories.bulkAdd(categories)
    await db.settings.add({ ...DEFAULT_SETTINGS, quickAdds })
  })
}
