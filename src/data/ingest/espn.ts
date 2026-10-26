import { normalizeTeam } from '../normalize'
import { assignToColumns, columnsFromHeader, documentLines, parsePrintTimestamp, type PdfCell, type PdfLine, type PdfPage } from './pdfLines'
import {
  isNumericCell,
  isStatusToken,
  num,
  parseStatus,
  type EspnProjectionRow,
  type EspnStatBlock,
  type LiveDraftRow,
  type ParseResult,
  type RowIssue,
} from './types'

/** ESPN prints team nicknames on the projections page. */
export const ESPN_NICKNAMES: Record<string, string> = {
  hawks: 'ATL', celtics: 'BOS', nets: 'BKN', hornets: 'CHA', bulls: 'CHI', cavaliers: 'CLE', mavericks: 'DAL',
  nuggets: 'DEN', pistons: 'DET', warriors: 'GSW', rockets: 'HOU', pacers: 'IND', clippers: 'LAC', lakers: 'LAL',
  grizzlies: 'MEM', heat: 'MIA', bucks: 'MIL', timberwolves: 'MIN', pelicans: 'NOP', knicks: 'NYK', thunder: 'OKC',
  magic: 'ORL', '76ers': 'PHI', suns: 'PHX', 'trail blazers': 'POR', blazers: 'POR', kings: 'SAC', spurs: 'SAS',
  raptors: 'TOR', jazz: 'UTA', wizards: 'WAS', fa: 'FA', 'free agent': 'FA',
}

export function espnTeam(raw: string | null | undefined): string | null {
  if (!raw) return null
  const k = raw.trim().toLowerCase()
  return ESPN_NICKNAMES[k] ?? normalizeTeam(raw)
}

/** Text the ESPN site prints in its sticky navigation bars; when printed they can land on top of table rows. */
const OVERLAY = new Set([
  'Fantasy Basketball', 'Home', 'Sign Up', 'My Teams', 'Log In',
  'My Team', 'League', 'Players', 'FantasyCast', 'Scoreboard', 'Standings', 'Opposing Teams', 'Get Another Team',
])

const isHeaderFooter = (l: PdfLine, pageHeight = 612) => l.y < 30 || l.y > pageHeight - 22

function captureTime(lines: readonly PdfLine[]): string | null {
  for (const l of lines.slice(0, 3)) for (const c of l.cells) {
    const t = parsePrintTimestamp(c.s)
    if (t) return t
  }
  return null
}

// ───────────────────────────── Live Draft Trends ─────────────────────────────

/**
 * ESPN "Live Draft Trends". Each player is three printed lines:
 *   name [status]           (x ≈ 128)
 *   RANK  AVG PICK  7-DAY  AVG SALARY  7-DAY  %ROST
 *   TEAM  POSITIONS
 * Only SNAKE DRAFT STATS → AVG PICK is treated as ADP; RANK, salary and
 * %ROST are kept as separate fields.
 */
export function parseLiveDraftTrends(pages: readonly PdfPage[], file: string): ParseResult {
  const lines = documentLines(pages)
    .filter((l) => !isHeaderFooter(l))
    .map((l) => ({ ...l, cells: l.cells.filter((c) => !OVERLAY.has(c.s)) }))
    .filter((l) => l.cells.length)
  const issues: RowIssue[] = []
  const rows: LiveDraftRow[] = []
  const nameZone = (c: PdfCell) => c.x >= 110 && c.x < 150
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const first = l.cells[0]
    if (!(first.x < 60 && /^\d+$/.test(first.s))) continue
    const rank = Number(first.s)
    const nums = l.cells.filter((c) => c.x > 300 && isNumericCell(c.s))
    const loc = { file, page: l.page }
    const isTeamLine = (x: PdfLine) => /^[A-Z]{2,4}$/.test(x.cells.find(nameZone)?.s ?? '')
    // Normally the name sits ~4pt above the numbers and the team ~5pt below. When a row is cut by a
    // printed page break the name lands just under the numbers and the team line moves to the next page.
    let nameLine = [...lines.slice(Math.max(0, i - 3), i)].reverse().find((x) => x.page === l.page && l.y - x.y < 10 && x.cells.some(nameZone) && !isTeamLine(x))
    let teamLine = lines.slice(i + 1, i + 4).find((x) => x.page === l.page && x.y - l.y < 10 && isTeamLine(x))
    if (!nameLine) {
      const next = lines[i + 1]
      if (next && next.page === l.page && next.y - l.y <= 3 && next.cells.some(nameZone) && !isTeamLine(next)) nameLine = next
      const carry = lines.slice(i + 1, i + 8).find((x) => x.page === l.page + 1 && isTeamLine(x))
      if (nameLine && !teamLine && carry && carry.y < 80) teamLine = carry
    }
    const above = nameLine
    const below = teamLine
    const nameCell = above?.cells.find(nameZone)
    if (!nameCell) {
      issues.push({ level: 'error', message: `Rank ${rank}: player name line not found`, loc })
      continue
    }
    const statusRaw = above!.cells.find((c) => c !== nameCell && isStatusToken(c.s))?.s ?? null
    const teamCell = below?.cells.find(nameZone) ?? null
    const posCell = below?.cells.find((c) => teamCell && c.x > teamCell.x) ?? null
    if (nums.length !== 5) {
      issues.push({ level: 'error', message: `Rank ${rank} ${nameCell.s}: expected 5 numeric cells, found ${nums.length}`, loc, name: nameCell.s })
      continue
    }
    const [avgPick, t7, sal, st7, rost] = nums.map((c) => num(c.s))
    if (avgPick == null) issues.push({ level: 'warn', message: `Rank ${rank} ${nameCell.s}: no AVG PICK`, loc, name: nameCell.s })
    rows.push({
      loc,
      rank,
      name: nameCell.s,
      teamRaw: teamCell?.s ?? null,
      team: espnTeam(teamCell?.s),
      positions: posCell?.s ?? null,
      status: parseStatus(statusRaw),
      avgPick,
      avgPickTrend7d: t7,
      avgSalary: sal,
      salaryTrend7d: st7,
      pctRostered: rost,
    })
  }
  const view = documentLines(pages.slice(0, 1)).slice(0, 2).flatMap((l) => l.cells).find((c) => c.s.startsWith('Live Draft Trends'))?.s.split(' - ')[1] ?? null
  return { parsed: { role: 'espn-live-draft', rows, view }, issues, capturedAt: captureTime(documentLines(pages)), printedPages: pages.length }
}

// ───────────────────────────── Projections ─────────────────────────────

const ESPN_STAT_KEYS: Record<string, keyof EspnStatBlock> = {
  GP: 'gp', MIN: 'min', 'FG%': 'fgPct', 'FT%': 'ftPct', '3PM': 'tpm', REB: 'reb', AST: 'ast', 'A/TO': 'ato', STL: 'stl', BLK: 'blk', TO: 'tov', PTS: 'pts',
}

const YEAR_RE = /^(\d{4}) (STATISTICS|PROJECTIONS)$/

function blankBlock(): EspnStatBlock {
  return { gp: null, min: null, fgPct: null, ftPct: null, tpm: null, reb: null, ast: null, ato: null, stl: null, blk: null, tov: null, pts: null }
}

/**
 * ESPN "Complete <year> Projections" page (Full Projections view). Each player
 * block starts with a PLAYER / YEAR / stat header, then a "<year> STATISTICS"
 * row (prior-season actuals) and a "<year+1> PROJECTIONS" row, with the name,
 * team nickname, positions and an optional status on the left. Blocks can
 * straddle printed pages. Columns are read from each block's own header, so
 * a narrower print view without PTS/TO is detected rather than misaligned.
 */
export function parseEspnProjections(pages: readonly PdfPage[], file: string): ParseResult {
  const all = documentLines(pages)
  const lines = all
    .filter((l) => !isHeaderFooter(l))
    .map((l) => ({ ...l, cells: l.cells.filter((c) => !OVERLAY.has(c.s)) }))
    .filter((l) => l.cells.length)
  const issues: RowIssue[] = []
  const rows: EspnProjectionRow[] = []
  let league: string | null = null
  let view: string | null = null
  for (const l of lines.slice(0, 12)) {
    const c = l.cells.find((x) => /^Complete \d{4} Projections$/.test(x.s))
    if (c) league = l.cells.find((x) => x.x > c.r)?.s ?? null
    const st = l.cells.findIndex((x) => x.s === 'Scoring Type')
    if (st >= 0) view = 'pending'
  }
  if (view === 'pending') {
    const i = lines.findIndex((l) => l.cells.some((x) => x.s === 'Scoring Type'))
    view = lines[i + 1]?.cells.find((x) => x.x > 180)?.s ?? null
  }

  type Block = { header: PdfLine; lines: PdfLine[] }
  const blocks: Block[] = []
  for (const l of lines) {
    const isHeader = l.cells.some((c) => c.s === 'PLAYER') && l.cells.some((c) => c.s === 'YEAR')
    if (isHeader) blocks.push({ header: l, lines: [] })
    else if (blocks.length) blocks[blocks.length - 1].lines.push(l)
  }

  blocks.forEach((b, index) => {
    const yearCell = b.header.cells.find((c) => c.s === 'YEAR')!
    const columns = columnsFromHeader(b.header.cells.filter((c) => c.x > yearCell.r), (s) => ESPN_STAT_KEYS[s] ?? null, 'right')
    const colNames = b.header.cells.filter((c) => c.x > yearCell.r).map((c) => c.s)
    const loc = { file, page: b.header.page }
    const left = b.lines.flatMap((l) => l.cells.filter((c) => c.x < 250).map((c) => ({ c, l })))
    // Name and status share the x ≈ 90 column; the team nickname sits at x ≈ 104 with positions to its right.
    const nameCol = left.filter(({ c }) => c.x >= 80 && c.x < 100)
    const nameEntry = nameCol.find(({ c }) => !isStatusToken(c.s))
    const statusEntry = nameCol.find(({ c }) => isStatusToken(c.s))
    const teamEntry = left.find(({ c }) => c.x >= 100 && c.x < 115)
    const posCell = teamEntry ? teamEntry.l.cells.find((c) => c.x > teamEntry.c.r && c.x < 250) : undefined
    if (!nameEntry) {
      issues.push({ level: 'error', message: `Block ${index + 1}: no player name found`, loc })
      return
    }
    const name = nameEntry.c.s
    const extraNames = nameCol.filter((e) => e !== nameEntry && e !== statusEntry)
    if (extraNames.length) issues.push({ level: 'warn', message: `${name}: unexpected text in name column (${extraNames.map((e) => e.c.s).join(', ')})`, loc: { file, page: nameEntry.l.page }, name })

    let projection: EspnStatBlock | null = null
    let prior: EspnStatBlock | null = null
    let projectionLabel: string | null = null
    let priorLabel: string | null = null
    for (const l of b.lines) {
      const yc = l.cells.find((c) => c.x >= 250 && YEAR_RE.test(c.s))
      if (!yc) continue
      const valueCells = l.cells.filter((c) => c.x > yc.r + 2)
      const { values, stray } = assignToColumns(valueCells, columns, 14, 'right')
      if (stray.length) issues.push({ level: 'warn', message: `${name} ${yc.s}: unassigned cells ${stray.map((s) => s.s).join(' ')}`, loc: { file, page: l.page }, name })
      const block = blankBlock()
      for (const [k, raw] of Object.entries(values) as [keyof EspnStatBlock, string][]) {
        const v = num(raw)
        if (v != null && Number.isNaN(v)) {
          issues.push({ level: 'error', message: `${name} ${yc.s}: "${raw}" is not a number`, loc: { file, page: l.page }, name })
          continue
        }
        block[k] = v
      }
      if (/PROJECTIONS$/.test(yc.s)) {
        projection = block
        projectionLabel = yc.s
      } else {
        prior = block
        priorLabel = yc.s
      }
    }
    if (!projection) issues.push({ level: 'warn', message: `${name}: no PROJECTIONS row`, loc, name })
    rows.push({
      loc: { file, page: nameEntry.l.page },
      index,
      name,
      teamRaw: teamEntry?.c.s ?? null,
      team: espnTeam(teamEntry?.c.s),
      positions: posCell?.s ?? null,
      status: parseStatus(statusEntry?.c.s),
      statusRaw: statusEntry?.c.s ?? null,
      projection,
      projectionLabel,
      prior,
      priorLabel,
      columns: colNames,
    })
  })
  return { parsed: { role: 'espn-projections', rows, view, league }, issues, capturedAt: captureTime(all), printedPages: pages.length }
}

/** True when an ESPN stat block has nothing but dashes (e.g. a rookie's prior season). */
export function isEmptyBlock(b: EspnStatBlock | null): boolean {
  return !b || Object.values(b).every((v) => v == null)
}
