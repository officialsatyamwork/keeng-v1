import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Save, Building2, Bell, Lock, Users, Loader2 } from 'lucide-react'
import { get, post, put } from '../../lib/api'
import { useAuth } from '../../store/auth'
import TeamAccess from './TeamAccess'

const allTabs = [
  { id: 'business', label: 'Business Profile', icon: Building2, roles: ['master_admin', 'super_admin', 'admin'] },
  { id: 'team', label: 'Team & Access', icon: Users, roles: ['master_admin', 'super_admin', 'admin', 'manager'] },
  { id: 'notifications', label: 'Notifications', icon: Bell, roles: ['master_admin', 'super_admin', 'admin'] },
  { id: 'security', label: 'Security', icon: Lock, roles: ['master_admin', 'super_admin', 'admin', 'manager', 'employee', 'staff', 'customer'] },
]

const businessFields = [
  { key: 'name', label: 'Business Name' },
  { key: 'type', label: 'Business Type' },
  { key: 'email', label: 'Email Address' },
  { key: 'phone', label: 'Phone Number' },
  { key: 'gst', label: 'GST Number' },
  { key: 'currency', label: 'Currency' },
]

const notificationFields = [
  { key: 'appointmentReminders', label: 'Appointment Reminders', desc: 'Send reminders to customers before appointments' },
  { key: 'newBookings', label: 'New Bookings', desc: 'Notify when a new appointment is booked' },
  { key: 'cancellations', label: 'Cancellations', desc: 'Alert when an appointment is cancelled' },
  { key: 'lowStock', label: 'Low Stock Alerts', desc: 'Notify when inventory falls below minimum' },
  { key: 'dailySummary', label: 'Daily Summary', desc: 'Receive end-of-day business summary' },
  { key: 'weeklySummary', label: 'Weekly Report', desc: 'Receive weekly performance report' },
]

export default function SettingsPage() {
  const user = useAuth(s => s.user)
  const setSession = useAuth(s => s.setSession)
  const tabs = allTabs.filter(t => t.roles.includes(user?.role))
  const [tab, setTab] = useState(tabs[0]?.id || 'security')
  const isOwner = user?.role === 'master_admin'

  const [business, setBusiness] = useState(null)
  const [notifications, setNotifications] = useState(null)
  const [security, setSecurity] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setError(''); setFieldErrors({}); setSaved(false)
    if (tab === 'business' && !business) get('/settings/business').then(setBusiness).catch(e => setError(e.message))
    if (tab === 'notifications' && !notifications) get('/settings/notifications').then(setNotifications).catch(e => setError(e.message))
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setError(''); setFieldErrors({}); setSaving(true)
    try {
      if (tab === 'business') {
        setBusiness(await put('/settings/business', { ...business, email: business.email || null, phone: business.phone || null, gst: business.gst || null }))
      } else if (tab === 'notifications') {
        setNotifications(await put('/settings/notifications', notifications))
      } else if (tab === 'security') {
        if (!security.currentPassword) throw new Error('Enter current password')
        if (security.newPassword.length < 8) throw new Error('New password must be 8+ characters')
        if (security.newPassword !== security.confirmPassword) throw new Error('Passwords do not match')
        setSession(await post('/auth/change-password', { currentPassword: security.currentPassword, newPassword: security.newPassword }))
        setSecurity({ currentPassword: '', newPassword: '', confirmPassword: '' })
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err.message)
      setFieldErrors(err.fields || {})
    } finally {
      setSaving(false)
    }
  }

  const readOnly = tab === 'business' && !isOwner
  const loading = (tab === 'business' && !business) || (tab === 'notifications' && !notifications)

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex gap-2 flex-wrap">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === t.id ? 'btn-primary' : 'btn-ghost text-fg-2'}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6 space-y-5">
        {tab === 'team' && <TeamAccess />}
        {tab !== 'team' && loading && !error && <div className="h-40 rounded-xl animate-pulse" style={{ background: 'var(--surface)' }} />}

        {tab === 'business' && business && (
          <>
            <div>
              <h3 className="font-bold text-fg">Business information</h3>
              {readOnly && <p className="text-fg-muted text-xs mt-1">Only the master admin can change these details.</p>}
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {businessFields.map(f => (
                <div key={f.key}>
                  <label className="text-sm text-fg-2 block mb-1" htmlFor={`s-${f.key}`}>{f.label}</label>
                  <input id={`s-${f.key}`} value={business[f.key] ?? ''} disabled={readOnly}
                    onChange={e => setBusiness({ ...business, [f.key]: e.target.value })}
                    className={`input-field text-sm ${fieldErrors[f.key] ? 'input-error' : ''}`} />
                  {fieldErrors[f.key] && <p className="text-xs mt-1" style={{ color: '#f87171' }}>{fieldErrors[f.key]}</p>}
                </div>
              ))}
            </div>
            <div>
              <label className="text-sm text-fg-2 block mb-1" htmlFor="s-address">Address</label>
              <textarea id="s-address" value={business.address ?? ''} disabled={readOnly} onChange={e => setBusiness({ ...business, address: e.target.value })}
                rows={2} className="input-field text-sm resize-none" />
            </div>
          </>
        )}

        {tab === 'notifications' && notifications && (
          <>
            <h3 className="font-bold text-fg">Notification preferences</h3>
            <div className="space-y-1">
              {notificationFields.map(n => (
                <div key={n.key} className="flex items-center justify-between py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <p className="text-fg text-sm font-medium">{n.label}</p>
                    <p className="text-fg-muted text-xs">{n.desc}</p>
                  </div>
                  <button role="switch" aria-checked={notifications[n.key]} aria-label={n.label}
                    onClick={() => setNotifications({ ...notifications, [n.key]: !notifications[n.key] })}
                    className="w-11 h-6 rounded-full relative"
                    style={{ background: notifications[n.key] ? 'var(--brand)' : 'var(--surface-2)' }}>
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${notifications[n.key] ? 'left-6' : 'left-1'}`} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'security' && (
          <>
            <div>
              <h3 className="font-bold text-fg">Change password</h3>
              <p className="text-fg-muted text-xs mt-1">You stay signed in here. Other devices are signed out.</p>
            </div>
            <div className="space-y-4">
              {[
                { key: 'currentPassword', label: 'Current password', ac: 'current-password' },
                { key: 'newPassword', label: 'New password', ac: 'new-password' },
                { key: 'confirmPassword', label: 'Confirm new password', ac: 'new-password' },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-sm text-fg-2 block mb-1" htmlFor={`p-${f.key}`}>{f.label}</label>
                  <input id={`p-${f.key}`} type="password" autoComplete={f.ac} value={security[f.key]}
                    onChange={e => { setSecurity({ ...security, [f.key]: e.target.value }); setError('') }}
                    className="input-field text-sm" />
                </div>
              ))}
            </div>
          </>
        )}

        {error && <p role="alert" className="text-sm" style={{ color: '#f87171' }}>{error}</p>}

        {tab !== 'team' && !readOnly && !loading && (
          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {saved ? 'Saved' : 'Save changes'}
          </button>
        )}
      </motion.div>
    </div>
  )
}
