import type { ReactNode } from 'react'

export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl bg-surface border border-line shadow-sm ${onClick ? 'cursor-pointer active:scale-[0.99] transition-transform' : ''} ${className}`}
    >
      {children}
    </div>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2 mt-5 px-1">
      <h2 className="text-sm font-semibold text-ink-soft uppercase tracking-wide">{children}</h2>
      {action}
    </div>
  )
}

export function ProgressBar({
  value,
  max,
  tone = 'brand',
  className = '',
}: {
  value: number
  max: number
  tone?: 'brand' | 'pos' | 'neg' | 'warn'
  className?: string
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  const over = max > 0 && value > max
  const colors: Record<string, string> = {
    brand: 'bg-brand',
    pos: 'bg-pos',
    neg: 'bg-neg',
    warn: 'bg-warn',
  }
  return (
    <div className={`h-2 rounded-full bg-canvas overflow-hidden ${className}`}>
      <div
        className={`h-full rounded-full transition-all ${over ? 'bg-neg' : colors[tone]}`}
        style={{ width: `${over ? 100 : pct}%` }}
      />
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  type = 'button',
  className = '',
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'ghost' | 'soft' | 'danger'
  type?: 'button' | 'submit'
  className?: string
  disabled?: boolean
}) {
  const variants: Record<string, string> = {
    primary: 'bg-brand text-white active:bg-indigo-700',
    soft: 'bg-brand-soft text-brand active:bg-indigo-100',
    ghost: 'bg-transparent text-ink-soft active:bg-canvas',
    danger: 'bg-neg-soft text-neg active:bg-rose-100',
  }
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-4 py-3 font-semibold transition-colors disabled:opacity-40 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

export function EmptyState({
  emoji,
  title,
  hint,
  action,
}: {
  emoji: string
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center text-center py-12 px-6">
      <div className="text-5xl mb-3">{emoji}</div>
      <p className="font-semibold text-ink">{title}</p>
      {hint && <p className="text-sm text-ink-soft mt-1 max-w-xs">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Pill({
  children,
  active,
  onClick,
}: {
  children: ReactNode
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium border transition-colors ${
        active
          ? 'bg-brand text-white border-brand'
          : 'bg-surface text-ink-soft border-line active:bg-canvas'
      }`}
    >
      {children}
    </button>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function accountEmoji(type: string): string {
  return { checking: '🏦', savings: '🐷', cash: '💵', credit: '💳' }[type] ?? '💼'
}
