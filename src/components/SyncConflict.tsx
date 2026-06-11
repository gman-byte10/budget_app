import { useEffect, useState } from 'react'
import { getSyncState, onSyncChange, resolveConflict } from '../lib/sync'
import { Button } from './ui'

/**
 * Shown when this device and the cloud both changed since the last sync. The user
 * picks which copy wins — we never silently overwrite their edits.
 */
export function SyncConflict() {
  const [s, setS] = useState(getSyncState())
  useEffect(() => onSyncChange(() => setS(getSyncState())), [])

  if (!s.conflict) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-6 bg-black/40">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-5 animate-pop">
        <div className="text-3xl text-center mb-2">🔀</div>
        <h2 className="text-lg font-bold text-center">Sync conflict</h2>
        <p className="text-sm text-ink-soft mt-2 text-center">
          This device and another both changed since the last sync. Which copy should win? The other
          copy will be replaced — pick the one with the changes you want to keep.
        </p>
        <Button className="w-full mt-4" disabled={s.syncing} onClick={() => resolveConflict('local')}>
          Keep this device
        </Button>
        <Button
          variant="ghost"
          className="w-full mt-2 border border-line"
          disabled={s.syncing}
          onClick={() => resolveConflict('remote')}
        >
          Use the other device
        </Button>
        {s.error && <p className="text-xs text-neg text-center mt-2">{s.error}</p>}
      </div>
    </div>
  )
}
