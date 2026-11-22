import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link, useNavigate } from 'react-router-dom'
import {
  Eye, EyeOff, ArrowRight, Zap,
  User, Mail, Phone, Building2, Briefcase, Lock,
  Store, Users, UserCog, ChevronRight, MapPin, Hourglass, Info
} from 'lucide-react'
import logoWhite from '../../assets/logo-whites.png'
import logoBlack from '../../assets/logo-blacks.png'
import { useTheme } from '../../context/ThemeContext'
import BackHome from '../../components/auth/BackHome'
import { DEMO_PASSWORD, useAuth } from '../../store/auth'
import { passwordError, PASSWORD_HINT } from '../../lib/password'
import CitySelect from '../../components/ui/CitySelect'
import { BIZ_TYPES as PLATFORM_BIZ_TYPES } from '../../data/seed'

const BIZ_TYPES = PLATFORM_BIZ_TYPES

const ROLES = [
  {
    key: 'owner',
    label: 'Master Admin',
    icon: Store,
    color: '#c9973a',
    bg: 'rgba(201,151,58,0.12)',
    border: 'rgba(201,151,58,0.35)',
    desc: 'Create your business, your first salon, and a 14-day trial. You set the password now.',
    permissions: ['All salons', 'Revenue', 'Team invites', 'Branches'],
  },
  {
    key: 'super_admin',
    label: 'Super Admin',
    icon: Building2,
    color: '#8b5cf6',
    bg: 'rgba(139,92,246,0.12)',
    border: 'rgba(139,92,246,0.35)',
    desc: 'Works across the salons a master admin assigns. You do not sign up yourself.',
    permissions: ['Assigned salons', 'Revenue', 'Team', 'Switcher'],
    inviteOnly: 'A master admin invites you from Settings → Team & Access. The email link is where you create your password.',
    demoEmail: 'admin@glowsalon.com',
  },
  {
    key: 'admin',
    label: 'Admin',
    icon: Briefcase,
    color: '#0891b2',
    bg: 'rgba(8,145,178,0.12)',
    border: 'rgba(8,145,178,0.35)',
    desc: 'Runs exactly one salon, including that salon’s revenue.',
    permissions: ['One salon', 'Revenue', 'Desk', 'Team'],
    inviteOnly: 'A master admin invites you from Settings → Team & Access and assigns one salon. You set your password from the email.',
    demoEmail: 'salonadmin@glowsalon.com',
  },
  {
    key: 'manager',
    label: 'Manager',
    icon: UserCog,
    color: '#059669',
    bg: 'rgba(5,150,105,0.12)',
    border: 'rgba(5,150,105,0.35)',
    desc: 'Runs the floor of one salon. Revenue is not on this desk.',
    permissions: ['One salon', 'Appointments', 'Team list', 'No revenue'],
    inviteOnly: 'Your salon owner invites you from Settings → Team & Access. You create your password from the email link.',
    demoEmail: 'manager@glowsalon.com',
  },
  {
    key: 'staff',
    label: 'Staff',
    icon: Users,
    color: '#db2777',
    bg: 'rgba(219,39,119,0.12)',
    border: 'rgba(219,39,119,0.35)',
    desc: 'Your own chair: appointments, commission, and the next 7 days.',
    permissions: ['My appointments', 'Commission', 'Next 7 days'],
    inviteOnly: 'Your salon owner invites you from Settings → Team & Access. You create your password from the email link.',
    demoEmail: 'riya@glowsalon.com',
  },
  {
    key: 'customer',
    label: 'Customer',
    icon: User,
    color: '#2563eb',
    bg: 'rgba(37,99,235,0.12)',
    border: 'rgba(37,99,235,0.35)',
    desc: 'Create a login, book a salon, and see only your own appointments.',
    permissions: ['My bookings', 'Any open salon', 'No salon revenue'],
    selfServe: true,
  },
]

const EMPTY_FORM = { name: '', email: '', phone: '', businessName: '', businessType: '', city: '', password: '', confirm: '', dateOfBirth: '', allergies: '', preferences: '' }

function Err({ id, errors }) {
  return (
    <AnimatePresence>
      {errors[id] && (
        <motion.p initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
          className="text-[12px] mt-1.5 flex items-center gap-1.5" style={{ color: 'var(--danger)' }}>
          <span className="w-3.5 h-3.5 rounded-full border border-red-400/60 flex items-center justify-center text-[9px] font-bold flex-shrink-0">!</span>
          {errors[id]}
        </motion.p>
      )}
    </AnimatePresence>
  )
}

function IField({ id, form, errors, set, type = 'text', placeholder, Icon, autoComplete = '' }) {
  return (
    <div className="relative">
      <Icon size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
      <input type={type} value={form[id]} onChange={e => set(id, e.target.value)}
        placeholder={placeholder} autoComplete={autoComplete}
        className={`input-field pl-10 text-sm ${errors[id] ? 'input-error' : ''}`} />
    </div>
  )
}

export default function RegisterPage() {
  const { theme } = useTheme()
  const [selectedRole, setSelectedRole] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [submitted, setSubmitted] = useState(null)
  const [showPass, setShowPass]       = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [errors, setErrors]           = useState({})
  const [loading, setLoading]         = useState(false)
  const navigate = useNavigate()
  const register = useAuth(s => s.register)
  const registerCustomer = useAuth(s => s.registerCustomer)
  const login = useAuth(s => s.login)

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: '' })) }

  const validate = () => {
    const e = {}
    if (!form.name.trim())  e.name  = 'Full name is required'
    if (!form.email)        e.email = 'Email is required'
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Enter a valid email'
    if (!form.phone)        e.phone = 'Phone is required'
    else if (!/^\d{10}$/.test(form.phone)) e.phone = 'Enter exactly 10 digits'
    if (selectedRole === 'owner') {
      if (!form.businessName.trim()) e.businessName = 'Business name is required'
      if (!form.businessType) e.businessType = 'Please select a type'
      if (!form.city.trim()) e.city = 'City is required'
    }
    if (selectedRole === 'customer') {
      if (!form.dateOfBirth) e.dateOfBirth = 'Date of birth is required'
      else if (form.dateOfBirth > new Date().toISOString().slice(0, 10)) e.dateOfBirth = 'Date of birth cannot be in the future'
    }
    if (!form.password)     e.password = 'Password is required'
    else if (passwordError(form.password)) e.password = passwordError(form.password)
    if (!form.confirm)      e.confirm = 'Please confirm your password'
    else if (form.password !== form.confirm) e.confirm = 'Passwords do not match'
    return e
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    setLoading(true)
    try {
      if (selectedRole === 'customer') {
        await registerCustomer({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          password: form.password,
          dateOfBirth: form.dateOfBirth,
          allergies: form.allergies.trim() || null,
          preferences: form.preferences.trim() || null,
        })
      } else {
        await register({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          businessName: form.businessName.trim(),
          businessType: form.businessType,
          city: form.city.trim() || null,
          password: form.password,
        })
      }
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setErrors(err.fields || {})
      setErrors(e => ({ ...e, form: err.message }))
      setLoading(false)
    }
  }

  const openDemo = async (email) => {
    setLoading(true)
    try {
      await login(email, DEMO_PASSWORD)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setErrors({ form: err.message })
      setLoading(false)
    }
  }

  const selectRole = (key) => {
    setSelectedRole(key)
    setForm(EMPTY_FORM)
    setErrors({})
  }

  const role = ROLES.find(r => r.key === selectedRole)
  const needsBusiness = selectedRole === 'owner'
  const lbl = 'block text-[13px] font-semibold mb-1.5'

  return (
    <div className="min-h-screen flex items-center justify-center px-6 pt-20 pb-12 sm:py-12" style={{ background: 'var(--bg)' }}>
      <BackHome />


      {/* Background glow */}
      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
        <motion.div
          animate={{ scale: [1, 1.15, 1], opacity: [0.08, 0.14, 0.08] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
          style={{ position: 'absolute', top: '-20%', left: '50%', transform: 'translateX(-50%)', width: '800px', height: '600px', borderRadius: '50%', background: 'radial-gradient(ellipse,rgba(196,96,122,1) 0%,transparent 70%)', filter: 'blur(60px)' }}
        />
        <motion.div
          animate={{ scale: [1, 1.2, 1], opacity: [0.05, 0.1, 0.05] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
          style={{ position: 'absolute', bottom: '-10%', right: '-5%', width: '500px', height: '500px', borderRadius: '50%', background: 'radial-gradient(ellipse,rgba(201,151,58,1) 0%,transparent 70%)', filter: 'blur(60px)' }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full"
        style={{ maxWidth: selectedRole ? '520px' : '640px' }}
      >
        {/* Logo + heading */}
        <div className="text-center mb-7">
          <Link to="/" className="inline-block mb-5">
            <img src={theme === 'dark' ? logoWhite : logoBlack} alt="Keeng" className="logo-img h-14 mx-auto" />
          </Link>
          <AnimatePresence mode="wait">
            {submitted ? null : !selectedRole ? (
              <motion.div key="h1" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <h1 className="text-[2rem] font-black mb-1.5" style={{ color: 'var(--text-primary)', letterSpacing: '-0.025em' }}>
                  Who are you signing up as?
                </h1>
                <p className="text-[0.9rem]" style={{ color: 'var(--text-secondary)' }}>
                  Pick your role to get the right access
                </p>
              </motion.div>
            ) : (
              <motion.div key="h2" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-bold mb-3"
                  style={{ background: role.bg, border: `1px solid ${role.border}`, color: role.color }}>
                  <role.icon size={12} /> {role.label}
                </div>
                <h1 className="text-[2rem] font-black mb-1.5" style={{ color: 'var(--text-primary)', letterSpacing: '-0.025em' }}>
                  {role.selfServe ? 'Create your account' : role.inviteOnly ? 'Join your salon' : 'Register your salon'}
                </h1>
                <p className="text-[0.875rem]" style={{ color: 'var(--text-secondary)' }}>{role.desc}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence mode="wait">

          {/* ══ STEP 1 — Role picker ══ */}
          {!selectedRole && (
            <motion.div key="roles"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="relative rounded-2xl overflow-hidden"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)', boxShadow: '0 12px 60px var(--shadow)' }}
            >
              <div style={{ height: '3px', background: 'linear-gradient(90deg,var(--brand-dark),var(--brand),var(--gold-light),var(--brand-light))' }} />

              <div className="p-5">
                <div className="grid grid-cols-1 gap-2.5">
                  {ROLES.map((r, i) => (
                    <motion.button
                      key={r.key}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.07, ease: [0.22, 1, 0.36, 1] }}
                      type="button"
                      onClick={() => selectRole(r.key)}
                      className="w-full text-left rounded-xl transition-all duration-200"
                      style={{ background: 'var(--surface)', border: '1px solid var(--border)', padding: '14px 16px' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = r.border; e.currentTarget.style.background = r.bg; e.currentTarget.style.transform = 'translateX(4px)' }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.transform = 'translateX(0)' }}
                    >
                      <div className="flex items-center gap-4">
                        {/* Icon */}
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                          style={{ background: r.bg, border: `1px solid ${r.border}`, boxShadow: `0 4px 16px ${r.color}22` }}>
                          <r.icon size={20} style={{ color: r.color }} />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-[14px] font-bold" style={{ color: 'var(--text-primary)' }}>{r.label}</p>
                          </div>
                          <p className="text-[12px] leading-snug" style={{ color: 'var(--text-secondary)' }}>{r.desc}</p>
                          {/* Permission tags */}
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {r.permissions.map(p => (
                              <span key={p} className="text-[10px] font-semibold px-2 py-0.5 rounded-md"
                                style={{ background: r.bg, color: r.color, border: `1px solid ${r.border}` }}>
                                {p}
                              </span>
                            ))}
                          </div>
                        </div>

                        <ChevronRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      </div>
                    </motion.button>
                  ))}
                </div>
              </div>

              <div className="px-5 pb-5">
                <div className="flex items-center gap-3 mb-3.5">
                  <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>already have an account?</span>
                  <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                </div>
                <Link to="/login"
                  className="w-full py-3 rounded-xl font-semibold text-[13px] flex items-center justify-center gap-2 btn-ghost"
                  style={{ color: 'var(--text-secondary)' }}>
                  Sign in <ArrowRight size={14} />
                </Link>
              </div>
            </motion.div>
          )}

          {/* ══ Invite-only roles ══ */}
          {selectedRole && role?.inviteOnly && !submitted && (
            <motion.div key="invite" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl p-7"
              style={{ background: 'var(--card-bg)', border: `1px solid ${role.border}`, boxShadow: '0 12px 60px var(--shadow)' }}>
              <div className="flex gap-3 p-4 rounded-xl mb-5" style={{ background: role.bg, border: `1px solid ${role.border}` }}>
                <Info size={17} className="flex-shrink-0 mt-0.5" style={{ color: role.color }} />
                <p className="text-[13px]" style={{ color: 'var(--text-primary)' }}>{role.inviteOnly}</p>
              </div>
              {errors.form && <p className="text-[13px] mb-3" style={{ color: 'var(--danger)' }}>{errors.form}</p>}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button type="button" onClick={() => setSelectedRole(null)}
                  className="py-3 rounded-xl font-semibold text-[13px] btn-ghost" style={{ color: 'var(--text-secondary)' }}>
                  ← Change role
                </button>
                <Link to="/login" className="py-3 rounded-xl font-semibold text-[13px] flex items-center justify-center gap-2 btn-ghost" style={{ color: 'var(--text-secondary)' }}>
                  I have an account <ArrowRight size={14} />
                </Link>
                <button type="button" disabled={loading} onClick={() => openDemo(role.demoEmail)}
                  className="py-3 rounded-xl font-semibold text-[13px] btn-primary">
                  Open demo desk
                </button>
              </div>
            </motion.div>
          )}

          {/* ══ STEP 2 — Form ══ */}
          {selectedRole && !role?.inviteOnly && !submitted && (
            <motion.div key="form"
              initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              {errors.form && <p className="text-[13px] mb-3" style={{ color: 'var(--danger)' }}>{errors.form}</p>}

              {/* Card */}
              <div className="relative rounded-2xl overflow-hidden"
                style={{ background: 'var(--card-bg)', border: `1px solid ${role.border}`, boxShadow: `0 12px 60px var(--shadow), 0 0 0 1px ${role.color}18` }}>
                <div style={{ height: '3px', background: `linear-gradient(90deg,${role.color},${role.color}88,${role.color}44)` }} />

                <div className="p-7">
                  <form onSubmit={handleSubmit} noValidate>

                    {/* Personal */}
                    <p className="text-[11px] font-bold uppercase tracking-[0.1em] mb-4" style={{ color: 'var(--text-muted)' }}>Personal details</p>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div>
                        <label className={lbl} style={{ color: 'var(--text-primary)' }}>Full Name</label>
                        <IField id="name" form={form} errors={errors} set={set} Icon={User} placeholder="Your name" autoComplete="name" />
                        <Err id="name" errors={errors} />
                      </div>
                      <div>
                        <label className={lbl} style={{ color: 'var(--text-primary)' }}>Phone Number</label>
                        <IField id="phone" form={form} errors={errors} set={set} type="tel" Icon={Phone} placeholder="10-digit number" autoComplete="tel" />
                        <Err id="phone" errors={errors} />
                      </div>
                    </div>
                    <div className="mb-5">
                      <label className={lbl} style={{ color: 'var(--text-primary)' }}>Email Address</label>
                      <IField id="email" form={form} errors={errors} set={set} type="email" Icon={Mail} placeholder="you@business.com" autoComplete="email" />
                      <Err id="email" errors={errors} />
                    </div>

                    {selectedRole === 'customer' && (
                      <>
                        <div className="mb-4">
                          <label className={lbl} style={{ color: 'var(--text-primary)' }}>Date of birth</label>
                          <input type="date" value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)}
                            className={`input-field text-sm ${errors.dateOfBirth ? 'input-error' : ''}`} />
                          <Err id="dateOfBirth" errors={errors} />
                        </div>
                        <div className="mb-4">
                          <label className={lbl} style={{ color: 'var(--text-primary)' }}>Allergies</label>
                          <textarea value={form.allergies} onChange={e => set('allergies', e.target.value)}
                            placeholder="Hair colour, products, or skin. Leave blank if none."
                            className="input-field text-sm min-h-[72px]" />
                        </div>
                        <div className="mb-5">
                          <label className={lbl} style={{ color: 'var(--text-primary)' }}>How you like your service</label>
                          <textarea value={form.preferences} onChange={e => set('preferences', e.target.value)}
                            placeholder="Usual stylist, hair length, products you prefer"
                            className="input-field text-sm min-h-[72px]" />
                        </div>
                      </>
                    )}

                    {/* Business */}
                    {needsBusiness && (
                      <>
                        <div className="flex items-center gap-3 mb-5" style={{ borderTop: '1px solid var(--border)', paddingTop: '1.2rem' }}>
                          <p className="text-[11px] font-bold uppercase tracking-[0.1em] whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Business details</p>
                          <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                        </div>
                        <div className="grid grid-cols-2 gap-4 mb-5">
                          <div>
                            <label className={lbl} style={{ color: 'var(--text-primary)' }}>Business Name</label>
                            <IField id="businessName" form={form} errors={errors} set={set} Icon={Building2} placeholder="Your salon / spa" />
                            <Err id="businessName" errors={errors} />
                          </div>
                          <div>
                            <label className={lbl} style={{ color: 'var(--text-primary)' }}>Business Type</label>
                            <div className="relative">
                              <Briefcase size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                              <select value={form.businessType} onChange={e => set('businessType', e.target.value)}
                                className={`input-field pl-10 text-sm ${errors.businessType ? 'input-error' : ''}`}
                                style={{ background: 'var(--input-bg)' }}>
                                <option value="">Select type</option>
                                {BIZ_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </div>
                            <Err id="businessType" errors={errors} />
                          </div>
                        </div>
                        <div className="mb-5">
                          <label className={lbl} style={{ color: 'var(--text-primary)' }}>City</label>
                          <CitySelect value={form.city} onChange={city => set('city', city)} className={`input-field text-sm ${errors.city ? 'input-error' : ''}`} placeholder="Search an Indian city" />
                          <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>Search and pick a city in India.</p>
                          <Err id="city" errors={errors} />
                        </div>
                      </>
                    )}

                    {/* Password */}
                    <div className="flex items-center gap-3 mb-5" style={{ borderTop: '1px solid var(--border)', paddingTop: '1.2rem' }}>
                      <p className="text-[11px] font-bold uppercase tracking-[0.1em] whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Set a password</p>
                      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{PASSWORD_HINT}</p>
                      <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-6">
                      <div>
                        <label className={lbl} style={{ color: 'var(--text-primary)' }}>Password</label>
                        <div className="relative">
                          <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                          <input type={showPass ? 'text' : 'password'} value={form.password}
                            onChange={e => set('password', e.target.value)}
                            placeholder="Min. 8 characters" autoComplete="new-password"
                            className={`input-field pl-10 pr-10 text-sm ${errors.password ? 'input-error' : ''}`} />
                          <button type="button" onClick={() => setShowPass(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
                            {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                        <Err id="password" errors={errors} />
                      </div>
                      <div>
                        <label className={lbl} style={{ color: 'var(--text-primary)' }}>Confirm Password</label>
                        <div className="relative">
                          <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }} />
                          <input type={showConfirm ? 'text' : 'password'} value={form.confirm}
                            onChange={e => set('confirm', e.target.value)}
                            placeholder="Re-enter password" autoComplete="new-password"
                            className={`input-field pl-10 pr-10 text-sm ${errors.confirm ? 'input-error' : ''}`} />
                          <button type="button" onClick={() => setShowConfirm(v => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
                            {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                        <Err id="confirm" errors={errors} />
                      </div>
                    </div>

                    {/* Submit */}
                    <motion.button type="submit" whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }} disabled={loading}
                      className="w-full py-3.5 rounded-xl font-bold text-[14px] flex items-center justify-center gap-2 text-white"
                      style={{
                        opacity: loading ? 0.75 : 1,
                        background: `linear-gradient(135deg,${role.color},${role.color}bb)`,
                        boxShadow: `0 6px 24px ${role.color}44`,
                      }}>
                      {loading
                        ? <><span className="w-4 h-4 rounded-full border-2 border-white/25 border-t-white animate-spin flex-shrink-0" />Creating account…</>
                        : <><role.icon size={15} />{role.selfServe ? 'Create customer account' : 'Create salon account'} <ArrowRight size={15} /></>}
                    </motion.button>

                    <p className="text-[11.5px] text-center mt-4" style={{ color: 'var(--text-muted)' }}>
                      By signing up you agree to our{' '}
                      <a href="#" style={{ color: role.color }}>Terms</a>{' '}and{' '}
                      <a href="#" style={{ color: role.color }}>Privacy Policy</a>
                    </p>
                  </form>

                  <div className="flex items-center gap-3 mt-5 mb-4">
                    <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                    <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>or</span>
                    <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button type="button" onClick={() => { setSelectedRole(null); setErrors({}) }}
                      className="py-3 rounded-xl font-semibold text-[13px] flex items-center justify-center gap-2 btn-ghost"
                      style={{ color: 'var(--text-secondary)' }}>
                      ← Change role
                    </button>
                    <Link to="/login"
                      className="py-3 rounded-xl font-semibold text-[13px] flex items-center justify-center gap-2 btn-ghost"
                      style={{ color: 'var(--text-secondary)' }}>
                      Sign in <ArrowRight size={14} />
                    </Link>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
