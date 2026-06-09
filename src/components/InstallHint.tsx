import { useState } from 'react'

const KEY = 'budget.iosHintDismissed'

// iOS Safari doesn't offer an install prompt — nudge users to Add to Home Screen.
export function InstallHint() {
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  const [dismissed, setDismissed] = useState(localStorage.getItem(KEY) === '1')

  if (!isIOS || isStandalone || dismissed) return null

  return (
    <div className="rounded-2xl bg-brand-soft border border-brand/15 p-3 mt-3 flex items-center gap-3">
      <span className="text-xl">📲</span>
      <p className="flex-1 text-xs text-ink-soft">
        Install this app: tap <b>Share</b> then <b>Add to Home Screen</b> for a full-screen, app-like
        experience.
      </p>
      <button
        onClick={() => {
          localStorage.setItem(KEY, '1')
          setDismissed(true)
        }}
        className="text-ink-faint text-lg px-1"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  )
}
