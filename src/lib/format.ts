/** Display formatting. Unicode minus for negatives so columns align. */
export function signed(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return '—'
  const v = Math.abs(x) < 0.5 * 10 ** -digits ? 0 : x
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`
}

export function num(x: number | null | undefined, digits = 1): string {
  if (x == null || !Number.isFinite(x)) return '—'
  return x < 0 ? `−${Math.abs(x).toFixed(digits)}` : x.toFixed(digits)
}

/** .487 style percentage (3 decimals, no leading zero). */
export function pct(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return '—'
  return x.toFixed(3).replace(/^0/, '')
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

export function dateShort(iso: string | null | undefined): string {
  if (!iso) return 'unknown'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  // Calendar dates ("2026-10-16" or midnight UTC) must not shift a day in western timezones.
  const dateOnly = /^\d{4}-\d{2}-\d{2}(T00:00(:00(\.000)?)?Z)?$/.test(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', ...(dateOnly ? { timeZone: 'UTC' } : {}) })
}

export function relTime(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return new Date(ts).toLocaleDateString()
}
