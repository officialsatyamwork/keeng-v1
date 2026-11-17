import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

const titles = {
  '/dashboard': 'Dashboard',
  '/dashboard/appointments': 'Appointments',
  '/dashboard/customers': 'Customers',
  '/dashboard/billing': 'Billing & POS',
  '/dashboard/staff': 'Staff & Commission',
  '/dashboard/calendar': 'Calendar',
  '/dashboard/services': 'Services',
  '/dashboard/inventory': 'Inventory',
  '/dashboard/membership': 'Membership & Loyalty',
  '/dashboard/marketing': 'Marketing',
  '/dashboard/reports': 'Reports & Analytics',
  '/dashboard/branches': 'Branches',
  '/dashboard/settings': 'Settings',
}

export default function DashboardLayout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    const close = e => { if (e.matches) setMobileOpen(false) }
    desktop.addEventListener('change', close)
    return () => desktop.removeEventListener('change', close)
  }, [])

  return (
    <div className="dashboard flex flex-col h-screen overflow-hidden" style={{ background: 'var(--bg)' }}>
      <div className="flex flex-1 min-h-0">
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed}
          mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <TopBar title={titles[location.pathname] || 'Dashboard'} onMenu={() => setMobileOpen(true)} />
          <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-5 lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
