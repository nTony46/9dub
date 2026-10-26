import { cleanDoubledName, normalizeTeam } from '../normalize'

const NULLISH = new Set(['', '-', '--', '—', '–', 'n/a', 'na', 'null', 'none', '?'])

/** Parse a numeric cell: "1,234" → 1234, "+2.5" → 2.5, "—" → null. Never returns NaN. */
export function parseNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const s = String(raw).trim()
  if (NULLISH.has(s.toLowerCase())) return null
  const cleaned = s.replace(/,/g, '').replace(/^\+/, '').replace(/%$/, '')
  if (!/^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Percent cell → fraction: "52.8%" → .528, "0.528" / ".528" → .528, "52.8" → .528. */
export function parsePercent(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const s = String(raw).trim()
  const hasPct = s.endsWith('%')
  const n = parseNumber(s)
  if (n == null) return null
  if (hasPct || n > 1) return n / 100
  return n
}

const COMBO = /^\s*([0-9]*\.?[0-9]+%?)?\s*\(\s*([0-9]*\.?[0-9]+)\s*\/\s*([0-9]*\.?[0-9]+)\s*\)\s*$/

export function isPctCombo(raw: string | null | undefined): boolean {
  return raw != null && COMBO.test(String(raw))
}

/**
 * Percentage-with-volume cell as shown by some projection sites:
 * "0.573 (10.5/18.3)" → { pct: .573, made: 10.5, att: 18.3 }.
 */
export function parsePctCombo(raw: string | null | undefined): { pct: number | null; made: number | null; att: number | null } {
  const m = raw == null ? null : String(raw).match(COMBO)
  if (!m) return { pct: parsePercent(raw), made: null, att: null }
  return { pct: m[1] ? parsePercent(m[1]) : null, made: Number(m[2]), att: Number(m[3]) }
}

/**
 * Player cell. Handles "Name (TEAM - POS)" (FantasyPros style), doubled
 * full/short names ("Nikola JokicN.Jokic") and trailing injury markers.
 */
export function parsePlayerCell(raw: string): { name: string; team: string | null; positions: string | null } {
  let s = String(raw).replace(/\s+/g, ' ').trim()
  let team: string | null = null
  let positions: string | null = null
  const paren = s.match(/^(.*?)\s*\(\s*([A-Za-z]{2,4})\s*[-–—]\s*([A-Za-z/,\s]+)\)\s*(.*)$/)
  if (paren) {
    s = paren[1]
    team = normalizeTeam(paren[2])
    positions = paren[3].replace(/\s+/g, '')
  }
  s = s.replace(/\s+(DTD|O|OUT|GTD|INJ|IR|Q|SSPD|NA)$/i, '')
  return { name: cleanDoubledName(s), team, positions }
}
