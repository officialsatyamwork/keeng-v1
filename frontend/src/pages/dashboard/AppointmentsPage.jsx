import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { get, patch, post } from '../../lib/api'
import { useAuth } from '../../store/auth'
import MoveDialog from './MoveDialog.jsx'
import { SalonPicker, inr, useDeskSalon } from './useDeskSalon.jsx'

const STATUSES = ['all', 'booked', 'confirmed', 'checked_in', 'in_service', 'billed', 'no_show', 'cancelled']
const CLOSED = new Set(['completed', 'billed', 'cancelled', 'no_show'])
const label = s => String(s || '').replaceAll('_', ' ')

const emptyBook = { salonId: '', serviceId: '', staffUserId: '', customerId: '', customerName: '', customerPhone: '', customerEmail: '', when: '', source: 'desk', notes: '' }
const localDay = () => {
  const day = new Date()
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}
const dayOptions = () => Array.from({ length: 14 }, (_, i) => {
  const day = new Date()
  day.setDate(day.getDate() + i)
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
  return { key, label: day.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) }
})

export default function AppointmentsPage() {
  const user = useAuth(s => s.user)
  const desk = useDeskSalon()
  const isCustomer = user?.role === 'customer'
  const isStaff = user?.role === 'staff'
  const canMove = !isCustomer && !isStaff
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyBook)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [options, setOptions] = useState({ salons: [], services: [], staff: [], customers: [] })
  const [moving, setMoving] = useState(null)
  const [bills, setBills] = useState([])
  const [step, setStep] = useState(1)
  const [slots, setSlots] = useState([])
  const [chosen, setChosen] = useState(null)
  const [slotDay, setSlotDay] = useState(localDay)
  const [done, setDone] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const savingStatus = useRef(false)

  const load = useCallback(() => {
    setError('')
    const params = new URLSearchParams()
    if (!isCustomer && desk.salonId) params.set('salonId', desk.salonId)
    get(`/appointments${params.size ? `?${params}` : ''}`)
      .then(setRows)
      .catch(e => setError(e.message))
    if (isCustomer) get('/me/bills').then(setBills).catch(() => setBills([]))
  }, [desk.salonId, isCustomer])

  useEffect(load, [load])

  const openBook = async () => {
    setForm({ ...emptyBook, salonId: isCustomer ? '' : desk.salonId, source: 'desk', staffUserId: isStaff ? user.id : 'any' })
    setFormError('')
    setStep(1)
    setChosen(null)
    setSlots([])
    setOpen(true)
    if (isCustomer) {
      const salons = await get('/public/salons').catch(() => [])
      setOptions({ salons, services: [], staff: [], customers: [] })
    }
  }

  useEffect(() => {
    if (!open || !form.salonId) return
    const salonId = form.salonId
    Promise.all([
      get(`/services?salonId=${salonId}`).catch(() => []),
      get(`/staff?salonId=${salonId}`).catch(() => []),
      isCustomer ? Promise.resolve([]) : get(`/customers?salonId=${salonId}`).catch(() => []),
    ]).then(([services, staff, customers]) => setOptions(o => ({ ...o, services, staff, customers })))
  }, [open, form.salonId, isCustomer])

  useEffect(() => {
    if (!open || step < 2 || !form.salonId || !form.serviceId || !slotDay) return
    const params = new URLSearchParams({ salonId: form.salonId, serviceId: form.serviceId, day: slotDay })
    if (form.staffUserId && form.staffUserId !== 'any') params.set('staffUserId', form.staffUserId)
    get(`/appointments/slots?${params}`).then(setSlots).catch(err => setFormError(err.message))
  }, [open, step, form.salonId, form.serviceId, form.staffUserId, slotDay])

  const detailsError = () => {
    if (!form.salonId) return 'Choose a salon'
    if (!form.serviceId) return 'Choose a service'
    if (!isCustomer && !form.customerId) {
      if (!form.customerName.trim()) return 'Enter the customer name before continuing'
      if (!/^\d{10}$/.test(form.customerPhone)) return 'Enter a 10-digit phone number'
      if (form.customerEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail.trim())) return 'Enter a valid email for the confirmation'
    }
    return ''
  }

  const book = async () => {
    const missing = detailsError()
    if (missing) { setFormError(missing); setStep(1); return }
    if (!chosen) { setFormError('Pick a time slot'); setStep(2); return }
    setSaving(true)
    setFormError('')
    try {
      const body = {
        salonId: form.salonId,
        serviceId: form.serviceId,
        startsAt: chosen.startsAt,
        staffUserId: chosen.staffUserId,
        notes: form.notes || null,
        source: isCustomer ? 'online' : form.source,
      }
      const typedName = form.customerName.trim()
      const known = !isCustomer && !form.customerId
        ? options.customers.find(c => c.phone && c.phone === form.customerPhone.trim())
        : null
      if (!isCustomer) {
        if (form.customerId) body.customerId = form.customerId
        else if (known) body.customerId = known.id
        else {
          body.customerName = typedName
          body.customerPhone = form.customerPhone.trim()
          if (form.customerEmail.trim()) body.customerEmail = form.customerEmail.trim()
        }
      }
      const saved = await post('/appointments', body)
      const service = options.services.find(s => s.id === form.serviceId)
      const customer = saved.customerName || known?.fullName || (form.customerId
        ? options.customers.find(c => c.id === form.customerId)?.fullName
        : typedName) || user.fullName
      const reused = !form.customerId && typedName && customer.toLowerCase() !== typedName.toLowerCase()
      setDone({
        customer,
        reused,
        service: service?.name || 'Appointment',
        when: `${chosen.label} · ${new Date(`${slotDay}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`,
        staff: chosen.staffName,
      })
      setOpen(false)
      load()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const setStatus = async (id, status) => {
    if (savingStatus.current) return
    savingStatus.current = true
    setBusyId(id)
    setError('')
    const shown = status === 'completed' ? 'billed' : status
    setRows(current => (current || []).map(row => row.id === id ? { ...row, status: shown } : row))
    try {
      const saved = await patch(`/appointments/${id}`, { status })
      setRows(current => (current || []).map(row => row.id === id ? saved : row))
    } catch (err) {
      setError(err.message)
      load()
    } finally {
      savingStatus.current = false
      setBusyId(null)
    }
  }

  const filtered = (rows || []).filter(row => {
    const hay = `${row.customerName} ${row.serviceName} ${row.staffName || ''}`.toLowerCase()
    return hay.includes(search.toLowerCase()) && (filter === 'all' || row.status === filter)
  })

  return (
    <div className="space-y-5 w-full">
      {!open && (
      <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-fg tracking-tight">Appointments</h1>
          <p className="text-[12.5px] text-fg-muted mt-0.5">
            {rows ? `${filtered.length} shown` : 'Loading bookings…'}
            {filter !== 'all' ? ` · ${label(filter)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:justify-end">
          {!isCustomer && <SalonPicker {...desk} />}
          <div className="relative w-full sm:w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search guest or service"
              className="input-field pl-9 text-sm py-2 w-full"
            />
          </div>
          <button onClick={openBook} className="btn-primary px-3.5 py-2 rounded-xl text-sm inline-flex items-center gap-1.5 whitespace-nowrap">
            <Plus size={15} /> Book
          </button>
        </div>
      </div>

      <div
        className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1"
        style={{ scrollbarWidth: 'thin' }}
      >
        {STATUSES.map(s => {
          const active = filter === s
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className="px-3 py-1.5 rounded-full text-[12.5px] font-medium capitalize whitespace-nowrap transition-colors"
              style={active
                ? { background: 'var(--brand)', color: '#fff' }
                : { background: 'var(--surface)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
            >
              {label(s)}
            </button>
          )
        })}
      </div>

      {isCustomer && bills.some(bill => bill.status === 'unpaid') && (
        <div className="glass-card rounded-2xl p-4 space-y-2">
          <p className="text-fg font-semibold">Bills to pay</p>
          <p className="text-[12.5px] text-fg-muted">Paying here updates the bill, your points, and the salon’s records. Cash is still paid at the desk.</p>
          {bills.filter(bill => bill.status === 'unpaid').map(bill => (
            <div key={bill.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-fg">{bill.number}</span>
              <span className="text-fg-2">{inr.format(bill.total)}</span>
              <button className="btn-primary px-2.5 py-1 rounded-lg text-[12px]" onClick={() => post(`/me/bills/${bill.id}/pay`, { payMethod: 'upi' }).then(load).catch(err => setError(err.message))}>Pay by UPI</button>
              <button className="btn-ghost px-2.5 py-1 rounded-lg text-[12px]" onClick={() => post(`/me/bills/${bill.id}/pay`, { payMethod: 'card' }).then(load).catch(err => setError(err.message))}>Pay by card</button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      {!rows && !error && <div className="glass rounded-2xl h-40 animate-pulse" />}

      {rows && filtered.length === 0 && (
        <div
          className="rounded-2xl px-6 py-14 text-center"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
        >
          <p className="text-[15px] font-semibold text-fg">No appointments</p>
          <p className="text-[13px] text-fg-muted mt-1 max-w-sm mx-auto">
            {search || filter !== 'all'
              ? 'Nothing matches this filter. Try another status or clear search.'
              : 'Book the first visit to see it here.'}
          </p>
          {!search && filter === 'all' && (
            <button onClick={openBook} className="btn-primary mt-5 px-4 py-2.5 rounded-xl text-sm inline-flex items-center gap-1.5">
              <Plus size={15} /> Book appointment
            </button>
          )}
        </div>
      )}

      {filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(row => (
            <div
              key={row.id}
              className="rounded-2xl px-4 py-3.5 flex flex-col lg:flex-row lg:items-center gap-3"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
            >
              <div className="min-w-0 lg:w-[180px]">
                <p className="text-fg font-semibold text-[14px] truncate">{row.customerName}</p>
                <p className="text-[12px] text-fg-muted truncate">{row.customerPhone || row.salonName}</p>
              </div>
              <div className="min-w-0 flex-1 text-[13px]">
                <p className="text-fg truncate">{row.serviceName} · {row.durationMinutes} min</p>
                <p className="text-fg-muted">
                  {new Date(row.startsAt).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  <span className="text-fg-muted"> · {row.staffName || 'Unassigned'}</span>
                </p>
              </div>
              <div className="flex items-center gap-2.5 flex-wrap lg:justify-end">
                <p className="text-[13px] font-medium text-fg whitespace-nowrap">{inr.format(row.price)}</p>
                <span
                  className="text-[11px] font-medium capitalize px-2.5 py-1 rounded-full whitespace-nowrap"
                  style={{ background: 'var(--brand-soft)', color: 'var(--brand)', border: '1px solid var(--border-brand)' }}
                >
                  {label(row.status)}
                </span>
                <div className="flex gap-1.5 flex-wrap">
                  {canMove && !CLOSED.has(row.status) && (
                    <button type="button" disabled={busyId === row.id} className="btn-ghost text-[12px] px-2.5 py-1 rounded-lg disabled:opacity-50" onClick={() => setMoving(row)}>Move</button>
                  )}
                  {(isStaff || !isCustomer) && !CLOSED.has(row.status) && (
                    <>
                      {row.status === 'booked' && <button type="button" disabled={busyId === row.id} className="btn-ghost text-[12px] px-2.5 py-1 rounded-lg disabled:opacity-50" onClick={() => setStatus(row.id, 'confirmed')}>{busyId === row.id ? 'Confirming…' : 'Confirm'}</button>}
                      {['booked', 'confirmed'].includes(row.status) && <button type="button" disabled={busyId === row.id} className="btn-ghost text-[12px] px-2.5 py-1 rounded-lg disabled:opacity-50" onClick={() => setStatus(row.id, 'checked_in')}>Check in</button>}
                      {row.status === 'checked_in' && <button type="button" disabled={busyId === row.id} className="btn-ghost text-[12px] px-2.5 py-1 rounded-lg disabled:opacity-50" onClick={() => setStatus(row.id, 'in_service')}>Start</button>}
                      {['booked', 'confirmed'].includes(row.status) && <button type="button" disabled={busyId === row.id} className="btn-ghost text-[12px] px-2.5 py-1 rounded-lg disabled:opacity-50" onClick={() => setStatus(row.id, 'no_show')}>No-show</button>}
                      {(row.status === 'checked_in' || row.status === 'in_service' || new Date(row.startsAt).getTime() <= Date.now()) && (
                        <button type="button" disabled={busyId === row.id} className="btn-ghost text-[12px] px-2.5 py-1 rounded-lg disabled:opacity-50" onClick={() => setStatus(row.id, 'completed')}>Complete</button>
                      )}
                    </>
                  )}
                  {!CLOSED.has(row.status) && (isCustomer ? ['booked', 'confirmed'].includes(row.status) : true) && (
                    <button type="button" disabled={busyId === row.id} className="text-[12px] px-2.5 py-1 rounded-lg disabled:opacity-50" style={{ color: 'var(--danger)' }} onClick={() => setStatus(row.id, 'cancelled')}>Cancel</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      </>
      )}

      {open && (
        <form
          onSubmit={e => { e.preventDefault(); if (step === 3) book() }}
          className="w-full rounded-2xl overflow-hidden"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-5 sm:px-6 py-5" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="min-w-0">
              <h2 className="text-[18px] font-semibold text-fg tracking-tight">Book appointment</h2>
              <p className="text-[12.5px] text-fg-muted mt-0.5">
                {step === 1 ? 'Service and guest details' : step === 2 ? 'Pick an available time' : 'Review and confirm'}
              </p>
            </div>
            <div className="flex items-center gap-3 w-full sm:w-auto sm:min-w-[320px] sm:max-w-md">
              <div className="flex items-center gap-2 flex-1">
                {['Details', 'Time', 'Confirm'].map((name, index) => {
                  const n = index + 1
                  const active = step === n
                  const doneStep = step > n
                  return (
                    <div key={name} className="flex items-center gap-2 flex-1 min-w-0">
                      <span
                        className="w-6 h-6 rounded-full text-[11px] font-semibold flex items-center justify-center flex-shrink-0"
                        style={active || doneStep
                          ? { background: 'var(--brand)', color: '#fff' }
                          : { background: 'var(--bg-3)', color: 'var(--text-muted)' }}
                      >
                        {n}
                      </span>
                      <span className={`text-[12px] font-medium truncate hidden sm:inline ${active ? 'text-fg' : 'text-fg-muted'}`}>{name}</span>
                      {n < 3 && <span className="h-px flex-1 hidden sm:block" style={{ background: doneStep || active ? 'var(--brand)' : 'var(--border)' }} />}
                    </div>
                  )
                })}
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="btn-icon-close"
              >
                <X size={17} strokeWidth={2.25} />
              </button>
            </div>
          </div>

          <div className="px-5 sm:px-6 py-5 w-full">
            {formError && (
              <p className="text-[13px] rounded-xl px-3 py-2.5 mb-5" style={{ color: 'var(--danger)', background: 'var(--danger-soft)' }}>
                {formError}
              </p>
            )}

            {step === 1 && (
              <div className="space-y-5">
                <div className={`grid grid-cols-1 ${isCustomer ? 'lg:grid-cols-3' : 'lg:grid-cols-2'} gap-5`}>
                  <section className="rounded-xl p-4 sm:p-5 space-y-4" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                    <div>
                      <p className="text-[13px] font-semibold text-fg">Visit</p>
                      <p className="text-[12px] text-fg-muted mt-0.5">Salon, service and stylist</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <label className="block sm:col-span-2">
                        <span className="text-[12px] font-medium text-fg-2">Salon</span>
                        {isCustomer ? (
                          <select required className="input-field text-sm mt-1.5" value={form.salonId} onChange={e => setForm(f => ({ ...f, salonId: e.target.value, serviceId: '', staffUserId: 'any' }))}>
                            <option value="">Select salon</option>
                            {options.salons.map(s => <option key={s.id} value={s.id}>{s.businessName ? `${s.businessName} · ` : ''}{s.name}</option>)}
                          </select>
                        ) : (
                          <select required className="input-field text-sm mt-1.5" value={form.salonId} onChange={e => setForm(f => ({ ...f, salonId: e.target.value, serviceId: '', staffUserId: isStaff ? user.id : 'any', customerId: '' }))}>
                            <option value="">Select salon</option>
                            {desk.salons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                          </select>
                        )}
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="text-[12px] font-medium text-fg-2">Service</span>
                        <select required className="input-field text-sm mt-1.5" value={form.serviceId} onChange={e => setForm(f => ({ ...f, serviceId: e.target.value }))}>
                          <option value="">Select service</option>
                          {options.services.filter(s => s.isActive !== false).map(s => (
                            <option key={s.id} value={s.id}>{s.name} · {s.durationMinutes} min · {inr.format(s.price)}</option>
                          ))}
                        </select>
                        {form.salonId && options.services.length === 0 && (
                          <span className="block text-[12px] text-fg-muted mt-1.5">No services yet. Add one under Services first.</span>
                        )}
                      </label>
                      <label className="block sm:col-span-2">
                        <span className="text-[12px] font-medium text-fg-2">Stylist</span>
                        <select className="input-field text-sm mt-1.5" value={form.staffUserId} onChange={e => setForm(f => ({ ...f, staffUserId: e.target.value }))}>
                          <option value="any">Any available</option>
                          {options.staff.filter(person => !form.serviceId || !person.serviceIds?.length || person.serviceIds.includes(form.serviceId)).map(s => (
                            <option key={s.userId} value={s.userId}>{s.fullName}{s.jobTitle ? ` · ${s.jobTitle}` : ''}</option>
                          ))}
                        </select>
                      </label>
                      {!isCustomer && (
                        <label className="block sm:col-span-2">
                          <span className="text-[12px] font-medium text-fg-2">Source</span>
                          <select className="input-field text-sm mt-1.5" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
                            <option value="desk">Desk booking</option>
                            <option value="walk_in">Walk-in</option>
                          </select>
                        </label>
                      )}
                    </div>
                  </section>

                  {!isCustomer && (
                    <section className="rounded-xl p-4 sm:p-5 space-y-4" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                      <div>
                        <p className="text-[13px] font-semibold text-fg">Customer</p>
                        <p className="text-[12px] text-fg-muted mt-0.5">Existing guest or new profile</p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                        <label className="block sm:col-span-2">
                          <span className="text-[12px] font-medium text-fg-2">Customer</span>
                          <select className="input-field text-sm mt-1.5" value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value, customerName: '', customerPhone: '', customerEmail: '' }))}>
                            <option value="">New customer</option>
                            {options.customers.map(c => <option key={c.id} value={c.id}>{c.fullName}{c.phone ? ` · ${c.phone}` : ''}</option>)}
                          </select>
                        </label>
                        {!form.customerId && (
                          <>
                            <label className="block">
                              <span className="text-[12px] font-medium text-fg-2">Full name</span>
                              <input
                                className={`input-field text-sm mt-1.5 ${formError.includes('name') ? 'input-error' : ''}`}
                                placeholder="Guest name"
                                value={form.customerName}
                                onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                              />
                            </label>
                            <label className="block">
                              <span className="text-[12px] font-medium text-fg-2">Phone</span>
                              <input
                                className={`input-field text-sm mt-1.5 ${formError.includes('phone') ? 'input-error' : ''}`}
                                inputMode="numeric"
                                placeholder="10 digits"
                                value={form.customerPhone}
                                onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                              />
                            </label>
                            <label className="block sm:col-span-2">
                              <span className="text-[12px] font-medium text-fg-2">Email <span className="text-fg-muted font-normal">(optional)</span></span>
                              <input
                                className="input-field text-sm mt-1.5"
                                placeholder="For confirmation"
                                value={form.customerEmail}
                                onChange={e => setForm(f => ({ ...f, customerEmail: e.target.value }))}
                              />
                            </label>
                          </>
                        )}
                      </div>
                    </section>
                  )}

                  {isCustomer && (
                    <section className="rounded-xl p-4 sm:p-5 lg:col-span-2 flex items-center" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                      <p className="text-[13px] text-fg-2">Choose a salon and service, then continue to pick your time slot.</p>
                    </section>
                  )}
                </div>

                <div className="flex justify-end pt-1" style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="pt-4">
                    <button
                      type="button"
                      className="btn-primary px-6 py-2.5 rounded-xl text-sm"
                      onClick={() => {
                        const message = detailsError()
                        if (message) { setFormError(message); return }
                        setFormError('')
                        setChosen(null)
                        setStep(2)
                      }}
                    >
                      Continue to time
                    </button>
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                  <label className="block md:col-span-1">
                    <span className="text-[12px] font-medium text-fg-2">Date</span>
                    <select className="input-field text-sm mt-1.5" value={slotDay} onChange={e => { setSlotDay(e.target.value); setChosen(null) }}>
                      {dayOptions().map(day => <option key={day.key} value={day.key}>{day.label}</option>)}
                    </select>
                  </label>
                  <div className="md:col-span-3 flex md:justify-end items-center gap-2 text-[12.5px] text-fg-muted pb-1">
                    <span>{slots.length} open slot{slots.length === 1 ? '' : 's'}</span>
                    {chosen && <span className="text-fg font-medium">· Selected {chosen.label} · {chosen.staffName}</span>}
                  </div>
                </div>

                <div>
                  <p className="text-[12px] font-medium text-fg-2 mb-2.5">Available slots</p>
                  {slots.length === 0 ? (
                    <div className="rounded-xl px-4 py-12 text-center text-[13px] text-fg-muted" style={{ background: 'var(--bg-2)', border: '1px dashed var(--border)' }}>
                      No free slots this day. Try another date or stylist.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5">
                      {slots.map(slot => {
                        const on = chosen?.startsAt === slot.startsAt && chosen?.staffUserId === slot.staffUserId
                        return (
                          <button
                            type="button"
                            key={`${slot.startsAt}-${slot.staffUserId}`}
                            onClick={() => { setChosen(slot); setFormError('') }}
                            className="rounded-xl px-3 py-3 text-left transition-all"
                            style={on
                              ? { background: 'var(--brand-soft)', border: '1px solid var(--border-brand)', color: 'var(--text-primary)', boxShadow: 'inset 0 0 0 1px var(--brand)' }
                              : { background: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                          >
                            <span className="block text-[13px] font-semibold">{slot.label}</span>
                            <span className="block text-[11px] text-fg-muted mt-0.5 truncate">{slot.staffName}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="flex justify-between gap-2.5 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                  <button type="button" className="btn-ghost px-4 py-2.5 rounded-xl text-sm" onClick={() => setStep(1)}>Back</button>
                  <button
                    type="button"
                    className="btn-primary px-6 py-2.5 rounded-xl text-sm"
                    onClick={() => { if (!chosen) { setFormError('Pick a time'); return } setFormError(''); setStep(3) }}
                  >
                    Review booking
                  </button>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
                  {[
                    { label: 'Service', value: options.services.find(s => s.id === form.serviceId)?.name || '—' },
                    { label: 'When', value: chosen?.label || '—', sub: dayOptions().find(day => day.key === slotDay)?.label },
                    { label: 'Stylist', value: chosen?.staffName || '—' },
                    { label: 'Customer', value: form.customerId ? options.customers.find(c => c.id === form.customerId)?.fullName : form.customerName || user.fullName },
                  ].map(card => (
                    <div key={card.label} className="rounded-xl p-4" style={{ background: 'var(--bg-2)', border: '1px solid var(--border)' }}>
                      <p className="text-[11px] uppercase tracking-[0.08em] text-fg-muted font-semibold">{card.label}</p>
                      <p className="text-[14px] font-semibold text-fg mt-1.5">{card.value}</p>
                      {card.sub && <p className="text-[12px] text-fg-muted mt-0.5">{card.sub}</p>}
                    </div>
                  ))}
                </div>

                <label className="block">
                  <span className="text-[12px] font-medium text-fg-2">Notes <span className="text-fg-muted font-normal">(optional)</span></span>
                  <input
                    className="input-field text-sm mt-1.5"
                    placeholder="Any special request"
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </label>

                <div className="flex justify-between gap-2.5 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                  <button type="button" className="btn-ghost px-4 py-2.5 rounded-xl text-sm" onClick={() => setStep(2)}>Back</button>
                  <button type="submit" disabled={saving} className="btn-primary px-6 py-2.5 rounded-xl text-sm">
                    {saving ? 'Booking…' : 'Confirm booking'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </form>
      )}

      {done && !open && (
        <div
          className="rounded-2xl px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          style={{ background: 'var(--success-soft)', border: '1px solid var(--border)' }}
        >
          <div>
            <p className="text-fg font-semibold">Booking confirmed</p>
            <p className="text-[13px] text-fg-2 mt-0.5">
              {done.reused
                ? `${done.customer} is already a customer. This visit was added to that profile.`
                : `${done.customer} is booked for ${done.service}.`}
              {' '}
              <span className="text-fg-muted">{done.when} · {done.staff}</span>
            </p>
          </div>
          <button className="btn-ghost px-3 py-2 rounded-xl text-sm whitespace-nowrap" onClick={() => setDone(null)}>Dismiss</button>
        </div>
      )}
      {moving && <MoveDialog row={moving} onClose={() => setMoving(null)} onSaved={() => { setMoving(null); load() }} />}
    </div>
  )
}
