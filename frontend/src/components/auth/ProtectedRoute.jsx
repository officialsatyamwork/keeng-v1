import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { useAuth } from '../../store/auth'

export function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--gold)' }} />
    </div>
  )
}

export function RequireAuth() {
  const status = useAuth(s => s.status)
  const location = useLocation()
  if (status === 'loading') return <FullPageSpinner />
  if (status !== 'authed') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

export function GuestOnly({ children }) {
  const status = useAuth(s => s.status)
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'authed') return <Navigate to="/dashboard" replace />
  return children
}

export function RequireModule({ module, children }) {
  const allowed = useAuth(s => s.can(module))
  if (!allowed) {
    return (
      <div className="glass-card rounded-2xl p-10 text-center max-w-md mx-auto mt-10">
        <Lock size={28} className="mx-auto mb-3 text-fg-muted" />
        <p className="text-fg font-semibold mb-1">You don't have access to this page</p>
        <p className="text-fg-muted text-sm">Ask your salon owner if you need it.</p>
      </div>
    )
  }
  return children
}
