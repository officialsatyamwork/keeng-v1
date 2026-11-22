import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Save, Building2, Bell, Lock, Users, Loader2, UserRound } from 'lucide-react'
import { get, patch, post, put } from '../../lib/api'
import { useAuth } from '../../store/auth'
import { passwordError } from '../../lib/password'
import TeamAccess from './TeamAccess'

const allTabs = [
  { id: 'profile', label: 'My details', icon: UserRound, roles: ['customer'] },
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
  { key: 'newBookings', label: 'New Bookings', desc: 'Email the salon when a booking is confirmed, moved, or completed. The bell still shows every change.' },
  { key: 'cancellations', label: 'Cancellations', desc: 'Email the salon when an appointment is cancelled. The customer is always emailed.' },
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
  const [profile, setProfile] = useState(null)
  const [fieldErrors, setFieldErrors] = useState({})
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resetNote, setResetNote] = useState('')

  useEffect(() => {
    setError(''); setFieldErrors({}); setSaved(false)
    if (tab === 'business' && !business) {
      get('/settings/business')
        .then(b => setBusiness({
          ...b,
          phone: String(b.phone || '').replace(/\D/g, '').slice(0, 10),
        }))
        .catch(e => setError(e.message))
    }
    if (tab === 'notifications' && !notifications) get('/settings/notifications').then(setNotifications).catch(e => setError(e.message))
    if (tab === 'profile' && !profile) get('/me/profile').then(setProfile).catch(e => setError(e.message))
  }, [tab]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setError(''); setFieldErrors({}); setSaving(true)
    try {
      if (tab === 'business') {
        const phone = String(business.phone || '').replace(/\D/g, '').slice(0, 10)
        if (phone && phone.length !== 10) throw new Error('Phone number must be exactly 10 digits')
        setBusiness(await put('/settings/business', { ...business, email: business.email || null, phone: phone || null, gst: business.gst || null }))
      } else if (tab === 'notifications') {
        setNotifications(await put('/settings/notifications', notifications))
      } else if (tab === 'profile') {
        setProfile(await patch('/me/profile', {
          dateOfBirth: profile.dateOfBirth || null,
          allergies: profile.allergies || null,
          preferences: profile.preferences || null,
        }))
      } else if (tab === 'security') {
        if (!security.currentPassword) throw new Error('Enter current password')
        if (passwordError(security.newPassword)) throw new Error(passwordError(security.newPassword))
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
  const loading = (tab === 'business' && !business) || (tab === 'notifications' && !notifications) || (tab === 'profile' && !profile)

  return (
    <div className={`space-y-6 ${tab === 'team' ? 'w-full' : 'max-w-4xl'}`}>
      <div className="flex gap-2 flex-wrap">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${tab === t.id ? 'btn-primary' : 'btn-ghost text-fg-2'}`}>
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      <motion.div
        key={tab}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={tab === 'team' ? 'w-full' : 'glass rounded-2xl p-6 space-y-5'}
      >
        {tab === 'team' && <TeamAccess />}
        {tab !== 'team' && loading && !error && <div className="h-40 rounded-xl animate-pulse" style={{ background: 'var(--surface)' }} />}

        {tab === 'business' && business && (
          <>
            <div>
              <h3 className="font-bold text-fg">Business information</h3>
              {readOnly && <p className="text-fg-muted text-xs mt-1">Only the master admin can change these details.</p>}
            </div>
            {isOwner && (
              <div>
                <label className="text-sm text-fg-2 block mb-1" htmlFor="owner-phone">Your sign-in phone</label>
                <input
                  id="owner-phone"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="10-digit phone"
                  defaultValue={String(user?.phone || '').replace(/\D/g, '').slice(0, 10)}
                  onChange={e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10) }}
                  onBlur={async e => {
                    const phone = e.target.value.replace(/\D/g, '').slice(0, 10)
                    if (phone && !/^\d{10}$/.test(phone)) { setError('Enter exactly 10 digits'); return }
                    if (phone === (user?.phone || '')) return
                    try {
                      await patch(`/users/${user.id}`, { phone: phone || null })
                      setSession(await post('/auth/refresh'))
                    } catch (err) {
                      setError(err.message)
                    }
                  }}
                  className="input-field text-sm"
                />
                <p className="text-fg-muted text-xs mt-1">This is the phone you use to sign in. It must be 10 digits.</p>
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-4">
              {businessFields.map(f => {
                const isPhone = f.key === 'phone'
                return (
                  <div key={f.key}>
                    <label className="text-sm text-fg-2 block mb-1" htmlFor={`s-${f.key}`}>{f.label}</label>
                    <input
                      id={`s-${f.key}`}
                      value={business[f.key] ?? ''}
                      disabled={readOnly}
                      inputMode={isPhone ? 'numeric' : undefined}
                      maxLength={isPhone ? 10 : undefined}
                      placeholder={isPhone ? '10 digits' : undefined}
                      onChange={e => {
                        const value = isPhone
                          ? e.target.value.replace(/\D/g, '').slice(0, 10)
                          : e.target.value
                        setBusiness({ ...business, [f.key]: value })
                      }}
                      className={`input-field text-sm ${fieldErrors[f.key] ? 'input-error' : ''}`}
                    />
                    {isPhone && !fieldErrors.phone && (
                      <p className="text-fg-muted text-xs mt-1">Exactly 10 digits.</p>
                    )}
                    {fieldErrors[f.key] && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{fieldErrors[f.key]}</p>}
                  </div>
                )
              })}
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

        {tab === 'profile' && profile && (
          <>
            <div>
              <h3 className="font-bold text-fg">Your salon file</h3>
              <p className="text-fg-muted text-xs mt-1">The salon sees this with every visit, starting from the first one, including who did the service.</p>
            </div>
            <div>
              <label className="text-sm text-fg-2 block mb-1" htmlFor="dob">Date of birth</label>
              <input id="dob" type="date" value={profile.dateOfBirth || ''} onChange={e => setProfile({ ...profile, dateOfBirth: e.target.value })} className="input-field text-sm" />
            </div>
            <div>
              <label className="text-sm text-fg-2 block mb-1" htmlFor="allergies">Allergies</label>
              <textarea id="allergies" value={profile.allergies || ''} onChange={e => setProfile({ ...profile, allergies: e.target.value })} rows={3} className="input-field text-sm" placeholder="Leave blank if none" />
            </div>
            <div>
              <label className="text-sm text-fg-2 block mb-1" htmlFor="preferences">How you like your service</label>
              <textarea id="preferences" value={profile.preferences || ''} onChange={e => setProfile({ ...profile, preferences: e.target.value })} rows={3} className="input-field text-sm" />
            </div>
            <div>
              <p className="text-sm font-medium text-fg mb-2">Visits from the first</p>
              {(profile.visits || []).length === 0 && <p className="text-sm text-fg-muted">Your visits will appear here after you book.</p>}
              {(profile.visits || []).map(visit => (
                <div key={visit.id} className="py-2 text-[13px]" style={{ borderTop: '1px solid var(--border)' }}>
                  <p className="text-fg">{visit.serviceName} · {visit.salonName}</p>
                  <p className="text-fg-muted">{new Date(visit.startsAt).toLocaleString('en-IN')} · {visit.staffName || 'Unassigned'} · {visit.status.replaceAll('_', ' ')}</p>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'security' && (
          <>
            <div>
              <h3 className="font-bold text-fg">Change password</h3>
              <p className="text-fg-muted text-xs mt-1">You stay signed in here. Other devices are signed out. A new password needs a capital letter, a small letter, a number, and a special character.</p>
            </div>
            <button type="button" onClick={async () => {
              setError(''); setResetNote('')
              try {
                await post('/auth/forgot-password', { email: user.email }, { auth: false })
                setResetNote(`A reset link was sent to ${user.email}.`)
              } catch (err) {
                setError(err.message)
              }
            }} className="btn-ghost px-4 py-2 rounded-xl text-sm">
              Email me a reset link
            </button>
            {resetNote && <p className="text-sm" style={{ color: 'var(--success)' }}>{resetNote}</p>}
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

        {error && <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}

        {tab !== 'team' && !readOnly && !loading && (
          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-medium">
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {saved ? 'Saved' : 'Save changes'}
          </button>
        )}
      </motion.div>
    </div>
  )
}
