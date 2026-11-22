import { useCallback, useEffect, useState } from 'react'
import { get, post } from '../../lib/api'
import { SalonPicker, useDeskSalon } from './useDeskSalon.jsx'

const empty = { name: '', channel: 'whatsapp', audience: 'all', message: '' }
const audienceLabel = { all: 'All customers', birthday: 'Birthday in 14 days', due: 'Due back', recent: 'Seen this week' }

export default function MarketingPage() {
  const desk = useDeskSalon()
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(empty)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    if (!desk.salonId) return
    get(`/campaigns?salonId=${desk.salonId}`).then(setRows).catch(err => setError(err.message))
  }, [desk.salonId])
  useEffect(load, [load])

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await post('/campaigns', { ...form, salonId: desk.salonId, name: form.name.trim(), message: form.message.trim() })
      setForm(empty)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const send = async (row) => {
    setError('')
    try {
      await post(`/campaigns/${row.id}/send`)
      load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <SalonPicker {...desk} />
      </div>
      <p className="text-[13px] text-fg-muted">A campaign records the message and counts the real customers it is for. It is not delivered to WhatsApp from here.</p>
      {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <form onSubmit={save} className="glass-card rounded-2xl p-4 space-y-3">
        <p className="text-fg font-semibold">New campaign</p>
        <input required className="input-field text-sm" placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
        <div className="grid sm:grid-cols-2 gap-2">
          <select className="input-field text-sm" value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
            <option value="email">Email</option>
          </select>
          <select className="input-field text-sm" value={form.audience} onChange={e => setForm(f => ({ ...f, audience: e.target.value }))}>
            {Object.entries(audienceLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        <textarea required className="input-field text-sm min-h-[80px]" placeholder="Message" value={form.message} onChange={e => setForm(f => ({ ...f, message: e.target.value }))} />
        <button disabled={saving || !desk.salonId} className="btn-primary px-3 py-2 rounded-xl text-sm">Save draft</button>
      </form>
      <div className="space-y-2">
        {rows.map(row => (
          <div key={row.id} className="glass rounded-2xl p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-fg font-semibold">{row.name}</p>
              <span className="text-[11px] uppercase tracking-wide px-2 py-1 rounded-lg glass">{row.channel}</span>
              <span className="text-[11px] uppercase tracking-wide px-2 py-1 rounded-lg glass">{row.status}</span>
              {row.status === 'draft' && <button className="btn-ghost text-[12px] px-2 py-1 rounded-lg ml-auto" onClick={() => send(row)}>Record send</button>}
            </div>
            <p className="text-[13px] text-fg-2 mt-2">{row.message}</p>
            <p className="text-[12px] text-fg-muted mt-1">{audienceLabel[row.audience] || row.audience} · {row.recipientCount} customers</p>
          </div>
        ))}
        {rows.length === 0 && <div className="glass rounded-2xl p-10 text-center text-sm text-fg-muted">No campaigns yet.</div>}
      </div>
    </div>
  )
}
