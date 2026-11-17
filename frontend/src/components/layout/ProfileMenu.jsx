import { useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, UserRound, GitBranch, Moon, LogOut } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import useDismiss from '../../hooks/useDismiss'
import { useAuth, ROLES, initials } from '../../store/auth'

function Avatar({ name, size = 32, radius = 10, text = 13 }) {
  return (
    <span className="relative flex-shrink-0">
      <span className="flex items-center justify-center font-bold"
        style={{
          width: size, height: size, borderRadius: radius, fontSize: text,
          background: 'linear-gradient(135deg, #c9973a, #e8c97a)', color: '#2a1a0a',
        }}>
        {initials(name)}
      </span>
      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-500"
        style={{ boxShadow: '0 0 0 2px var(--panel)' }} />
    </span>
  )
}

export default function ProfileMenu({ open, onToggle, onClose }) {
  const ref = useRef(null)
  const navigate = useNavigate()
  const { theme, toggle } = useTheme()
  const user = useAuth(s => s.user)
  const can = useAuth(s => s.can)
  const signOut = useAuth(s => s.logout)
  useDismiss(ref, open, onClose)

  const role = ROLES[user?.role] || { label: 'Account', color: '#e8c97a' }
  const name = user?.fullName || 'Account'
  const scope = user?.tenant?.name || 'Velura'
  const logout = () => { onClose(); signOut(); navigate('/login') }

  const links = [
    { icon: UserRound, label: 'My account', to: '/dashboard/settings', show: true },
    { icon: GitBranch, label: 'Branches', to: '/dashboard/branches', show: can('branches') },
  ]

  return (
    <div ref={ref} className="sm:relative">
      <button onClick={onToggle} aria-label="Account menu" aria-expanded={open}
        className={`flex items-center gap-2 rounded-xl p-0.5 xl:pr-2 transition-all ${open ? 'bg-fg/10' : 'hover:bg-fg/5'}`}>
        <Avatar name={name} />
        <span className="hidden xl:block text-left">
          <span className="block text-[12.5px] font-semibold text-fg leading-tight">{name}</span>
          <span className="block text-[11px] text-fg-muted leading-tight">{role.label}</span>
        </span>
        <ChevronDown size={14}
          className={`hidden xl:block text-fg-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            style={{ transformOrigin: 'top right', background: 'var(--panel)', border: '1px solid var(--border)', boxShadow: '0 20px 60px var(--shadow)' }}
            className="absolute left-3 right-3 top-[64px] sm:left-auto sm:right-0 sm:top-full sm:mt-2.5 sm:w-[300px] z-50 rounded-2xl overflow-hidden"
            role="menu"
          >
            <div className="p-4" style={{ background: 'linear-gradient(135deg, var(--brand-soft), var(--gold-soft))' }}>
              <div className="flex items-center gap-3">
                <Avatar name={name} size={46} radius={14} text={16} />
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-fg truncate">{name}</p>
                  <p className="text-[12px] text-fg-2 truncate">{user?.email}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0"
                  style={{ background: `${role.color}1f`, color: role.color }}>
                  {role.label}
                </span>
                <span className="text-[11.5px] text-fg-2 truncate">{scope}</span>
              </div>
            </div>

            <div className="p-1.5 mt-1.5">
              {links.filter(l => l.show).map(({ icon: Icon, label, to }) => (
                <Link key={label} to={to} onClick={onClose} role="menuitem"
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-fg-2 hover:text-fg hover:bg-fg/5 transition-colors">
                  <Icon size={16} className="text-fg-muted" /> {label}
                </Link>
              ))}
              <button onClick={toggle} role="menuitemcheckbox" aria-checked={theme === 'dark'}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-fg-2 hover:text-fg hover:bg-fg/5 transition-colors">
                <Moon size={16} className="text-fg-muted" />
                <span className="flex-1 text-left">Dark mode</span>
                <span className="relative w-9 h-5 rounded-full transition-colors"
                  style={{ background: theme === 'dark' ? 'var(--brand)' : 'color-mix(in srgb, var(--text-primary) 15%, transparent)' }}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${theme === 'dark' ? 'left-[18px]' : 'left-0.5'}`} />
                </span>
              </button>
            </div>

            <div className="p-1.5 border-t border-line">
              <button onClick={logout} role="menuitem"
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-red-400 hover:bg-red-500/10 transition-colors">
                <LogOut size={16} /> Log out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
