import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  Tooltip,
  LineChart,
  Line,
  YAxis,
} from 'recharts'
import {
  getCategoryBreakdown,
  getMonthlyTrend,
  getNetWorthSeries,
  getMonthDailySpend,
  type CategorySlice,
  type TrendPoint,
  type NetWorthPoint,
} from '../lib/stats'
import { currentMonthKey, monthLabel, monthLabelShort, parseMonthKey } from '../lib/dates'
import { money, moneyShort } from '../lib/money'
import { Card, SectionTitle, EmptyState } from '../components/ui'

export default function Insights() {
  const navigate = useNavigate()
  const mk = currentMonthKey()
  const [slices, setSlices] = useState<CategorySlice[] | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])
  const [networth, setNetworth] = useState<NetWorthPoint[]>([])
  const [daily, setDaily] = useState<number[]>([])

  useEffect(() => {
    getCategoryBreakdown(mk).then(setSlices)
    getMonthlyTrend(6).then(setTrend)
    getNetWorthSeries(6).then(setNetworth)
    getMonthDailySpend(mk).then(setDaily)
  }, [mk])

  const totalSpent = slices?.reduce((s, x) => s + x.value, 0) ?? 0

  return (
    <div className="pt-2 pb-4">
      <SectionTitle>Spending · {monthLabel(mk)}</SectionTitle>
      <Card className="p-4">
        {!slices ? (
          <p className="text-center text-ink-faint py-8">Loading…</p>
        ) : slices.length === 0 ? (
          <EmptyState emoji="📊" title="Nothing to chart yet" hint="Log a few expenses and your breakdown appears here." />
        ) : (
          <>
            <div className="relative">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={slices} dataKey="value" nameKey="name" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="none">
                    {slices.map((s) => (
                      <Cell key={s.name} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => money(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-xs text-ink-faint">Total</span>
                <span className="tnum text-xl font-bold">{moneyShort(totalSpent)}</span>
              </div>
            </div>
            <div className="mt-3 space-y-1.5">
              {slices.slice(0, 8).map((s) => (
                <button
                  key={s.id}
                  onClick={() => navigate(`/transactions?category=${s.id}`)}
                  className="w-full flex items-center gap-2 text-sm py-0.5 active:opacity-60"
                >
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="flex-1 truncate text-left">
                    {s.emoji} {s.name}
                  </span>
                  <span className="tnum text-ink-soft">{money(s.value)}</span>
                  <span className="tnum text-ink-faint w-10 text-right">
                    {totalSpent > 0 ? Math.round((s.value / totalSpent) * 100) : 0}%
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </Card>

      <SectionTitle>Daily spending</SectionTitle>
      <Card className="p-4">
        <MonthHeatmap monthKey={mk} daily={daily} />
      </Card>

      <SectionTitle>Income vs spending</SectionTitle>
      <Card className="p-4 pl-1">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={trend} barGap={2}>
            <XAxis
              dataKey="monthKey"
              tickFormatter={(mk) => monthLabelShort(mk).split(' ')[0]}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              formatter={(v, n) => [money(Number(v)), n === 'income' ? 'Income' : 'Spending']}
              labelFormatter={(mk) => monthLabel(mk as string)}
            />
            <Bar dataKey="income" fill="#059669" radius={[4, 4, 0, 0]} />
            <Bar dataKey="expenses" fill="#e11d48" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div className="flex justify-center gap-4 text-xs text-ink-soft mt-1">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-pos" /> Income</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-neg" /> Spending</span>
        </div>
      </Card>

      <SectionTitle>Net worth trend</SectionTitle>
      <Card className="p-4 pl-1">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={networth}>
            <XAxis
              dataKey="monthKey"
              tickFormatter={(mk) => monthLabelShort(mk).split(' ')[0]}
              tick={{ fontSize: 11, fill: '#94a3b8' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis hide domain={['auto', 'auto']} />
            <Tooltip formatter={(v) => money(Number(v))} labelFormatter={(mk) => monthLabel(mk as string)} />
            <Line type="monotone" dataKey="net" stroke="#4f46e5" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  )
}

function MonthHeatmap({ monthKey, daily }: { monthKey: string; daily: number[] }) {
  const { year, month } = parseMonthKey(monthKey)
  const firstWeekday = new Date(year, month - 1, 1).getDay() // 0=Sun
  const max = Math.max(1, ...daily)
  const total = daily.reduce((s, v) => s + v, 0)
  const labels = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5 mb-1">
        {labels.map((l, i) => (
          <div key={i} className="text-[10px] text-ink-faint text-center">
            {l}
          </div>
        ))}
        {Array.from({ length: firstWeekday }).map((_, i) => (
          <div key={`pad${i}`} />
        ))}
        {daily.map((amt, i) => {
          const intensity = amt > 0 ? 0.15 + (amt / max) * 0.85 : 0
          return (
            <div
              key={i}
              title={amt > 0 ? `${i + 1}: ${money(amt)}` : `${i + 1}: —`}
              className="aspect-square rounded-md grid place-items-center text-[10px]"
              style={{
                background: amt > 0 ? `color-mix(in srgb, var(--color-brand) ${Math.round(intensity * 100)}%, var(--color-canvas))` : 'var(--color-canvas)',
                color: intensity > 0.55 ? '#fff' : 'var(--color-ink-faint)',
              }}
            >
              {i + 1}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-ink-faint text-center mt-2">{money(total)} spent · darker = more</p>
    </div>
  )
}
