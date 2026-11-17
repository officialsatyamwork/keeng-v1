import { create } from 'zustand'
import { onSession, post, refreshSession, setAccessToken } from '../lib/api'

export const ROLE_LABELS = {
  master_admin: 'Master Admin',
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Manager',
  employee: 'Employee',
  staff: 'Staff',
  customer: 'Customer',
}

export const ROLES = {
  master_admin: { label: 'Master Admin', color: '#e8c97a' },
  super_admin: { label: 'Super Admin', color: '#c4b5fd' },
  admin: { label: 'Admin', color: '#67e8f9' },
  manager: { label: 'Manager', color: '#6ee7b7' },
  employee: { label: 'Employee', color: '#fdba74' },
  staff: { label: 'Staff', color: '#f9a8d4' },
  customer: { label: 'Customer', color: '#93c5fd' },
}

export const LIVE_MODULES = new Set(['dashboard', 'branches', 'settings'])

/** All authenticated roles share `/dashboard`; the API shapes cards by role. */
export function dashboardPathFor(_user) {
  return '/dashboard'
}

function defaultSalonId(user, previous) {
  const salons = user?.salons || []
  if (previous && salons.some(s => s.id === previous)) return previous
  // Single-salon roles (and anyone with exactly one salon) get that salon scoped.
  if (salons.length === 1) return salons[0].id
  return null
}

export const useAuth = create((set, get) => ({
  status: 'loading',
  user: null,
  salonId: null,

  setSession(data) {
    if (data) {
      setAccessToken(data.accessToken)
      const salonId = defaultSalonId(data.user, get().salonId)
      set({ status: 'authed', user: data.user, salonId })
    } else {
      setAccessToken(null)
      set({ status: 'guest', user: null, salonId: null })
    }
  },

  async bootstrap() {
    try { await refreshSession() } catch { get().setSession(null) }
  },

  async login(identifier, password) {
    const value = identifier.trim()
    const body = value.includes('@') ? { email: value, password } : { phone: value, password }
    get().setSession(await post('/auth/login', body, { auth: false }))
  },

  async register(form) {
    get().setSession(await post('/auth/register', form, { auth: false }))
  },

  async acceptInvite(token, password) {
    get().setSession(await post('/auth/accept-invite', { token, password }, { auth: false }))
  },

  async logout() {
    try { await post('/auth/logout', undefined, { auth: false }) } catch { /* still sign out locally */ }
    get().setSession(null)
  },

  setSalon(salonId) {
    const salons = get().user?.salons || []
    if (salonId && !salons.some(s => s.id === salonId)) return
    set({ salonId: salonId || null })
  },

  can(module) {
    if (module === 'dashboard') return true
    if (module === 'calendar') return get().user?.modules?.includes('appointments') ?? false
    return get().user?.modules?.includes(module) ?? false
  },

  /** Primary salon / branch context from the authenticated session. */
  primarySalon() {
    const { user, salonId } = get()
    if (!user?.salons?.length) return null
    if (salonId) return user.salons.find(s => s.id === salonId) || null
    return user.salons[0] || null
  },
}))

onSession(data => useAuth.getState().setSession(data))

export function useScope() {
  const user = useAuth(s => s.user)
  const salonId = useAuth(s => s.salonId)
  const salons = user?.salons || []
  const visible = salonId ? salons.filter(s => s.id === salonId) : salons
  const business = user?.tenant
    ? { id: user.tenant.id, name: user.tenant.name, type: user.tenant.businessType, branches: visible }
    : null
  return { user, business, branches: visible }
}

export const initials = name => (name || '?').split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase()
