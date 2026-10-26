import type { CompletenessFlag, PlayerProjection } from './schema'

/** Canonical NBA team codes (NBA.com tricodes). */
export const NBA_TEAMS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS',
] as const

const TEAM_ALIASES: Record<string, string> = {
  GS: 'GSW', GOS: 'GSW', NO: 'NOP', NOR: 'NOP', NOH: 'NOP', NY: 'NYK', SA: 'SAS', SAN: 'SAS',
  UTAH: 'UTA', UTH: 'UTA', WSH: 'WAS', PHO: 'PHX', BRK: 'BKN', BKLN: 'BKN', NJN: 'BKN', CHO: 'CHA', CHH: 'CHA',
  LAK: 'LAL', OKL: 'OKC', SEA: 'OKC', PHL: 'PHI', TORONTO: 'TOR', FA: 'FA', 'FREE AGENT': 'FA',
}

export function normalizeTeam(raw: string | null | undefined): string | null {
  if (!raw) return null
  const t = raw.trim().toUpperCase().replace(/[^A-Z ]/g, '')
  if (!t) return null
  if ((NBA_TEAMS as readonly string[]).includes(t)) return t
  return TEAM_ALIASES[t] ?? t
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v'])
/** Letters that do not decompose under NFD. */
const TRANSLIT: Record<string, string> = { ø: 'o', Ø: 'o', ł: 'l', Ł: 'l', đ: 'd', Đ: 'd', æ: 'ae', Æ: 'ae', ß: 'ss', ı: 'i' }

/**
 * Identity key for matching names across sources: strips accents, punctuation,
 * generational suffixes and case. "Luka Dončić" == "luka doncic";
 * "Trey Murphy III" == "trey murphy"; "D'Angelo" == "dangelo".
 */
export function normalizeName(name: string): string {
  const base = name
    .replace(/[øØłŁđĐæÆßı]/g, (c) => TRANSLIT[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’`]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  while (base.length > 1 && SUFFIXES.has(base[base.length - 1])) base.pop()
  return base.join(' ')
}

/**
 * Provider name variants for the same player, as normalized keys
 * (alias → canonical). Limited to well-established nickname / legal-name
 * pairs (e.g. Herb ↔ Herbert Jones); suffixes, accents and punctuation are
 * already handled by normalizeName. Look-alike names that are different
 * people (Jalen vs Jaden McDaniels, Julian vs Justin Champagnie) must never
 * be added. The ingest audit lists near-miss names for review.
 */
export const VERIFIED_ALIASES: Record<string, string> = {
  'herb jones': 'herbert jones',
  'nic claxton': 'nicolas claxton',
  'bub carrington': 'carlton carrington',
  'cam johnson': 'cameron johnson',
  'cam thomas': 'cameron thomas',
  'moe wagner': 'moritz wagner',
  'alex sarr': 'alexandre sarr',
  'ron holland': 'ronald holland',
  'nahshon hyland': 'bones hyland',
  'gregory jackson': 'gg jackson',
  'kenyon martin': 'kj martin',
}

/** Identity key across sources: normalized name with verified aliases applied. */
export function canonicalKey(name: string): string {
  const k = normalizeName(name)
  return VERIFIED_ALIASES[k] ?? k
}

export function slugify(name: string): string {
  return normalizeName(name).replace(/\s+/g, '-')
}

/**
 * Some sites render a full and an abbreviated name in one cell and hide one
 * with CSS, so a raw copy can read "Nikola JokicN.Jokic" or "Jane Doe J. Doe".
 * Remove a trailing "X.Lastname" that repeats the end of the full name.
 */
export function cleanDoubledName(raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim()
  const re = /[A-Z][a-z]?\.\s?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index === 0) continue
    const full = s.slice(0, m.index).trim()
    const abbrLast = s.slice(m.index + m[0].length).trim()
    if (abbrLast.length >= 2 && full.length > abbrLast.length && full.toLowerCase().endsWith(abbrLast.toLowerCase()))
      return full
  }
  return s
}

/** Mutating helper: derive what can be derived (never attempts from a percentage alone) and set flags. */
export function finalizeProjection(p: PlayerProjection): PlayerProjection {
  const flags = new Set<CompletenessFlag>(p.completenessFlags)
  const out = { ...p }

  // FG
  if (out.fieldGoalsAttempted != null) {
    if (out.fieldGoalsMade == null && out.fieldGoalPct != null) {
      out.fieldGoalsMade = out.fieldGoalPct * out.fieldGoalsAttempted
      flags.add('derived-fgm')
    }
    if (out.fieldGoalPct == null && out.fieldGoalsMade != null && out.fieldGoalsAttempted > 0) {
      out.fieldGoalPct = out.fieldGoalsMade / out.fieldGoalsAttempted
      flags.add('derived-fg-pct')
    }
  }
  if (out.fieldGoalsAttempted == null || out.fieldGoalsMade == null) {
    flags.add('missing-fga')
    if (out.fieldGoalPct != null) flags.add('pct-without-volume')
  }

  // FT
  if (out.freeThrowsAttempted != null) {
    if (out.freeThrowsMade == null && out.freeThrowPct != null) {
      out.freeThrowsMade = out.freeThrowPct * out.freeThrowsAttempted
      flags.add('derived-ftm')
    }
    if (out.freeThrowPct == null && out.freeThrowsMade != null && out.freeThrowsAttempted > 0) {
      out.freeThrowPct = out.freeThrowsMade / out.freeThrowsAttempted
      flags.add('derived-ft-pct')
    }
  }
  if (out.freeThrowsAttempted == null || out.freeThrowsMade == null) {
    flags.add('missing-fta')
    if (out.freeThrowPct != null) flags.add('pct-without-volume')
  }

  if (out.gamesProjected == null) flags.add('missing-gp')
  else flags.delete('missing-gp')
  if (out.minutesPerGame == null) flags.add('missing-minutes')
  else flags.delete('missing-minutes')
  if (out.espnAdp == null && out.otherAdp == null) flags.add('missing-adp')
  else flags.delete('missing-adp')
  out.completenessFlags = [...flags]
  return out
}

export const FLAG_TEXT: Record<CompletenessFlag, string> = {
  'missing-fga': 'No FG attempts — FG% impact unknown',
  'missing-fta': 'No FT attempts — FT% impact unknown',
  'missing-gp': 'Games projected not supplied',
  'missing-minutes': 'Minutes not supplied',
  'missing-adp': 'No ADP',
  'missing-positions': 'No position eligibility',
  'derived-fgm': 'FGM derived from FG% × FGA',
  'derived-ftm': 'FTM derived from FT% × FTA',
  'derived-fg-pct': 'FG% derived from FGM / FGA',
  'derived-ft-pct': 'FT% derived from FTM / FTA',
  'unit-converted-from-totals': 'Converted from season totals ÷ GP',
  'pct-without-volume': 'Percentage given without attempt volume',
  'gp-supplemental': 'Games/minutes from a different source (labelled)',
  'adp-fallback': 'ESPN ADP via FantasyPros (ordinal), not ESPN Live Draft Trends',
  'adp-capped': "ESPN AVG PICK at ESPN's ~140 ceiling — rarely drafted",
}

/** Severity used for the compact data-quality signal. */
export function qualityLevel(flags: readonly CompletenessFlag[]): 'complete' | 'partial' | 'limited' {
  const severe = flags.filter((f) => f === 'missing-fga' || f === 'missing-fta').length
  if (severe >= 2) return 'limited'
  if (severe === 1 || flags.includes('missing-gp')) return 'partial'
  return 'complete'
}
