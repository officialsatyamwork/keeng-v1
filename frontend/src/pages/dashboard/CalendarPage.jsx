import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, Clock, UserRound, X } from 'lucide-react'
import { get } from '../../lib/api'
import { useAuth } from '../../store/auth'
import MoveDialog from './MoveDialog.jsx'
import { SalonPicker, useDeskSalon } from './useDeskSalon.jsx'

function startOfDay(date = new Date()) {
  const x = new Date(date)
  x.setHours(0, 0, 0, 0)
  return x
}

function dayKeyOf(day) {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function addDays(date, amount) {
  const next = new Date(date)
  next.setDate(date.getDate() + amount)
  return startOfDay(next)
}

function startOfMonth(date) {
  return startOfDay(new Date(date.getFullYear(), date.getMonth(), 1))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const STATUS_TONE = {
  booked: { bg: 'var(--info-soft)', color: 'var(--info)', border: 'rgba(59,130,246,0.25)' },
  confirmed: { bg: 'var(--brand-soft)', color: 'var(--brand)', border: 'var(--border-brand)' },
  checked_in: { bg: 'var(--warning-soft)', color: 'var(--warning)', border: 'rgba(245,158,11,0.28)' },
  in_service: { bg: 'var(--gold-soft)', color: 'var(--gold-text)', border: 'rgba(201,151,58,0.3)' },
  billed: { bg: 'var(--success-soft)', color: 'var(--success)', border: 'rgba(34,197,94,0.28)' },
  completed: { bg: 'var(--success-soft)', color: 'var(--success)', border: 'rgba(34,197,94,0.28)' },
  joined: { bg: 'var(--brand-soft)', color: 'var(--brand)', border: 'var(--border-brand)' },
}

export default function CalendarPage() {
  const role = useAuth(s => s.user?.role)
  const isCustomer = role === 'customer'
  const canMove = role && role !== 'customer' && role !== 'staff'
  const desk = useDeskSalon()
  const today = useMemo(() => startOfDay(new Date()), [])
  const [cursor, setCursor] = useState(today)
  const [selectedKey, setSelectedKey] = useState(() => dayKeyOf(today))
  const [rows, setRows] = useState([])
  const [team, setTeam] = useState([])
  const [error, setError] = useState('')
  const [moving, setMoving] = useState(null)
  const [reload, setReload] = useState(0)
  const [owners, setOwners] = useState([])
  const isOwner = role === 'master_admin'
  const atToday = isSameDay(cursor, today)

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(cursor, i)), [cursor])

  const itemsForDay = (day) => {
    const dayKey = dayKeyOf(day)
    if (isOwner) {
      return owners.filter(person => (person.createdAt || '').slice(0, 10) === dayKey).map(person => ({
        id: person.id,
        startsAt: person.createdAt,
        customerName: person.fullName,
        serviceName: person.role === 'admin' ? 'Salon admin joined' : 'Super admin joined',
        status: 'joined',
        phone: person.phone || '',
        email: person.email || '',
      }))
    }
    return rows.filter(row => {
      const when = new Date(row.startsAt)
      return isSameDay(when, day) && row.status !== 'cancelled' && row.status !== 'no_show'
    })
  }

  useEffect(() => {
    const end = addDays(cursor, 7)
    const params = new URLSearchParams({ start: cursor.toISOString(), end: end.toISOString() })
    if (!isCustomer && desk.salonId) params.set('salonId', desk.salonId)
    if (isOwner) {
      get('/users?pageSize=100').then(data => setOwners((data.items || []).filter(person => ['admin', 'super_admin'].includes(person.role)))).catch(e => setError(e.message))
      return
    }
    get(`/appointments?${params}`).then(setRows).catch(e => setError(e.message))
    if (!isCustomer && desk.salonId) get(`/staff?salonId=${desk.salonId}`).then(setTeam).catch(() => setTeam([]))
  }, [cursor, desk.salonId, isCustomer, isOwner, reload])

  useEffect(() => {
    if (!days.some(day => dayKeyOf(day) === selectedKey)) {
      setSelectedKey(dayKeyOf(days[0]))
    }
  }, [days, selectedKey])

  const slide = (daysAmount) => {
    setCursor(current => addDays(current, daysAmount))
  }

  const setMonthYear = (month, year) => {
    const next = startOfMonth(new Date(year, month, 1))
    const target = (next.getFullYear() === today.getFullYear() && next.getMonth() === today.getMonth())
      ? today
      : next
    setCursor(target)
    setSelectedKey(dayKeyOf(target))
  }

  const selectedDay = days.find(day => dayKeyOf(day) === selectedKey) || days[0]
  const selectedItems = selectedDay ? itemsForDay(selectedDay) : []
  const selectedAway = selectedDay
    ? team.filter(person => (person.leave || []).some(item => item.day === dayKeyOf(selectedDay)))
    : []
  const selectedBreaks = selectedDay
    ? team.flatMap(person => (person.breaks || [])
      .filter(item => item.weekday === ((selectedDay.getDay() + 6) % 7))
      .map(item => `${person.fullName.split(' ')[0]} ${item.startTime}–${item.endTime}`))
    : []

  const years = Array.from({ length: 7 }, (_, i) => today.getFullYear() - 3 + i)
  const weekCount = isOwner
    ? owners.filter(person => {
      const key = (person.createdAt || '').slice(0, 10)
      return days.some(day => dayKeyOf(day) === key)
    }).length
    : rows.filter(row => row.status !== 'cancelled' && row.status !== 'no_show').length

  return (
    <div className="space-y-5 w-full">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-fg tracking-tight">Calendar</h1>
          <p className="text-[12.5px] text-fg-muted mt-0.5">
            {isOwner ? `${weekCount} owner join${weekCount === 1 ? '' : 's'} in view` : `${weekCount} booking${weekCount === 1 ? '' : 's'} in view`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isCustomer && !isOwner && <SalonPicker {...desk} />}
          <div
            className="inline-flex items-center gap-1 rounded-xl px-2 py-1"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
          >
            <select
              className="input-field text-sm py-1.5 min-h-0 w-[88px] border-0 bg-transparent shadow-none"
              value={cursor.getMonth()}
              onChange={e => setMonthYear(Number(e.target.value), cursor.getFullYear())}
              aria-label="Month"
            >
              {MONTHS.map((month, index) => (
                <option key={month} value={index}>{month}</option>
              ))}
            </select>
            <select
              className="input-field text-sm py-1.5 min-h-0 w-[84px] border-0 bg-transparent shadow-none"
              value={cursor.getFullYear()}
              onChange={e => setMonthYear(cursor.getMonth(), Number(e.target.value))}
              aria-label="Year"
            >
              {years.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
          {!atToday && (
            <button
              type="button"
              onClick={() => { setCursor(today); setSelectedKey(dayKeyOf(today)) }}
              className="btn-ghost px-3.5 py-2 rounded-xl text-sm"
            >
              Today
            </button>
          )}
        </div>
      </div>

      {isOwner && (
        <p className="text-[12.5px] text-fg-muted">Salon owners who joined. Customer bookings stay with each salon.</p>
      )}
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}

      <div className="flex items-stretch gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => slide(-1)}
          aria-label="Previous days"
          className="hidden sm:flex w-11 flex-shrink-0 self-center rounded-2xl items-center justify-center text-fg-2 hover:text-fg transition-all"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', minHeight: 120 }}
        >
          <ChevronLeft size={22} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-7 gap-3">
            {days.map(day => {
              const dayKey = dayKeyOf(day)
              const isToday = isSameDay(day, today)
              const selected = dayKey === selectedKey
              const items = itemsForDay(day)

              return (
                <button
                  type="button"
                  key={day.toISOString()}
                  onClick={() => setSelectedKey(dayKey)}
                  className="rounded-2xl p-3.5 min-h-[120px] flex flex-col text-left transition-colors"
                  style={{
                    background: 'var(--card-bg)',
                    border: selected || isToday ? '1px solid var(--border-brand)' : '1px solid var(--card-border)',
                    boxShadow: selected ? 'inset 0 0 0 1px var(--brand), 0 0 0 3px var(--brand-soft)' : isToday ? 'inset 0 0 0 1px var(--brand-soft)' : undefined,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-fg-muted">
                        {day.toLocaleDateString('en-IN', { weekday: 'short' })}
                      </p>
                      <p className="text-[18px] font-semibold text-fg leading-tight mt-0.5">
                        {day.toLocaleDateString('en-IN', { day: 'numeric' })}
                        <span className="text-[12px] font-medium text-fg-muted ml-1">
                          {day.toLocaleDateString('en-IN', { month: 'short' })}
                        </span>
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {isToday && (
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
                          style={{ background: 'var(--brand)', color: '#fff' }}
                        >
                          Today
                        </span>
                      )}
                      <span className="text-[11px] text-fg-muted">{items.length}</span>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => slide(1)}
          aria-label="Next days"
          className="hidden sm:flex w-11 flex-shrink-0 self-center rounded-2xl items-center justify-center text-fg-2 hover:text-fg transition-all"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', minHeight: 120 }}
        >
          <ChevronRight size={22} />
        </button>
      </div>

      <div className="flex sm:hidden items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => slide(-1)}
          aria-label="Previous days"
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-fg-2"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
        >
          <ChevronLeft size={22} />
        </button>
        <button
          type="button"
          onClick={() => slide(1)}
          aria-label="Next days"
          className="w-12 h-12 rounded-2xl flex items-center justify-center text-fg-2"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
        >
          <ChevronRight size={22} />
        </button>
      </div>

      {selectedDay && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
        >
          <div className="flex items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <div>
              <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-fg-muted">Day details</p>
              <h2 className="text-[16px] font-semibold text-fg mt-1">
                {selectedDay.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </h2>
              <p className="text-[12.5px] text-fg-muted mt-0.5">
                {selectedItems.length} item{selectedItems.length === 1 ? '' : 's'}
                {selectedAway.length ? ` · ${selectedAway.length} on leave` : ''}
              </p>
            </div>
            <button
              type="button"
              aria-label="Clear selection"
              onClick={() => setSelectedKey(dayKeyOf(today))}
              className="btn-icon-close"
            >
              <X size={17} strokeWidth={2.25} />
            </button>
          </div>

          <div className="p-5 space-y-3">
            {(selectedAway.length > 0 || selectedBreaks.length > 0) && (
              <div className="flex flex-wrap gap-2">
                {selectedAway.map(person => (
                  <span
                    key={person.userId}
                    className="text-[12px] px-2.5 py-1 rounded-full"
                    style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}
                  >
                    {person.fullName} on leave
                  </span>
                ))}
                {selectedBreaks.map(text => (
                  <span
                    key={text}
                    className="text-[12px] px-2.5 py-1 rounded-full text-fg-muted"
                    style={{ background: 'var(--bg-3)' }}
                  >
                    {text} break
                  </span>
                ))}
              </div>
            )}

            {selectedItems.length === 0 ? (
              <div
                className="rounded-xl px-4 py-10 text-center"
                style={{ background: 'var(--bg-2)', border: '1px dashed var(--border)' }}
              >
                <CalendarDays size={18} className="mx-auto text-fg-muted mb-2" />
                <p className="text-[13px] text-fg-muted">Nothing scheduled for this day.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {selectedItems.map(row => {
                  const tone = STATUS_TONE[row.status] || STATUS_TONE.confirmed
                  return (
                    <div
                      key={row.id}
                      className="rounded-xl p-4"
                      style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}
                    >
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span
                          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-fg"
                        >
                          <Clock size={13} className="text-fg-muted" />
                          {new Date(row.startsAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {row.status && (
                          <span
                            className="text-[10px] font-semibold capitalize px-2 py-0.5 rounded-full"
                            style={{ background: tone.bg, color: tone.color, border: `1px solid ${tone.border}` }}
                          >
                            {String(row.status).replaceAll('_', ' ')}
                          </span>
                        )}
                      </div>

                      <div className="flex items-start gap-2.5">
                        <span
                          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                        >
                          <UserRound size={14} />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold text-fg truncate">{row.customerName}</p>
                          <p className="text-[12.5px] text-fg-muted mt-0.5 leading-snug">
                            {row.serviceName}
                          </p>
                          {row.staffName && (
                            <p className="text-[12px] text-fg-2 mt-1">Stylist · {row.staffName}</p>
                          )}
                          {(row.phone || row.customerPhone) && (
                            <p className="text-[12px] text-fg-muted mt-1">{row.phone || row.customerPhone}</p>
                          )}
                        </div>
                      </div>

                      {canMove && !isOwner && !['completed', 'billed', 'cancelled', 'no_show', 'joined'].includes(row.status) && (
                        <button
                          type="button"
                          className="mt-3 text-[12px] font-medium"
                          style={{ color: 'var(--brand)' }}
                          onClick={() => setMoving(row)}
                        >
                          Move appointment
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {moving && (
        <MoveDialog
          row={moving}
          onClose={() => setMoving(null)}
          onSaved={() => { setMoving(null); setReload(n => n + 1) }}
        />
      )}
    </div>
  )
}
