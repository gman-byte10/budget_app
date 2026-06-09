import { useLiveQuery } from 'dexie-react-hooks'
import { db, DEFAULT_SETTINGS } from '../db/db'
import type { Settings } from '../db/schema'

/** Live settings, always defined (falls back to defaults until loaded). */
export function useSettings(): Settings {
  return useLiveQuery(() => db.settings.get('app'), [], DEFAULT_SETTINGS) ?? DEFAULT_SETTINGS
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const cur = (await db.settings.get('app')) ?? DEFAULT_SETTINGS
  await db.settings.put({ ...cur, ...patch })
}
