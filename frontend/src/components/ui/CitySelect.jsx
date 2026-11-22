import { useMemo, useState } from 'react'
import { INDIA_CITIES } from '../../data/indiaCities'

export default function CitySelect({ value, onChange, className = 'input-field text-sm', placeholder = 'Search an Indian city' }) {
  const [query, setQuery] = useState(value || '')
  const [open, setOpen] = useState(false)
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return INDIA_CITIES.slice(0, 12)
    return INDIA_CITIES.filter(city => city.toLowerCase().includes(q)).slice(0, 12)
  }, [query])

  return (
    <div className="relative">
      <input
        value={query}
        placeholder={placeholder}
        className={className}
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true); onChange('') }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-52 overflow-auto rounded-xl" style={{ background: 'var(--panel)', border: '1px solid var(--border)' }}>
          {matches.map(city => (
            <button type="button" key={city} className="block w-full text-left px-3 py-2 text-sm text-fg hover:bg-fg/5"
              onMouseDown={() => { setQuery(city); onChange(city); setOpen(false) }}>
              {city}
            </button>
          ))}
          {matches.length === 0 && <p className="px-3 py-2 text-sm text-fg-muted">No city matches that.</p>}
        </div>
      )}
    </div>
  )
}
