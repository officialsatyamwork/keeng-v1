import { useCallback, useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { get, patch, post } from '../../lib/api'
import { SalonPicker, inr, useDeskSalon } from './useDeskSalon.jsx'

const empty = { name: '', category: 'General', durationMinutes: 45, price: '', gstRate: 18 }

export default function ServicesPage() {
  const desk = useDeskSalon()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    if (!desk.salonId) return
    get(`/services?salonId=${desk.salonId}`).then(setRows).catch(e => setError(e.message))
  }, [desk.salonId])
  useEffect(load, [load])

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const body = {
        name: form.name.trim(),
        category: form.category.trim() || 'General',
        durationMinutes: Number(form.durationMinutes),
        price: Number(form.price),
        gstRate: Number(form.gstRate),
      }
      if (editing) await patch(`/services/${editing}`, body)
      else await post('/services', { ...body, salonId: desk.salonId })
      setOpen(false)
      setEditing(null)
      setForm(empty)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const toggle = async (row) => {
    try {
      await patch(`/services/${row.id}`, { isActive: !row.isActive })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SalonPicker {...desk} />
        <button onClick={() => { setEditing(null); setForm(empty); setOpen(true) }} disabled={!desk.salonId} className="btn-primary ml-auto px-3 py-2 rounded-xl text-sm inline-flex items-center gap-1.5">
          <Plus size={15} /> Add service
        </button>
      </div>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {(rows || []).map(row => (
          <div key={row.id} className="glass rounded-2xl p-4">
            <div className="flex justify-between gap-2">
              <p className="text-[12px] uppercase tracking-wide text-fg-muted">{row.category}</p>
              <button onClick={() => toggle(row)} className="text-[12px]" style={{ color: row.isActive ? 'var(--success)' : 'var(--danger)' }}>
                {row.isActive ? 'Active' : 'Hidden'}
              </button>
            </div>
            <p className="text-fg font-semibold mt-1">{row.name}</p>
            <p className="text-[13px] text-fg-muted mt-1">{row.durationMinutes} min · {inr.format(row.price)} · GST {row.gstRate}%</p>
            <button type="button" onClick={() => {
              setEditing(row.id)
              setForm({ name: row.name, category: row.category, durationMinutes: row.durationMinutes, price: row.price, gstRate: row.gstRate ?? 18 })
              setOpen(true)
            }} className="btn-ghost mt-3 px-2.5 py-1 rounded-lg text-[12px]">Edit</button>
          </div>
        ))}
      </div>
      {rows && rows.length === 0 && <div className="glass rounded-2xl p-10 text-center text-sm text-fg-muted">No services yet. Add the first one for this salon.</div>}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <form onSubmit={save} onClick={e => e.stopPropagation()} className="glass-card rounded-2xl p-5 w-full max-w-md space-y-3">
            <div className="flex justify-between items-center gap-3"><p className="font-semibold text-fg">{editing ? 'Edit service' : 'New service'}</p><button type="button" aria-label="Close" className="btn-icon-close" onClick={() => { setOpen(false); setEditing(null) }}><X size={17} strokeWidth={2.25} /></button></div>
            <input required className="input-field text-sm" placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className="input-field text-sm" placeholder="Category" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <input required type="number" min="5" className="input-field text-sm" placeholder="Minutes" value={form.durationMinutes} onChange={e => setForm(f => ({ ...f, durationMinutes: e.target.value }))} />
              <input required type="number" min="0" className="input-field text-sm" placeholder="Price" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
            </div>
            <input required type="number" min="0" max="28" className="input-field text-sm" placeholder="GST %" value={form.gstRate} onChange={e => setForm(f => ({ ...f, gstRate: e.target.value }))} />
            <button disabled={saving} className="btn-primary w-full py-2.5 rounded-xl text-sm">{editing ? 'Save changes' : 'Save service'}</button>
          </form>
        </div>
      )}
    </div>
  )
}
