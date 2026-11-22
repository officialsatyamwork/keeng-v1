import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Crown, Building2, Store, ClipboardList, Scissors, UserRound, Loader2, ArrowRight } from 'lucide-react'
import { DEMO_PASSWORD, useAuth } from '../../store/auth'

export const DEMO_WORKSPACES = [
  { role: 'master_admin', email: 'owner@glowsalon.com', title: 'Master Admin', text: 'Every salon, network revenue, and who can sign in.', icon: Crown, accent: '#c9973a' },
  { role: 'super_admin', email: 'admin@glowsalon.com', title: 'Super Admin', text: 'Assigned salons, a salon switcher, and revenue.', icon: Building2, accent: '#8b5cf6' },
  { role: 'admin', email: 'salonadmin@glowsalon.com', title: 'Admin', text: 'One salon. Full desk, including this branch’s revenue.', icon: Store, accent: '#0891b2' },
  { role: 'manager', email: 'manager@glowsalon.com', title: 'Manager', text: 'Today’s floor and the team. Revenue stays hidden.', icon: ClipboardList, accent: '#059669' },
  { role: 'staff', email: 'riya@glowsalon.com', title: 'Staff', text: 'Your chair, commission, and the next 7 days.', icon: Scissors, accent: '#db2777' },
  { role: 'customer', email: 'customer@example.com', title: 'Customer', text: 'Book a salon and see only your own visits.', icon: UserRound, accent: '#2563eb' },
]

export default function RoleWorkspaces() {
  const login = useAuth(s => s.login)
  const verifyLogin = useAuth(s => s.verifyLogin)
  const navigate = useNavigate()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [challenge, setChallenge] = useState(null)
  const [code, setCode] = useState('')

  const enter = async (workspace) => {
    setBusy(workspace.role)
    setError('')
    try {
      const data = await login(workspace.email, DEMO_PASSWORD)
      if (data?.twoFactorRequired) {
        setChallenge({ id: data.challengeId, email: workspace.email })
        setCode('')
        setBusy('')
        return
      }
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.message || 'Could not open this workspace')
      setBusy('')
    }
  }

  const confirm = async (e) => {
    e.preventDefault()
    setBusy('code')
    setError('')
    try {
      await verifyLogin(challenge.id, code.trim())
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.message || 'That code is wrong')
      setBusy('')
    }
  }

  return (
    <div className="mt-8" hidden style={{ display: 'none' }}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] mb-2" style={{ color: 'var(--gold)' }}>Demo workspaces</p>
      <h2 className="text-xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Sign in as a role</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>Each card starts that role’s sign-in. Enter the code sent to the email.</p>
      {error && <p className="text-[13px] mb-3" style={{ color: 'var(--danger)' }}>{error}</p>}
      {challenge && (
        <form onSubmit={confirm} className="mb-4 flex gap-2">
          <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric" placeholder={`Code for ${challenge.email}`} className="input-field text-sm flex-1" />
          <button type="submit" disabled={busy === 'code' || code.length !== 6} className="btn-primary px-4 rounded-xl text-sm">Confirm</button>
        </form>
      )}
      <div className="grid sm:grid-cols-2 gap-2.5">
        {DEMO_WORKSPACES.map(workspace => {
          const Icon = workspace.icon
          const loading = busy === workspace.role
          return (
            <button key={workspace.role} type="button" onClick={() => enter(workspace)} disabled={!!busy}
              className="text-left rounded-xl p-3.5 transition-all disabled:opacity-60"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}>
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: `${workspace.accent}22` }}>
                  {loading ? <Loader2 size={16} className="animate-spin" style={{ color: workspace.accent }} /> : <Icon size={16} style={{ color: workspace.accent }} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold" style={{ color: 'var(--text-primary)' }}>{workspace.title}</span>
                  <span className="block text-[11.5px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{workspace.email}</span>
                  <span className="block text-[12px] mt-1" style={{ color: 'var(--text-secondary)' }}>{workspace.text}</span>
                </span>
                <ArrowRight size={14} className="mt-1 flex-shrink-0" style={{ color: workspace.accent }} />
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
