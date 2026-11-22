import { useCallback, useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { get, patch, post } from '../../lib/api'
import { SalonPicker, inr, useDeskSalon } from './useDeskSalon.jsx'

const empty = { name: '', category: 'Hair', stock: '', minStock: 5, price: '', supplier: '' }

export default function InventoryPage() {
  const desk = useDeskSalon()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(empty)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    if (!desk.salonId) return
    get(`/products?salonId=${desk.salonId}`).then(setRows).catch(err => setError(err.message))
  }, [desk.salonId])
  useEffect(load, [load])

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await post('/products', {
        salonId: desk.salonId,
        name: form.name.trim(),
        category: form.category.trim() || 'General',
        stock: Number(form.stock || 0),
        minStock: Number(form.minStock || 0),
        price: Number(form.price),
        supplier: form.supplier.trim() || null,
      })
      setOpen(false)
      setForm(empty)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const adjust = async (row, stock) => {
    setError('')
    try {
      await patch(`/products/${row.id}`, { stock })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const low = (rows || []).filter(row => row.lowStock)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SalonPicker {...desk} />
        <button onClick={() => setOpen(true)} disabled={!desk.salonId} className="btn-primary ml-auto px-3 py-2 rounded-xl text-sm inline-flex items-center gap-1.5">
          <Plus size={15} /> Add product
        </button>
      </div>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      {low.length > 0 && (
        <div className="rounded-xl p-4 text-sm" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
          Low stock: {low.map(row => row.name).join(', ')}
        </div>
      )}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {(rows || []).map(row => (
          <div key={row.id} className="glass rounded-2xl p-4">
            <p className="text-[12px] uppercase tracking-wide text-fg-muted">{row.category}</p>
            <p className="text-fg font-semibold mt-1">{row.name}</p>
            <p className="text-[13px] text-fg-muted mt-1">{inr.format(row.price)} · {row.supplier || 'No supplier'}</p>
            <div className="flex items-center gap-2 mt-3">
              <button className="btn-ghost px-2 py-1 rounded-lg text-sm" onClick={() => adjust(row, Math.max(0, row.stock - 1))}>−</button>
              <span className="text-fg text-sm">{row.stock} in stock</span>
              <button className="btn-ghost px-2 py-1 rounded-lg text-sm" onClick={() => adjust(row, row.stock + 1)}>+</button>
              <span className="text-[12px] text-fg-muted ml-auto">min {row.minStock}</span>
            </div>
          </div>
        ))}
      </div>
      {rows && rows.length === 0 && <div className="glass rounded-2xl p-10 text-center text-sm text-fg-muted">No products yet.</div>}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <form onSubmit={save} onClick={e => e.stopPropagation()} className="glass-card rounded-2xl p-5 w-full max-w-md space-y-3">
            <div className="flex justify-between items-center gap-3"><p className="font-semibold text-fg">New product</p><button type="button" aria-label="Close" className="btn-icon-close" onClick={() => setOpen(false)}><X size={17} strokeWidth={2.25} /></button></div>
            <input required className="input-field text-sm" placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <input className="input-field text-sm" placeholder="Category" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
            <input className="input-field text-sm" placeholder="Supplier" value={form.supplier} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} />
            <div className="grid grid-cols-3 gap-2">
              <input required type="number" min="0" className="input-field text-sm" placeholder="Stock" value={form.stock} onChange={e => setForm(f => ({ ...f, stock: e.target.value }))} />
              <input type="number" min="0" className="input-field text-sm" placeholder="Minimum" value={form.minStock} onChange={e => setForm(f => ({ ...f, minStock: e.target.value }))} />
              <input required type="number" min="0" className="input-field text-sm" placeholder="Price" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
            </div>
            <button disabled={saving} className="btn-primary w-full py-2.5 rounded-xl text-sm">Save product</button>
          </form>
        </div>
      )}
    </div>
  )
}
