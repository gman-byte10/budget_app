import { useEffect, useState, lazy, Suspense } from 'react'
import { Routes, Route, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ensureSeeded } from './db/seed'
import { processDueRecurring } from './lib/recurring'
import { initSync, syncConfigured, syncPull } from './lib/sync'
import { useSettings } from './state/useSettings'
import { configureMoney } from './lib/money'
import { streakLoggedToday } from './state/actions'
import Dashboard from './routes/Dashboard'
import AddTxn from './routes/AddTxn'
import Accounts from './routes/Accounts'
import AccountDetail from './routes/AccountDetail'
import Transactions from './routes/Transactions'
import Budgets from './routes/Budgets'
import Goals from './routes/Goals'
import Recurring from './routes/Recurring'
import Settings from './routes/Settings'
import Onboarding from './components/Onboarding'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PinLock } from './components/PinLock'
import { isUnlocked } from './lib/pin'

// Charts (recharts) are heavy — load only when the user opens Insights.
const Insights = lazy(() => import('./routes/Insights'))

function useBootstrap() {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    ensureSeeded()
      .then(() => {
        initSync() // set up write-hooks + focus pulling
        return syncConfigured() ? syncPull() : undefined // adopt newer cloud data first
      })
      .then(() => processDueRecurring())
      .then(() => setReady(true))
      .catch((e) => setError(String((e as Error)?.message || e)))
  }, [])
  return { ready, error }
}

export default function App() {
  const { ready, error } = useBootstrap()
  const settings = useSettings()
  const location = useLocation()
  const [unlocked, setUnlocked] = useState(isUnlocked())
  configureMoney(settings.currency, settings.locale)

  const theme = settings.theme ?? 'system'
  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => root.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches))
    apply()
    if (theme === 'system') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])

  if (error) {
    return (
      <div className="min-h-screen grid place-items-center p-6 text-center">
        <div className="max-w-sm">
          <div className="text-5xl mb-3">💾</div>
          <h1 className="text-lg font-bold">Can't open local storage</h1>
          <p className="text-sm text-ink-soft mt-2">
            This app stores data in your browser's database. That's unavailable right now — often
            because of private/incognito mode or storage being blocked. Try a normal browser window.
          </p>
          <pre className="text-[11px] text-ink-faint bg-canvas rounded-lg p-2 mt-3 overflow-auto text-left">{error}</pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-xl bg-brand text-white px-4 py-3 font-semibold w-full"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="min-h-screen grid place-items-center text-ink-soft">
        <div className="animate-pulse text-3xl">💸</div>
      </div>
    )
  }

  if (!unlocked) {
    return <PinLock onUnlock={() => setUnlocked(true)} />
  }

  if (!settings.onboarded) {
    return <Onboarding onDone={() => {}} />
  }

  return (
    <div className="min-h-screen max-w-md mx-auto flex flex-col">
      <Header />
      <main className="flex-1 px-4 pb-28">
        <ErrorBoundary key={location.pathname}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/add" element={<AddTxn />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/accounts/:id" element={<AccountDetail />} />
          <Route path="/goals" element={<Goals />} />
          <Route path="/recurring" element={<Recurring />} />
          <Route
            path="/insights"
            element={
              <Suspense fallback={<div className="text-center text-ink-faint py-12">Loading charts…</div>}>
                <Insights />
              </Suspense>
            }
          />
          <Route path="/settings" element={<Settings />} />
        </Routes>
        </ErrorBoundary>
      </main>
      <TabBar />
    </div>
  )
}

function Header() {
  const settings = useSettings()
  const navigate = useNavigate()
  const onStreak = streakLoggedToday(settings.streak.lastLogDate)
  return (
    <header className="sticky top-0 z-10 bg-canvas/90 backdrop-blur px-4 pt-3 pb-2 flex items-center justify-between">
      <button onClick={() => navigate('/')} className="text-lg font-bold tracking-tight">
        Budget
      </button>
      <div className="flex items-center gap-1">
        <button
          onClick={() => navigate('/transactions')}
          className="px-2 py-1.5 rounded-lg active:bg-surface text-ink-soft"
          aria-label="Search transactions"
        >
          🔎
        </button>
        <button
          onClick={() => navigate('/settings')}
          className={`px-2 py-1.5 rounded-lg text-sm font-semibold ${onStreak ? 'text-warn' : 'text-ink-faint'}`}
          title="Logging streak"
        >
          🔥 {settings.streak.current}
        </button>
        <button
          onClick={() => navigate('/settings')}
          className="px-2 py-1.5 rounded-lg active:bg-surface"
          aria-label="Settings"
        >
          ⚙️
        </button>
      </div>
    </header>
  )
}

const tabs = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/budgets', label: 'Budget', icon: '🎯' },
  { to: '/goals', label: 'Goals', icon: '⭐' },
  { to: '/accounts', label: 'Accounts', icon: '💳' },
]

function TabBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const isActive = (to: string) =>
    to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
  return (
    <nav className="fixed bottom-0 inset-x-0 z-20">
      <div className="max-w-md mx-auto px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 bg-surface/95 backdrop-blur border-t border-line">
        <div className="flex items-center justify-between">
          {tabs.slice(0, 2).map((t) => (
            <Tab key={t.to} {...t} active={isActive(t.to)} />
          ))}
          <button
            onClick={() => navigate('/add')}
            className="-mt-7 grid place-items-center h-14 w-14 rounded-full bg-brand text-white text-3xl shadow-lg active:scale-95 transition-transform"
            aria-label="Add transaction"
          >
            +
          </button>
          {tabs.slice(2).map((t) => (
            <Tab key={t.to} {...t} active={isActive(t.to)} />
          ))}
        </div>
      </div>
    </nav>
  )
}

function Tab({ to, label, icon, active }: { to: string; label: string; icon: string; active: boolean }) {
  return (
    <NavLink
      to={to}
      className={`flex flex-col items-center gap-0.5 w-14 py-1 text-[11px] font-medium ${
        active ? 'text-brand' : 'text-ink-faint'
      }`}
    >
      <span className="text-xl leading-none">{icon}</span>
      {label}
    </NavLink>
  )
}
