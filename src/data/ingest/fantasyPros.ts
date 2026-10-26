import { normalizeTeam } from '../normalize'
import { parseCsv } from './fantasyEdge'
import { num, parseStatus, type DerivedRow, type FantasyProsAdpRow, type FantasyProsEcrRow, type ParseResult, type RowIssue } from './types'

/** "Nikola Jokic (DEN - C)" / "Pacome Dadiet (NYK - SF,SG) G-League" → parts. */
export function parseFpNameCell(raw: string): { name: string; team: string | null; positions: string | null; tag: string | null } {
  const m = raw.trim().match(/^(.*?)\s*\(\s*([A-Za-z]{2,4})\s*-\s*([A-Z, /]+?)\s*\)\s*(.*)$/)
  if (!m) return { name: raw.trim(), team: null, positions: null, tag: null }
  return { name: m[1].trim(), team: normalizeTeam(m[2]), positions: m[3].trim(), tag: m[4].trim() || null }
}

function reader(headers: string[], issues: RowIssue[], file: string) {
  const idx = (h: string) => headers.findIndex((x) => x.toUpperCase() === h.toUpperCase())
  return (r: string[], i: number, h: string): number | null => {
    const j = idx(h)
    if (j < 0) return null
    const v = num(r[j])
    if (v != null && Number.isNaN(v)) {
      issues.push({ level: 'warn', message: `Row ${i + 1}: ${h} "${r[j]}" is not a number`, loc: { file, row: i + 1 } })
      return null
    }
    return v
  }
}

/**
 * FantasyPros "Draft ALL Rankings" (expert consensus). RK/BEST/WORST/AVG./STD.DEV
 * are EXPERT RANK statistics — AVG. is the average expert rank, not ADP, and
 * "ECR VS. ADP" is a difference, not an ADP.
 */
export function parseFantasyProsEcr(text: string, file: string): ParseResult {
  const { headers, rows } = parseCsv(text)
  const issues: RowIssue[] = []
  const g = reader(headers, issues, file)
  const nameIdx = headers.findIndex((h) => h.toUpperCase() === 'PLAYER NAME')
  const out: FantasyProsEcrRow[] = []
  rows.forEach((r, i) => {
    const cell = parseFpNameCell(r[nameIdx] ?? '')
    if (!cell.name) return
    out.push({ loc: { file, row: i + 1 }, rank: g(r, i, 'RK') ?? i + 1, name: cell.name, team: cell.team, positions: cell.positions, tag: cell.tag, best: g(r, i, 'BEST'), worst: g(r, i, 'WORST'), avg: g(r, i, 'AVG.'), sd: g(r, i, 'STD.DEV'), ecrVsAdp: g(r, i, 'ECR VS. ADP') })
  })
  return { parsed: { role: 'fantasypros-ecr', rows: out }, issues, capturedAt: null, printedPages: null }
}

/** FantasyPros "Overall NBA ADP": Rank, Player, Team, Positions, Yahoo, ESPN, AVG — platform columns kept separate. */
export function parseFantasyProsAdp(text: string, file: string): ParseResult {
  const { headers, rows } = parseCsv(text)
  const issues: RowIssue[] = []
  const g = reader(headers, issues, file)
  const col = (h: string) => headers.findIndex((x) => x.toUpperCase() === h.toUpperCase())
  const out: FantasyProsAdpRow[] = []
  rows.forEach((r, i) => {
    const name = (r[col('Player')] ?? '').trim()
    if (!name) return
    const posRaw = (r[col('Positions')] ?? '').trim()
    // e.g. "C,PF OUT" — a status word printed after the positions.
    const m = posRaw.match(/^([A-Z,/ ]*?)\s*\b(OUT|DTD|GTD|SSPD|O)?$/)
    out.push({ loc: { file, row: i + 1 }, rank: g(r, i, 'Rank') ?? i + 1, name, team: normalizeTeam(r[col('Team')]), positions: (m?.[1] ?? posRaw).trim() || null, status: parseStatus(m?.[2]), yahoo: g(r, i, 'Yahoo'), espn: g(r, i, 'ESPN'), avg: g(r, i, 'AVG') })
  })
  return { parsed: { role: 'fantasypros-adp', rows: out }, issues, capturedAt: null, printedPages: null }
}

/** A previously combined 9dub CSV. Read only so the audit can cross-check it; it never feeds the dataset. */
export function parseDerived9dub(text: string, file: string): ParseResult {
  const { headers, rows } = parseCsv(text)
  const issues: RowIssue[] = []
  const g = reader(headers, issues, file)
  const nameIdx = headers.findIndex((h) => h === 'Player')
  const out: DerivedRow[] = rows.map((r, i) => ({ loc: { file, row: i + 1 }, name: (r[nameIdx] ?? '').trim(), fga: g(r, i, 'FGA'), fta: g(r, i, 'FTA'), fgPct: g(r, i, 'FG%'), ftPct: g(r, i, 'FT%'), pts: g(r, i, 'PTS') }))
  return { parsed: { role: 'derived-9dub', rows: out.filter((r) => r.name) }, issues, capturedAt: null, printedPages: null }
}
