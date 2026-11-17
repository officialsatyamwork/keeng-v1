import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { post } from '../../lib/api'
import BackHome from '../../components/auth/BackHome'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!/\S+@\S+\.\S+/.test(email)) { setError('Enter a valid email'); return }
    setBusy(true); setError('')
    try {
      await post('/auth/forgot-password', { email: email.trim() }, { auth: false })
      setSent(true)
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
          <h1 className="text-[1.7rem] font-black mb-1" style={{ color: 'var(--text-primary)' }}>Forgot password?</h1>
          <p className="text-[13.5px] mb-6" style={{ color: 'var(--text-secondary)' }}>We'll email you a link to set a new one.</p>
          {sent ? (
            <div className="space-y-4">
              <p className="text-[13.5px]" style={{ color: 'var(--text-primary)' }}>If an account exists for {email}, a reset link is on its way. It expires in 30 minutes.</p>
              <Link to="/login" className="block text-center text-sm" style={{ color: 'var(--brand)' }}>Back to sign in</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              {error && <p className="text-[13px]" style={{ color: '#f87171' }}>{error}</p>}
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@business.com" autoComplete="email" className="input-field text-sm" />
              <button type="submit" disabled={busy} className="btn-primary w-full py-3 rounded-xl text-sm font-semibold flex items-center justify-center gap-2">
                {busy && <Loader2 size={15} className="animate-spin" />} Send reset link
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
