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

// Mid-tone colors that stay readable on both light and dark surfaces.
export const ROLES = {
  master_admin: { label: 'Master Admin', color: '#c9973a' },
  super_admin: { label: 'Super Admin', color: '#8b5cf6' },
  admin: { label: 'Admin', color: '#0891b2' },
  manager: { label: 'Manager', color: '#059669' },
  employee: { label: 'Employee', color: '#ea580c' },
  staff: { label: 'Staff', color: '#db2777' },
  customer: { label: 'Customer', color: '#2563eb' },
}

export const LIVE_MODULES = new Set([
  'dashboard', 'branches', 'settings',
  'appointments', 'calendar', 'customers', 'staff', 'services', 'membership',
  'billing', 'inventory', 'marketing', 'reports',
])

export const DEMO_PASSWORD = 'Keeng@123'

export const useAuth = create((set, get) => ({
  status: 'loading',
  user: null,
  salonId: null,

  setSession(data) {
    if (data) {
      setAccessToken(data.accessToken)
      const keep = get().salonId
      const stillAllowed = keep && data.user.salons.some(s => s.id === keep)
      set({ status: 'authed', user: data.user, salonId: stillAllowed ? keep : null })
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
    const data = await post('/auth/login', body, { auth: false })
    if (data.twoFactorRequired) return data
    get().setSession(data)
    return data
  },

  async verifyLogin(challengeId, code) {
    get().setSession(await post('/auth/login/verify', { challengeId, code }, { auth: false }))
  },

  async register(form) {
    get().setSession(await post('/auth/register', form, { auth: false }))
  },

  async registerCustomer(form) {
    get().setSession(await post('/auth/register/customer', form, { auth: false }))
  },

  async acceptInvite(token, password) {
    get().setSession(await post('/auth/accept-invite', { token, password }, { auth: false }))
  },

  async logout() {
    try { await post('/auth/logout', undefined, { auth: false }) } catch { /* still sign out locally */ }
    get().setSession(null)
  },

  setSalon(salonId) { set({ salonId }) },

  can(module) {
    if (module === 'dashboard') return true
    if (module === 'calendar') return get().user?.modules?.includes('appointments') ?? false
    return get().user?.modules?.includes(module) ?? false
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
