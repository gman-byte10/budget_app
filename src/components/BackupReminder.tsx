import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { useSettings } from '../state/useSettings'
import { downloadBackup } from '../lib/backup'
import { daysBetween, todayStr } from '../lib/dates'
import { Button } from './ui'

const SNOOZE = 'budget.backupSnooze'

/**
 * Data lives only in this browser's IndexedDB, so a "clear site data" wipes it.
 * Nudge the user to export a JSON backup if they never have / it's been a while.
 */
export function BackupReminder() {
  const settings = useSettings()
  const count = useLiveQuery(() => db.transactions.count(), [], 0)
  const [hidden, setHidden] = useState(false)

  const last = settings.lastBackupAt
  const stale = !last || daysBetween(last, todayStr()) >= 14
  const snooze = localStorage.getItem(SNOOZE)
  const snoozed = !!snooze && daysBetween(snooze, todayStr()) < 7

  if (hidden || count < 5 || !stale || snoozed) return null

  return (
    <div className="rounded-2xl bg-warn-soft border border-warn/20 p-4 mt-3">
      <p className="font-semibold text-sm">🛡️ Back up your data</p>
      <p className="text-xs text-ink-soft mt-0.5">
        {last
          ? `Last backup was ${daysBetween(last, todayStr())} days ago.`
          : "You haven't backed up yet."}{' '}
        Everything is stored only on this device — export a copy to be safe.
      </p>
      <div className="flex gap-2 mt-3">
        <Button variant="soft" className="flex-1 py-2" onClick={() => downloadBackup()}>
          Back up now
        </Button>
        <Button
          variant="ghost"
          className="py-2 border border-line"
          onClick={() => {
            localStorage.setItem(SNOOZE, todayStr())
            setHidden(true)
          }}
        >
          Later
        </Button>
      </div>
    </div>
  )
}
