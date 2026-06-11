import { db } from '../db/db'
import { todayStr } from './dates'

const TABLES = [
  'accounts',
  'categories',
  'groups',
  'transactions',
  'budgets',
  'snapshots',
  'goals',
  'contributions',
  'recurring',
  'settings',
] as const

export interface Backup {
  app: 'budget'
  version: 1
  exportedAt: string
  data: Record<string, unknown[]>
}

export async function exportAll(): Promise<Backup> {
  const data: Record<string, unknown[]> = {}
  for (const t of TABLES) {
    data[t] = await (db as never as Record<string, { toArray(): Promise<unknown[]> }>)[t].toArray()
  }
  return { app: 'budget', version: 1, exportedAt: new Date().toISOString(), data }
}

export async function downloadBackup() {
  const backup = await exportAll()
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `budget-backup-${backup.exportedAt.slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
  // Record the backup date so we can stop nagging.
  const s = await db.settings.get('app')
  if (s) await db.settings.put({ ...s, lastBackupAt: todayStr() })
}

/** Export all transactions as a CSV for spreadsheets / taxes. */
export async function downloadTransactionsCsv(): Promise<void> {
  const [txns, accts, cats] = await Promise.all([
    db.transactions.orderBy('date').toArray(),
    db.accounts.toArray(),
    db.categories.toArray(),
  ])
  const an = (id?: string) => accts.find((a) => a.id === id)?.name ?? ''
  const cn = (id?: string) => cats.find((c) => c.id === id)?.name ?? ''
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const rows: (string | number)[][] = [
    ['Date', 'Type', 'Amount', 'Account', 'To account', 'Category', 'Note'],
  ]
  for (const t of txns) {
    rows.push([
      t.date,
      t.type,
      t.amount,
      an(t.accountId),
      t.type === 'transfer' ? an(t.toAccountId) : '',
      t.type === 'transfer' ? '' : cn(t.categoryId),
      t.note ?? '',
    ])
  }
  const csv = rows.map((r) => r.map(esc).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `budget-transactions-${todayStr()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** Replace all data with the contents of a backup file. */
export async function importAll(json: string): Promise<void> {
  const parsed = JSON.parse(json) as Backup
  if (parsed.app !== 'budget' || !parsed.data) throw new Error('Not a valid budget backup file.')
  const tableRefs = TABLES.map(
    (t) => (db as never as Record<string, { clear(): Promise<void>; bulkAdd(r: unknown[]): Promise<unknown> }>)[t],
  )
  await db.transaction('rw', tableRefs as never, async () => {
    for (let i = 0; i < TABLES.length; i++) {
      const table = tableRefs[i]
      await table.clear()
      const rows = parsed.data[TABLES[i]] ?? []
      if (rows.length) await table.bulkAdd(rows)
    }
  })
}
