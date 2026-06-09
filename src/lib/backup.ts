import { db } from '../db/db'
import { todayStr } from './dates'

const TABLES = [
  'accounts',
  'categories',
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
