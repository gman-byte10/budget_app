import { db } from '../db/db'

type Orderable = 'accounts' | 'categories'

/** Swap an item with its neighbour in the given direction (-1 up, +1 down). */
export async function reorder(kind: Orderable, id: string, dir: -1 | 1): Promise<void> {
  const table = db[kind]
  const items = await table.orderBy('order').toArray()
  const idx = items.findIndex((i) => i.id === id)
  const swapIdx = idx + dir
  if (idx < 0 || swapIdx < 0 || swapIdx >= items.length) return
  const a = items[idx]
  const b = items[swapIdx]
  await db.transaction('rw', table, async () => {
    await table.update(a.id, { order: b.order })
    await table.update(b.id, { order: a.order })
  })
}

/**
 * Reorder an item within a SUBSET (e.g. only credit cards, or only the visible
 * budget categories), swapping order with its neighbour inside that group so
 * groups stay independent.
 */
export async function reorderWithin(
  kind: Orderable,
  group: { id: string; order: number }[],
  id: string,
  dir: -1 | 1,
): Promise<void> {
  const table = db[kind]
  const sorted = [...group].sort((a, b) => a.order - b.order)
  const idx = sorted.findIndex((g) => g.id === id)
  const swapIdx = idx + dir
  if (idx < 0 || swapIdx < 0 || swapIdx >= sorted.length) return
  const a = sorted[idx]
  const b = sorted[swapIdx]
  await db.transaction('rw', table, async () => {
    await table.update(a.id, { order: b.order })
    await table.update(b.id, { order: a.order })
  })
}
