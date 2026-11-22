import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { get, patch, post } from '../../lib/api'
import { useAuth } from '../../store/auth'
import { SalonPicker, inr, useDeskSalon } from './useDeskSalon.jsx'

const empty = { fullName: '', phone: '', email: '', notes: '', dateOfBirth: '', allergies: '', preferences: '' }
const when = value => value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const day = value => value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

export default function CustomersPage() {
  const desk = useDeskSalon()
  const role = useAuth(s => s.user?.role)
  const canShare = ['admin', 'manager', 'master_admin'].includes(role)
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)
  const [filter, setFilter] = useState('all')
  const [file, setFile] = useState(null)
  const [visits, setVisits] = useState(null)

  const load = useCallback(() => {
    if (!desk.salonId) return
    setError('')
    get(`/customers?salonId=${desk.salonId}`).then(setRows).catch(e => setError(e.message))
  }, [desk.salonId])
  useEffect(load, [load])

  const shown = useMemo(() => {
    const list = rows || []
    const filtered = list.filter(row => {
      if (filter === 'birthday') return row.birthdaySoon
      if (filter === 'due') return row.dueBack
      if (filter === 'recent') return row.daysSinceVisit != null && row.daysSinceVisit <= 7
      return true
    })
    return filtered.sort((a, b) => {
      const rank = row => row.birthdaySoon ? 0 : row.dueBack ? 1 : 2
      return rank(a) - rank(b) || (a.daysSinceVisit ?? 999) - (b.daysSinceVisit ?? 999)
    })
  }, [rows, filter])

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    try {
      await post('/customers', {
        salonId: desk.salonId,
        fullName: form.fullName.trim(),
        phone: form.phone || null,
        email: form.email || null,
        notes: form.notes || null,
        dateOfBirth: form.dateOfBirth || null,
        allergies: form.allergies.trim() || null,
        preferences: form.preferences.trim() || null,
      })
      setOpen(false)
      setForm(empty)
      load()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const openFile = async (row) => {
    setFile({ ...row, dateOfBirth: row.dateOfBirth || '' })
    setVisits(null)
    try {
      setVisits(await get(`/customers/${row.id}/visits`))
    } catch (err) {
      setError(err.message)
    }
  }

  const saveFile = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const saved = await patch(`/customers/${file.id}`, {
        notes: file.notes || null,
        shareAcrossBranches: file.shareAcrossBranches !== false,
        dateOfBirth: file.dateOfBirth || null,
        allergies: file.allergies || null,
        preferences: file.preferences || null,
      })
      setFile(current => ({ ...current, ...saved, dateOfBirth: saved.dateOfBirth || '' }))
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <SalonPicker {...desk} />
        {['all', 'recent', 'due', 'birthday'].map(key => (
          <button key={key} onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-sm capitalize ${filter === key ? 'bg-violet-600 text-white' : 'glass text-fg-2'}`}>
            {key === 'due' ? 'Due back' : key === 'recent' ? 'Seen this week' : key === 'birthday' ? 'Birthday soon' : 'All'}
          </button>
        ))}
        <button onClick={() => { setFormError(''); setOpen(true) }} disabled={!desk.salonId} className="btn-primary ml-auto px-3 py-2 rounded-xl text-sm inline-flex items-center gap-1.5">
          <Plus size={15} /> Add customer
        </button>
      </div>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="grid xl:grid-cols-2 gap-3">
        {shown.map(row => (
          <button key={row.id} onClick={() => openFile(row)} className="glass rounded-2xl p-4 text-left space-y-2">
            <div className="flex justify-between gap-3">
              <div>
                <p className="text-fg font-semibold">{row.fullName}</p>
                <p className="text-[12.5px] text-fg-muted">{row.phone || 'No phone'}{row.email ? ` · ${row.email}` : ''}</p>
              </div>
              <div className="text-right text-[12px] text-fg-muted">
                <p>{row.visits} visits · {row.loyaltyPoints} pts</p>
                <p>{row.daysSinceVisit == null ? 'No completed visit' : `${row.daysSinceVisit} ${row.daysSinceVisit === 1 ? 'day' : 'days'} since last visit`}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {row.birthdaySoon && <span className="text-[11px] px-2 py-0.5 rounded-md" style={{ background: 'var(--gold-soft)', color: 'var(--gold-text)' }}>Birthday in {row.daysUntilBirthday} days</span>}
              {row.dueBack && <span className="text-[11px] px-2 py-0.5 rounded-md" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>Due for a visit</span>}
              {row.allergies && <span className="text-[11px] px-2 py-0.5 rounded-md" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>Allergy on file</span>}
            </div>
            <p className="text-[12.5px] text-fg-2">Usual stylist: {row.usualStaff || 'Not yet'} · First visit {day(row.firstVisitAt)} · Next {day(row.nextVisitAt)}</p>
            {row.allergies && <p className="text-[12.5px]" style={{ color: 'var(--warning)' }}>{row.allergies}</p>}
            {row.recentVisits?.slice(0, 2).map(visit => (
              <p key={visit.id} className="text-[12px] text-fg-muted">
                {day(visit.startsAt)} · {visit.serviceName} · {visit.staffName || 'Unassigned'} · {visit.status.replaceAll('_', ' ')}
              </p>
            ))}
          </button>
        ))}
      </div>
      {rows && shown.length === 0 && <div className="glass rounded-2xl p-10 text-center text-sm text-fg-muted">No customers in this view.</div>}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <form onSubmit={save} onClick={e => e.stopPropagation()} className="glass-card rounded-2xl p-5 w-full max-w-md space-y-3 max-h-[85vh] overflow-auto">
            <div className="flex justify-between items-center gap-3"><p className="font-semibold text-fg">New customer</p><button type="button" aria-label="Close" className="btn-icon-close" onClick={() => setOpen(false)}><X size={17} strokeWidth={2.25} /></button></div>
            <input required className="input-field text-sm" placeholder="Full name" value={form.fullName} onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))} />
            <input required className="input-field text-sm" inputMode="numeric" placeholder="10-digit phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
            <input className="input-field text-sm" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            <input type="date" className="input-field text-sm" value={form.dateOfBirth} onChange={e => setForm(f => ({ ...f, dateOfBirth: e.target.value }))} />
            <textarea className="input-field text-sm min-h-[64px]" placeholder="Allergies" value={form.allergies} onChange={e => setForm(f => ({ ...f, allergies: e.target.value }))} />
            <textarea className="input-field text-sm min-h-[64px]" placeholder="How they like their service" value={form.preferences} onChange={e => setForm(f => ({ ...f, preferences: e.target.value }))} />
            <textarea className="input-field text-sm min-h-[64px]" placeholder="Desk notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            {formError && <p className="text-sm" style={{ color: 'var(--danger)' }}>{formError}</p>}
            <button disabled={saving} className="btn-primary w-full py-2.5 rounded-xl text-sm">Save</button>
          </form>
        </div>
      )}

      {file && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setFile(null)}>
          <form onSubmit={saveFile} onClick={e => e.stopPropagation()} className="glass-card rounded-2xl p-5 w-full max-w-lg space-y-3 max-h-[85vh] overflow-auto">
            <div className="flex justify-between gap-3">
              <div>
                <p className="font-semibold text-fg">{file.fullName}</p>
                <p className="text-[12.5px] text-fg-muted">{file.phone}{file.email ? ` · ${file.email}` : ''}</p>
              </div>
              <button type="button" aria-label="Close" className="btn-icon-close" onClick={() => setFile(null)}><X size={17} strokeWidth={2.25} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[12.5px] text-fg-2">
              <p>First visit<br /><span className="text-fg">{day(file.firstVisitAt)}</span></p>
              <p>Last completed<br /><span className="text-fg">{day(file.lastVisitAt)}</span></p>
              <p>Next booking<br /><span className="text-fg">{day(file.nextVisitAt)}</span></p>
              <p>Usual stylist<br /><span className="text-fg">{file.usualStaff || 'Not yet'}</span></p>
            </div>
            {canShare && (
              <label className="flex items-center gap-2 text-sm text-fg-2">
                <input type="checkbox" checked={file.shareAcrossBranches !== false}
                  onChange={e => setFile(current => ({ ...current, shareAcrossBranches: e.target.checked }))} />
                Share this customer with other branches
              </label>
            )}
            <label className="block text-[12px] text-fg-muted">Date of birth
              <input type="date" className="input-field text-sm mt-1" value={file.dateOfBirth || ''} onChange={e => setFile(f => ({ ...f, dateOfBirth: e.target.value }))} />
            </label>
            <label className="block text-[12px] text-fg-muted">Allergies
              <textarea className="input-field text-sm mt-1 min-h-[64px]" value={file.allergies || ''} onChange={e => setFile(f => ({ ...f, allergies: e.target.value }))} />
            </label>
            <label className="block text-[12px] text-fg-muted">How they like their service
              <textarea className="input-field text-sm mt-1 min-h-[64px]" value={file.preferences || ''} onChange={e => setFile(f => ({ ...f, preferences: e.target.value }))} />
            </label>
            <label className="block text-[12px] text-fg-muted">Desk notes
              <textarea className="input-field text-sm mt-1 min-h-[64px]" value={file.notes || ''} onChange={e => setFile(f => ({ ...f, notes: e.target.value }))} />
            </label>
            <button disabled={saving} className="btn-primary px-3 py-2 rounded-xl text-sm">Save file</button>
            <p className="text-[13px] font-semibold text-fg pt-2">Every visit, from the first</p>
            {visits && visits.length === 0 && <p className="text-sm text-fg-muted">No visits yet.</p>}
            {(visits || []).map(visit => (
              <div key={visit.id} className="text-[13px] py-2" style={{ borderTop: '1px solid var(--border)' }}>
                <p className="text-fg">{visit.serviceName} · {visit.status.replaceAll('_', ' ')} · {inr.format(visit.price)}</p>
                <p className="text-fg-muted">{when(visit.startsAt)} · {visit.staffName || 'Unassigned'} · {visit.salonName}</p>
                {visit.notes && <p className="text-fg-2">{visit.notes}</p>}
              </div>
            ))}
          </form>
        </div>
      )}
    </div>
  )
}
