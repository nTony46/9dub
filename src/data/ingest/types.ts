/**
 * Row shapes produced by the local source parsers. Every row keeps where it
 * came from (file, printed page or CSV line) so the audit can point back at
 * the original. Values are exactly as published: per game, percentages as
 * 0–1 fractions, `null` where the source shows nothing or "--".
 */

export type SourceRole =
  | 'espn-projections'
  | 'espn-live-draft'
  | 'fantasyedge-pdf'
  | 'fantasyedge-csv'
  | 'fantasypros-ecr'
  | 'fantasypros-adp'
  | 'derived-9dub'
  | 'unknown'

export const ROLE_LABEL: Record<SourceRole, string> = {
  'espn-projections': 'ESPN season projections (league projections page, printed)',
  'espn-live-draft': 'ESPN Live Draft Trends (printed)',
  'fantasyedge-pdf': 'NBA Fantasy Edge 9-cat rankings (printed page)',
  'fantasyedge-csv': 'NBA Fantasy Edge 9-cat rankings (CSV export)',
  'fantasypros-ecr': 'FantasyPros expert consensus rankings (CSV export)',
  'fantasypros-adp': 'FantasyPros overall ADP (CSV export)',
  'derived-9dub': 'Previously combined 9dub CSV (derived — reference only)',
  unknown: 'Unrecognised file',
}

export interface RowLoc {
  file: string
  /** Printed PDF page (1-based). */
  page?: number
  /** CSV data row (1-based, header excluded). */
  row?: number
}

export interface RowIssue {
  level: 'error' | 'warn'
  message: string
  loc: RowLoc
  name?: string
}

/** Player availability tag as printed by a source at capture time. */
export type StatusTag = 'day-to-day' | 'out' | 'suspended' | 'injured' | 'g-league' | 'free-agent'

const STATUS_MAP: Record<string, StatusTag> = {
  dtd: 'day-to-day',
  'day-to-day': 'day-to-day',
  gtd: 'day-to-day',
  q: 'day-to-day',
  o: 'out',
  out: 'out',
  ir: 'out',
  ofs: 'out',
  sspd: 'suspended',
  suspended: 'suspended',
  susp: 'suspended',
  inj: 'injured',
  injured: 'injured',
  'g-league': 'g-league',
}

export function parseStatus(raw: string | null | undefined): StatusTag | null {
  if (!raw) return null
  return STATUS_MAP[raw.trim().toLowerCase()] ?? null
}

export const isStatusToken = (s: string) => parseStatus(s) != null

export function statusText(tag: string): string {
  switch (tag) {
    case 'day-to-day':
      return 'Day-to-day'
    case 'out':
      return 'Out'
    case 'suspended':
      return 'Suspended'
    case 'injured':
      return 'Injured'
    case 'g-league':
      return 'G League'
    default:
      return tag
  }
}

/** One season line as printed by ESPN's projections page. */
export interface EspnStatBlock {
  gp: number | null
  min: number | null
  fgPct: number | null
  ftPct: number | null
  tpm: number | null
  reb: number | null
  ast: number | null
  /** Assist-to-turnover ratio. Displayed by ESPN; never a 9-cat category. Kept only as an integrity cross-check. */
  ato: number | null
  stl: number | null
  blk: number | null
  tov: number | null
  pts: number | null
}

export interface EspnProjectionRow {
  loc: RowLoc
  /** 0-based position of the player within this printed results page. */
  index: number
  name: string
  /** Team as printed (ESPN shows the nickname, e.g. "Nuggets"). */
  teamRaw: string | null
  team: string | null
  positions: string | null
  status: StatusTag | null
  statusRaw: string | null
  /** Row labelled "<year> PROJECTIONS" (e.g. 2027 = the 2026–27 season). */
  projection: EspnStatBlock | null
  projectionLabel: string | null
  /** Row labelled "<year> STATISTICS" — prior-season actuals, never used as a projection. */
  prior: EspnStatBlock | null
  priorLabel: string | null
  /** Stat columns present in this view (some print views omit PTS/TO). */
  columns: string[]
}

export interface LiveDraftRow {
  loc: RowLoc
  rank: number
  name: string
  teamRaw: string | null
  team: string | null
  positions: string | null
  status: StatusTag | null
  /** SNAKE DRAFT STATS → AVG PICK. The primary ESPN market number. */
  avgPick: number | null
  avgPickTrend7d: number | null
  avgSalary: number | null
  salaryTrend7d: number | null
  pctRostered: number | null
}

export interface FantasyEdgePdfRow {
  loc: RowLoc
  rank: number
  name: string
  team: string | null
  positions: string | null
  status: StatusTag | null
  /** "ADP n" shown under the name; platform not stated by the page. */
  adp: number | null
  pts: number | null
  reb: number | null
  ast: number | null
  stl: number | null
  blk: number | null
  tpm: number | null
  fgPct: number | null
  /** Second line under FG%: field-goal attempts per game. */
  fga: number | null
  ftPct: number | null
  /** Second line under FT%: free-throw attempts per game. */
  fta: number | null
  tov: number | null
  value: number | null
}

export interface FantasyEdgeCsvRow {
  loc: RowLoc
  rank: number
  name: string
  pts: number | null
  reb: number | null
  ast: number | null
  stl: number | null
  blk: number | null
  tpm: number | null
  fgPct: number | null
  ftPct: number | null
  tov: number | null
  value: number | null
}

export interface FantasyProsEcrRow {
  loc: RowLoc
  rank: number
  name: string
  team: string | null
  positions: string | null
  /** Trailing tag printed after the name cell, e.g. "G-League". */
  tag: string | null
  best: number | null
  worst: number | null
  /** Average EXPERT rank — not ADP. */
  avg: number | null
  sd: number | null
  ecrVsAdp: number | null
}

export interface FantasyProsAdpRow {
  loc: RowLoc
  rank: number
  name: string
  team: string | null
  positions: string | null
  status: StatusTag | null
  yahoo: number | null
  espn: number | null
  avg: number | null
}

export interface DerivedRow {
  loc: RowLoc
  name: string
  fga: number | null
  fta: number | null
  fgPct: number | null
  ftPct: number | null
  pts: number | null
}

export type ParsedSource =
  | { role: 'espn-projections'; rows: EspnProjectionRow[]; view: string | null; league: string | null }
  | { role: 'espn-live-draft'; rows: LiveDraftRow[]; view: string | null }
  | { role: 'fantasyedge-pdf'; rows: FantasyEdgePdfRow[] }
  | { role: 'fantasyedge-csv'; rows: FantasyEdgeCsvRow[] }
  | { role: 'fantasypros-ecr'; rows: FantasyProsEcrRow[] }
  | { role: 'fantasypros-adp'; rows: FantasyProsAdpRow[] }
  | { role: 'derived-9dub'; rows: DerivedRow[] }
  | { role: 'unknown'; rows: [] }

export interface ParseResult {
  parsed: ParsedSource
  issues: RowIssue[]
  /** Capture time printed on the page (browser print header), if any. */
  capturedAt: string | null
  printedPages: number | null
}

/** Strict numeric cell: "27.9", "+0.3", "-0.4", ".574", "1,234" → number; "--"/"" → null; anything else → NaN (caller flags). */
export function num(raw: string | null | undefined): number | null {
  if (raw == null) return null
  const s = raw.trim()
  if (s === '' || /^[-—–]+$/.test(s)) return null
  const c = s.replace(/,/g, '').replace(/^\+/, '')
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(c)) return Number.NaN
  return Number(c)
}

export const isNumericCell = (s: string) => {
  const v = num(s)
  return v === null || !Number.isNaN(v)
}
