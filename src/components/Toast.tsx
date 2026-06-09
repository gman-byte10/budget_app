import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ToastOptions {
  actionLabel?: string
  onAction?: () => void
  duration?: number
}
interface ToastState extends ToastOptions {
  id: number
  message: string
}

const ToastCtx = createContext<(message: string, opts?: ToastOptions) => void>(() => {})

// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  return useContext(ToastCtx)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idRef = useRef(0)

  const show = useCallback((message: string, opts?: ToastOptions) => {
    if (timer.current) clearTimeout(timer.current)
    const id = ++idRef.current
    setToast({ id, message, ...opts })
    timer.current = setTimeout(() => setToast((t) => (t?.id === id ? null : t)), opts?.duration ?? 4000)
  }, [])

  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 pointer-events-none">
          <div className="pointer-events-auto max-w-md w-full flex items-center justify-between gap-3 rounded-xl bg-ink text-white px-4 py-3 shadow-lg animate-pop">
            <span className="text-sm">{toast.message}</span>
            {toast.actionLabel && (
              <button
                onClick={() => {
                  toast.onAction?.()
                  setToast(null)
                }}
                className="text-sm font-bold text-indigo-300 shrink-0"
              >
                {toast.actionLabel}
              </button>
            )}
          </div>
        </div>
      )}
    </ToastCtx.Provider>
  )
}
