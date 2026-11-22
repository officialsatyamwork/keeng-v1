import { useCallback, useEffect, useState } from 'react'
import { Plus, X, Loader2, Mail, UserX, UserCheck } from 'lucide-react'
import { del, get, patch, post, put } from '../../lib/api'
import { useAuth, ROLE_LABELS } from '../../store/auth'

const emptyInvite = { fullName: '', email: '', phone: '', role: 'staff', jobTitle: '', salonIds: [] }

export default function TeamAccess() {
  const me = useAuth(s => s.user)
  const salons = me?.salons || []
  const salonName = Object.fromEntries(salons.map(s => [s.id, s.name]))
  const isOwner = me?.role === 'master_admin'
  const canManage = ['master_admin', 'super_admin', 'admin', 'manager'].includes(me?.role)
  const roleOptions = {
    master_admin: ['super_admin', 'admin', 'manager', 'employee', 'staff'],
    super_admin: ['admin', 'manager', 'employee', 'staff'],
    admin: ['manager', 'employee', 'staff'],
    manager: ['employee', 'staff'],
  }[me?.role] || ['staff']
  const manageable = new Set(roleOptions)

  const [users, setUsers] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [form, setForm] = useState(emptyInvite)
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(() => {
    get('/users?pageSize=100').then(r => setUsers(r.items)).catch(e => setError(e.message))
  }, [])
  useEffect(load, [load])

  const replaceUser = (u) => setUsers(list => list.map(x => x.id === u.id ? u : x))
  const flash = (msg) => { setNotice(msg); setTimeout(() => setNotice(''), 2500) }

  const run = async (id, fn) => {
    setBusyId(id); setError('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusyId(null) }
  }

  const toggleAdminSalon = (u, salonId) => run(u.id, async () => {
    const has = u.salonIds.includes(salonId)
    const updated = has
      ? await del(`/users/${u.id}/salons/${salonId}`)
      : await post(`/users/${u.id}/salons/${salonId}`)
    replaceUser(updated)
  })

  const moveTo = (u, salonId) => run(u.id, async () => replaceUser(await put(`/users/${u.id}/salons`, { salonIds: [salonId] })))
  const setActive = (u, isActive) => run(u.id, async () => replaceUser(await patch(`/users/${u.id}`, { isActive })))
  const resend = (u) => run(u.id, async () => { await post(`/users/${u.id}/resend-invite`); flash(`Invite re-sent to ${u.email}`) })
  const sendReset = (u) => run(u.id, async () => { await post(`/users/${u.id}/send-reset`); flash(`Password reset emailed to ${u.email}`) })

  const submitInvite = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!form.fullName.trim()) errs.fullName = 'Required'
    if (!/\S+@\S+\.\S+/.test(form.email)) errs.email = 'Enter a valid email'
    if (form.phone && !/^\d{10}$/.test(form.phone)) errs.phone = 'Enter a 10-digit number'
    if (!form.salonIds.length) errs.salonIds = 'Pick at least one salon'
    if (form.role !== 'super_admin' && form.salonIds.length > 1) errs.salonIds = 'This role belongs to one salon'
    setFieldErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true); setError('')
    try {
      const body = { ...form, phone: form.phone || null, jobTitle: form.jobTitle || null }
      const created = await post('/users', body)
      setUsers(list => [...list, created])
      setShowInvite(false); setForm(emptyInvite)
      flash(`Invite sent to ${created.email}`)
    } catch (err) {
      setFieldErrors(err.code === 'email_taken' ? { email: err.message } : (err.fields || {}))
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const pickSalon = (id) => {
    if (form.role === 'super_admin') {
      setForm(f => ({ ...f, salonIds: f.salonIds.includes(id) ? f.salonIds.filter(x => x !== id) : [...f.salonIds, id] }))
    } else {
      setForm(f => ({ ...f, salonIds: [id] }))
    }
  }

  if (!users && !error) return <div className="h-40 rounded-xl animate-pulse" style={{ background: 'var(--surface)' }} />

  return (
    <div className="space-y-5 w-full max-w-4xl">
      {!showInvite && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="text-[16px] font-semibold text-fg">Team and salon access</h3>
              <p className="text-fg-muted text-[12.5px] mt-0.5">
                {isOwner
                  ? 'Invite people, set their role, and choose which salons they can use.'
                  : 'People in the salons you manage.'}
              </p>
            </div>
            {canManage && (
              <button
                onClick={() => { setShowInvite(true); setFieldErrors({}); setError('') }}
                className="btn-primary px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              >
                <Plus size={15} /> Invite member
              </button>
            )}
          </div>

          {error && <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
          {notice && <p role="status" className="text-sm" style={{ color: 'var(--success)' }}>{notice}</p>}

          <div className="overflow-x-auto rounded-2xl" style={{ border: '1px solid var(--card-border)' }}>
            <table className="w-full data-table text-sm">
              <thead>
                <tr>
                  <th className="text-left">Name</th>
                  <th className="text-left">Role</th>
                  <th className="text-left">Salon access</th>
                  <th className="text-left">Status</th>
                  {canManage && <th />}
                </tr>
              </thead>
              <tbody>
                {(users || []).map(u => {
                  const self = u.id === me.id
                  const editable = canManage && !self && manageable.has(u.role)
                  return (
                    <tr key={u.id}>
                      <td>
                        <p className="text-fg font-semibold text-[14px]">
                          {u.fullName || 'Unnamed'}
                          {self && <span className="text-fg-muted font-normal text-sm"> (you)</span>}
                        </p>
                        <p className="text-fg-muted text-xs">{u.email}{u.phone ? ` · ${u.phone}` : ''}</p>
                      </td>
                      <td className="text-fg-2">
                        {ROLE_LABELS[u.role]}
                        {u.jobTitle && <span className="text-fg-muted text-xs block">{u.jobTitle}</span>}
                      </td>
                      <td>
                        {u.role === 'master_admin' ? <span className="text-fg-2">All salons</span>
                          : u.role === 'super_admin' && isOwner ? (
                            <div className="flex flex-wrap gap-1.5">
                              {salons.map(s => {
                                const on = u.salonIds.includes(s.id)
                                return (
                                  <button key={s.id} disabled={busyId === u.id} onClick={() => toggleAdminSalon(u, s.id)}
                                    aria-pressed={on}
                                    className="px-2 py-0.5 rounded-lg text-xs border"
                                    style={on
                                      ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)', color: 'var(--text-primary)' }
                                      : { borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                                    {s.name}
                                  </button>
                                )
                              })}
                            </div>
                          ) : editable && ['admin', 'manager', 'employee', 'staff'].includes(u.role) ? (
                            <select value={u.salonIds[0] || ''} disabled={busyId === u.id} onChange={e => moveTo(u, e.target.value)}
                              className="input-field py-1.5 px-2 text-xs rounded-lg min-h-0">
                              {salons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          ) : (
                            <span className="text-fg-2">{u.salonIds.map(id => salonName[id] || 'Other salon').join(', ') || '—'}</span>
                          )}
                      </td>
                      <td>
                        {!u.isActive ? <span className="badge" style={{ background: 'var(--surface)', color: 'var(--text-muted)' }}>Disabled</span>
                          : u.invitePending ? <span className="badge" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>Invite sent</span>
                            : <span className="badge" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>Active</span>}
                      </td>
                      {canManage && (
                        <td className="text-right whitespace-nowrap">
                          <div className="flex justify-end items-center gap-1.5">
                            {busyId === u.id && <Loader2 size={16} className="animate-spin text-fg-2" />}
                            {editable && u.invitePending && u.isActive && (
                              <button
                                type="button"
                                onClick={() => resend(u)}
                                title="Resend invite"
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] font-medium"
                                style={{ color: 'var(--text-primary)', background: 'var(--bg-2)', border: '1px solid var(--border)' }}
                              >
                                <Mail size={14} strokeWidth={2.25} /> Resend
                              </button>
                            )}
                            {u.isActive && !u.invitePending && (
                              <button
                                type="button"
                                onClick={() => sendReset(u)}
                                title="Email a password reset"
                                className="inline-flex items-center px-3 py-1.5 rounded-lg text-[13px] font-semibold"
                                style={{ color: 'var(--text-primary)', background: 'var(--bg-2)', border: '1px solid var(--border)' }}
                              >
                                Reset
                              </button>
                            )}
                            {editable && (
                              <button
                                type="button"
                                onClick={() => setActive(u, !u.isActive)}
                                title={u.isActive ? 'Disable account' : 'Enable account'}
                                className="inline-flex items-center justify-center w-9 h-9 rounded-lg"
                                style={{ color: 'var(--text-primary)', background: 'var(--bg-2)', border: '1px solid var(--border)' }}
                              >
                                {u.isActive ? <UserX size={16} strokeWidth={2.25} /> : <UserCheck size={16} strokeWidth={2.25} />}
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showInvite && (
        <form
          onSubmit={submitInvite}
          noValidate
          className="w-full rounded-2xl overflow-hidden"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
        >
          <div className="flex items-start justify-between gap-3 px-5 sm:px-6 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <div>
              <h2 className="text-[18px] font-semibold text-fg tracking-tight">Invite team member</h2>
              <p className="text-[12.5px] text-fg-muted mt-0.5">They get an email link to set their password. It lasts 72 hours.</p>
            </div>
            <button
              type="button"
              aria-label="Close"
              onClick={() => { setShowInvite(false); setFieldErrors({}); setError('') }}
              className="btn-icon-close"
            >
              <X size={17} strokeWidth={2.25} />
            </button>
          </div>

          <div className="px-5 sm:px-6 py-5 space-y-5">
            {error && (
              <p role="alert" className="text-[13px] rounded-xl px-3 py-2.5" style={{ color: 'var(--danger)', background: 'var(--danger-soft)' }}>
                {error}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <label className="block sm:col-span-2">
                <span className="text-[12px] font-medium text-fg-2">Full name</span>
                <input
                  id="i-fullName"
                  autoFocus
                  value={form.fullName}
                  onChange={e => setForm({ ...form, fullName: e.target.value })}
                  className={`input-field text-sm mt-1.5 ${fieldErrors.fullName ? 'input-error' : ''}`}
                  placeholder="Name"
                />
                {fieldErrors.fullName && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{fieldErrors.fullName}</p>}
              </label>
              <label className="block sm:col-span-2">
                <span className="text-[12px] font-medium text-fg-2">Email</span>
                <input
                  id="i-email"
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  className={`input-field text-sm mt-1.5 ${fieldErrors.email ? 'input-error' : ''}`}
                  placeholder="name@email.com"
                />
                {fieldErrors.email && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{fieldErrors.email}</p>}
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-fg-2">Phone <span className="text-fg-muted font-normal">(optional)</span></span>
                <input
                  id="i-phone"
                  inputMode="numeric"
                  value={form.phone}
                  onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                  className={`input-field text-sm mt-1.5 ${fieldErrors.phone ? 'input-error' : ''}`}
                  placeholder="10 digits"
                />
                {fieldErrors.phone && <p className="text-xs mt-1" style={{ color: 'var(--danger)' }}>{fieldErrors.phone}</p>}
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-fg-2">Job title <span className="text-fg-muted font-normal">(optional)</span></span>
                <input
                  id="i-jobTitle"
                  value={form.jobTitle}
                  onChange={e => setForm({ ...form, jobTitle: e.target.value })}
                  className="input-field text-sm mt-1.5"
                  placeholder="e.g. Stylist"
                />
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-fg-2">Role</span>
                <select
                  id="i-role"
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value, salonIds: form.salonIds.slice(0, 1) })}
                  className="input-field text-sm mt-1.5"
                >
                  {roleOptions.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                </select>
              </label>
              <div className="block">
                <p className="text-[12px] font-medium text-fg-2 mb-1.5">
                  {form.role === 'super_admin' ? 'Salons they can access' : 'Salon'}
                </p>
                <div className="grid grid-cols-1 gap-2">
                  {salons.map(s => {
                    const on = form.salonIds.includes(s.id)
                    return (
                      <button
                        type="button"
                        key={s.id}
                        onClick={() => pickSalon(s.id)}
                        aria-pressed={on}
                        className="px-3 py-2.5 rounded-xl text-[13px] text-left transition-colors"
                        style={on
                          ? { border: '1px solid var(--border-brand)', background: 'var(--brand-soft)', color: 'var(--text-primary)' }
                          : { border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text-secondary)' }}
                      >
                        {s.name}
                      </button>
                    )
                  })}
                </div>
                {fieldErrors.salonIds && <p className="text-xs mt-1.5" style={{ color: 'var(--danger)' }}>{fieldErrors.salonIds}</p>}
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => { setShowInvite(false); setFieldErrors({}); setError('') }}
                className="btn-ghost px-4 py-2.5 rounded-xl text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="btn-primary px-5 py-2.5 rounded-xl text-sm font-medium inline-flex items-center gap-2"
              >
                {saving && <Loader2 size={15} className="animate-spin" />}
                Send invite
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
