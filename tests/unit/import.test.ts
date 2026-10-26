import { describe, expect, it } from 'vitest'
import { parseTableText } from '@/data/import/parseTable'
import { initialMapping, mapRows, planImport, defaultOptionsFor, detectUnit } from '@/data/import/pipeline'
import { parsePctCombo, parsePlayerCell, parseNumber, parsePercent } from '@/data/import/cells'
import { cleanDoubledName, normalizeName, normalizeTeam } from '@/data/normalize'
import { generateDemoDataset } from '@/data/demo/generate'
import { DatasetSnapshotSchema } from '@/data/schema'

// All names and numbers below are FICTIONAL; only the layouts mirror real sites.
const HB_PASTE = [
  'R#\tPLAYER\tADP\tPOS\tTEAM\tGP\tMPG\tFG%\tFT%\t3PM\tPTS\tTREB\tAST\tSTL\tBLK\tTO\tTOTAL',
  '1\tArlo QuarlesA.Quarles\t1.6\tC\tDEN\t71\t34.8\t0.571 (10.2/17.9)\t0.812 (5.4/6.6)\t1.7\t27.5\t12.4\t9.9\t1.5\t0.8\t3.4\t15.10',
  '2\tBram Okafor-LaneB.Okafor-Lane\t3.2\tPG/SG\tGS\t70\t33.9\t0.462\n(8.1/17.5)\t0.901 (5.9/6.6)\t3.9\t26.0\t4.9\t6.1\t1.1\t0.4\t2.8\t9.30',
  'R#\tPLAYER\tADP\tPOS\tTEAM\tGP\tMPG\tFG%\tFT%\t3PM\tPTS\tTREB\tAST\tSTL\tBLK\tTO\tTOTAL',
  '3\tCass Durrant Jr.C.Durrant Jr.\t12.0\tSF/PF\tNO\t66\t32.1\t0.488 (7.3/15.0)\t0.774 (4.1/5.3)\t1.9\t20.6\t7.7\t3.0\t1.6\t0.9\t2.0\t6.20',
].join('\n')

describe('cell parsing', () => {
  it('parses numbers and percents defensively', () => {
    expect(parseNumber('1,234')).toBe(1234)
    expect(parseNumber('—')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
    expect(parsePercent('52.8%')).toBeCloseTo(0.528)
    expect(parsePercent('.528')).toBeCloseTo(0.528)
    expect(parsePercent('52.8')).toBeCloseTo(0.528)
  })
  it('parses percentage cells with makes/attempts', () => {
    expect(parsePctCombo('0.573 (10.5/18.3)')).toEqual({ pct: 0.573, made: 10.5, att: 18.3 })
    expect(parsePctCombo('.573(10.5 / 18.3)')).toEqual({ pct: 0.573, made: 10.5, att: 18.3 })
    expect(parsePctCombo('0.573')).toEqual({ pct: 0.573, made: null, att: null })
  })
  it('cleans doubled names and FantasyPros-style player cells', () => {
    expect(cleanDoubledName('Arlo QuarlesA.Quarles')).toBe('Arlo Quarles')
    expect(cleanDoubledName('Cass Durrant Jr.C.Durrant Jr.')).toBe('Cass Durrant Jr.')
    expect(cleanDoubledName('P.J. Fenwick')).toBe('P.J. Fenwick')
    expect(parsePlayerCell('Zane Yoon (OKC - PG)')).toEqual({ name: 'Zane Yoon', team: 'OKC', positions: 'PG' })
  })
  it('normalizes names and team codes for matching', () => {
    expect(normalizeName('Lúka Dončić')).toBe('luka doncic')
    expect(normalizeName('Trey Murphy III')).toBe('trey murphy')
    expect(normalizeName("D'Angelo Smith-Jones Jr.")).toBe('dangelo smith jones')
    expect(normalizeTeam('GS')).toBe('GSW')
    expect(normalizeTeam('PHO')).toBe('PHX')
    expect(normalizeTeam('UTAH')).toBe('UTA')
  })
})

describe('Hashtag-style paste', () => {
  const table = parseTableText(HB_PASTE)
  it('detects the layout, re-joins split cells and drops repeated headers', () => {
    expect(table.preset).toBe('hashtag-projections')
    expect(table.rows).toHaveLength(3)
    expect(table.rows[1][7]).toBe('0.462 (8.1/17.5)')
  })
  it('maps FG%/FT% to makes/attempts and keeps ADP/rank separate', () => {
    const map = initialMapping(table)
    expect(map[table.headers.indexOf('FG%')]).toBe('fgCombo')
    expect(map[table.headers.indexOf('R#')]).toBe('sourceRank')
    expect(map[table.headers.indexOf('ADP')]).toBe('otherAdp')
    expect(map[table.headers.indexOf('TOTAL')]).toBe('ignore')
    const rows = mapRows(table, map, defaultOptionsFor(table.preset, '2026-10-16'))
    expect(rows.every((r) => r.errors.length === 0)).toBe(true)
    const a = rows[0]
    expect(a.name).toBe('Arlo Quarles')
    expect(a.fields.fieldGoalsMade).toBe(10.2)
    expect(a.fields.fieldGoalsAttempted).toBe(17.9)
    expect(a.fields.freeThrowsAttempted).toBe(6.6)
    expect(a.fields.sourceNineCatRank).toBe(1)
    expect(a.fields.otherAdp).toBe(1.6)
    expect(a.fields.espnAdp).toBeUndefined()
    expect(rows[1].team).toBe('GSW')
    expect(rows[1].positions).toEqual(['PG', 'SG'])
    expect(rows[2].name).toBe('Cass Durrant Jr.')
  })
  it('builds a valid replace snapshot', () => {
    const opts = defaultOptionsFor(table.preset, '2026-10-16')
    const plan = planImport(mapRows(table, initialMapping(table), opts), 'replace', null, opts, {}, '2026-10-16T12:00:00.000Z')
    expect(plan.error).toBeNull()
    expect(plan.counts.added).toBe(3)
    expect(DatasetSnapshotSchema.safeParse(plan.snapshot).success).toBe(true)
    expect(plan.snapshot!.sources[0].url).toContain('hashtagbasketball.com')
  })
})

describe('season totals and validation', () => {
  const CSV = [
    'Player,PTS,REB,AST,BLK,STL,FG%,FT%,3PM,GP,MIN,TO',
    '"Zane Yoon (OKC - PG)","2,000",400,500,40,100,.500,.880,150,80,"2,720",200',
    '"Bad Row (BOS - C)",abc,400,100,90,40,.600,.700,1,70,"2,000",120',
    '"No Games (MIA - SF)",900,300,200,30,60,.480,.800,90,,"1,800",80',
  ].join('\n')
  const table = parseTableText(CSV)
  const map = initialMapping(table)
  it('detects totals and converts to per game, keeping FG% without volume flagged', () => {
    expect(table.preset).toBe('fantasypros')
    expect(detectUnit(table, map)).toBe('totals')
    const rows = mapRows(table, map, { ...defaultOptionsFor('fantasypros', '2026-10-16') })
    const z = rows[0]
    expect(z.errors).toEqual([])
    expect(z.fields.points).toBeCloseTo(25)
    expect(z.fields.minutesPerGame).toBeCloseTo(34)
    expect(z.fields.fieldGoalPct).toBeCloseTo(0.5)
    expect(z.fields.fieldGoalsAttempted).toBeUndefined()
    expect(z.warnings.join(' ')).toMatch(/FG% without attempts/)
    expect(rows[1].errors.join(' ')).toMatch(/not a number/)
    expect(rows[2].errors.join(' ')).toMatch(/games played/)
  })
  it('surfaces invalid rows in the plan instead of importing them', () => {
    const opts = defaultOptionsFor('fantasypros', '2026-10-16')
    const plan = planImport(mapRows(table, map, opts), 'replace', null, opts)
    expect(plan.counts.invalid).toBe(2)
    expect(plan.snapshot).toBeNull() // only 1 valid player
    const rec = mapRows(table, map, opts)[0]
    expect(rec.fields.completenessFlags).toContain('unit-converted-from-totals')
  })
})

describe('merge mode and identity matching', () => {
  const demo = generateDemoDataset({ count: 60 })
  const a = demo.players[0].identity
  const b = demo.players[1].identity
  const ADP = [
    'NAME\tTEAM\tYAHOO\tESPN\tFANTRAX\tBLEND',
    'POS\tADP\tORDER\tPOS\tADP\tORDER\tPOS\tADP\tORDER\tADP\tORDER',
    `${a.fullName.toUpperCase()}\t${a.nbaTeam}\tPG\t2.0\t2\tPG\t1.5\t1\tPG\t2.2\t2\t1.9\t1`,
    `${b.fullName}\t${b.nbaTeam}\tC\t\t\tC\t9.0\t9\tC\t\t\t9.5\t10`,
    `Unknown Person\tBOS\tSF\t200\t200\tSF\t\t\tSF\t\t\t200.0\t199`,
  ].join('\n')
  const table = parseTableText(ADP)
  const opts = defaultOptionsFor(table.preset, '2026-10-16')
  const rows = mapRows(table, initialMapping(table), opts)
  const plan = planImport(rows, 'merge', demo, opts)

  it('parses the two-row ADP header', () => {
    expect(table.preset).toBe('hashtag-adp')
    expect(rows[0].fields.espnAdp).toBe(1.5)
    expect(rows[0].fields.otherAdp).toBe(1.9)
  })
  it('updates only supplied fields on matched players and keeps stats', () => {
    const before = demo.players[0].projection!
    const after = plan.snapshot!.players.find((p) => p.identity.id === a.id)!.projection!
    expect(after.espnAdp).toBe(1.5)
    expect(after.otherAdp).toBe(1.9)
    expect(after.otherAdpLabel).toBe('HB blended ADP')
    expect(after.points).toBe(before.points)
    expect(after.fieldGoalsAttempted).toBe(before.fieldGoalsAttempted)
    expect(plan.counts.updated).toBe(2)
  })
  it('skips unmatched rows that lack a full stat line, and keeps lineage for rollback', () => {
    expect(plan.matches[2].status).toBe('skipped')
    expect(plan.snapshot!.parentId).toBe(demo.id)
    expect(plan.snapshot!.players).toHaveLength(60)
  })
  it('flags ambiguous same-name players instead of guessing', () => {
    const dup = structuredClone(demo)
    dup.players[5].identity.fullName = a.fullName
    dup.players[5].identity.nbaTeam = a.nbaTeam === 'BOS' ? 'NYK' : 'BOS'
    const t = parseTableText(`Player\tADP\n${a.fullName}\t4.0`)
    const r = mapRows(t, initialMapping(t), { ...opts, otherAdpLabel: 'x' })
    const p = planImport(r, 'merge', dup, opts)
    expect(p.matches[0].status).toBe('ambiguous')
    expect(p.matches[0].candidates).toHaveLength(2)
    const resolved = planImport(r, 'merge', dup, opts, { 0: { action: 'match', targetId: a.id } })
    expect(resolved.matches[0].status).toBe('matched')
  })
})
