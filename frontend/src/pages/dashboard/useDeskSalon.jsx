import { useState } from 'react'
import { useAuth } from '../../store/auth'

export function useDeskSalon() {
  const salons = useAuth(s => s.user?.salons) || []
  const selected = useAuth(s => s.salonId)
  const [picked, setPicked] = useState('')
  const salonId = selected || picked || salons[0]?.id || ''
  return { salonId, setSalonId: setPicked, salons, locked: Boolean(selected) }
}

export const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })

export function SalonPicker({ salonId, setSalonId, salons, locked }) {
  if (!salons.length || locked || salons.length === 1) return null
  return (
    <select value={salonId} onChange={e => setSalonId(e.target.value)} className="input-field text-sm py-2">
      {salons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  )
}
