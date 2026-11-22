import { useEffect, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { get } from '../../lib/api'
import { useAuth } from '../../store/auth'
import { inr } from './useDeskSalon.jsx'

export default function ReportsPage() {
  const salonId = useAuth(s => s.salonId)
  const [days, setDays] = useState(30)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const params = new URLSearchParams({ days: String(days) })
    if (salonId) params.set('salonId', salonId)
    get(`/reports?${params}`).then(setData).catch(err => setError(err.message))
  }, [salonId, days])

  if (error) return <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
  if (!data) return <div className="glass rounded-2xl h-40 animate-pulse" />

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[[7, '7 days'], [30, '30 days'], [180, '6 months']].map(([value, label]) => (
          <button key={value} onClick={() => setDays(value)}
            className={`px-3 py-1.5 rounded-lg text-sm ${days === value ? 'bg-violet-600 text-white' : 'glass text-fg-2'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Paid revenue', inr.format(data.revenue)],
          ['Paid bills', data.invoices],
          ['Customers', data.customers],
          ['Bookings in range', data.appointments],
        ].map(([label, value]) => (
          <div key={label} className="glass rounded-2xl p-4">
            <p className="text-[22px] font-bold text-fg">{value}</p>
            <p className="text-[12.5px] text-fg-muted">{label}</p>
          </div>
        ))}
      </div>
      <div className="glass-card rounded-2xl p-5">
        <p className="text-[15px] font-semibold text-fg mb-4">Paid revenue</p>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data.revenueByDay}>
            <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip formatter={value => inr.format(value)} />
            <Area type="monotone" dataKey="revenue" stroke="#c4607a" fill="rgba(196,96,122,0.25)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="glass-card rounded-2xl p-5">
          <p className="text-[15px] font-semibold text-fg mb-4">Services</p>
          {data.services.length === 0 ? <p className="text-sm text-fg-muted">No paid service bills in this range.</p> : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={data.services}>
                <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip formatter={value => inr.format(value)} />
                <Bar dataKey="revenue" fill="#a78bfa" radius={6} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="glass-card rounded-2xl p-5">
          <p className="text-[15px] font-semibold text-fg mb-3">Staff on paid bills</p>
          {data.staff.length === 0 && <p className="text-sm text-fg-muted">No stylist is on a paid bill in this range.</p>}
          {data.staff.map(row => (
            <div key={row.name} className="flex justify-between text-[13px] py-2" style={{ borderTop: '1px solid var(--border)' }}>
              <span className="text-fg">{row.name}</span>
              <span className="text-fg-muted">{row.appointments} lines · {inr.format(row.revenue)}</span>
            </div>
          ))}
          {data.payments.length > 0 && (
            <p className="text-[12.5px] text-fg-muted mt-4">
              Payments: {data.payments.map(row => `${row.name} ${inr.format(row.value)}`).join(' · ')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
