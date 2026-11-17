import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import {
  TrendingUp, Users, Calendar, CreditCard, Clock, Store, UserCheck, Wallet, CalendarDays,
  Footprints, History, LayoutDashboard, Scissors, Package, Star, Megaphone, BarChart3, GitBranch, Settings,
  ArrowRight, RefreshCw,
} from 'lucide-react'
import { get } from '../../lib/api'
import { useAuth } from '../../store/auth'

const cardStyle = {
  revenue_today: { icon: TrendingUp, bg: 'rgba(196,96,122,0.15)', color: '#e07a90' },
  appointments_today: { icon: Calendar, bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
  customers: { icon: Users, bg: 'rgba(16,185,129,0.15)', color: '#34d399' },
  pending_payments: { icon: CreditCard, bg: 'rgba(245,158,11,0.15)', color: '#fbbf24' },
  salons: { icon: Store, bg: 'rgba(201,151,58,0.15)', color: '#e8c97a' },
  team: { icon: UserCheck, bg: 'rgba(236,72,153,0.15)', color: '#f472b6' },
  walk_ins: { icon: Footprints, bg: 'rgba(16,185,129,0.15)', color: '#34d399' },
  customers_today: { icon: Users, bg: 'rgba(245,158,11,0.15)', color: '#fbbf24' },
  my_today: { icon: Calendar, bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
  commission: { icon: Wallet, bg: 'rgba(196,96,122,0.15)', color: '#e07a90' },
  next7: { icon: CalendarDays, bg: 'rgba(16,185,129,0.15)', color: '#34d399' },
  upcoming: { icon: Calendar, bg: 'rgba(59,130,246,0.15)', color: '#60a5fa' },
  visits: { icon: History, bg: 'rgba(16,185,129,0.15)', color: '#34d399' },
}

const moduleIcons = {
  dashboard: LayoutDashboard, appointments: Calendar, customers: Users, billing: CreditCard, staff: UserCheck,
  services: Scissors, inventory: Package, membership: Star, marketing: Megaphone, reports: BarChart3,
  branches: GitBranch, settings: Settings,
}

const roleDesk = {
  master_admin: { kicker: 'Master Admin', title: 'Network desk', text: 'All salons, the money across them, and who is allowed into each one.', accent: '#e8c97a' },
  super_admin: { kicker: 'Super Admin', title: 'Salon group', text: 'The salons assigned to you, with revenue and an All my salons view.', accent: '#c4b5fd' },
  admin: { kicker: 'Admin', title: 'Salon desk', text: 'This branch only. Bookings, customers, bills, and this salon’s revenue.', accent: '#67e8f9' },
  manager: { kicker: 'Manager', title: 'Floor desk', text: 'Today’s appointments, walk-ins, and who is on shift. Revenue is not on this desk.', accent: '#6ee7b7' },
  employee: { kicker: 'Employee', title: 'Front desk', text: 'Check people in, watch walk-ins, and see the next 7 days.', accent: '#fdba74' },
  staff: { kicker: 'Staff', title: 'Your chair', text: 'Your own appointments, commission earned, and the next 7 days.', accent: '#f9a8d4' },
  customer: { kicker: 'Customer', title: 'My visits', text: 'Book a salon and see only your own appointments.', accent: '#93c5fd' },
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const fmt = (c) => c.value == null ? '—' : c.format === 'currency' ? inr.format(c.value) : Number(c.value).toLocaleString('en-IN')

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
      <p className="text-[12px] text-fg-muted">{label}</p>
      <p className="text-[14px] font-bold text-fg">{inr.format(payload[0].value)}</p>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-5" aria-busy="true">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map(i => <div key={i} className="stat-card h-[108px] animate-pulse" />)}
      </div>
      <div className="glass rounded-2xl h-64 animate-pulse" />
    </div>
  )
}

export default function DashboardHome() {
  const user = useAuth(s => s.user)
  const salonId = useAuth(s => s.salonId)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const ctrl = new AbortController()
    setData(null)
    setError('')
    get(`/dashboard${salonId ? `?salonId=${salonId}` : ''}`, { signal: ctrl.signal })
      .then(setData)
      .catch(e => { if (e.name !== 'AbortError') setError(e.message) })
    return () => ctrl.abort()
  }, [salonId, reload])

  if (error) {
    return (
      <div className="glass rounded-2xl p-8 text-center max-w-md mx-auto">
        <p className="text-fg font-medium mb-1">Couldn't load your dashboard</p>
        <p className="text-fg-muted text-sm mb-4">{error}</p>
        <button onClick={() => setReload(n => n + 1)} className="btn-primary inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm">
          <RefreshCw size={14} /> Try again
        </button>
      </div>
    )
  }
  if (!data) return <Skeleton />

  const firstName = user?.fullName?.split(' ')[0]
  const modules = data.modules.filter(m => m.key !== 'dashboard')
  const desk = roleDesk[user?.role] || roleDesk.master_admin

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5 flex items-end justify-between flex-wrap gap-3" style={{ background: `linear-gradient(135deg, ${desk.accent}22, transparent)`, border: `1px solid ${desk.accent}44` }}>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: desk.accent }}>{desk.kicker}</p>
          <p className="text-[22px] font-semibold text-fg mt-1">{desk.title}{firstName ? ` · ${firstName}` : ''}</p>
          <p className="text-[13px] text-fg-2 mt-1 max-w-xl">{desk.text}</p>
        </div>
        <p className="text-[12px] text-fg-muted">{data.scopeLabel} · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      <div className={`grid grid-cols-2 ${data.cards.length > 4 ? 'lg:grid-cols-3 xl:grid-cols-6' : data.cards.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-4`}>
        {data.cards.map((c, i) => {
          const st = cardStyle[c.key] || cardStyle.salons
          return (
            <motion.div key={c.key} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.35 }} className="stat-card">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-4" style={{ background: st.bg }}>
                <st.icon size={17} style={{ color: st.color }} />
              </div>
              <p className="text-[22px] font-bold text-fg tracking-tight leading-none mb-1">{fmt(c)}</p>
              <p className="text-[12.5px] text-fg-muted">{c.label}</p>
              {c.hint && <p className="text-[11px] text-fg-muted mt-1">{c.hint}</p>}
            </motion.div>
          )
        })}
      </div>

      {data.revenueTrend && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="glass-card rounded-2xl p-5">
          <p className="text-[15px] font-semibold text-fg">Last 7 days revenue</p>
          <p className="text-[12.5px] text-fg-muted mt-0.5 mb-5">
            {inr.format(data.revenueTrend.reduce((s, d) => s + d.revenue, 0))} · fills in once billing goes live (V3)
          </p>
          <ResponsiveContainer width="100%" height={170}>
            <AreaChart data={data.revenueTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#c4607a" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#c4607a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 11.5 }} axisLine={false} tickLine={false} />
              <YAxis hide domain={[0, 'auto']} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="revenue" stroke="#c4607a" strokeWidth={2} fill="url(#revGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>
      )}

      <div>
        <p className="text-[15px] font-semibold text-fg mb-3">Your workspace</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {modules.map((m, i) => {
            const Icon = moduleIcons[m.key] || LayoutDashboard
            return (
              <motion.div key={m.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.03 }}>
                <Link to={m.path} className="glass rounded-2xl p-4 flex items-start gap-3 group h-full">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(201,151,58,0.12)' }}>
                    <Icon size={16} style={{ color: '#e8c97a' }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[13.5px] font-semibold text-fg">{m.label}</p>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                        style={m.available ? { background: 'rgba(34,197,94,0.12)', color: '#4ade80' } : { background: 'var(--surface)', color: 'var(--text-muted)' }}>
                        {m.available ? 'Live' : m.release}
                      </span>
                    </div>
                    <p className="text-[12px] text-fg-muted mt-0.5">{m.description}</p>
                  </div>
                  <ArrowRight size={14} className="text-fg-muted group-hover:text-fg mt-1 transition-colors" />
                </Link>
              </motion.div>
            )
          })}
        </div>
      </div>

      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <p className="text-[15px] font-semibold text-fg">{user?.role === 'customer' ? 'Your upcoming bookings' : "Today's appointments"}</p>
          <p className="text-[12.5px] text-fg-muted mt-0.5">{data.todayAppointments.length} scheduled</p>
        </div>
        {data.todayAppointments.length === 0 && (
          <div className="py-10 text-center">
            <Clock size={22} className="mx-auto mb-2 text-fg-muted" />
            <p className="text-fg text-sm font-medium">No appointments yet</p>
            <p className="text-fg-muted text-[12.5px] mt-0.5">Bookings will show here once online booking goes live in V2.</p>
          </div>
        )}
      </div>
    </div>
  )
}
