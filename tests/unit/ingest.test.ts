/**
 * Parser and reconciliation tests on small SYNTHETIC layouts that mirror the
 * structure of the real printed pages (positions, two-line cells, page breaks,
 * sticky-header overlays). No proprietary rows are reproduced here.
 */
import { describe, expect, it } from 'vitest'
import { classifyCsv, classifyPdf } from '@/data/ingest/classify'
import { parseEspnProjections, parseLiveDraftTrends } from '@/data/ingest/espn'
import { parseFantasyEdgePdf } from '@/data/ingest/fantasyEdge'
import { parseFantasyProsAdp, parseFantasyProsEcr, parseFpNameCell } from '@/data/ingest/fantasyPros'
import { mergeRuns, parsePrintTimestamp, toLines, type PdfItem, type PdfPage } from '@/data/ingest/pdfLines'
import { estimateVolume, reconcile, type IngestFile } from '@/data/ingest/reconcile'
import type { ParseResult } from '@/data/ingest/types'
import { DatasetSnapshotSchema } from '@/data/schema'

/** Text run helper: width ≈ 5.5pt per character, like the printed pages. */
const run = (s: string, x: number, y: number, w = s.length * 5.5): PdfItem => ({ s, x, y, w })
/** Right-aligned value whose right edge sits at `right`. */
const ra = (s: string, right: number, y: number): PdfItem => run(s, right - s.length * 5.5, y)
const page = (n: number, items: PdfItem[]): PdfPage => ({ page: n, width: 792, height: 612, items })

describe('positioned text → cells', () => {
  it('glues accent runs split by the PDF text layer, keeps real columns apart', () => {
    const cells = mergeRuns([run('Nikola Joki', 105, 10, 50), run('ć', 155, 10, 5), run('.561', 577, 10)])
    expect(cells.map((c) => c.s)).toEqual(['Nikola Jokić', '.561'])
  })
  it('joins a word split around a non-ASCII glyph with a space, but never a status tag', () => {
    expect(mergeRuns([run('Alperen', 105, 10, 36.8), run('Ş', 144.6, 10, 5.8), run('engün', 150.4, 10, 29)]).map((c) => c.s)).toEqual(['Alperen Şengün'])
    expect(mergeRuns([run('Chet Holmgren', 105, 10, 72), run('DTD', 179.8, 10, 16)]).map((c) => c.s)).toEqual(['Chet Holmgren', 'DTD'])
  })
  it('keeps an overlapping sticky-header run separate from the row text under it', () => {
    const cells = mergeRuns([run('Payton Pritchard', 127.7, 10, 80), run('Home', 137.2, 10, 22)])
    expect(cells.map((c) => c.s)).toEqual(['Payton Pritchard', 'Home'])
  })
  it('groups runs into lines by baseline and parses the browser print timestamp', () => {
    const lines = toLines(page(1, [run('b', 50, 101), run('a', 10, 100), run('c', 10, 120)]))
    expect(lines.map((l) => l.cells.map((c) => c.s).join(' '))).toEqual(['a b', 'c'])
    expect(parsePrintTimestamp('10/17/26, 10:21 PM')).toBe('2026-10-17T22:21')
  })
})

describe('ESPN Live Draft Trends', () => {
  const header = [run('10/17/26, 10:21 PM', 24, 23), run('Live Draft Trends - FBA Rotisserie - ESPN Fantasy Basketball', 342, 23), run('RANK', 46.8, 182), run('PLAYER', 100.5, 182), run('AVG PICK', 368.4, 182), run('7 DAY +/-', 451.4, 182), run('AVG SALARY', 542.4, 182), run('7 DAY +/-', 635.9, 182), run('%ROST', 715, 182)]
  const row = (rank: number, name: string, team: string, pos: string, nums: string[], y: number, extra: PdfItem[] = []) => [
    run(name, 127.8, y),
    ...extra,
    run(String(rank), 44.4, y + 4.5),
    ...nums.map((n, i) => ra(n, [402, 485, 590, 670, 745][i], y + 4.5)),
    run(team, 127.8, y + 9),
    run(pos, 152, y + 9),
  ]
  it('reads AVG PICK separately from rank, salary and %ROST, tolerating overlays and page breaks', () => {
    const p1 = page(1, [
      ...header,
      ...row(1, 'Star Center', 'DEN', 'C', ['2.1', '0.0', '71.3', '-0.5', '99.9'], 197),
      ...row(2, 'Hurt Guard', 'SA', 'PG, SG', ['4.2', '+0.1', '62.4', '-0.2', '99.9'], 221, [run('DTD', 200, 221)]),
      // Sticky ESPN header printed over the rank line of player 3.
      run('Fantasy Basketball', 51.5, 249.5), run('Home', 137.2, 249.5), run('My Teams', 708.8, 249.5),
      ...row(3, 'Overlay Wing', 'NY', 'SF', ['12.6', '0.0', '48.1', '-0.4', '99.8'], 245),
      // Page break: numbers, then the name 2pt lower; the team line continues on page 2.
      run('4', 44.4, 577), ...['139.9', '0.0', '0.0', '0.0', '0.1'].map((n, i) => ra(n, [402, 485, 590, 670, 745][i], 577)), run('Cut Row', 127.8, 579),
    ])
    const p2 = page(2, [run('10/17/26, 10:21 PM', 24, 23), run('RANK', 46.8, 53), run('AVG PICK', 368.4, 53), run('FA', 127.8, 63), run('C', 145, 63)])
    const res = parseLiveDraftTrends([p1, p2], 'ldt.pdf')
    expect(res.issues).toEqual([])
    const rows = res.parsed.role === 'espn-live-draft' ? res.parsed.rows : []
    expect(rows.map((r) => [r.rank, r.name, r.team, r.avgPick, r.pctRostered])).toEqual([
      [1, 'Star Center', 'DEN', 2.1, 99.9],
      [2, 'Hurt Guard', 'SAS', 4.2, 99.9],
      [3, 'Overlay Wing', 'NYK', 12.6, 99.8],
      [4, 'Cut Row', 'FA', 139.9, 0.1],
    ])
    expect(rows[1].status).toBe('day-to-day')
    expect(rows[0].avgSalary).toBe(71.3)
    expect(res.capturedAt).toBe('2026-10-17T22:21')
    expect(res.parsed.role === 'espn-live-draft' && res.parsed.view).toBe('FBA Rotisserie')
  })
})

describe('ESPN projections page', () => {
  const H = ['GP', 'MIN', 'FG%', 'FT%', '3PM', 'REB', 'AST', 'A/TO', 'STL', 'BLK', 'TO', 'PTS']
  const R = [390, 424, 459, 493, 525, 560, 594, 629, 658, 687, 714, 749]
  const block = (y: number, name: string, team: string, pos: string, prior: string[] | null, proj: string[] | null, status?: string) => [
    run('PLAYER', 46.8, y), run('YEAR', 257.6, y, 17), ...H.map((h, i) => ra(h, R[i], y)),
    run('2026 STATISTICS', 257.6, y + 14, 56), ...(prior ? prior.map((v, i) => ra(v, R[i], y + 14)) : H.slice(1).map((_, i) => ra('--', R[i + 1] + 6, y + 14))),
    run(name, 90.1, y + 23),
    run('2027 PROJECTIONS', 257.6, y + 28, 65), ...(proj ? proj.map((v, i) => ra(v, R[i], y + 28)) : H.slice(1).map((_, i) => ra('--', R[i + 1] + 6, y + 28))),
    run(team, 103.8, y + 35), run(pos, 140, y + 35),
    ...(status ? [run(status, 90.1, y + 47)] : []),
    run('2027 OUTLOOK:', 262.4, y + 48), run('Narrative text that must be ignored 12.3 PPG.', 262.4, y + 59, 300),
  ]
  it('reads 2027 PROJECTIONS and 2026 STATISTICS separately by column, including dash rows and statuses', () => {
    const p = page(1, [
      run('10/17/26, 10:02 PM', 24, 23),
      run('Complete 2027 Projections', 40.8, 110, 150), run('My League', 227.8, 110, 60),
      ...block(259, 'Big Man', 'Nuggets', 'C', ['61', '33.9', '.552', '.808', '1.3', '11.6', '9.4', '2.61', '1.2', '0.9', '3.3', '25.2'], ['70', '34.2', '.558', '.799', '1.4', '11.9', '9.2', '2.74', '1.3', '0.9', '3.2', '26.1']),
      ...block(368, 'Rookie Wing', '76ers', 'SF, PF', null, ['66', '24.1', '.472', '.842', '1.5', '3.1', '3.6', '1.71', '1.0', '0.3', '2.0', '15.4'], 'Day-To-Day'),
      ...block(480, 'No Projection', 'FA', 'PG', ['20', '10.0', '.400', '.800', '0.5', '1.0', '1.0', '1.00', '0.3', '0.1', '1.0', '4.0'], null),
    ])
    const res = parseEspnProjections([p], 'proj.pdf')
    expect(res.issues).toEqual([])
    const rows = res.parsed.role === 'espn-projections' ? res.parsed.rows : []
    expect(rows.map((r) => r.name)).toEqual(['Big Man', 'Rookie Wing', 'No Projection'])
    expect(rows[0].team).toBe('DEN')
    expect(rows[0].projectionLabel).toBe('2027 PROJECTIONS')
    expect(rows[0].projection).toMatchObject({ gp: 70, fgPct: 0.558, ftPct: 0.799, reb: 11.9, ast: 9.2, ato: 2.74, tov: 3.2, pts: 26.1 })
    expect(rows[0].prior).toMatchObject({ gp: 61, pts: 25.2 })
    expect(rows[1].team).toBe('PHI')
    expect(rows[1].status).toBe('day-to-day')
    expect(Object.values(rows[1].prior!).every((v) => v == null)).toBe(true)
    expect(Object.values(rows[2].projection!).every((v) => v == null)).toBe(true)
    expect(res.parsed.role === 'espn-projections' && res.parsed.league).toBe('My League')
  })
})

describe('Fantasy Edge printed rankings', () => {
  it('maps the second line under FG% / FT% to FGA / FTA', () => {
    const cols = ['#', 'PLAYER', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO', 'VALUE']
    const right = [58, 105, 351, 394, 434, 472, 510, 551, 595, 640, 677, 734]
    const p = page(1, [
      run('10/17/26, 10:18 PM', 24, 23),
      ...cols.map((h, i) => (i < 2 ? run(h, [50.9, 73.2][i], 264) : ra(h, right[i], 264))),
      run('Nikola Joki', 105.4, 291, 50.1), run('ć', 155.5, 291, 5.5), ra('.561', 595, 291), ra('.803', 640, 291),
      run('1', 52.9, 297), ...['25.7', '11.8', '8.7', '1.2', '0.9', '1.4'].map((v, i) => ra(v, right[i + 2], 297)), ra('3.1', 677, 297), ra('+8.42', 734, 297),
      run('DEN · C · ADP 4', 105.4, 304, 60), ra('17.4', 591, 304), ra('5.9', 636, 304),
      run('Hurt Big', 105.4, 329), run('DTD', 179.8, 329), ra('.552', 595, 329), ra('.771', 640, 329),
      run('2', 52, 336), ...['16.4', '8.9', '2.3', '0.8', '1.9', '1.2'].map((v, i) => ra(v, right[i + 2], 336)), ra('1.5', 677, 336), ra('+2.41', 734, 336),
      run('OKC · PF/C · ADP 31', 105.4, 343, 80), ra('11.2', 591, 343), ra('3.8', 636, 343),
    ])
    const res = parseFantasyEdgePdf([p], 'fe.pdf')
    expect(res.issues).toEqual([])
    const rows = res.parsed.role === 'fantasyedge-pdf' ? res.parsed.rows : []
    expect(rows[0]).toMatchObject({ rank: 1, name: 'Nikola Jokić', team: 'DEN', positions: 'C', adp: 4, fgPct: 0.561, fga: 17.4, ftPct: 0.803, fta: 5.9, pts: 25.7, tov: 3.1, value: 8.42 })
    expect(rows[1]).toMatchObject({ name: 'Hurt Big', status: 'day-to-day', fga: 11.2, fta: 3.8, blk: 1.9 })
  })
})

describe('FantasyPros CSVs and file classification', () => {
  it('parses expert-rank cells (AVG. is an expert-rank mean, not ADP) and platform ADP columns', () => {
    expect(parseFpNameCell('Pacome Dadiet (NYK - SF,SG) G-League')).toEqual({ name: 'Pacome Dadiet', team: 'NYK', positions: 'SF,SG', tag: 'G-League' })
    const ecr = parseFantasyProsEcr('"RK","PLAYER NAME",TEAM,"BEST","WORST","AVG.","STD.DEV","ECR VS. ADP"\n"1","A One (DEN - C)",,"1","2","1.5","0.5","0"\n', 'ecr.csv')
    expect(ecr.parsed.rows[0]).toMatchObject({ rank: 1, name: 'A One', best: 1, worst: 2, avg: 1.5, sd: 0.5 })
    const adp = parseFantasyProsAdp('"Rank","Player","Team","Positions","Yahoo","ESPN","AVG"\n"9","B Two","PHI","C,PF OUT","","200","200.0"\n', 'adp.csv')
    expect(adp.parsed.rows[0]).toMatchObject({ name: 'B Two', positions: 'C,PF', status: 'out', yahoo: null, espn: 200, avg: 200 })
  })
  it('identifies files by content, not by name', () => {
    expect(classifyCsv(['#', 'Player', 'PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%', 'TO', 'Value'])).toBe('fantasyedge-csv')
    expect(classifyCsv(['RK', 'PLAYER NAME', 'TEAM', 'BEST', 'WORST', 'AVG.', 'STD.DEV', 'ECR VS. ADP'])).toBe('fantasypros-ecr')
    expect(classifyCsv(['Rank', 'Player', 'Team', 'Positions', 'Yahoo', 'ESPN', 'AVG'])).toBe('fantasypros-adp')
    expect(classifyCsv(['Rank_9Cat', 'Player', 'FGA', '9Cat_SourceValue', 'FGM_FTM_Derivation'])).toBe('derived-9dub')
    expect(classifyPdf([page(1, [run('Live Draft Trends - FBA', 1, 1), run('AVG PICK', 1, 2)])])).toBe('espn-live-draft')
    expect(classifyPdf([page(1, [run('Complete 2027 Projections', 1, 1)])])).toBe('espn-projections')
    expect(classifyPdf([page(1, [run('random', 1, 1)])])).toBe('unknown')
  })
})

// ───────────────────────── reconciliation ─────────────────────────

const ok = (parsed: ParseResult['parsed'], capturedAt: string | null = '2026-10-17T22:00'): ParseResult => ({ parsed, issues: [], capturedAt, printedPages: 1 })
const file = (name: string, result: ParseResult, sha = name): IngestFile => ({ file: name, sha256: sha, size: 1, mtime: '2026-10-17T00:00:00Z', kind: name.endsWith('.csv') ? 'csv' : 'pdf', result })
const blank = { gp: null, min: null, fgPct: null, ftPct: null, tpm: null, reb: null, ast: null, ato: null, stl: null, blk: null, tov: null, pts: null }

function fixtureFiles(): IngestFile[] {
  const fe = ok({
    role: 'fantasyedge-pdf',
    rows: [
      { loc: { file: 'fe.pdf', page: 1 }, rank: 1, name: 'Nikola Jokić', team: 'DEN', positions: 'C', status: null, adp: 4, pts: 25.7, reb: 11.8, ast: 8.7, stl: 1.2, blk: 0.9, tpm: 1.4, fgPct: 0.561, fga: 17.4, ftPct: 0.803, fta: 5.9, tov: 3.1, value: 8.42 },
      { loc: { file: 'fe.pdf', page: 1 }, rank: 2, name: 'Trey Murphy', team: 'NOP', positions: 'SG/SF', status: null, adp: 42, pts: 20.0, reb: 5.0, ast: 3.3, stl: 1.1, blk: 0.4, tpm: 2.9, fgPct: 0.471, fga: 14.9, ftPct: 0.862, fta: 3.6, tov: 1.5, value: 2.31 },
    ],
  })
  const proj = ok({
    role: 'espn-projections',
    league: 'My League',
    view: null,
    rows: [
      { loc: { file: 'proj.pdf', page: 1 }, index: 0, name: 'Nikola Jokic', teamRaw: 'Nuggets', team: 'DEN', positions: 'C', status: null, statusRaw: null, projectionLabel: '2027 PROJECTIONS', priorLabel: '2026 STATISTICS', columns: [], projection: { ...blank, gp: 70, min: 34.2, fgPct: 0.558, ftPct: 0.799, tpm: 1.4, reb: 11.9, ast: 9.2, ato: 2.74, stl: 1.3, blk: 0.9, tov: 3.2, pts: 26.1 }, prior: { ...blank, gp: 61, pts: 25.2, reb: 11.6, ast: 9.4, stl: 1.2, blk: 0.9, tpm: 1.3, tov: 3.3, fgPct: 0.552, ftPct: 0.808 } },
      { loc: { file: 'proj.pdf', page: 1 }, index: 1, name: 'Trey Murphy III', teamRaw: 'Pelicans', team: 'NOP', positions: 'SG, SF', status: null, statusRaw: null, projectionLabel: '2027 PROJECTIONS', priorLabel: '2026 STATISTICS', columns: [], projection: { ...blank, gp: 64, min: 31.5, fgPct: 0.476, ftPct: 0.857, tpm: 2.8, reb: 4.9, ast: 3.1, ato: 1.9, stl: 1.1, blk: 0.5, tov: 1.7, pts: 18.6 }, prior: null },
      { loc: { file: 'proj.pdf', page: 1 }, index: 2, name: 'Espn Only', teamRaw: 'Knicks', team: 'NYK', positions: 'C', status: 'out', statusRaw: 'Out', projectionLabel: '2027 PROJECTIONS', priorLabel: '2026 STATISTICS', columns: [], projection: { ...blank, gp: 60, min: 19.4, fgPct: 0.482, ftPct: 0.622, tpm: 0.4, reb: 8.4, ast: 1.2, ato: 1.2, stl: 0.7, blk: 0.7, tov: 1.0, pts: 6.7 }, prior: null },
      { loc: { file: 'proj.pdf', page: 1 }, index: 3, name: 'No Line', teamRaw: 'FA', team: 'FA', positions: 'PG', status: null, statusRaw: null, projectionLabel: '2027 PROJECTIONS', priorLabel: '2026 STATISTICS', columns: [], projection: { ...blank }, prior: null },
    ],
  })
  const ldt = ok({
    role: 'espn-live-draft',
    view: 'FBA',
    rows: [
      { loc: { file: 'ldt.pdf', page: 1 }, rank: 1, name: 'Nikola Jokic', teamRaw: 'DEN', team: 'DEN', positions: 'C', status: null, avgPick: 2.1, avgPickTrend7d: 0, avgSalary: 71.3, salaryTrend7d: -0.5, pctRostered: 99.9 },
      { loc: { file: 'ldt.pdf', page: 1 }, rank: 63, name: 'Trey Murphy III', teamRaw: 'NO', team: 'NOP', positions: 'SG, SF', status: null, avgPick: 66.2, avgPickTrend7d: 0.1, avgSalary: 7, salaryTrend7d: 0, pctRostered: 95 },
      { loc: { file: 'ldt.pdf', page: 1 }, rank: 200, name: 'Espn Only', teamRaw: 'NY', team: 'NYK', positions: 'C', status: null, avgPick: 140, avgPickTrend7d: 0, avgSalary: 0, salaryTrend7d: 0, pctRostered: 0.1 },
    ],
  })
  const fpAdp = ok({ role: 'fantasypros-adp', rows: [{ loc: { file: 'adp.csv', row: 1 }, rank: 5, name: 'Ranked Only', team: 'BOS', positions: 'PF', status: null, yahoo: 150, espn: 160, avg: 155 }, { loc: { file: 'adp.csv', row: 2 }, rank: 1, name: 'Nikola Jokic', team: 'DEN', positions: 'C', status: null, yahoo: 2, espn: 1, avg: 1.5 }] })
  const ecr = ok({
    role: 'fantasypros-ecr',
    rows: [
      { loc: { file: 'ecr.csv', row: 1 }, rank: 1, name: 'Nikola Jokic', team: 'DEN', positions: 'C', tag: null, best: 1, worst: 2, avg: 1.5, sd: 0.5, ecrVsAdp: 0 },
      { loc: { file: 'ecr.csv', row: 2 }, rank: 30, name: 'Trey Murphy III', team: 'NOP', positions: 'SG,SF', tag: null, best: 20, worst: 40, avg: 30, sd: 5, ecrVsAdp: 3 },
      { loc: { file: 'ecr.csv', row: 3 }, rank: 157, name: 'Ranked Only Jr.', team: 'BOS', positions: 'PF', tag: null, best: 100, worst: 200, avg: 150, sd: 20, ecrVsAdp: null },
      { loc: { file: 'ecr.csv', row: 4 }, rank: 200, name: 'Ranked Only', team: 'FA', positions: 'G', tag: null, best: 150, worst: 250, avg: 200, sd: 30, ecrVsAdp: null },
    ],
  })
  return [
    file('fe.pdf', fe),
    file('fe copy.pdf', fe, 'fe.pdf'),
    file('proj.pdf', proj),
    file('ldt.pdf', ldt),
    file('adp.csv', fpAdp),
    file('ecr.csv', ecr),
    file('combined.csv', ok({ role: 'derived-9dub', rows: [{ loc: { file: 'combined.csv', row: 1 }, name: 'Nikola Jokić', fga: 17.4, fta: 5.9, fgPct: 0.561, ftPct: 0.803, pts: 25.7 }] })),
  ]
}

describe('reconcile', () => {
  const { snapshot, audit } = reconcile(fixtureFiles(), { season: '2026-27', projectionLabel: '2027 PROJECTIONS', adpCap: 139.5, now: '2026-10-18T00:00:00Z', snapshotId: 'local-test', sourceDir: 'dir' })
  const byName = (n: string) => snapshot.players.find((p) => p.identity.fullName === n || p.identity.aliases.includes(n))!

  it('produces a schema-valid snapshot with one stable, name-derived id per player', () => {
    expect(DatasetSnapshotSchema.safeParse(snapshot).success).toBe(true)
    const ids = snapshot.players.map((p) => p.identity.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(byName('Nikola Jokić').identity.id).toBe('nikola-jokic')
    // ESPN spelling wins for display; the Fantasy Edge variant stays searchable as an alias.
    expect(byName('Trey Murphy III').identity.id).toBe('trey-murphy')
    expect(byName('Trey Murphy III').identity.aliases).toContain('Trey Murphy')
  })

  it('uses the Fantasy Edge line with derived makes; ESPN stays a separate profile, never averaged', () => {
    const j = byName('Nikola Jokić')
    expect(j.projection!.profile).toBe('fantasyedge')
    expect(j.projection!.points).toBe(25.7)
    expect(j.projection!.fieldGoalsAttempted).toBe(17.4)
    expect(j.projection!.fieldGoalsMade).toBeCloseTo(0.561 * 17.4, 10)
    expect(j.projection!.freeThrowsMade).toBeCloseTo(0.803 * 5.9, 10)
    expect(j.profiles!.fantasyedge.origin.fgm).toBe('derived')
    expect(j.profiles!.espn.pts).toBe(26.1)
    // ESPN GP is attached to the Fantasy Edge line as a labelled supplemental field.
    expect(j.projection!.gamesProjected).toBe(70)
    expect(j.projection!.completenessFlags).toContain('gp-supplemental')
    // Prior-season actuals are kept for reference only.
    expect(j.priorSeason!.kind).toBe('actual')
    expect(j.priorSeason!.pts).toBe(25.2)
  })

  it('marks ESPN-only players incomplete (no attempts) and offers only an optional labelled estimate', () => {
    const e = byName('Espn Only')
    expect(e.projection!.profile).toBe('espn')
    expect(e.projection!.fieldGoalsAttempted).toBeNull()
    expect(e.projection!.completenessFlags).toEqual(expect.arrayContaining(['missing-fga', 'missing-fta', 'pct-without-volume']))
    expect(e.volumeEstimate?.espn.method).toBe('pts-identity')
    expect(e.provenance!.status).toEqual({ tag: 'out', source: 'ESPN projections' })
    expect(audit.incomplete.map((i) => i.name)).toContain('Espn Only')
  })

  it('keeps ranked-only players as directory entries without a projection', () => {
    const r = byName('Ranked Only')
    expect(r.projection).toBeNull()
    expect(r.rankings!.fantasyProsEcr!.rank).toBe(157)
    expect(byName('No Line').projection).toBeNull()
  })

  it('follows ESPN ADP precedence: Live Draft Trends, then the FantasyPros ESPN ordinal; ceiling values are not ADP', () => {
    expect(byName('Trey Murphy III').projection!.espnAdp).toBe(66.2)
    expect(byName('Trey Murphy III').projection!.espnAdpSource).toBe('espn-live-draft')
    const capped = byName('Espn Only')
    expect(capped.market!.espnLive!.capped).toBe(true)
    expect(capped.projection!.espnAdp).toBeNull()
    expect(capped.projection!.completenessFlags).toContain('adp-capped')
    // Yahoo / blended ADP are stored but never substituted for ESPN.
    expect(byName('Nikola Jokić').market!.fantasyPros).toEqual({ espn: 1, yahoo: 2, avg: 1.5, rank: 1 })
    expect(byName('Nikola Jokić').projection!.espnAdp).toBe(2.1)
    expect(byName('Nikola Jokić').projection!.otherAdp).toBeNull()
  })

  it('resolves a same-name duplicate inside one source by team agreement and logs it', () => {
    expect(audit.duplicates).toHaveLength(1)
    expect(audit.duplicates[0].name).toBe('Ranked Only Jr.')
    expect(byName('Ranked Only').rankings!.fantasyProsEcr!.rank).toBe(157)
  })

  it('inventories duplicates and derived files without using them as data', () => {
    const st = Object.fromEntries(audit.files.map((f) => [f.file, f.status]))
    // Byte-identical copies: exactly one is used, the other is reported as a duplicate.
    expect([st['fe copy.pdf'], st['fe.pdf']].sort()).toEqual(['duplicate', 'used'])
    expect(st['combined.csv']).toBe('reference-only')
    expect(audit.crossChecks.derivedVsPdf).toEqual({ compared: 1, mismatches: [] })
    expect(audit.crossChecks.ptsIdentity.maxAbsResidual).toBeLessThan(0.15)
  })
})

describe('shooting-volume estimate', () => {
  it('inverts PTS = 2·FG%·FGA + 3PM + FT%·r·FGA exactly', () => {
    const e = estimateVolume({ pts: 25.7, tpm: 1.4, fgPct: 0.561, ftPct: 0.803 }, 5.9 / 17.4)!
    expect(e.fga).toBeCloseTo(17.4, 0)
    expect(2 * 0.561 * e.fga + 1.4 + 0.803 * e.fta).toBeCloseTo(25.7, 10)
    expect(estimateVolume({ pts: 10, tpm: 1, fgPct: null, ftPct: 0.8 }, 0.3)).toBeNull()
  })
})
