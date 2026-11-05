import { describe, expect, it } from 'vitest'
import type { MatchupPlayer, WeekTotals } from '@/analytics/matchup'
import { ESPN_DEFAULT_SLOTS, type SlotDef } from '@/analytics/positions'
import type { StatLine } from '@/analytics/types'
import type { EspnTotals } from '@/data/espn'
import {
  applyLab,
  categoryZ,
  finishedWeeks,
  labWeeks,
  leagueMetrics,
  lineValues,
  overallRank,
  seasonLine,
  seasonRanks,
  teamWeeks,
  tierOf,
  volumeFactor,
  volumeFactors,
  withRosterLimit,
  type LeagueRates,
} from '@/features/season/lab'
import { restOfWeek } from '@/features/season/model'
import { ordinal } from '@/lib/format'
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

  it('pools one or two games with a short last season instead of taking them as the season', () => {
    // One game at 2 of 3 from the line; last season 12 games at 0.8 attempts and 78%.
    const one = span(1, 23, { ftm: 2, fta: 3 })
    const short = span(12, 24, { ftm: 0.625, fta: 0.8 })
    const l = seasonLine(one, short, league)!
    expect(l.fta).toBeCloseTo((3 + 12 * 0.8) / 13)
    expect(l.ftm! / l.fta!).toBeGreaterThan(0.75) // not 67%
    expect(l.ftm! / l.fta!).toBeLessThan(0.79)
    // No last season at all: the one game's volume, shooting pulled toward the league's rate.
    const alone = seasonLine(one, null, league)!
    expect(alone.fta).toBeCloseTo(3)
    expect(alone.ftm! / alone.fta!).toBeGreaterThan(0.74)
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

  it('scales a team by how much it actually plays, more as finished weeks pile up', () => {
    // Half strength after two finished weeks, 8/10 after eight; the ratio itself stays within ±25%.
    expect(volumeFactor(330, 300, 2)).toBeCloseTo(1.05)
    expect(volumeFactor(330, 300, 8)).toBeCloseTo(1.08)
    expect(volumeFactor(600, 300, 2)).toBeCloseTo(1.125)
    expect(volumeFactor(100, 300, 2)).toBeCloseTo(0.9)
    expect(volumeFactor(0, 300, 2)).toBe(1)
    expect(volumeFactor(330, 300, 0)).toBe(1)
    const players: MatchupPlayer[] = [{ id: 'a', nbaTeam: 'BOS', positions: ['PG'], line: line({ fga: 10 }), priority: 1 }]
    const dates = ['2026-10-20', '2026-10-21']
    const playing = () => new Set(['BOS'])
    // Projected 20 attempts over the two days; the team actually took 22 in its one finished week.
    const [f] = volumeFactors(1, () => [players], [{ dates, fga: new Map([[0, 22]]) }], playing, ESPN_DEFAULT_SLOTS)
    expect(f).toBeCloseTo(1 + 0.1 / 3)
    const [w] = teamWeeks(players, [dates], playing, ESPN_DEFAULT_SLOTS, f)
    expect(w.fga).toBeCloseTo(20 * f)
    expect(w.fgPct).toBeCloseTo(0.4) // percentages unchanged
  })

  it('measures each finished week against the players the team had that week', () => {
    const star: MatchupPlayer = { id: 'star', nbaTeam: 'BOS', positions: ['PG'], line: line({ fga: 20 }), priority: 1 }
    const sub: MatchupPlayer = { id: 'sub', nbaTeam: 'BOS', positions: ['PG'], line: line({ fga: 10 }), priority: 2 }
    const playing = () => new Set(['BOS'])
    const w1 = { dates: ['2026-10-20'], fga: new Map([[0, 20]]) }
    const w2 = { dates: ['2026-10-27'], fga: new Map([[0, 10]]) }
    // The star played week 1 and has since gone down: actual matches the roster of each week, so no scaling.
    const then = (w: { dates: string[] }) => [w.dates[0] === '2026-10-20' ? [star] : [sub]]
    expect(volumeFactors(1, then, [w1, w2], playing, ESPN_DEFAULT_SLOTS)[0]).toBeCloseTo(1)
    // Measured against today's roster alone, those 30 attempts would read as a team outplaying a 20-attempt projection.
    expect(volumeFactors(1, () => [[sub]], [w1, w2], playing, ESPN_DEFAULT_SLOTS)[0]).toBeGreaterThan(1.1)
  })
})

describe('Roster Lab: the roster limit as players come back', () => {
  const p = (id: string, priority: number, outThrough?: string | null): MatchupPlayer => ({ id, nbaTeam: 'BOS', positions: ['PG'], line: line(), priority, outThrough })
  // Thirteen healthy players (priority = lower is better, so h13 is the lowest value).
  const healthy = Array.from({ length: 11 }, (_, k) => p(`h${k + 1}`, k + 1))
  const until = (r: ReturnType<typeof withRosterLimit>, id: string) => r.players.find((x) => x.id === id)!.until

  it('drops the lowest-value healthy player the day a return would put the team over', () => {
    const r = withRosterLimit([...healthy, p('h12', 12), p('h13', 13), p('star', 0, '2026-11-18'), p('big', 0.5, '2026-12-01')], 13, 2, '2026-11-01')
    expect([...r.cuts]).toEqual([
      ['h13', '2026-11-18'],
      ['h12', '2026-12-01'],
    ])
    expect(until(r, 'h13')).toBe('2026-11-18')
    expect(until(r, 'h1')).toBeUndefined()
  })

  it('keeps everyone while out players fit in the IR slots and the rest fit the limit', () => {
    const r = withRosterLimit([...healthy, p('star', 0, '2026-11-18')], 13, 2, '2026-11-01')
    expect(r.cuts.size).toBe(0)
  })

  it('counts a third out player against the roster, and someone out for good never comes back to force a cut', () => {
    // 11 healthy + 3 out with 2 IR slots: 12 on the roster until they return, then 14: one cut, when the last of them is back.
    const r = withRosterLimit([...healthy, p('a', 0, '2026-11-10'), p('b', 0, '2026-11-12'), p('c', 0, '2026-11-20')], 13, 2, '2026-11-01')
    expect([...r.cuts]).toEqual([['h11', '2026-11-20']])
    const never = withRosterLimit([...healthy, p('a', 0, null), p('b', 0, null), p('c', 0, '2026-11-20')], 13, 2, '2026-11-01')
    expect(never.cuts.size).toBe(0)
  })

  it('trims a team already over the limit (a three-for-two trade) from the first day projected', () => {
    const r = withRosterLimit([...healthy, p('h12', 12), p('h13', 13), p('h14', 14)], 13, 2, '2026-11-01')
    expect([...r.cuts]).toEqual([['h14', '2026-11-01']])
  })
})

describe('a live week: what is still to come on the sync day', () => {
  const seats = [{ label: 'UTIL', accepts: [], starter: true }, { label: 'UTIL', accepts: [], starter: true }] as unknown as SlotDef[]
  const p = (id: string, nbaTeam: string, pts: number, priority: number): MatchupPlayer => ({ id, nbaTeam, positions: ['PG'], line: line({ pts }), priority })
  const tippedStar = p('tipped', 'BOS', 30, 1)
  const later = p('later', 'LAL', 20, 2)
  const bench = p('bench', 'DEN', 10, 3)
  const day = '2026-11-04'
  const next = '2026-11-05'
  const byDate = new Map([
    [day, new Set(['BOS', 'LAL', 'DEN'])],
    [next, new Set(['DEN'])],
  ])
  const live = { fromDate: day, started: new Set(['BOS']), underway: { BOS: 0.5 } }

  it('a tipped player keeps his seat: nobody on the bench inherits it, and the rest of his game counts', () => {
    const r = restOfWeek([tippedStar, later, bench], [day], live, byDate, seats)
    expect(r.totals.pts).toBeCloseTo(20 + 0.5 * 30) // later in full, half of the game under way; the bench player sits
    expect(r.starts).toBe(1) // only a game yet to tip is a start to come
    expect(r.startsOf('bench')).toBe(0)
  })

  it('a finished game adds nothing, and syncs from before `underway` existed read the same way', () => {
    expect(restOfWeek([tippedStar, later, bench], [day], { fromDate: day, started: new Set(['BOS']) }, byDate, seats).totals.pts).toBeCloseTo(20)
    expect(restOfWeek([tippedStar, later, bench], [day], { fromDate: day, started: new Set(['BOS']), underway: {} }, byDate, seats).totals.pts).toBeCloseTo(20)
  })

  it('later days are projected as usual', () => {
    const r = restOfWeek([tippedStar, later, bench], [day, next], live, byDate, seats)
    expect(r.totals.pts).toBeCloseTo(20 + 15 + 10) // the bench player starts tomorrow, when his is the only game
    expect(r.startsOf('bench')).toBe(1)
  })

  it('a pickup can’t play in a game under way, and takes a seat tonight only if one is open', () => {
    const pickup = p('pickup', 'BOS', 40, 0)
    const r = restOfWeek([later, pickup], [day], live, byDate, seats, 'pickup')
    expect(r.totals.pts).toBeCloseTo(20)
    expect(r.startsOf('pickup')).toBe(0)
    const lateTip = p('pickup', 'DEN', 40, 0)
    expect(restOfWeek([tippedStar, lateTip], [day], live, byDate, seats, 'pickup').startsOf('pickup')).toBe(1)
    expect(restOfWeek([tippedStar, later, { ...lateTip, priority: 9 }], [day], live, byDate, seats, 'pickup').startsOf('pickup')).toBe(0)
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
    // The league table: every team's ranks, the same as its own view.
    expect(m.teams[0].ranks).toEqual(m.ranks)
    expect(m.teams[3].ranks).toMatchObject({ REB: 1, STL: 1, BLK: 1, TO: 1, PTS: 2 })
    expect(m.teams[2].ranks.PTS).toBe(4)
    expect(m.teams.map((_, t) => overallRank(m.strength, t)).sort()).toEqual([1, 2, 3, 4])
    expect(overallRank(m.strength, 0)).toBe(m.overall)
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
    const out = applyLab(rosters, 0, [{ drop: 'b', add: 'fa1' }, { drop: null, add: 'fa2' }, { drop: 'c', add: null }], [])
    expect(out[0]).toEqual(['a', 'c', 'fa1', 'fa2'])
    expect(out[1]).toEqual(['x', 'y'])
    expect(rosters[0]).toEqual(['a', 'b', 'c']) // inputs untouched
  })

  it('moves trade players both ways, after the pickups', () => {
    const out = applyLab(rosters, 0, [{ drop: 'a', add: 'fa1' }], [{ team: 1, give: ['b'], get: ['x', 'y'] }])
    expect(out[0].sort()).toEqual(['c', 'fa1', 'x', 'y'])
    expect(out[1]).toEqual(['b'])
  })

  it('makes several trades in order, with different teams, skipping empty ones', () => {
    const three = [['a', 'b', 'c'], ['x', 'y'], ['p', 'q']]
    const out = applyLab(three, 0, [], [{ team: 1, give: ['a'], get: ['x'] }, { team: 2, give: [], get: [] }, { team: 2, give: ['b', 'c'], get: ['p'] }])
    expect(out[0].sort()).toEqual(['p', 'x'])
    expect(out[1].sort()).toEqual(['a', 'y'])
    expect(out[2].sort()).toEqual(['b', 'c', 'q'])
  })
})

describe('League ranks, season to date (actual ESPN totals)', () => {
  const tot = (o: Partial<EspnTotals> = {}): EspnTotals => ({ pts: 400, tpm: 45, reb: 160, ast: 90, stl: 25, blk: 18, tov: 50, fgm: 150, fga: 320, ftm: 70, fta: 90, ...o })
  const side = (slot: number, totals: EspnTotals) => ({ slot, wins: 0, losses: 0, ties: 0, totals, cats: {} })
  const result = (period: number, home: [number, EspnTotals], away: [number, EspnTotals]): EspnSync['results'][number] => ({ period, home: side(...home), away: side(...away) })
  const live = (period: number, teams: [number, EspnTotals][]): NonNullable<EspnSync['live']> => ({
    period,
    asOf: '2026-11-04T20:00:00.000Z',
    fromDate: '2026-11-04',
    started: [],
    teams: teams.map(([slot, totals]) => ({ slot, totals })),
  })

  it('ranks FG% and FT% on summed makes over summed attempts, not the average of weekly percentages', () => {
    // Slot 1: 90/200 then 2/10 → 92/210 = .438 (weekly average .325). Slot 2: 40/100 twice → .400.
    const results = [result(1, [1, tot({ fgm: 90, fga: 200, ftm: 9, fta: 10 })], [2, tot({ fgm: 40, fga: 100, ftm: 40, fta: 50 })]), result(2, [1, tot({ fgm: 2, fga: 10, ftm: 1, fta: 10 })], [2, tot({ fgm: 40, fga: 100, ftm: 40, fta: 50 })])]
    const r = seasonRanks(results, null, 2)!
    expect(r.teams[0]!.totals.FG).toBeCloseTo(92 / 210)
    expect(r.teams[0]!.ranks.FG).toBe(1)
    expect(r.teams[1]!.ranks.FG).toBe(2)
    // FT: 10/20 = .500 against 80/100 = .800 (the weekly average would be .55 vs .80: same order, but the value is the summed one).
    expect(r.teams[0]!.totals.FT).toBeCloseTo(0.5)
    expect(r.teams[0]!.ranks.FT).toBe(2)
    // Counting categories are season totals.
    expect(r.teams[0]!.totals.PTS).toBe(800)
    expect(r.periods).toEqual([1, 2])
    expect(r.livePeriod).toBeNull()
  })

  it('ranks fewer turnovers higher, and tied teams share the better rank', () => {
    const results = [result(1, [1, tot({ tov: 40, pts: 500 })], [2, tot({ tov: 60, pts: 500 })]), result(1, [3, tot({ tov: 50, pts: 450 })], [4, tot({ tov: 40, pts: 400 })])]
    const r = seasonRanks(results, null, 4)!
    expect(r.teams.map((t) => t!.ranks.TO)).toEqual([1, 4, 3, 1])
    expect(r.teams.map((t) => t!.ranks.PTS)).toEqual([1, 1, 3, 4])
    // Heat: better is positive, fewer turnovers included.
    const z = categoryZ(r.teams.map((t) => t!.totals))
    expect(z[0].TO).toBeGreaterThan(0)
    expect(z[1].TO).toBeLessThan(0)
    expect(z[0].PTS).toBeCloseTo(z[1].PTS)
  })

  it('adds the week in progress so far, unless ESPN has already scored it', () => {
    const results = [result(1, [1, tot({ reb: 100 })], [2, tot({ reb: 150 })])]
    const now = live(2, [
      [1, tot({ reb: 80 })],
      [2, tot({ reb: 10 })],
    ])
    const r = seasonRanks(results, now, 2)!
    expect(r.livePeriod).toBe(2)
    expect(r.teams[0]!.totals.REB).toBe(180)
    expect(r.teams[0]!.ranks.REB).toBe(1)
    // Week 2 already final: its live totals aren't counted twice.
    const twice = seasonRanks([...results, result(2, [1, tot({ reb: 80 })], [2, tot({ reb: 10 })])], now, 2)!
    expect(twice.livePeriod).toBeNull()
    expect(twice.teams[0]!.totals.REB).toBe(180)
    // A week in progress with nothing played yet adds nothing.
    const zero = tot({ pts: 0, tpm: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, ftm: 0, fta: 0 })
    expect(seasonRanks(results, live(2, [[1, zero], [2, zero]]), 2)!.livePeriod).toBeNull()
  })

  it('is empty before anything is played; teams without totals are left unranked', () => {
    const zero = tot({ pts: 0, tpm: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, ftm: 0, fta: 0 })
    expect(seasonRanks(undefined, null, 12)).toBeNull()
    expect(seasonRanks([], undefined, 12)).toBeNull()
    expect(seasonRanks([], live(1, [[1, zero], [2, zero]]), 12)).toBeNull()
    // Only the week in progress: ranked on it, teams outside the league ignored.
    const r = seasonRanks([], live(1, [[1, tot()], [2, tot({ stl: 30 })], [13, tot({ stl: 99 })]]), 3)!
    expect(r.periods).toEqual([])
    expect(r.livePeriod).toBe(1)
    expect(r.teams).toHaveLength(3)
    expect(r.teams[2]).toBeNull()
    expect(r.teams[1]!.ranks.STL).toBe(1)
    expect(r.teams[0]!.ranks.STL).toBe(2)
  })

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 112].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th', '112th'])
  })
})
