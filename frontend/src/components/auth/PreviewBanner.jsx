export function PreviewBanner({ release = 'V2' }) {
  return (
    <div className="mb-4 rounded-xl px-4 py-3 text-[13px]" style={{ background: 'var(--gold-soft)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>
      <strong>Sample preview · {release}.</strong> This screen shows how the module will look. Nothing you change here is saved to your salon.
    </div>
  )
}
