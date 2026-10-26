import { z } from 'zod'
import type { PdfItem, PdfPage } from './ingest/pdfLines.ts'

/**
 * NBA regular-season schedule (reference data for in-season matchup
 * projections). Built from the official "Schedule By Date" PDF the user
 * downloads — read from its embedded text layer only, never fetched from a
 * league or NBA API.
 */

export const REGULAR_SEASON_GAMES = 82

export const ScheduleGameSchema = z.object({
  n: z.number().int(),
  /** Local game date, YYYY-MM-DD. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  away: z.string(),
  home: z.string(),
  /** Neutral-site game ("vs" in the PDF). */
  neutral: z.boolean().default(false),
  /** Emirates NBA Cup group-play game. */
  cup: z.boolean().default(false),
})
export type ScheduleGame = z.infer<typeof ScheduleGameSchema>

export const NbaScheduleSchema = z.object({
  kind: z.literal('nba-schedule'),
  season: z.string(),
  /** "AS OF …" date printed on the PDF. */
  asOf: z.string().nullable().default(null),
  source: z.object({ file: z.string(), sha256: z.string().nullable().default(null) }),
  createdAt: z.string(),
  games: z.array(ScheduleGameSchema),
  /** Games each team still needs to reach 82 (scheduled later by the NBA). */
  unscheduled: z.record(z.string(), z.number().int()).default({}),
  /** Longest Nov–Dec stretch with no games listed: where the unscheduled games most likely go. */
  tbdWindow: z.object({ start: z.string(), end: z.string() }).nullable().default(null),
})
export type NbaSchedule = z.infer<typeof NbaScheduleSchema>

/** City names as printed in the NBA schedule → the team codes used by player records. */
export const NBA_CITY_CODES: Record<string, string> = {
  Atlanta: 'ATL',
  Boston: 'BOS',
  Brooklyn: 'BKN',
  Charlotte: 'CHA',
  Chicago: 'CHI',
  Cleveland: 'CLE',
  Dallas: 'DAL',
  Denver: 'DEN',
  Detroit: 'DET',
  'Golden State': 'GSW',
  Houston: 'HOU',
  Indiana: 'IND',
  'LA Clippers': 'LAC',
  'LA Lakers': 'LAL',
  Memphis: 'MEM',
  Miami: 'MIA',
  Milwaukee: 'MIL',
  Minnesota: 'MIN',
  'New Orleans': 'NOP',
  'New York': 'NYK',
  'Oklahoma City': 'OKC',
  Orlando: 'ORL',
  Philadelphia: 'PHI',
  Phoenix: 'PHX',
  Portland: 'POR',
  Sacramento: 'SAC',
  'San Antonio': 'SAS',
  Toronto: 'TOR',
  Utah: 'UTA',
  Washington: 'WAS',
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/
const TIME_RE = /\d{1,2}:\d{2}\s*(AM|PM)?/i

const pad = (n: number) => String(n).padStart(2, '0')

export function isoFromSlashDate(s: string): string | null {
  const m = DATE_RE.exec(s.trim())
  if (!m) return null
  return `20${m[3]}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`
}

/** Calendar arithmetic on YYYY-MM-DD strings (UTC, no time-zone drift). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

export function datesBetween(start: string, end: string): string[] {
  const out: string[] = []
  for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) out.push(d)
  return out
}

function rowsOf(items: readonly PdfItem[], tol = 2): PdfItem[][] {
  const rows: { y: number; items: PdfItem[] }[] = []
  for (const it of [...items].filter((i) => i.s.trim()).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((r) => Math.abs(r.y - it.y) < tol)
    if (row) row.items.push(it)
    else rows.push({ y: it.y, items: [it] })
  }
  return rows.map((r) => r.items.sort((a, b) => a.x - b.x))
}

function parseAsOf(text: string): string | null {
  const m = /AS OF\s+([A-Z]+)\s+(\d{1,2}),\s*(\d{4})/i.exec(text)
  if (!m) return null
  const mi = MONTHS.indexOf(m[1].toLowerCase())
  return mi < 0 ? null : `${m[3]}-${pad(mi + 1)}-${pad(Number(m[2]))}`
}

/**
 * Parse the NBA "Regular Season Schedule By Date" PDF layout:
 * GAME · DAY · DATE · TEAM 1 · at|vs · TEAM 2 · LOCAL · ET · NAT TV · R · #
 * Column boundaries come from each page's header row; time cells are never
 * read as part of a team name (noon tip-offs sit closer to the team column).
 */
export function parseNbaSchedulePdf(pages: readonly PdfPage[]): { games: ScheduleGame[]; asOf: string | null; warnings: string[] } {
  const warnings: string[] = []
  const games = new Map<number, ScheduleGame>()
  let asOf: string | null = null
  let cols: { local: number; hash: number } | null = null
  for (const page of pages) {
    for (const row of rowsOf(page.items)) {
      const text = row.map((i) => i.s.trim()).join(' ')
      asOf ??= parseAsOf(text)
      if (/TEAM 1/.test(text) && /TEAM 2/.test(text)) {
        const local = row.find((i) => i.s.trim() === 'LOCAL')
        const hash = row.find((i) => i.s.trim() === '#')
        if (local) cols = { local: local.x, hash: hash?.x ?? Infinity }
        continue
      }
      const dateCell = row.find((i) => DATE_RE.test(i.s.trim()))
      const sep = row.find((i) => i.s.trim() === 'at' || i.s.trim() === 'vs')
      if (!dateCell || !sep) continue
      const date = isoFromSlashDate(dateCell.s)!
      const n = Number(row[0].s.trim())
      const localX = cols?.local ?? Infinity
      const away = row
        .filter((i) => i.x > dateCell.x + dateCell.w && i.x < sep.x)
        .map((i) => i.s.trim())
        .join(' ')
      const home = row
        .filter((i) => i.x > sep.x && i.x < localX - 1 && !TIME_RE.test(i.s))
        .map((i) => i.s.trim())
        .join(' ')
        .replace(/\s*\d{1,2}:\d{2}.*$/, '')
      const awayCode = NBA_CITY_CODES[away]
      const homeCode = NBA_CITY_CODES[home]
      if (!Number.isInteger(n) || !awayCode || !homeCode) {
        warnings.push(`Page ${page.page}: could not read "${text.slice(0, 80)}"`)
        continue
      }
      const cup = cols ? row.some((i) => i.s.trim() === 'C' && i.x >= cols!.hash - 6) : false
      if (games.has(n)) continue
      games.set(n, { n, date, away: awayCode, home: homeCode, neutral: sep.s.trim() === 'vs', cup })
    }
  }
  return { games: [...games.values()].sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n), asOf, warnings }
}

/** Games still to be scheduled per team, and the Nov–Dec gap they most likely fill (the NBA Cup knockout window). */
export function unscheduledInfo(games: readonly ScheduleGame[]): { unscheduled: Record<string, number>; tbdWindow: { start: string; end: string } | null } {
  const count = new Map<string, number>()
  for (const g of games) for (const t of [g.away, g.home]) count.set(t, (count.get(t) ?? 0) + 1)
  const unscheduled: Record<string, number> = {}
  for (const [t, c] of count) if (c < REGULAR_SEASON_GAMES) unscheduled[t] = REGULAR_SEASON_GAMES - c
  if (!games.length || !Object.keys(unscheduled).length) return { unscheduled, tbdWindow: null }
  const has = new Set(games.map((g) => g.date))
  let best = { start: '', end: '', len: 0 }
  let runStart = ''
  let runLen = 0
  for (const d of datesBetween(games[0].date, games[games.length - 1].date)) {
    const month = Number(d.slice(5, 7))
    if (has.has(d) || (month !== 11 && month !== 12)) {
      runLen = 0
      continue
    }
    if (runLen === 0) runStart = d
    runLen++
    if (runLen > best.len) best = { start: runStart, end: d, len: runLen }
  }
  return { unscheduled, tbdWindow: best.len >= 3 ? { start: best.start, end: best.end } : null }
}

export function seasonLabel(games: readonly ScheduleGame[]): string {
  const y = Number(games[0]?.date.slice(0, 4) ?? new Date().getFullYear())
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
}

/** NBA team codes playing on each date. */
export function teamsByDate(s: Pick<NbaSchedule, 'games'>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const g of s.games) {
    const set = out.get(g.date) ?? new Set<string>()
    set.add(g.away)
    set.add(g.home)
    out.set(g.date, set)
  }
  return out
}
