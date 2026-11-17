import { useCallback, useState } from 'react'
import { Sun, Moon, Menu } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import NotificationMenu from './NotificationMenu'
import ProfileMenu from './ProfileMenu'
import { useAuth } from '../../store/auth'

export default function TopBar({ title, onMenu }) {
  const { theme, toggle } = useTheme()
  const [openMenu, setOpenMenu] = useState(null)
  const close = useCallback(() => setOpenMenu(null), [])
  const toggleMenu = name => setOpenMenu(m => (m === name ? null : name))
  const user = useAuth(s => s.user)
  const salonId = useAuth(s => s.salonId)
  const setSalon = useAuth(s => s.setSalon)
  const salons = user?.salons || []
  const multi = ['master_admin', 'super_admin'].includes(user?.role) && salons.length > 1

  return (
    <header
      className="h-[60px] flex items-center justify-between gap-3 px-4 sm:px-6 sticky top-0 z-30 flex-shrink-0"
      style={{
        background: 'var(--nav-bg)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <button onClick={onMenu} aria-label="Open menu"
          className="lg:hidden -ml-1.5 w-9 h-9 rounded-xl flex items-center justify-center text-fg-2 hover:text-fg hover:bg-fg/5 transition-all flex-shrink-0">
          <Menu size={19} />
        </button>
        <h1 className="text-[15px] font-semibold text-fg tracking-tight truncate">{title}</h1>
      </div>

      <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
        {multi && (
          <select
            aria-label="Salon"
            value={salonId || ''}
            onChange={e => setSalon(e.target.value || null)}
            className="input-field py-1.5 px-3 text-[12.5px] rounded-xl max-w-[180px]"
          >
            <option value="">All my salons</option>
            {salons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {!multi && salons[0] && (
          <span className="hidden sm:block text-[12.5px] text-fg-2 truncate max-w-[160px]">{salons[0].name}</span>
        )}

        <button className="theme-toggle !w-8 !h-8" onClick={toggle} title="Toggle theme">
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <NotificationMenu open={openMenu === 'notifications'} onToggle={() => toggleMenu('notifications')} onClose={close} />

        <span className="hidden sm:block w-px h-6 bg-line" />

        <ProfileMenu open={openMenu === 'profile'} onToggle={() => toggleMenu('profile')} onClose={close} />
      </div>
    </header>
  )
}
