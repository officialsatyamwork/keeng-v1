import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth, dashboardPathFor } from '../../store/auth'

export function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div className="w-8 h-8 rounded-full border-2 animate-spin" style={{ borderColor: 'var(--border)', borderTopColor: 'var(--gold)' }} />
    </div>
  )
}

/** `/` — guests go to login; signed-in users go to their role dashboard. */
export function RootRedirect() {
  const status = useAuth(s => s.status)
  const user = useAuth(s => s.user)
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'authed') return <Navigate to={dashboardPathFor(user)} replace />
  return <Navigate to="/login" replace />
}

export function RequireAuth() {
  const status = useAuth(s => s.status)
  const location = useLocation()
  if (status === 'loading') return <FullPageSpinner />
  if (status !== 'authed') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

export function GuestOnly({ children }) {
  const status = useAuth(s => s.status)
  const user = useAuth(s => s.user)
  if (status === 'loading') return <FullPageSpinner />
  if (status === 'authed') return <Navigate to={dashboardPathFor(user)} replace />
  return children
}

/** Block module URLs the user's role is not allowed to open. */
export function RequireModule({ module, children }) {
  const status = useAuth(s => s.status)
  const user = useAuth(s => s.user)
  const allowed = useAuth(s => s.can(module))
  if (status === 'loading') return <FullPageSpinner />
  if (status !== 'authed') return <Navigate to="/login" replace />
  if (!allowed) return <Navigate to={dashboardPathFor(user)} replace />
  return children
}
