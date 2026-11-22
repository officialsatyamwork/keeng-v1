import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { get, patch } from '../../lib/api'

function toLocalInput(iso) {
  const d = new Date(iso)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function MoveDialog({ row, onClose, onSaved }) {
  const [when, setWhen] = useState(toLocalInput(row.startsAt))
  const [staffUserId, setStaffUserId] = useState(row.staffUserId || '')
  const [staff, setStaff] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    get(`/staff?salonId=${row.salonId}`).then(setStaff).catch(err => setError(err.message))
  }, [row.salonId])

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await patch(`/appointments/${row.id}`, {
        startsAt: new Date(when).toISOString(),
        staffUserId,
      })
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={save} onClick={e => e.stopPropagation()} className="glass-card rounded-2xl p-5 w-full max-w-md space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-fg font-semibold">Move booking</p>
          <button type="button" onClick={onClose} aria-label="Close" className="btn-icon-close"><X size={17} strokeWidth={2.25} /></button>
        </div>
        <p className="text-[13px] text-fg-2">{row.customerName} · {row.serviceName}</p>
        {error && <p className="text-[13px]" style={{ color: 'var(--danger)' }}>{error}</p>}
        <label className="block text-[12px] text-fg-muted">New time
          <input required type="datetime-local" className="input-field text-sm mt-1" value={when} onChange={e => setWhen(e.target.value)} />
        </label>
        <label className="block text-[12px] text-fg-muted">Stylist
          <select required className="input-field text-sm mt-1" value={staffUserId} onChange={e => setStaffUserId(e.target.value)}>
            <option value="">Choose a stylist</option>
            {staff.filter(person => !person.serviceIds?.length || person.serviceIds.includes(row.serviceId)).map(person => (
              <option key={person.userId} value={person.userId}>
                {person.fullName}{person.jobTitle ? ` · ${person.jobTitle}` : ''}
              </option>
            ))}
          </select>
        </label>
        <button disabled={saving} className="btn-primary w-full py-2.5 rounded-xl text-sm">{saving ? 'Saving…' : 'Save new time'}</button>
      </form>
    </div>
  )
}
