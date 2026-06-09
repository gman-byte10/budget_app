import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { useMonthBudget, useCashFlow, useBalances } from '../state/useData'
import { useSettings } from '../state/useSettings'
import { streakLoggedToday } from '../state/actions'
import { currentMonthKey, monthProgress, monthLabel, todayStr, friendlyDate } from '../lib/dates'
import { money, moneySigned } from '../lib/money'
import { Card, ProgressBar, EmptyState, Button, SectionTitle } from '../components/ui'
import { TxnRow, makeLookups } from '../components/TxnRow'
import { WeeklyCheckinCard } from '../components/WeeklyCheckin'
import { CoachCard } from '../components/Coach'
import { InstallHint } from '../components/InstallHint'
import { BackupReminder } from '../components/BackupReminder'
import { daysSinceCheckin, getConsistencyDots } from '../lib/stats'

export default function Dashboard() {
  const navigate = useNavigate()
  const mk = currentMonthKey()
  const settings = useSettings()
  const budget = useMonthBudget(mk)
  const flow = useCashFlow(mk)
  const bal = useBalances()

  const recent = useLiveQuery(
    async () => {
      const all = await db.transactions.orderBy('date').reverse().limit(8).toArray()
      // orderBy('date') then reverse gives latest dates; tie-break by createdAt
      return all.sort((a, b) => (b.date.localeCompare(a.date) || b.createdAt - a.createdAt)).slice(0, 6)
    },
    [],
    [],
  )
  const cats = useLiveQuery(() => db.categories.toArray(), [], [])
  const accts = useLiveQuery(() => db.accounts.toArray(), [], [])
  const lookups = makeLookups(cats, accts)

  const upcomingRule = useLiveQuery(
    async () => {
      const active = (await db.recurring.filter((r) => r.active).toArray()).sort((a, b) =>
        a.nextDate.localeCompare(b.nextDate),
      )
      const dueReminders = active.filter((r) => !r.autoPost && r.nextDate <= todayStr())
      return { next: active[0], dueCount: dueReminders.length }
    },
    [],
    { next: undefined, dueCount: 0 },
  )

  const onStreak = streakLoggedToday(settings.streak.lastLogDate)
  const prog = monthProgress(mk)
  const safe = budget?.safeToSpend ?? 0
  const perDay = prog.remaining > 0 ? safe / prog.remaining : 0

  // Quick stats
  const biggest = budget?.rows.filter((r) => r.spent > 0).sort((a, b) => b.spent - a.spent)[0]
  const avgDaily = prog.elapsed > 0 ? (budget?.totalSpent ?? 0) / prog.elapsed : 0
  const checkinReady = daysSinceCheckin(settings.lastWeeklyCheckin) >= 7 && (recent?.length ?? 0) > 0
  const dots = useLiveQuery(() => getConsistencyDots(), [], [])

  const hour = new Date().getHours()
  const greeting =
    hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="pt-1">
      <p className="text-sm text-ink-soft mt-1 px-1">{greeting} 👋</p>

      {/* Log-today nudge — motivating, not guilt-inducing */}
      {!onStreak && (
        <Card className="p-4 mt-2 flex items-center justify-between bg-warn-soft border-warn/20">
          <div>
            <p className="font-semibold text-sm">Nothing logged today</p>
            <p className="text-xs text-ink-soft">
              {settings.streak.current > 0
                ? `Keep your ${settings.streak.current}-day streak alive 🔥`
                : 'A 5-second entry starts your streak ✨'}
            </p>
          </div>
          <Button variant="soft" onClick={() => navigate('/add')}>
            Log
          </Button>
        </Card>
      )}

      <InstallHint />
      <BackupReminder />

      {/* 7-day consistency strip — gentle habit reinforcement */}
      <Card className="p-3 mt-3">
        <div className="flex items-center justify-between">
          {dots.map((d) => (
            <div key={d.date} className="flex flex-col items-center gap-1">
              <span className={`text-[10px] ${d.isToday ? 'text-brand font-bold' : 'text-ink-faint'}`}>{d.label}</span>
              <span
                className={`h-7 w-7 rounded-full grid place-items-center text-xs ${
                  d.logged
                    ? 'bg-pos text-white'
                    : d.isToday
                      ? 'border-2 border-dashed border-brand text-brand'
                      : 'bg-canvas text-ink-faint'
                }`}
              >
                {d.logged ? '✓' : d.isToday ? '+' : ''}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Safe to spend — the headline number */}
      {(budget?.totalEffective ?? 0) === 0 ? (
        <Card className="p-5 mt-3 text-center" onClick={() => navigate('/budgets')}>
          <p className="text-sm font-medium text-ink-soft">Safe to spend · {monthLabel(mk, settings.locale)}</p>
          <p className="text-2xl mt-2">🎯</p>
          <p className="font-semibold mt-1">Set budgets to unlock this</p>
          <p className="text-xs text-ink-faint mt-1">
            Give a few categories a monthly amount and you'll get a single safe-to-spend number. Tap to start ›
          </p>
        </Card>
      ) : (
        <Card className="p-5 mt-3 text-center">
          <p className="text-sm font-medium text-ink-soft">Safe to spend · {monthLabel(mk, settings.locale)}</p>
          <p className={`tnum text-5xl font-bold mt-1 ${safe < 0 ? 'text-neg' : 'text-ink'}`}>{money(safe)}</p>
          {safe >= 0 ? (
            <p className="text-xs text-ink-faint mt-1">
              ≈ {money(perDay)}/day for {prog.remaining} day{prog.remaining === 1 ? '' : 's'} left
            </p>
          ) : (
            <p className="text-xs text-neg mt-1">Over budget — ease up where you can 💛</p>
          )}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-ink-soft mb-1">
              <span>Spent {money(budget?.totalSpent ?? 0)}</span>
              <span>of {money(budget?.totalEffective ?? 0)}</span>
            </div>
            <ProgressBar value={budget?.totalSpent ?? 0} max={budget?.totalEffective ?? 0} />
          </div>
        </Card>
      )}

      <WeeklyCheckinCard ready={checkinReady} />

      {/* Cash flow + net worth */}
      <div className="grid grid-cols-2 gap-3 mt-3">
        <Card className="p-4">
          <p className="text-xs text-ink-faint font-medium">This month</p>
          <p className={`tnum text-xl font-bold ${(flow?.net ?? 0) >= 0 ? 'text-pos' : 'text-neg'}`}>
            {moneySigned(flow?.net ?? 0)}
          </p>
          <p className="text-[11px] text-ink-faint mt-0.5">
            +{money(flow?.income ?? 0)} · −{money(flow?.expenses ?? 0)}
          </p>
        </Card>
        <Card className="p-4" onClick={() => navigate('/accounts')}>
          <p className="text-xs text-ink-faint font-medium">Net worth</p>
          <p className="tnum text-xl font-bold">{money(bal?.net ?? 0)}</p>
          <p className="text-[11px] text-ink-faint mt-0.5">across accounts ›</p>
        </Card>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3 mt-3">
        <Stat label="Days left" value={String(prog.remaining)} />
        <Stat label="Avg/day" value={money(avgDaily)} />
        <Stat label="Top spend" value={biggest ? `${biggest.category.emoji ?? ''} ${money(biggest.spent)}` : '—'} />
      </div>

      <Card className="p-4 mt-3 flex items-center justify-between active:bg-canvas" onClick={() => navigate('/insights')}>
        <p className="font-semibold text-sm">📈 Insights & charts</p>
        <span className="text-ink-faint">›</span>
      </Card>

      <CoachCard />

      {upcomingRule?.next && (
        <Card className="p-4 mt-3 flex items-center justify-between active:bg-canvas" onClick={() => navigate('/recurring')}>
          <div>
            <p className="text-sm font-semibold">
              🔁 Upcoming{upcomingRule.dueCount > 0 ? ` · ${upcomingRule.dueCount} due` : ''}
            </p>
            <p className="text-xs text-ink-faint">
              {(upcomingRule.next.type === 'income' ? '+' : '') + money(upcomingRule.next.amount)} ·{' '}
              {friendlyDate(upcomingRule.next.nextDate)}
            </p>
          </div>
          <span className="text-ink-faint">›</span>
        </Card>
      )}

      <SectionTitle action={<button onClick={() => navigate('/transactions')} className="text-brand text-sm font-semibold">See all</button>}>
        Recent
      </SectionTitle>
      <Card className="p-2">
        {recent.length === 0 ? (
          <EmptyState
            emoji="🌱"
            title="No transactions yet"
            hint="Tap the + to log your first one. It takes about five seconds."
            action={<Button onClick={() => navigate('/add')}>Add transaction</Button>}
          />
        ) : (
          <div className="divide-y divide-line">
            {recent.map((t) => (
              <TxnRow key={t.id} txn={t} lookups={lookups} onClick={() => navigate('/transactions')} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-3 text-center">
      <p className="text-[11px] text-ink-faint font-medium">{label}</p>
      <p className="tnum font-bold mt-0.5 truncate">{value}</p>
    </Card>
  )
}
