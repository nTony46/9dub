import { describe, expect, it } from 'vitest'
import type { MatchupPlayer, WeekTotals } from '@/analytics/matchup'
import { ESPN_DEFAULT_SLOTS } from '@/analytics/positions'
import type { StatLine } from '@/analytics/types'
import { applyLab, finishedWeeks, labWeeks, leagueMetrics, lineValues, seasonLine, teamWeeks, tierOf, volumeFactor, volumeFactors, type LeagueRates } from '@/features/season/lab'
import type { EspnSync } from '@/store/schema'

type Span = NonNullable<EspnSync['stats'][string]['season']>
const span = (gp: number, mpg: number, per: Partial<Omit<Span, 'gp' | 'min'>> = {}): Span => {
  const g = { pts: 15, tpm: 2, reb: 5, ast: 4, stl: 1, blk: 0.5, tov: 2, fgm: 6, fga: 13, ftm: 2, fta: 2.5, ...per }
  return { gp, min: gp * mpg, ...(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v * gp])) as Omit<Span, 'gp' | 'min'>) }
}
const league: LeagueRates = { stl: 1 / 30, blk: 0.5 / 30, tpm: 1.5 / 30, fg: 0.47, ft: 0.78 }
const week = (o: Partial<WeekTotals> = {}): WeekTotals => ({ pts: 400, tpm: 45, reb: 160, ast: 90, stl: 25, blk: 18, tov: 50, fgm: 150, fga: 320, ftm: 70, fta: 90, fgPct: 150 / 320, ftPct: 70 / 90, ...o })
const line = (o: Partial<StatLine> = {}): StatLine => ({ pts: 10, tpm: 1, reb: 5, ast: 3, stl: 1, blk: 0.5, tov: 2, fgm: 4, fga: 8, ftm: 2, fta: 2.5, ...o })

describe('Roster Lab: lines on the season basis', () => {
  it('keeps this season’s minutes and leans on it for volume stats, more on last season for the noisy ones', () => {
    // A breakout: 34 minutes now (24 last season) with twice the assists per minute.
    const now = span(10, 34, { ast: 8, stl: 3 })
    const last = span(70, 24, { ast: 2.8, stl: 0.7 })
    const l = seasonLine(now, last, league)!
    expect(l.ast).toBeGreaterThan(7.3) // mostly this season (8/g)
    expect(l.ast).toBeLessThan(8)
    // Steals: 3/g this season over 340 minutes, but 300 minutes of last season's 0.7/24 pull it well down.
    expect(l.stl).toBeGreaterThan(1.5)
    expect(l.stl).toBeLessThan(2.4)
    expect(l.fga! / l.fgm!).toBeCloseTo(13 / 6, 1)
  })

  it('uses last season’s per-game line under three games, and league rates when there is no last season', () => {
    const last = span(60, 30, { pts: 20 })
    expect(seasonLine(span(2, 10, { pts: 2 }), last, league)!.pts).toBeCloseTo(20)
    expect(seasonLine(null, null, league)).toBeNull()
    // A rookie hitting 3 steals a game is pulled toward the league's rate.
    const rookie = seasonLine(span(8, 30, { stl: 3 }), null, league)!
    expect(rookie.stl).toBeLessThan(3)
    expect(rookie.stl).toBeGreaterThan(1.5)
  })

  it('values lines by summed z-scores, with fewer turnovers better', () => {
    const v = lineValues(new Map([['a', line({ pts: 20 })], ['b', line()], ['c', line({ tov: 4 })]]))
    expect(v.get('a')).toBeGreaterThan(v.get('b')!)
    expect(v.get('b')).toBeGreaterThan(v.get('c')!)
  })
})

describe('Roster Lab: weeks and volume', () => {
  const weeks = [
    { start: '2026-10-20', end: '2026-10-26' },
    { start: '2026-10-27', end: '2026-11-02' },
    { start: '2026-11-03', end: '2026-11-09' },
  ]

  it('projects the weeks still to play, the one in progress included', () => {
    const left = labWeeks(weeks, '2026-11-02')
    expect(left).toHaveLength(2)
    expect(left[0][0]).toBe('2026-10-27')
    expect(left[1]).toHaveLength(7)
  })

  it('reads finished weeks’ actual attempts from ESPN results (period k = week k)', () => {
    const totals = (fga: number) => ({ pts: 0, tpm: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga, ftm: 0, fta: 0 })
    const side = (slot: number, fga: number) => ({ slot, wins: 0, losses: 0, ties: 0, totals: totals(fga) })
    const results = [{ period: 1, home: side(1, 300), away: side(2, 250) }, { period: 2, home: side(1, 310), away: side(2, 260) }] as unknown as EspnSync['results']
    const fin = finishedWeeks(weeks, results, '2026-11-02')
    expect(fin).toHaveLength(1) // week 2 ends today: not finished
    expect(fin[0].fga.get(0)).toBe(300)
    expect(fin[0].fga.get(1)).toBe(250)
    expect(fin[0].dates).toHaveLength(7)
  })

  it('scales a team by how much it actually plays, within ±25%', () => {
    expect(volumeFactor(330, 300)).toBeCloseTo(1.1)
    expect(volumeFactor(600, 300)).toBe(1.25)
    expect(volumeFactor(100, 300)).toBe(0.8)
    expect(volumeFactor(0, 300)).toBe(1)
    const players: MatchupPlayer[] = [{ id: 'a', nbaTeam: 'BOS', positions: ['PG'], line: line({ fga: 10 }), priority: 1 }]
    const dates = ['2026-10-20', '2026-10-21']
    const playing = () => new Set(['BOS'])
    // Projected 20 attempts over the two days; the team actually took 22.
    const [f] = volumeFactors([players], [{ dates, fga: new Map([[0, 22]]) }], playing, ESPN_DEFAULT_SLOTS)
    expect(f).toBeCloseTo(1.1)
    const [w] = teamWeeks(players, [dates], playing, ESPN_DEFAULT_SLOTS, f)
    expect(w.fga).toBeCloseTo(22)
    expect(w.fgPct).toBeCloseTo(0.4) // percentages unchanged
  })
})

describe('Roster Lab: ranks and odds', () => {
  // Four teams: team 0 leads points and assists, team 3 is better everywhere else.
  const league4 = () => [
    [week({ pts: 480, ast: 110 })],
    [week()],
    [week({ pts: 380, ast: 85 })],
    [week({ reb: 190, stl: 30, blk: 25, tpm: 55, tov: 42, fgm: 160, fgPct: 0.5, ftm: 75, ftPct: 75 / 90 })],
  ]

  it('ranks each category among all teams (fewer turnovers is better) and counts expected wins', () => {
    const m = leagueMetrics(league4(), 0)
    expect(m.ranks.PTS).toBe(1)
    expect(m.ranks.AST).toBe(1)
    expect(m.ranks.REB).toBe(2) // tied with teams 1 and 2, behind team 3
    expect(m.ranks.TO).toBe(2)
    expect(m.wins.PTS).toBeGreaterThan(2.5)
    expect(m.strength).toHaveLength(4)
    expect(m.cpm).toBeCloseTo(m.strength[0])
    expect(m.p6).toBeLessThanOrEqual(m.p5)
  })

  it('a better roster moves the ranks and odds up', () => {
    const before = leagueMetrics(league4(), 1)
    const after = leagueMetrics([...league4().slice(0, 1), [week({ stl: 32, blk: 26 })], ...league4().slice(2)], 1, [0, 2, 3])
    expect(after.ranks.STL).toBeLessThan(before.ranks.STL)
    expect(after.cpm).toBeGreaterThan(before.cpm)
    expect(after.p5).toBeGreaterThan(before.p5)
  })

  it('sorts categories into win / swing / punt by share of opponents beaten', () => {
    expect(tierOf(8, 11)).toBe('win')
    expect(tierOf(5, 11)).toBe('swing')
    expect(tierOf(3, 11)).toBe('punt')
  })
})

describe('Roster Lab: applying changes', () => {
  const rosters = [
    ['a', 'b', 'c'],
    ['x', 'y'],
  ]

  it('swaps your players for pickups, an add with no drop fills an open spot', () => {
    const out = applyLab(rosters, 0, [{ drop: 'b', add: 'fa1' }, { drop: null, add: 'fa2' }, { drop: 'c', add: null }], null)
    expect(out[0]).toEqual(['a', 'c', 'fa1', 'fa2'])
    expect(out[1]).toEqual(['x', 'y'])
    expect(rosters[0]).toEqual(['a', 'b', 'c']) // inputs untouched
  })

  it('moves trade players both ways, after the pickups', () => {
    const out = applyLab(rosters, 0, [{ drop: 'a', add: 'fa1' }], { team: 1, give: ['b'], get: ['x', 'y'] })
    expect(out[0].sort()).toEqual(['c', 'fa1', 'x', 'y'])
    expect(out[1]).toEqual(['b'])
  })
})
