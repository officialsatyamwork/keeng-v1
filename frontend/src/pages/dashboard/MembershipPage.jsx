import { useCallback, useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { get, post } from '../../lib/api'
import { useAuth } from '../../store/auth'
import { SalonPicker, inr, useDeskSalon } from './useDeskSalon.jsx'

export default function MembershipPage() {
  const role = useAuth(s => s.user?.role)
  const canCreate = ['master_admin', 'super_admin', 'admin', 'manager'].includes(role)
  const desk = useDeskSalon()
  const [packages, setPackages] = useState(null)
  const [held, setHeld] = useState([])
  const [customers, setCustomers] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', sessions: 6, price: '', validityDays: 90 })
  const [sale, setSale] = useState({ customerId: '', packageId: '' })

  const load = useCallback(() => {
    if (!desk.salonId) return
    setError('')
    Promise.all([
      get(`/packages?salonId=${desk.salonId}`),
      get(`/customer-packages?salonId=${desk.salonId}`),
      get(`/customers?salonId=${desk.salonId}`),
    ]).then(([p, h, c]) => { setPackages(p); setHeld(h); setCustomers(c) }).catch(e => setError(e.message))
  }, [desk.salonId])
  useEffect(load, [load])

  const create = async (e) => {
    e.preventDefault()
    try {
      await post('/packages', { salonId: desk.salonId, name: form.name.trim(), sessions: Number(form.sessions), price: Number(form.price), validityDays: Number(form.validityDays) })
      setOpen(false)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  const sell = async (e) => {
    e.preventDefault()
    try {
      await post('/customer-packages', sale)
      setSale({ customerId: '', packageId: '' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <SalonPicker {...desk} />
        {canCreate && (
          <button onClick={() => setOpen(true)} className="btn-primary ml-auto px-3 py-2 rounded-xl text-sm inline-flex items-center gap-1.5">
            <Plus size={15} /> New package
          </button>
        )}
      </div>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {(packages || []).map(row => (
          <div key={row.id} className="glass rounded-2xl p-4">
            <p className="text-fg font-semibold">{row.name}</p>
            <p className="text-[13px] text-fg-muted mt-1">{row.sessions} sessions · {inr.format(row.price)} · {row.validityDays} days</p>
          </div>
        ))}
      </div>

      <form onSubmit={sell} className="glass rounded-2xl p-4 flex flex-wrap gap-2 items-end">
        <div>
          <p className="text-[12px] text-fg-muted mb-1">Sell a package</p>
          <select required className="input-field text-sm" value={sale.customerId} onChange={e => setSale(s => ({ ...s, customerId: e.target.value }))}>
            <option value="">Customer</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.fullName}</option>)}
          </select>
        </div>
        <select required className="input-field text-sm" value={sale.packageId} onChange={e => setSale(s => ({ ...s, packageId: e.target.value }))}>
          <option value="">Package</option>
          {(packages || []).filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button className="btn-primary px-3 py-2 rounded-xl text-sm">Sell</button>
      </form>

      <div className="space-y-2">
        {held.map(row => (
          <div key={row.id} className="glass rounded-2xl px-4 py-3 flex flex-wrap justify-between gap-2 text-[13px]">
            <p className="text-fg">{row.customerName} · {row.packageName}</p>
            <p className="text-fg-muted">{row.sessionsUsed}/{row.sessionsTotal} used · {row.status} · until {new Date(row.expiresAt).toLocaleDateString('en-IN')}</p>
          </div>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <form onSubmit={create} onClick={e => e.stopPropagation()} className="glass-card rounded-2xl p-5 w-full max-w-md space-y-3">
            <div className="flex justify-between items-center gap-3"><p className="font-semibold text-fg">New package</p><button type="button" aria-label="Close" className="btn-icon-close" onClick={() => setOpen(false)}><X size={17} strokeWidth={2.25} /></button></div>
            <input required className="input-field text-sm" placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <div className="grid grid-cols-3 gap-2">
              <input required type="number" min="1" className="input-field text-sm" placeholder="Sessions" value={form.sessions} onChange={e => setForm(f => ({ ...f, sessions: e.target.value }))} />
              <input required type="number" min="0" className="input-field text-sm" placeholder="Price" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
              <input required type="number" min="1" className="input-field text-sm" placeholder="Days" value={form.validityDays} onChange={e => setForm(f => ({ ...f, validityDays: e.target.value }))} />
            </div>
            <button className="btn-primary w-full py-2.5 rounded-xl text-sm">Save package</button>
          </form>
        </div>
      )}
    </div>
  )
}
