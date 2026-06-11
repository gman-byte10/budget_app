import { describe, it, expect } from 'vitest'
import { decidePull } from './sync'

// The core data-safety rule for cross-device sync: never silently overwrite
// local edits. Adopt the cloud copy ONLY when this device is clean.
describe('sync pull decision', () => {
  it('does nothing when there is no remote copy', () => {
    expect(decidePull(null, 100, false)).toBe('noop')
    expect(decidePull(null, 100, true)).toBe('noop')
  })

  it('does nothing when the remote is not newer than what we have', () => {
    expect(decidePull(100, 100, false)).toBe('noop') // equal
    expect(decidePull(90, 100, false)).toBe('noop') // older
    expect(decidePull(90, 100, true)).toBe('noop') // older, even if dirty
  })

  it('adopts the cloud copy when remote is newer AND we have no local edits', () => {
    expect(decidePull(200, 100, false)).toBe('adopt')
  })

  it('raises a CONFLICT when remote is newer AND we have unsynced local edits', () => {
    // This is the data-loss guard: do not overwrite the user's local changes.
    expect(decidePull(200, 100, true)).toBe('conflict')
  })

  it('treats a fresh device (localUpdatedAt 0) with a remote copy as adopt when clean', () => {
    expect(decidePull(200, 0, false)).toBe('adopt')
    expect(decidePull(200, 0, true)).toBe('conflict')
  })
})
