import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LandingPage from './pages/landing/LandingPage'
import AboutPage from './pages/landing/AboutPage'
import FeaturesPage from './pages/landing/FeaturesPage'
import SolutionsPage from './pages/landing/SolutionsPage'
import PricingPage from './pages/landing/PricingPage'
import LoginPage from './pages/auth/LoginPage'
import RegisterPage from './pages/auth/RegisterPage'
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage'
import SetPasswordPage from './pages/auth/SetPasswordPage'
import DashboardLayout from './components/layout/DashboardLayout'
import DashboardHome from './pages/dashboard/DashboardHome'
import AppointmentsPage from './pages/dashboard/AppointmentsPage'
import CustomersPage from './pages/dashboard/CustomersPage'
import BillingPage from './pages/dashboard/BillingPage'
import StaffPage from './pages/dashboard/StaffPage'
import ServicesPage from './pages/dashboard/ServicesPage'
import InventoryPage from './pages/dashboard/InventoryPage'
import MembershipPage from './pages/dashboard/MembershipPage'
import MarketingPage from './pages/dashboard/MarketingPage'
import ReportsPage from './pages/dashboard/ReportsPage'
import BranchesPage from './pages/dashboard/BranchesPage'
import SettingsPage from './pages/dashboard/SettingsPage'
import CalendarPage from './pages/dashboard/CalendarPage'
import { GuestOnly, RequireAuth, RequireModule } from './components/auth/ProtectedRoute'
import { PreviewBanner } from './components/auth/PreviewBanner'
import { LIVE_MODULES, useAuth } from './store/auth'

const modulePages = [
  ['appointments', AppointmentsPage, 'V2'],
  ['calendar', CalendarPage, 'V2'],
  ['customers', CustomersPage, 'V2'],
  ['billing', BillingPage, 'V3'],
  ['staff', StaffPage, 'V2'],
  ['services', ServicesPage, 'V2'],
  ['inventory', InventoryPage, 'V3'],
  ['membership', MembershipPage, 'V2'],
  ['marketing', MarketingPage, 'V3'],
  ['reports', ReportsPage, 'V3'],
  ['branches', BranchesPage],
  ['settings', SettingsPage],
]

function ModulePage({ module, release, Page }) {
  const live = LIVE_MODULES.has(module)
  return (
    <>
      {!live && <PreviewBanner release={release} />}
      <Page />
    </>
  )
}

export default function App() {
  const bootstrap = useAuth(s => s.bootstrap)
  useEffect(() => { bootstrap() }, [bootstrap])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/solutions" element={<SolutionsPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
        <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<SetPasswordPage mode="reset" />} />
        <Route path="/accept-invite" element={<SetPasswordPage mode="invite" />} />
        <Route element={<RequireAuth />}>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<DashboardHome />} />
            {modulePages.map(([path, Page, release]) => (
              <Route
                key={path}
                path={path}
                element={<RequireModule module={path}><ModulePage module={path} release={release} Page={Page} /></RequireModule>}
              />
            ))}
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
