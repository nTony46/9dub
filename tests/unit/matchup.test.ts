import { describe, expect, it } from 'vitest'
import { closenessOf, compareWeek, projectSide, scoreText, type MatchupPlayer, type WeekTotals } from '@/analytics/matchup'
import { backToBackWindows, streamingTeams } from '@/analytics/streaming'
import type { Position } from '@/analytics/positions'
import type { StatLine } from '@/analytics/types'

const line = (o: Partial<StatLine> = {}): StatLine => ({ pts: 10, tpm: 1, reb: 5, ast: 3, stl: 1, blk: 0.5, tov: 2, fgm: 4, fga: 8, ftm: 2, fta: 2.5, ...o })
const player = (id: string, team: string, positions: Position[], priority: number, o: Partial<MatchupPlayer> = {}): MatchupPlayer => ({
  id,
  nbaTeam: team,
  positions,
  line: line(),
  priority,
  ...o,
})
const everyone = () => new Set(['BOS', 'NYK', 'MIA'])

describe('weekly matchup projection', () => {
  it('counts games from the schedule and starts the best players when the lineup is full', () => {
    // Six centres: one C slot + three UTIL slots → four start each day, the two lowest priorities sit.
    const bigs = Array.from({ length: 6 }, (_, i) => player(`c${i}`, 'BOS', ['C'], i))
    const side = projectSide(bigs, ['2026-10-20', '2026-10-21'], everyone)
    expect(side.games).toBe(12)
    expect(side.starts).toBe(8)
    expect(side.benched).toBe(4)
    expect(side.players.get('c0')).toMatchObject({ games: 2, starts: 2, benched: 0 })
    expect(side.players.get('c5')).toMatchObject({ games: 2, starts: 0, benched: 2 })
    expect(side.days[0].benched).toEqual(['c4', 'c5'])
    expect(side.totals.pts).toBeCloseTo(8 * 10)
  })

  it('only counts players whose NBA team plays that day', () => {
    const playing = (d: string) => (d === '2026-10-20' ? new Set(['BOS']) : new Set(['NYK']))
    const side = projectSide([player('a', 'BOS', ['PG'], 1), player('b', 'NYK', ['SG'], 2), player('c', 'FA', ['SF'], 3)], ['2026-10-20', '2026-10-21', '2026-10-22'], playing)
    expect(side.players.get('a')!.games).toBe(1)
    expect(side.players.get('b')!.games).toBe(2)
    expect(side.players.get('c')!.games).toBe(0)
  })

  it('builds FG% / FT% from total makes and attempts, skipping players without volume', () => {
    const side = projectSide(
      [player('a', 'BOS', ['PG'], 1, { line: line({ fgm: 9, fga: 18 }) }), player('b', 'BOS', ['C'], 2, { line: line({ fgm: 3, fga: 4 }) }), player('n', 'BOS', ['SF'], 3, { line: line({ fgm: null, fga: null }) })],
      ['2026-10-20'],
      everyone,
    )
    expect(side.totals.fgPct).toBeCloseTo(12 / 22)
    expect(side.missingVolume.fg).toEqual(['n'])
    expect(side.totals.pts).toBeCloseTo(30) // the no-volume player still adds counting stats
  })

  it('scales by availability and ignores players without a projection', () => {
    const side = projectSide([player('a', 'BOS', ['PG'], 1, { availability: 0.5 }), player('x', 'BOS', ['SG'], 2, { line: null })], ['2026-10-20', '2026-10-21'], everyone)
    expect(side.totals.pts).toBeCloseTo(10)
    expect(side.noProjection).toEqual(['x'])
    expect(side.players.get('x')!.games).toBe(0)
  })
})

describe('category calls', () => {
  const totals = (o: Partial<WeekTotals>): WeekTotals => {
    const t = { pts: 500, tpm: 60, reb: 200, ast: 120, stl: 35, blk: 20, tov: 60, fgm: 200, fga: 420, ftm: 80, fta: 100, ...o }
    return { ...t, fgPct: t.fgm / t.fga, ftPct: t.ftm / t.fta }
  }

  it('fewer turnovers wins TO; ties are reported as ties', () => {
    const c = compareWeek(totals({ tov: 55 }), totals({ tov: 65 }))
    expect(c.calls.find((x) => x.cat === 'TO')).toMatchObject({ winner: 'me', edge: 10 })
    expect(c.calls.find((x) => x.cat === 'PTS')!.winner).toBe('tie')
    expect(scoreText(c)).toBe('1–0–8')
  })

  it('labels closeness against the weekly noise scale and says what flips a loss', () => {
    const c = compareWeek(totals({ stl: 34, pts: 400 }), totals({ stl: 36 }))
    const stl = c.calls.find((x) => x.cat === 'STL')!
    expect(stl.winner).toBe('them')
    expect(stl.noise).toBeCloseTo(Math.sqrt(70))
    expect(stl.closeness).toBe('toss-up')
    expect(stl.flip).toBe('+2.0 STL')
    expect(c.calls.find((x) => x.cat === 'PTS')!.closeness).toBe('clear')
    expect(closenessOf(1, 1)).toBe('lean')
  })

  it('percentages compare made ÷ attempted and give the makes needed at the same attempts', () => {
    const c = compareWeek(totals({ fgm: 190 }), totals({ fgm: 200 }))
    const fg = c.calls.find((x) => x.cat === 'FG')!
    expect(fg.winner).toBe('them')
    expect(fg.flip).toBe('+10.0 FGM on the same attempts')
    expect(fg.noise).toBeGreaterThan(0)
  })
})

describe('daily lineups and injuries', () => {
  it('records each starting slot, the bench, no-game days and players marked out', () => {
    const roster = [
      player('pg', 'BOS', ['PG'], 1),
      player('c', 'BOS', ['C'], 2),
      player('hurt', 'BOS', ['SF'], 0, { outThrough: '2026-10-20' }),
      player('idle', 'NYK', ['SG'], 3),
    ]
    const playing = () => new Set(['BOS'])
    const side = projectSide(roster, ['2026-10-20', '2026-10-21'], playing)
    const [d1, d2] = side.days
    expect(d1.lineup.map((s) => s.slot)).toEqual(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL', 'UTIL'])
    expect(d1.lineup.find((s) => s.slot === 'PG')!.id).toBe('pg')
    expect(d1.lineup.find((s) => s.slot === 'C')!.id).toBe('c')
    expect(d1.out).toEqual(['hurt'])
    expect(d1.idle).toEqual(['idle'])
    expect(d2.out).toEqual([]) // back the day after "out until"
    expect(d2.started).toContain('hurt')
    expect(side.players.get('hurt')).toMatchObject({ missed: 1, games: 1, starts: 1 })
  })

  it('a player out until further notice never counts', () => {
    const side = projectSide([player('a', 'BOS', ['PG'], 1, { outThrough: null })], ['2026-10-20', '2026-12-20'], () => new Set(['BOS']))
    expect(side.starts).toBe(0)
    expect(side.players.get('a')!.missed).toBe(2)
  })
})

describe('ESPN-style lineup display', () => {
  it('keeps every starting slot filled: players with games count, idle players fill the rest, only the remainder sits', () => {
    const roster = [
      ...Array.from({ length: 12 }, (_, i) => player(`g${i}`, 'BOS', ['C'], i)), // 12 centres with games: C + 3 UTIL start, 8 benched
      player('pg', 'NYK', ['PG'], 20), // no game today
    ]
    const day = projectSide(roster, ['2026-10-20'], () => new Set(['BOS'])).days[0]
    expect(day.started).toHaveLength(4)
    expect(day.benched).toHaveLength(8)
    const pg = day.lineup.find((s) => s.slot === 'PG')!
    expect(pg).toEqual({ slot: 'PG', id: 'pg', playing: false }) // shown in the slot, marked no game
    expect(day.lineup.filter((s) => s.playing)).toHaveLength(4)
    expect(day.bench.slice(0, 8)).toEqual(day.benched) // benched-with-a-game listed first
    expect(day.bench).not.toContain('pg')
  })
})

describe('open seats and streaming teams', () => {
  it('knows which positions can fill an open seat (a missing centre leaves only C)', () => {
    // Nine non-centres with games fill every slot except C.
    const roster = ['PG', 'PG', 'SG', 'SG', 'SF', 'SF', 'PF', 'PF', 'PG', 'SF'].map((pos, i) => player(`p${i}`, 'BOS', [pos as Position], i))
    const day = projectSide(roster, ['2026-10-23'], () => new Set(['BOS'])).days[0]
    expect(day.started).toHaveLength(9)
    expect(day.benched).toHaveLength(1)
    expect(day.open).toBe(1)
    expect(day.fits).toEqual(['C'])
  })

  it('ranks teams by open nights they play and finds back-to-backs on open nights', () => {
    const roster = [player('a', 'BOS', ['PG'], 1)]
    const sched: Record<string, string[]> = {
      '2026-10-24': ['BOS', 'PHI', 'MIA'],
      '2026-10-25': ['PHI', 'MIA', 'NYK'],
      '2026-10-26': ['PHI'],
    }
    const teamsOn = (d: string) => new Set(sched[d] ?? [])
    const side = projectSide(roster, ['2026-10-24', '2026-10-25', '2026-10-26'], teamsOn)
    const fits = streamingTeams(side.days, teamsOn, '2026-10-24')
    expect(fits[0]).toMatchObject({ team: 'PHI', teamGames: 3 })
    expect(fits[0].days.map((d) => d.date)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26'])
    expect(fits[0].b2b).toHaveLength(2)
    expect(fits.find((f) => f.team === 'MIA')!.days).toHaveLength(2)
    // Nights before "from" are ignored.
    expect(streamingTeams(side.days, teamsOn, '2026-10-26').map((f) => f.team)).toEqual(['PHI'])
    const b2b = backToBackWindows(side.days, teamsOn, '2026-10-24')
    expect(b2b[0]).toMatchObject({ first: '2026-10-24', second: '2026-10-25', teams: ['MIA', 'PHI'] })
  })
})

describe('stable daily lineup (moves off the bench)', () => {
  it('keeps starters in their usual slots and drops bench players with a game into the seats of starters without one', () => {
    const roster = [
      player('pg', 'BOS', ['PG'], 1),
      player('sg', 'BOS', ['SG'], 2),
      player('sf', 'BOS', ['SF'], 3),
      player('pf', 'BOS', ['PF'], 4),
      player('c', 'BOS', ['C'], 5),
      player('g', 'BOS', ['PG'], 6),
      player('tatum', 'NYK', ['SF', 'PF'], 7), // usual F, no game today
      player('pritchard', 'NYK', ['PG', 'SG'], 8), // usual UTIL, no game today
      player('u2', 'BOS', ['SG'], 9),
      player('u3', 'BOS', ['PF'], 10),
      player('hachimura', 'BOS', ['SF', 'PF'], 11), // bench, has a game
      player('acuff', 'BOS', ['PG'], 12), // bench, has a game
    ]
    const home = new Map([
      ['pg', 0],
      ['sg', 1],
      ['sf', 2],
      ['pf', 3],
      ['c', 4],
      ['g', 5],
      ['tatum', 6],
      ['pritchard', 7],
      ['u2', 8],
      ['u3', 9],
    ])
    const day = projectSide(roster, ['2026-10-28'], () => new Set(['BOS']), undefined, home).days[0]
    const at = (i: number) => day.lineup[i].id
    expect([0, 1, 2, 3, 4, 5, 8, 9].map(at)).toEqual(['pg', 'sg', 'sf', 'pf', 'c', 'g', 'u2', 'u3']) // nobody reshuffled
    expect(at(6)).toBe('hachimura') // into Tatum's F
    expect(at(7)).toBe('acuff') // into Pritchard's UTIL
    expect(day.started).toHaveLength(10)
    expect(day.bench).toEqual(['tatum', 'pritchard'])
  })

  it('on a quiet night, idle starters keep their own slots; nobody playing is moved for them', () => {
    const roster = [
      player('pg', 'NYK', ['PG'], 1), // no game, usual PG
      player('lillard', 'NYK', ['PG'], 2), // no game, usual UTIL (bench player took it)
      player('grimes', 'BOS', ['SG', 'SF'], 9), // bench, has a game
    ]
    const home = new Map([
      ['pg', 0],
      ['lillard', 7],
    ])
    const day = projectSide(roster, ['2026-10-28'], () => new Set(['BOS']), undefined, home).days[0]
    expect(day.lineup[0]).toEqual({ slot: 'PG', id: 'pg', playing: false })
    expect(day.lineup.find((s) => s.id === 'grimes')!.playing).toBe(true)
    expect(day.lineup.find((s) => s.id === 'lillard')?.playing ?? false).toBe(false)
  })
})
