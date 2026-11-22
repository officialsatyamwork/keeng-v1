import { useCallback, useEffect, useState } from 'react'
import { get, post } from '../../lib/api'
import { SalonPicker, inr, useDeskSalon } from './useDeskSalon.jsx'

const empty = { customerId: '', customerName: '', customerPhone: '', discount: 0, payMethod: 'upi', payNow: true, staffUserId: '', splitUserId: '', splitPercent: '' }

export default function BillingPage() {
  const desk = useDeskSalon()
  const [tab, setTab] = useState('pos')
  const [services, setServices] = useState([])
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [invoices, setInvoices] = useState([])
  const [cart, setCart] = useState([])
  const [form, setForm] = useState(empty)
  const [staff, setStaff] = useState([])
  const [visits, setVisits] = useState([])
  const [extra, setExtra] = useState({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    if (!desk.salonId) return
    const q = `salonId=${desk.salonId}`
    Promise.all([
      get(`/services?${q}`),
      get(`/products?${q}`),
      get(`/customers?${q}`),
      get(`/invoices?${q}`),
      get(`/staff?${q}`),
      get(`/appointments?${q}`),
    ]).then(([svc, prod, cust, bills, people, bookings]) => {
      setServices(svc.filter(row => row.isActive))
      setProducts(prod.filter(row => row.isActive))
      setCustomers(cust)
      setInvoices(bills)
      setStaff(people)
      setVisits(bookings)
    }).catch(err => setError(err.message))
  }, [desk.salonId])

  useEffect(load, [load])

  const add = (kind, row) => {
    setCart(list => {
      const found = list.find(item => item.kind === kind && item.refId === row.id)
      if (found) return list.map(item => item === found ? { ...item, qty: item.qty + 1 } : item)
      return [...list, { kind, refId: row.id, name: row.name, price: row.price, gstRate: row.gstRate, qty: 1 }]
    })
  }

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0)
  const discount = Math.round(subtotal * Number(form.discount || 0) / 100)
  const taxable = subtotal - discount
  const gst = subtotal === 0 ? 0 : Math.round(cart.reduce((sum, item) => {
    const share = (item.price * item.qty) / subtotal * taxable
    return sum + share * item.gstRate / 100
  }, 0))
  const total = taxable + gst

  const picked = customers.find(row => row.id === form.customerId)

  const useVisit = (visit) => {
    const service = services.find(row => row.id === visit.serviceId)
    if (service) add('service', service)
    setForm(current => ({ ...current, staffUserId: visit.staffUserId || current.staffUserId, customerId: visit.customerId }))
  }

  const checkout = async () => {
    if (!cart.length) return
    if (cart.some(item => item.kind === 'service') && !form.staffUserId) {
      setError('Choose who did the service. Their commission is counted from that.')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const split = Number(form.splitPercent)
      const body = {
        salonId: desk.salonId,
        discountPercent: Number(form.discount || 0),
        payNow: form.payNow,
        lines: cart.map(item => {
          const line = { kind: item.kind, refId: item.refId, qty: item.qty }
          if (item.kind === 'service' && form.splitUserId && split > 0 && split < 100 && form.staffUserId) {
            line.shares = [
              { staffUserId: form.staffUserId, percent: 100 - split },
              { staffUserId: form.splitUserId, percent: split },
            ]
          }
          return line
        }),
      }
      if (form.payNow) body.payMethod = form.payMethod
      if (form.staffUserId) body.staffUserId = form.staffUserId
      const typedName = form.customerName.trim()
      const known = !form.customerId ? customers.find(row => row.phone && row.phone === form.customerPhone) : null
      if (form.customerId) body.customerId = form.customerId
      else if (known) body.customerId = known.id
      else {
        if (!typedName) { setError('Enter the customer name'); setSaving(false); return }
        if (!/^\d{10}$/.test(form.customerPhone)) { setError('Enter a 10-digit phone number'); setSaving(false); return }
        body.customerName = typedName
        body.customerPhone = form.customerPhone
      }
      const saved = await post('/invoices', body)
      if (!form.customerId && saved.customerName && typedName && saved.customerName.toLowerCase() !== typedName.toLowerCase()) {
        setNotice(`${saved.customerName} is already a customer. This bill was added to that profile.`)
      } else setNotice('')
      setCart([])
      setForm(empty)
      setTab('invoices')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const collect = async (row) => {
    setError('')
    try {
      await post(`/invoices/${row.id}/pay`, { payMethod: 'upi' })
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <SalonPicker {...desk} />
        {['pos', 'invoices'].map(key => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded-lg text-sm ${tab === key ? 'bg-violet-600 text-white' : 'glass text-fg-2'}`}>
            {key === 'pos' ? 'New bill' : 'Bills'}
          </button>
        ))}
      </div>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      {notice && <p className="text-sm text-fg-2">{notice}</p>}

      {tab === 'pos' && (
        <div className="grid lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 space-y-3">
            <div className="glass rounded-2xl p-4">
              <p className="text-fg font-semibold mb-3">Services</p>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {services.map(row => (
                  <button key={row.id} onClick={() => add('service', row)} className="glass rounded-xl p-3 text-left">
                    <p className="text-[11px] uppercase text-fg-muted">{row.category}</p>
                    <p className="text-fg text-sm font-medium">{row.name}</p>
                    <p className="text-[12px] text-fg-muted">{inr.format(row.price)} · GST {row.gstRate}%</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="glass rounded-2xl p-4">
              <p className="text-fg font-semibold mb-3">Products</p>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {products.map(row => (
                  <button key={row.id} onClick={() => add('product', row)} disabled={row.stock < 1} className="glass rounded-xl p-3 text-left disabled:opacity-40">
                    <p className="text-fg text-sm font-medium">{row.name}</p>
                    <p className="text-[12px] text-fg-muted">{inr.format(row.price)} · {row.stock} in stock</p>
                  </button>
                ))}
                {products.length === 0 && <p className="text-sm text-fg-muted">No products at this salon yet.</p>}
              </div>
            </div>
          </div>
          <div className="glass-card rounded-2xl p-4 space-y-3">
            <p className="text-fg font-semibold">Bill</p>
            <select className="input-field text-sm" value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}>
              <option value="">New customer</option>
              {customers.map(row => <option key={row.id} value={row.id}>{row.fullName}{row.phone ? ` · ${row.phone}` : ''}</option>)}
            </select>
            {picked && (
              <div className="rounded-xl p-3 text-[12.5px] space-y-1" style={{ background: 'var(--surface)' }}>
                <p className="text-fg font-medium">{picked.fullName}</p>
                <p className="text-fg-muted">{picked.phone || 'No phone'}{picked.email ? ` · ${picked.email}` : ''}</p>
                <p className="text-fg-2">{picked.loyaltyPoints} loyalty points · {picked.visits} visits</p>
                {picked.allergies && <p style={{ color: 'var(--warning)' }}>Allergy: {picked.allergies}</p>}
                {picked.preferences && <p className="text-fg-2">{picked.preferences}</p>}
                {visits.filter(row => row.customerId === picked.id && !['cancelled', 'no_show'].includes(row.status)).slice(0, 3).map(row => (
                  <button type="button" key={row.id} className="block text-left text-violet-300" onClick={() => useVisit(row)}>
                    Use booking: {row.serviceName} · {row.staffName || 'Unassigned'}
                  </button>
                ))}
              </div>
            )}
            {!form.customerId && (
              <>
                <input className="input-field text-sm" placeholder="Customer name" value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} />
                <input className="input-field text-sm" inputMode="numeric" placeholder="10-digit phone" value={form.customerPhone} onChange={e => setForm(f => ({ ...f, customerPhone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} />
                <p className="text-[12px] text-fg-muted">A phone or name that is already on file is billed to that customer.</p>
              </>
            )}
            <select className="input-field text-sm" value={form.staffUserId} onChange={e => setForm(f => ({ ...f, staffUserId: e.target.value }))}>
              <option value="">Who did this service</option>
              {staff.map(person => <option key={person.userId} value={person.userId}>{person.fullName}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select className="input-field text-sm" value={form.splitUserId} onChange={e => setForm(f => ({ ...f, splitUserId: e.target.value }))}>
                <option value="">Split with</option>
                {staff.filter(person => person.userId !== form.staffUserId).map(person => <option key={person.userId} value={person.userId}>{person.fullName}</option>)}
              </select>
              <input className="input-field text-sm" type="number" min="1" max="99" placeholder="Their %" value={form.splitPercent} onChange={e => setForm(f => ({ ...f, splitPercent: e.target.value }))} />
            </div>
            {cart.map(item => (
              <div key={`${item.kind}-${item.refId}`} className="flex justify-between text-[13px]">
                <span className="text-fg-2">{item.name} × {item.qty}</span>
                <button className="text-fg-muted" onClick={() => setCart(list => list.filter(row => row !== item))}>Remove</button>
              </div>
            ))}
            <label className="block text-[12px] text-fg-muted">Discount %
              <input type="number" min="0" max="100" className="input-field text-sm mt-1" value={form.discount} onChange={e => setForm(f => ({ ...f, discount: e.target.value }))} />
            </label>
            <label className="flex items-center gap-2 text-sm text-fg-2">
              <input type="checkbox" checked={form.payNow} onChange={e => setForm(f => ({ ...f, payNow: e.target.checked }))} />
              Take payment now
            </label>
            {form.payNow && (
              <select className="input-field text-sm" value={form.payMethod} onChange={e => setForm(f => ({ ...f, payMethod: e.target.value }))}>
                <option value="upi">UPI</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
              </select>
            )}
            <div className="text-[13px] text-fg-2 space-y-1">
              <p className="flex justify-between"><span>Subtotal</span><span>{inr.format(subtotal)}</span></p>
              <p className="flex justify-between"><span>Discount</span><span>{inr.format(discount)}</span></p>
              <p className="flex justify-between"><span>GST</span><span>{inr.format(gst)}</span></p>
              <p className="flex justify-between text-fg font-semibold"><span>Total</span><span>{inr.format(total)}</span></p>
            </div>
            <button disabled={saving || !cart.length} onClick={checkout} className="btn-primary w-full py-2.5 rounded-xl text-sm">
              {saving ? 'Saving…' : form.payNow ? 'Save paid bill' : 'Save unpaid bill'}
            </button>
          </div>
        </div>
      )}

      {tab === 'invoices' && (
        <div className="space-y-2">
          {invoices.map(row => (
            <div key={row.id} className="glass rounded-2xl px-4 py-3 flex flex-wrap items-center gap-3">
              <div className="min-w-[120px]">
                <p className="text-fg font-semibold text-sm">{row.number}</p>
                <p className="text-[12px] text-fg-muted">{row.customerName}</p>
              </div>
              <p className="text-[13px] text-fg">{inr.format(row.total)}</p>
              <p className="text-[12px] text-fg-muted">GST {inr.format(row.gst)}</p>
              <span className="text-[11px] uppercase tracking-wide px-2 py-1 rounded-lg glass">{row.status}{row.payMethod ? ` · ${row.payMethod}` : ''}</span>
              <select className="input-field text-[12px] py-1" value={extra[row.id] || ''} onChange={e => setExtra(current => ({ ...current, [row.id]: e.target.value }))}>
                <option value="">Add a service</option>
                {services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}
              </select>
              <button className="btn-ghost text-[12px] px-2 py-1 rounded-lg" onClick={() => {
                if (!extra[row.id]) return
                post(`/invoices/${row.id}/lines`, { staffUserId: form.staffUserId || null, lines: [{ kind: 'service', refId: extra[row.id], qty: 1 }] })
                  .then(load)
                  .catch(err => setError(err.message))
              }}>Add</button>
              {row.status === 'unpaid' && (
                <button className="btn-ghost text-[12px] px-2 py-1 rounded-lg ml-auto" onClick={() => collect(row)}>Mark paid by UPI</button>
              )}
            </div>
          ))}
          {invoices.length === 0 && <div className="glass rounded-2xl p-10 text-center text-sm text-fg-muted">No bills yet.</div>}
        </div>
      )}
    </div>
  )
}
