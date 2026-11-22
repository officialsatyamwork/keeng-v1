import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { post } from '../../lib/api'
import { useAuth } from '../../store/auth'
import { passwordError, PASSWORD_HINT } from '../../lib/password'
import BackHome from '../../components/auth/BackHome'

export default function SetPasswordPage({ mode }) {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [form, setForm] = useState({ password: '', confirm: '' })
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const acceptInvite = useAuth(s => s.acceptInvite)
  const navigate = useNavigate()
  const invite = mode === 'invite'

  const submit = async (e) => {
    e.preventDefault()
    if (passwordError(form.password)) { setError(passwordError(form.password)); return }
    if (form.password !== form.confirm) { setError('Passwords do not match'); return }
    setBusy(true); setError('')
    try {
      if (invite) {
        await acceptInvite(token, form.password)
        navigate('/dashboard', { replace: true })
      } else {
        await post('/auth/reset-password', { token, password: form.password }, { auth: false })
        setDone(true)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: 'var(--bg)' }}>
      <BackHome />
      <div className="w-full max-w-[420px] rounded-2xl overflow-hidden" style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
        <div style={{ height: '3px', background: 'linear-gradient(90deg,var(--brand-dark),var(--brand),var(--gold-light))' }} />
        <div className="p-8">
          <h1 className="text-[1.7rem] font-black mb-1" style={{ color: 'var(--text-primary)' }}>{invite ? 'Welcome to Keeng' : 'Set a new password'}</h1>
          <p className="text-[13.5px] mb-6" style={{ color: 'var(--text-secondary)' }}>
            {invite ? 'Choose a password to activate your account. ' : ''}{PASSWORD_HINT}
          </p>
          {!token && <p className="text-[13px]" style={{ color: 'var(--danger)' }}>This link is missing its token. Ask for a new email.</p>}
          {done && (
            <div className="space-y-4">
              <p className="text-[13.5px]" style={{ color: 'var(--text-primary)' }}>Password updated. Sign in with the new one.</p>
              <Link to="/login" className="btn-primary inline-flex px-5 py-2.5 rounded-xl text-sm">Sign in</Link>
            </div>
          )}
          {token && !done && (
            <form onSubmit={submit} className="space-y-4" noValidate>
              {error && <p className="text-[13px]" style={{ color: 'var(--danger)' }}>{error}</p>}
              <input type="password" autoComplete="new-password" value={form.password} placeholder="New password"
                onChange={e => setForm({ ...form, password: e.target.value })} className="input-field text-sm" />
              <input type="password" autoComplete="new-password" value={form.confirm} placeholder="Confirm password"
                onChange={e => setForm({ ...form, confirm: e.target.value })} className="input-field text-sm" />
              <button type="submit" disabled={busy} className="btn-primary w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
                {busy && <Loader2 size={15} className="animate-spin" />} {invite ? 'Activate account' : 'Save password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
