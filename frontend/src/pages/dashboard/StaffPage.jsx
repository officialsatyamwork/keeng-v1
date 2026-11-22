import { useCallback, useEffect, useState } from 'react'
import { del, download, get, patch, post, put } from '../../lib/api'
import { useAuth } from '../../store/auth'
import { SalonPicker, inr, useDeskSalon } from './useDeskSalon.jsx'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function monthKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export default function StaffPage() {
  const role = useAuth(s => s.user?.role)
  const canEdit = ['admin', 'manager', 'employee'].includes(role)
  const desk = useDeskSalon()
  const [rows, setRows] = useState(null)
  const [services, setServices] = useState([])
  const [error, setError] = useState('')
  const [leaveDay, setLeaveDay] = useState('')

  const load = useCallback(() => {
    if (!desk.salonId) return
    get(`/staff?salonId=${desk.salonId}`).then(setRows).catch(e => setError(e.message))
    get(`/services?salonId=${desk.salonId}`).then(setServices).catch(() => setServices([]))
  }, [desk.salonId])
  useEffect(load, [load])

  const savePlan = async (person, extra) => {
    try {
      await patch(`/staff/${person.userId}?salonId=${desk.salonId}`, extra)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const saveShift = async (person, weekday, startTime, endTime) => {
    const clip = value => String(value).slice(0, 5)
    const shifts = (person.shifts || []).filter(s => s.weekday !== weekday)
    if (startTime && endTime) shifts.push({ weekday, startTime: clip(startTime), endTime: clip(endTime) })
    try {
      await put(`/staff/${person.userId}/shifts`, { salonId: desk.salonId, shifts })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const saveBreak = async (person, weekday, startTime, endTime) => {
    const clip = value => String(value).slice(0, 5)
    const breaks = (person.breaks || []).filter(s => s.weekday !== weekday)
    if (startTime && endTime) breaks.push({ weekday, startTime: clip(startTime), endTime: clip(endTime) })
    try {
      await put(`/staff/${person.userId}/breaks`, { salonId: desk.salonId, breaks })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const saveSkills = async (person, serviceIds) => {
    try {
      await put(`/staff/${person.userId}/skills`, { salonId: desk.salonId, serviceIds })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const addLeave = async (person) => {
    if (!leaveDay) return
    try {
      await post(`/staff/${person.userId}/leave`, { salonId: desk.salonId, day: leaveDay })
      setLeaveDay('')
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const payMonth = async (person) => {
    try {
      await post(`/staff/${person.userId}/payout`, { salonId: desk.salonId, month: monthKey() })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <SalonPicker {...desk} />
      <p className="text-[13px] text-fg-muted">Pay is base salary for days worked, plus service and product commission on paid bills, plus incentive, minus advances. GST is not included. A slab pays the first rate up to the limit and the higher rate after that. Fixed pays a rupee amount per service. Leave every service unticked and the stylist can do all of them.</p>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="space-y-3">
        {(rows || []).map(person => (
          <div key={person.userId} className="glass rounded-2xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-fg font-semibold">{person.fullName}</p>
                <p className="text-[12.5px] text-fg-muted">{person.jobTitle || 'Team'}</p>
              </div>
              {person.monthPay != null && (
                <div className="text-right">
                  <p className="text-fg font-semibold">{inr.format(person.monthPay)}</p>
                  <p className="text-[12px] text-fg-muted">This month · {person.payoutStatus}</p>
                  {person.servicePay != null && <p className="text-[11px] text-fg-muted">Service {inr.format(person.servicePay)} · Product {inr.format(person.productPay)} · Salary {inr.format(person.salaryPay)}</p>}
                  {canEdit && person.payoutStatus !== 'paid' && (
                    <button className="btn-ghost mt-1 px-2 py-1 rounded-lg text-[12px]" onClick={() => payMonth(person)}>Mark month paid</button>
                  )}
                  <button className="btn-ghost mt-1 ml-1 px-2 py-1 rounded-lg text-[12px]" onClick={() => download(`/staff/${person.userId}/payslip?salonId=${desk.salonId}&month=${monthKey()}`, `payslip-${monthKey()}.pdf`).catch(err => setError(err.message))}>Payslip</button>
                </div>
              )}
            </div>
            {person.commissionPercent != null && (
              <div className="flex flex-wrap gap-3">
                <label className="text-[12.5px] text-fg-muted flex items-center gap-2">Plan
                  <select disabled={!canEdit} value={person.commissionKind || 'percent'} className="input-field text-sm py-1.5"
                    onChange={e => savePlan(person, { commissionKind: e.target.value })}>
                    <option value="percent">Percent</option>
                    <option value="slab">Slab</option>
                    <option value="fixed">Fixed amount</option>
                  </select>
                </label>
                <label className="text-[12.5px] text-fg-muted flex items-center gap-2">
                  Service %
                  <input defaultValue={person.commissionPercent} disabled={!canEdit} key={`${person.userId}-svc-${person.commissionPercent}`}
                    onBlur={e => canEdit && e.target.value !== String(person.commissionPercent) && savePlan(person, { commissionPercent: Number(e.target.value) })}
                    className="input-field text-sm w-20 py-1.5" />
                </label>
                <label className="text-[12.5px] text-fg-muted flex items-center gap-2">
                  Product %
                  <input defaultValue={person.productCommissionPercent} disabled={!canEdit} key={`${person.userId}-prd-${person.productCommissionPercent}`}
                    onBlur={e => canEdit && e.target.value !== String(person.productCommissionPercent) && savePlan(person, { productCommissionPercent: Number(e.target.value) })}
                    className="input-field text-sm w-20 py-1.5" />
                </label>
                {person.commissionKind === 'slab' && (
                  <>
                    <label className="text-[12.5px] text-fg-muted flex items-center gap-2">Up to ₹
                      <input defaultValue={person.slabUpto} key={`${person.userId}-upto`} className="input-field text-sm w-24 py-1.5" disabled={!canEdit}
                        onBlur={e => savePlan(person, { slabUpto: Number(e.target.value) })} />
                    </label>
                    <label className="text-[12.5px] text-fg-muted flex items-center gap-2">Then %
                      <input defaultValue={person.slabPercent} key={`${person.userId}-low`} className="input-field text-sm w-16 py-1.5" disabled={!canEdit}
                        onBlur={e => savePlan(person, { slabPercent: Number(e.target.value) })} />
                    </label>
                    <label className="text-[12.5px] text-fg-muted flex items-center gap-2">After %
                      <input defaultValue={person.slabAfterPercent} key={`${person.userId}-high`} className="input-field text-sm w-16 py-1.5" disabled={!canEdit}
                        onBlur={e => savePlan(person, { slabAfterPercent: Number(e.target.value) })} />
                    </label>
                  </>
                )}
                {person.commissionKind === 'fixed' && (
                  <label className="text-[12.5px] text-fg-muted flex items-center gap-2">₹ per service
                    <input defaultValue={person.fixedAmount} key={`${person.userId}-fix`} className="input-field text-sm w-20 py-1.5" disabled={!canEdit}
                      onBlur={e => savePlan(person, { fixedAmount: Number(e.target.value) })} />
                  </label>
                )}
                <label className="text-[12.5px] text-fg-muted flex items-center gap-2">Salary
                  <input defaultValue={person.baseSalary || 0} key={`${person.userId}-sal`} className="input-field text-sm w-24 py-1.5" disabled={!canEdit}
                    onBlur={e => savePlan(person, { baseSalary: Number(e.target.value) })} />
                </label>
                <label className="text-[12.5px] text-fg-muted flex items-center gap-2">Incentive
                  <input defaultValue={person.incentive || 0} key={`${person.userId}-inc`} className="input-field text-sm w-20 py-1.5" disabled={!canEdit}
                    onBlur={e => savePlan(person, { incentive: Number(e.target.value) })} />
                </label>
                <label className="text-[12.5px] text-fg-muted flex items-center gap-2">Advance
                  <input defaultValue={person.advance || 0} key={`${person.userId}-adv`} className="input-field text-sm w-20 py-1.5" disabled={!canEdit}
                    onBlur={e => savePlan(person, { advance: Number(e.target.value) })} />
                </label>
              </div>
            )}
            {canEdit && (
              <div className="flex flex-wrap gap-2">
                {services.filter(row => row.isActive).map(service => {
                  const on = (person.serviceIds || []).includes(service.id)
                  return (
                    <button key={service.id} type="button"
                      onClick={() => saveSkills(person, on ? person.serviceIds.filter(id => id !== service.id) : [...(person.serviceIds || []), service.id])}
                      className={`px-2.5 py-1 rounded-lg text-[12px] ${on ? 'bg-violet-600 text-white' : 'glass text-fg-2'}`}>
                      {service.name}
                    </button>
                  )
                })}
              </div>
            )}
            {canEdit && (
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                {DAYS.map((day, weekday) => {
                  const shift = (person.shifts || []).find(s => s.weekday === weekday)
                  const brk = (person.breaks || []).find(s => s.weekday === weekday)
                  return (
                    <div key={day} className="text-[12px]">
                      <p className="text-fg-muted mb-1">{day} shift</p>
                      <div className="flex gap-1">
                        <input type="time" defaultValue={shift?.startTime || ''} key={`${person.userId}-ss-${weekday}-${shift?.startTime || ''}`} className="input-field text-xs py-1"
                          onBlur={e => {
                            const end = e.target.parentElement.querySelector('[data-end]').value
                            if (e.target.value && end) saveShift(person, weekday, e.target.value, end)
                          }} />
                        <input type="time" data-end defaultValue={shift?.endTime || ''} key={`${person.userId}-se-${weekday}-${shift?.endTime || ''}`} className="input-field text-xs py-1"
                          onBlur={e => {
                            const start = e.target.parentElement.querySelector('input').value
                            if (start && e.target.value) saveShift(person, weekday, start, e.target.value)
                          }} />
                      </div>
                      <p className="text-fg-muted mt-2 mb-1">Break</p>
                      <div className="flex gap-1">
                        <input type="time" defaultValue={brk?.startTime || ''} key={`${person.userId}-bs-${weekday}-${brk?.startTime || ''}`} className="input-field text-xs py-1"
                          onBlur={e => {
                            const end = e.target.parentElement.querySelector('[data-bend]').value
                            saveBreak(person, weekday, e.target.value, end)
                          }} />
                        <input type="time" data-bend defaultValue={brk?.endTime || ''} key={`${person.userId}-be-${weekday}-${brk?.endTime || ''}`} className="input-field text-xs py-1"
                          onBlur={e => {
                            const start = e.target.parentElement.querySelector('input').value
                            saveBreak(person, weekday, start, e.target.value)
                          }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {!canEdit && person.shifts?.length > 0 && (
              <p className="text-[12.5px] text-fg-muted">
                {person.shifts.map(s => `${DAYS[s.weekday]} ${s.startTime}–${s.endTime}`).join(' · ')}
              </p>
            )}
            {(person.leave || []).length > 0 && (
              <div className="flex flex-wrap gap-2 text-[12.5px]">
                {person.leave.map(item => (
                  <span key={item.id} className="glass rounded-lg px-2 py-1 text-fg-2">
                    Leave {item.day}
                    {canEdit && (
                      <button type="button" className="ml-2 text-fg-muted" onClick={() => del(`/staff/${person.userId}/leave/${item.id}`).then(load).catch(err => setError(err.message))}>Remove</button>
                    )}
                  </span>
                ))}
              </div>
            )}
            {canEdit && (
              <div className="flex gap-2 items-center">
                <input type="date" className="input-field text-sm py-1.5" value={leaveDay} onChange={e => setLeaveDay(e.target.value)} />
                <button type="button" className="btn-ghost px-2.5 py-1.5 rounded-lg text-sm" onClick={() => addLeave(person)}>Add leave</button>
              </div>
            )}
          </div>
        ))}
      </div>
      {rows && rows.length === 0 && <div className="glass rounded-2xl p-10 text-center text-sm text-fg-muted">No staff assigned to this salon yet.</div>}
    </div>
  )
}
