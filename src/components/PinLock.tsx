import { useState } from 'react'
import { verifyPin, markUnlocked } from '../lib/pin'
import { tap } from '../lib/haptics'

/** Full-screen 4-digit PIN gate shown before the app when a PIN is set. */
export function PinLock({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)

  async function submit(value: string) {
    if (await verifyPin(value)) {
      markUnlocked()
      onUnlock()
    } else {
      setError(true)
      navigator.vibrate?.([20, 60, 20])
      setTimeout(() => {
        setPin('')
        setError(false)
      }, 450)
    }
  }

  function press(d: string) {
    if (pin.length >= 4 || error) return
    tap()
    const next = pin + d
    setPin(next)
    if (next.length === 4) submit(next)
  }

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

  return (
    <div className="fixed inset-0 z-50 bg-canvas grid place-items-center px-8">
      <div className="w-full max-w-xs text-center">
        <div className="text-4xl mb-2">🔒</div>
        <p className="font-semibold">Enter PIN</p>
        <div className={`flex justify-center gap-3 my-6 ${error ? 'animate-pop' : ''}`}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-3.5 w-3.5 rounded-full border-2 ${
                error
                  ? 'border-neg bg-neg'
                  : i < pin.length
                    ? 'border-brand bg-brand'
                    : 'border-line'
              }`}
            />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {keys.map((k, i) =>
            k === '' ? (
              <span key={i} />
            ) : (
              <button
                key={i}
                onClick={() => (k === '⌫' ? setPin((p) => p.slice(0, -1)) : press(k))}
                className="h-16 rounded-2xl bg-surface border border-line text-2xl font-semibold text-ink active:bg-canvas"
              >
                {k}
              </button>
            ),
          )}
        </div>
      </div>
    </div>
  )
}
