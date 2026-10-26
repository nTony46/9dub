import Papa from 'papaparse'
import { normalizeTeam } from '../normalize'
import { assignToColumns, columnsFromHeader, documentLines, parsePrintTimestamp, type PdfLine, type PdfPage } from './pdfLines'
import { isStatusToken, num, parseStatus, type FantasyEdgeCsvRow, type FantasyEdgePdfRow, type ParseResult, type RowIssue } from './types'

type FeKey = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'tpm' | 'fgPct' | 'ftPct' | 'tov' | 'value'
const FE_KEYS: Record<string, FeKey> = {
  PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk', '3PM': 'tpm', 'FG%': 'fgPct', 'FT%': 'ftPct', TO: 'tov', VALUE: 'value',
}

/**
 * NBA Fantasy Edge rankings page, printed. Each player is three lines:
 *   Name [status]                      FG%      FT%
 *   #   PTS REB AST STL BLK 3PM                  TO  VALUE
 *   TEAM · POS · ADP n                 FGA      FTA
 * i.e. attempts per game sit directly under the percentages.
 */
export function parseFantasyEdgePdf(pages: readonly PdfPage[], file: string): ParseResult {
  const all = documentLines(pages)
  const lines = all.filter((l) => l.y >= 30 && l.y <= 590)
  const issues: RowIssue[] = []
  const rows: FantasyEdgePdfRow[] = []
  const header = lines.find((l) => l.cells.some((c) => c.s === 'PLAYER') && l.cells.some((c) => c.s === 'VALUE'))
  if (!header) return { parsed: { role: 'fantasyedge-pdf', rows }, issues: [{ level: 'error', message: 'Rankings table header not found', loc: { file } }], capturedAt: null, printedPages: pages.length }
  const columns = columnsFromHeader(header.cells, (s) => FE_KEYS[s] ?? null, 'right')
  const near = (a: PdfLine, b: PdfLine | undefined, max: number) => !!b && b.page === a.page && Math.abs(a.y - b.y) <= max

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const first = l.cells[0]
    if (!(first && first.x < 70 && /^\d+$/.test(first.s))) continue
    const stats = l.cells.slice(1)
    if (stats.length < 8) continue
    const rank = Number(first.s)
    const loc = { file, page: l.page }
    const above = near(l, lines[i - 1], 10) ? lines[i - 1] : undefined
    const below = near(l, lines[i + 1], 10) ? lines[i + 1] : undefined
    const nameCell = above?.cells.find((c) => c.x >= 95 && c.x < 130)
    if (!above || !nameCell) {
      issues.push({ level: 'error', message: `Rank ${rank}: name line not found`, loc })
      continue
    }
    const name = nameCell.s
    const statusRaw = above.cells.find((c) => c !== nameCell && c.x < 320 && isStatusToken(c.s))?.s ?? null
    const top = assignToColumns(above.cells.filter((c) => c.x > 320), columns, 16, 'right')
    const mid = assignToColumns(stats, columns, 16, 'right')
    const metaCell = below?.cells.find((c) => c.x >= 95 && c.x < 130)
    const bottom = below ? assignToColumns(below.cells.filter((c) => c.x > 320), columns, 16, 'right') : { values: {}, stray: [] }
    for (const s of [...top.stray, ...mid.stray, ...bottom.stray]) issues.push({ level: 'warn', message: `${name}: unassigned cell "${s.s}"`, loc, name })

    const read = (raw: string | undefined, label: string): number | null => {
      const v = num(raw)
      if (v != null && Number.isNaN(v)) {
        issues.push({ level: 'error', message: `${name}: ${label} "${raw}" is not a number`, loc, name })
        return null
      }
      return v
    }
    let team: string | null = null
    let positions: string | null = null
    let adp: number | null = null
    if (metaCell) {
      const parts = metaCell.s.split('·').map((p) => p.trim())
      team = normalizeTeam(parts[0])
      positions = parts[1] ?? null
      const a = parts.find((p) => /^ADP\b/i.test(p))
      adp = a ? read(a.replace(/^ADP\s*/i, ''), 'ADP') : null
    } else issues.push({ level: 'warn', message: `${name}: team/position/ADP line not found`, loc, name })

    const row: FantasyEdgePdfRow = {
      loc,
      rank,
      name,
      team,
      positions,
      status: parseStatus(statusRaw),
      adp,
      pts: read(mid.values.pts, 'PTS'),
      reb: read(mid.values.reb, 'REB'),
      ast: read(mid.values.ast, 'AST'),
      stl: read(mid.values.stl, 'STL'),
      blk: read(mid.values.blk, 'BLK'),
      tpm: read(mid.values.tpm, '3PM'),
      tov: read(mid.values.tov, 'TO'),
      value: read(mid.values.value, 'VALUE'),
      fgPct: read(top.values.fgPct, 'FG%'),
      ftPct: read(top.values.ftPct, 'FT%'),
      fga: read((bottom.values as Partial<Record<FeKey, string>>).fgPct, 'FGA'),
      fta: read((bottom.values as Partial<Record<FeKey, string>>).ftPct, 'FTA'),
    }
    if (row.fga == null) issues.push({ level: 'warn', message: `${name}: no FGA under FG%`, loc, name })
    if (row.fta == null) issues.push({ level: 'warn', message: `${name}: no FTA under FT%`, loc, name })
    rows.push(row)
  }
  let capturedAt: string | null = null
  for (const c of all[0]?.cells ?? []) capturedAt ??= parsePrintTimestamp(c.s)
  return { parsed: { role: 'fantasyedge-pdf', rows }, issues, capturedAt, printedPages: pages.length }
}

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const res = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' })
  const [headers = [], ...rows] = res.data
  return { headers: headers.map((h) => h.trim()), rows: rows.filter((r) => r.some((c) => c.trim() !== '')) }
}

/** Fantasy Edge "Export CSV": #, Player, PTS, REB, AST, STL, BLK, 3PM, FG%, FT%, TO, Value (no attempts, team or positions). */
export function parseFantasyEdgeCsv(text: string, file: string): ParseResult {
  const { headers, rows } = parseCsv(text)
  const idx = (h: string) => headers.findIndex((x) => x.toUpperCase() === h)
  const issues: RowIssue[] = []
  const out: FantasyEdgeCsvRow[] = []
  rows.forEach((r, i) => {
    const loc = { file, row: i + 1 }
    const g = (h: string) => {
      const v = num(r[idx(h)])
      if (v != null && Number.isNaN(v)) {
        issues.push({ level: 'error', message: `Row ${i + 1}: ${h} "${r[idx(h)]}" is not a number`, loc })
        return null
      }
      return v
    }
    const name = (r[idx('PLAYER')] ?? '').trim()
    if (!name) {
      issues.push({ level: 'error', message: `Row ${i + 1}: no player name`, loc })
      return
    }
    out.push({ loc, rank: g('#') ?? i + 1, name, pts: g('PTS'), reb: g('REB'), ast: g('AST'), stl: g('STL'), blk: g('BLK'), tpm: g('3PM'), fgPct: g('FG%'), ftPct: g('FT%'), tov: g('TO'), value: g('VALUE') })
  })
  return { parsed: { role: 'fantasyedge-csv', rows: out }, issues, capturedAt: null, printedPages: null }
}
