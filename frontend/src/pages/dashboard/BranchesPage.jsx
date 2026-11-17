import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, X, MapPin, Phone, Users, TrendingUp, Loader2, Power } from 'lucide-react'
import { del, get, patch, post } from '../../lib/api'
import { useAuth } from '../../store/auth'

const emptyForm = { name: '', city: '', address: '', phone: '' }
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

export default function BranchesPage() {
  const user = useAuth(s => s.user)
  const bootstrap = useAuth(s => s.bootstrap)
  const isOwner = user?.role === 'master_admin'
  const [branches, setBranches] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    setLoadError('')
    get('/salons').then(setBranches).catch(e => setLoadError(e.message))
  }, [])
  useEffect(load, [load])

  const validate = () => {
    const e = {}
    if (!form.name.trim()) e.name = 'Required'
    if (!form.city.trim()) e.city = 'Required'
    if (!form.address.trim()) e.address = 'Required'
    if (!form.phone.trim()) e.phone = 'Required'
    else if (!/^\d{10}$/.test(form.phone)) e.phone = 'Enter a 10-digit number'
    return e
  }

  const close = () => { setShowModal(false); setErrors({}); setFormError(''); setForm(emptyForm) }

  const handleAdd = async (e) => {
    e.preventDefault()
    const errs = validate()
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true); setFormError('')
    try {
      const created = await post('/salons', form)
      setBranches(b => [...(b || []), created])
      close()
      bootstrap()
    } catch (err) {
      setFormError(err.message); setErrors(err.fields || {})
    } finally {
      setSaving(false)
    }
  }

  const toggleStatus = async (b) => {
    try {
      const updated = b.status === 'active'
        ? (await del(`/salons/${b.id}`), { ...b, status: 'inactive' })
        : await patch(`/salons/${b.id}`, { status: 'active' })
      setBranches(list => list.map(x => x.id === b.id ? { ...x, ...updated } : x))
    } catch (err) {
      setLoadError(err.message)
    }
  }

  if (!branches && !loadError) {
    return <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{[0, 1, 2].map(i => <div key={i} className="glass rounded-2xl h-44 animate-pulse" />)}</div>
  }

  const list = branches || []
  const showRevenue = list.some(b => b.revenue !== null && b.revenue !== undefined)
  const totalRevenue = list.reduce((s, b) => s + (b.revenue || 0), 0)
  const totalStaff = list.reduce((s, b) => s + b.staff, 0)

  return (
    <div className="space-y-6">
      {loadError && (
        <div role="alert" className="rounded-xl px-4 py-3 text-sm flex items-center justify-between" style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
          {loadError} <button onClick={load} className="underline">Retry</button>
        </div>
      )}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex gap-4 flex-wrap">
          {[
            { label: 'Branches', value: list.length },
            { label: 'Team', value: totalStaff },
            ...(showRevenue ? [{ label: 'Revenue', value: inr.format(totalRevenue) }] : []),
          ].map(s => (
            <div key={s.label} className="glass rounded-xl px-5 py-3">
              <p className="text-xl font-black text-fg">{s.value}</p>
              <p className="text-fg-muted text-xs">{s.label}</p>
            </div>
          ))}
        </div>
        {isOwner && (
          <button onClick={() => setShowModal(true)} className="btn-primary px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2">
            <Plus size={16} /> Add branch
          </button>
        )}
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {list.map(b => (
          <motion.div key={b.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            className={`glass rounded-2xl p-5 ${b.status !== 'active' ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between mb-4 gap-2">
              <div className="min-w-0">
                <h3 className="font-bold text-fg truncate">{b.name}</h3>
                {(b.address || b.city) && (
                  <div className="flex items-center gap-1 text-fg-2 text-xs mt-1">
                    <MapPin size={11} className="flex-shrink-0" /> <span className="truncate">{[b.address, b.city].filter(Boolean).join(', ')}</span>
                  </div>
                )}
              </div>
              <span className="text-xs px-2 py-1 rounded-full capitalize flex-shrink-0"
                style={b.status === 'active' ? { background: 'rgba(34,197,94,0.12)', color: '#4ade80' } : { background: 'var(--surface)', color: 'var(--text-muted)' }}>
                {b.status}
              </span>
            </div>
            <div className="flex items-center justify-between text-fg-2 text-sm mb-4">
              <span className="flex items-center gap-1">{b.phone && <><Phone size={12} /> {b.phone}</>}</span>
              {isOwner && (
                <button onClick={() => toggleStatus(b)} className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg">
                  <Power size={12} /> {b.status === 'active' ? 'Deactivate' : 'Reactivate'}
                </button>
              )}
            </div>
            <div className={`grid ${showRevenue ? 'grid-cols-3' : 'grid-cols-2'} gap-3 pt-3`} style={{ borderTop: '1px solid var(--border)' }}>
              <div className="text-center">
                <div className="flex items-center justify-center gap-1 text-fg font-bold text-sm"><Users size={12} /> {b.staff}</div>
                <p className="text-fg-muted text-xs">Team</p>
              </div>
              <div className="text-center">
                <p className="text-fg font-bold text-sm">{b.appointments}</p>
                <p className="text-fg-muted text-xs">Appts</p>
              </div>
              {showRevenue && (
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-fg font-bold text-sm"><TrendingUp size={12} /> {inr.format(b.revenue || 0)}</div>
                  <p className="text-fg-muted text-xs">Revenue</p>
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl p-6 w-full max-w-md" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-fg">Add branch</h2>
              <button onClick={close} className="text-fg-muted hover:text-fg" aria-label="Close"><X size={20} /></button>
            </div>
            <form onSubmit={handleAdd} className="space-y-4" noValidate>
              {formError && <p className="text-sm" style={{ color: '#f87171' }}>{formError}</p>}
              {[
                { key: 'name', label: 'Branch name', placeholder: 'e.g. Glow Salon - Juhu' },
                { key: 'city', label: 'City', placeholder: 'e.g. Mumbai' },
                { key: 'address', label: 'Address', placeholder: 'Full address' },
                { key: 'phone', label: 'Phone', placeholder: '10-digit number' },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-sm text-fg-2 block mb-1" htmlFor={`b-${f.key}`}>{f.label}</label>
                  <input id={`b-${f.key}`} value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                    placeholder={f.placeholder} className={`input-field text-sm ${errors[f.key] ? 'input-error' : ''}`} />
                  {errors[f.key] && <p className="text-xs mt-1" style={{ color: '#f87171' }}>{errors[f.key]}</p>}
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={close} className="flex-1 btn-ghost py-2.5 rounded-xl text-sm font-medium">Cancel</button>
                <button type="submit" disabled={saving} className="flex-1 btn-primary py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2">
                  {saving && <Loader2 size={15} className="animate-spin" />} Add branch
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  )
}
