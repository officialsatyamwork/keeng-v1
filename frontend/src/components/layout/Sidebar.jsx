import { Link, useLocation } from 'react-router-dom'
import { useAuth, ROLES } from '../../store/auth'
import { useTheme } from '../../context/ThemeContext'
import logoBlack from '../../assets/logo-blacks.png'
import logoWhite from '../../assets/logo-whites.png'
import {
  LayoutDashboard, Calendar, Users, CreditCard,
  UserCheck, Scissors, Package, Star, Megaphone, BarChart3,
  GitBranch, Settings, ChevronLeft, ChevronRight, LogOut, X, CalendarDays,
} from 'lucide-react'

const NAV = [
  { group: 'Overview', items: [
    { icon: LayoutDashboard, label: 'Dashboard', module: 'dashboard', path: '/dashboard' },
  ]},
  { group: 'Operations', items: [
    { icon: Calendar, label: 'Appointments', module: 'appointments', path: '/dashboard/appointments' },
    { icon: CalendarDays, label: 'Calendar', module: 'calendar', path: '/dashboard/calendar' },
    { icon: Users, label: 'Customers', module: 'customers', path: '/dashboard/customers' },
    { icon: CreditCard, label: 'Billing & POS', module: 'billing', path: '/dashboard/billing' },
    { icon: UserCheck, label: 'Staff & Commission', module: 'staff', path: '/dashboard/staff' },
  ]},
  { group: 'Catalogue', items: [
    { icon: Scissors, label: 'Services', module: 'services', path: '/dashboard/services' },
    { icon: Package, label: 'Inventory', module: 'inventory', path: '/dashboard/inventory' },
  ]},
  { group: 'Growth', items: [
    { icon: Star, label: 'Membership', module: 'membership', path: '/dashboard/membership' },
    { icon: Megaphone, label: 'Marketing', module: 'marketing', path: '/dashboard/marketing' },
    { icon: BarChart3, label: 'Reports', module: 'reports', path: '/dashboard/reports' },
  ]},
  { group: 'Business', items: [
    { icon: GitBranch, label: 'Branches', module: 'branches', path: '/dashboard/branches' },
    { icon: Settings, label: 'Settings', module: 'settings', path: '/dashboard/settings' },
  ]},
]

export default function Sidebar({ collapsed: collapsedPref, setCollapsed, mobileOpen, onClose }) {
  const location = useLocation()
  const { theme } = useTheme()
  const user = useAuth(s => s.user)
  const can = useAuth(s => s.can)
  const logout = useAuth(s => s.logout)
  const logoSrc = theme === 'dark' ? logoWhite : logoBlack
  const groups = NAV
    .map(g => ({ ...g, items: g.items.filter(i => can(i.module)) }))
    .filter(g => g.items.length)
  const orgName = user?.tenant?.name || 'Keeng'
  const role = ROLES[user?.role] || { label: 'Account', color: 'var(--gold-text)' }
  const scope = user?.salons?.length
    ? `${user.salons.length} salon${user.salons.length === 1 ? '' : 's'}`
    : role.label
  const isActive = path => location.pathname === path || (path !== '/dashboard' && location.pathname.startsWith(`${path}/`))
  const collapsed = collapsedPref && !mobileOpen

  return (
    <>
    {mobileOpen && (
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden" onClick={onClose} />
    )}
    <aside
      className={`fixed inset-y-0 left-0 z-50 w-[240px] ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:sticky lg:top-0 lg:z-auto lg:translate-x-0 ${collapsed ? 'lg:w-[64px]' : 'lg:w-[220px]'}
        transition-all duration-300 ease-in-out flex flex-col h-screen lg:h-auto flex-shrink-0`}
      style={{ background: 'var(--bg-2)', borderRight: '1px solid var(--border)' }}
    >
      <div className={`flex items-center ${collapsed ? 'justify-center px-0' : 'justify-between px-4'} py-5`}
        style={{ borderBottom: '1px solid var(--border)' }}>
        {!collapsed && (
          <Link to="/" className="flex items-center min-w-0">
            <img src={logoSrc} alt="Keeng" className="logo-img h-10" />
          </Link>
        )}
        {collapsed && (
          <Link to="/" className="flex items-center justify-center w-11 h-11 overflow-hidden" title="Keeng">
            <img src={logoSrc} alt="Keeng" className="h-9 w-9 object-cover object-left" />
          </Link>
        )}
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            aria-label="Collapse sidebar"
            className="hidden lg:flex w-9 h-9 rounded-xl items-center justify-center transition-all"
            style={{ color: 'var(--text-primary)', background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <ChevronLeft size={18} strokeWidth={2.25} />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="btn-icon-close sidebar-mobile-only !w-10 !h-10"
        >
          <X size={20} strokeWidth={2.25} />
        </button>
      </div>

      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          aria-label="Expand sidebar"
          className="hidden lg:flex w-9 h-9 mx-auto mt-2 rounded-xl items-center justify-center transition-all"
          style={{ color: 'var(--text-primary)', background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <ChevronRight size={18} strokeWidth={2.25} />
        </button>
      )}

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
        {groups.map((group, gi) => (
          <div key={group.group} className={gi > 0 ? 'mt-4' : ''}>
            {!collapsed && (
              <p className="px-3 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-fg-muted">
                {group.group}
              </p>
            )}
            {group.items.map(item => {
              const active = isActive(item.path)
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={onClose}
                  title={collapsed ? item.label : undefined}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 mb-0.5 ${
                    active ? 'nav-active' : 'text-fg-2 hover:text-fg hover:bg-fg/5'
                  } ${collapsed ? 'justify-center' : ''}`}
                >
                  <item.icon size={16} className="flex-shrink-0" style={active ? { color: '#c9973a' } : {}} />
                  {!collapsed && (
                    <span className="text-[13px] font-medium" style={active ? { color: 'var(--gold-text)' } : {}}>
                      {item.label}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="px-2 py-3" style={{ borderTop: '1px solid var(--border)' }}>
        {!collapsed && (
          <div className="flex items-center gap-2.5 px-3 py-2 mb-1 rounded-xl" style={{ background: 'var(--surface)' }}>
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #c9973a, #e8c97a)', color: '#0b0e18' }}>
              {orgName[0]}
            </div>
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-fg truncate leading-tight">{orgName}</p>
              <p className="text-[11px] leading-tight truncate">
                <span className="font-semibold" style={{ color: role.color }}>{role.label}</span>
                <span className="text-fg-muted"> · {scope}</span>
              </p>
            </div>
          </div>
        )}
        <button onClick={logout}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-fg-muted hover:text-red-400 hover:bg-red-500/8 transition-all ${collapsed ? 'justify-center' : ''}`}>
          <LogOut size={15} />
          {!collapsed && <span className="text-[13px] font-medium">Logout</span>}
        </button>
      </div>
    </aside>
    </>
  )
}
