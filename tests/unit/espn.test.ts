import { afterEach, describe, expect, it, vi } from 'vitest'
import { addTotals, compareWeek, weekTotals } from '@/analytics/matchup'
import { ESPN_DEFAULT_SLOTS, slotDefs } from '@/analytics/positions'
import { EspnSnapshotSchema, espnSeasonId, localDate, matchupWeeks, nbaScheduleFromEspn, snapshotFromEspn, type EspnSnapshot } from '@/data/espn'
import { datesBetween, NbaScheduleSchema } from '@/data/schedule'
import { currentSeason } from '@/data/seasonLabel'
import { ESPN_IR_NOTE, planEspnDraft, planEspnSync, type EspnPlanInput } from '@/store/espnSync'
import { finalFor, liveFor } from '@/features/season/model'
import { ESPN_FAN_BASE, ESPN_READ_BASE, espnRead } from '../../scripts/espn'

const entry = (playerId: number, fullName: string, proTeamId: number, lineupSlotId: number, eligibleSlots: number[], injuryStatus = 'ACTIVE') => ({
  playerId,
  lineupSlotId,
  playerPoolEntry: { player: { id: playerId, fullName, proTeamId, injuryStatus, eligibleSlots } },
})
const score = (pts: number, fgm: number, fga: number) => ({
  cumulativeScore: { scoreByStat: { '0': { score: pts }, '13': { score: fgm }, '14': { score: fga }, '17': { score: 3 }, '11': { score: 4 } } },
})

const FETCHED = '2026-10-22T03:00:00.000Z'
const rawLeague = {
  id: 42,
  seasonId: 2027,
  status: { currentMatchupPeriod: 1 },
  settings: { name: 'Test League', draftSettings: { pickOrder: [7, 3] }, scheduleSettings: { matchupPeriodCount: 2 } },
  teams: [
    { id: 3, name: 'Second Pick', abbrev: 'SP', roster: { entries: [entry(30, 'Jalen Brunson', 18, 0, [0, 1, 5, 11, 12, 13]), entry(31, 'Ja Morant', 29, 13, [0, 5, 11, 12, 13], 'OUT')] } },
    { id: 7, name: 'First Pick', abbrev: 'FP', roster: { entries: [entry(70, 'Nikola Jokić', 7, 4, [4, 9, 10, 11, 12, 13])] } },
  ],
  schedule: [
    { matchupPeriodId: 1, home: { teamId: 7, ...score(50, 20, 40) }, away: { teamId: 3, ...score(44, 15, 38) } },
    { matchupPeriodId: 2, home: { teamId: 3 }, away: { teamId: 7 } },
    { matchupPeriodId: 3, home: { teamId: 7 }, away: { teamId: 3 } }, // playoffs: dropped
  ],
}
const rawPro = {
  settings: {
    proTeams: [
      { id: 7, abbrev: 'Den' },
      { id: 18, abbrev: 'NY' },
      { id: 29, abbrev: 'Mem' },
    ],
  },
  // DEN tipped off 2h before the read; NYK plays tomorrow.
  games: [
    { start: Date.parse(FETCHED) - 2 * 3600_000, home: 7, away: 29 },
    { start: Date.parse(FETCHED) + 20 * 3600_000, home: 18, away: 7 },
  ],
}

describe('ESPN snapshot', () => {
  const snap = snapshotFromEspn(rawLeague, rawPro, FETCHED)

  it('orders teams by draft slot and maps NBA codes, positions, IR and injuries', () => {
    expect(snap.teams.map((t) => [t.slot, t.name])).toEqual([
      [1, 'First Pick'],
      [2, 'Second Pick'],
    ])
    const sp = snap.teams[1].roster
    expect(sp[0]).toMatchObject({ name: 'Jalen Brunson', nbaTeam: 'NYK', lineupSlot: 'PG', positions: ['PG', 'SG'] })
    expect(sp[1]).toMatchObject({ lineupSlot: 'IR', injuryStatus: 'OUT', nbaTeam: 'MEM' })
    expect(snap.teams[0].roster[0].positions).toEqual(['C'])
  })

  it('keeps regular-season matchups by slot and the live totals of the week in progress', () => {
    expect(snap.schedule).toEqual([
      { period: 1, home: 1, away: 2 },
      { period: 2, home: 2, away: 1 },
    ])
    expect(snap.live?.period).toBe(1)
    expect(snap.live?.fromDate).toBe(localDate(Date.parse(FETCHED)))
    expect(snap.live?.started.sort()).toEqual(['DEN', 'MEM'])
    expect(snap.live?.teams.find((t) => t.slot === 1)?.totals).toMatchObject({ pts: 50, fgm: 20, fga: 40, tpm: 3, tov: 4, reb: 0 })
  })

  it('maps a 9dub season label to ESPN’s season id', () => {
    expect(espnSeasonId('2026-27')).toBe(2027)
  })
})

describe('finished matchups and standings', () => {
  const side = (teamId: number, wins: number, losses: number, pts: [number, string], tov: [number, string]) => ({
    teamId,
    cumulativeScore: { wins, losses, ties: 0, scoreByStat: { '0': { score: pts[0], result: pts[1] }, '11': { score: tov[0], result: tov[1] }, '13': { score: 20, result: null } } },
  })
  const scored = {
    ...rawLeague,
    status: { currentMatchupPeriod: 2 },
    teams: rawLeague.teams.map((t) => ({ ...t, playoffSeed: t.id === 3 ? 1 : 2, record: { overall: t.id === 3 ? { wins: 5, losses: 4, ties: 0 } : { wins: 4, losses: 5, ties: 0 } } })),
    schedule: [
      { matchupPeriodId: 1, winner: 'AWAY', home: side(7, 4, 5, [50, 'LOSS'], [9, 'LOSS']), away: side(3, 5, 4, [61, 'WIN'], [8, 'WIN']) },
      { matchupPeriodId: 2, winner: 'UNDECIDED', home: { teamId: 3 }, away: { teamId: 7 } },
      { matchupPeriodId: 3, winner: 'HOME', home: side(7, 6, 3, [1, 'WIN'], [1, 'WIN']), away: side(3, 3, 6, [0, 'LOSS'], [2, 'LOSS']) }, // playoffs: dropped
    ],
  }
  const snap = snapshotFromEspn(scored, rawPro, FETCHED)

  it('keeps each scored week’s final line by draft slot, with ESPN’s call per category', () => {
    expect(snap.results).toHaveLength(1)
    const r = snap.results[0]
    expect(r.period).toBe(1)
    expect(r.home).toMatchObject({ slot: 1, wins: 4, losses: 5, cats: { PTS: 'L', TO: 'L' } })
    expect(r.away).toMatchObject({ slot: 2, wins: 5, losses: 4, cats: { PTS: 'W', TO: 'W' } })
    expect(r.away.totals).toMatchObject({ pts: 61, tov: 8, fgm: 20 })
  })

  it('reads the standings: category record and place', () => {
    expect(snap.standings).toEqual([
      { slot: 1, wins: 4, losses: 5, ties: 0, rank: 2 },
      { slot: 2, wins: 5, losses: 4, ties: 0, rank: 1 },
    ])
  })

  it('finds your side of a week, home or away', () => {
    expect(finalFor(snap.results, 1, 1)).toMatchObject({ opp: 0, me: { wins: 5 }, them: { wins: 4 } })
    expect(finalFor(snap.results, 1, 0)).toMatchObject({ opp: 1, me: { wins: 4 } })
    expect(finalFor(snap.results, 2, 0)).toBeUndefined()
  })

  it('reads an older snapshot without them', () => {
    const { results: _r, standings: _s, ...old } = snap
    expect(EspnSnapshotSchema.parse(old)).toMatchObject({ results: [], standings: [] })
  })
})

describe('planEspnSync', () => {
  const snap = snapshotFromEspn(rawLeague, rawPro, FETCHED)
  const records = [
    { id: 'jokic', fullName: 'Nikola Jokic', aliases: [], nbaTeam: 'DEN' },
    { id: 'brunson', fullName: 'Jalen Brunson', aliases: [], nbaTeam: 'NYK' },
    { id: 'morant', fullName: 'Ja Morant', aliases: [], nbaTeam: 'MEM' },
    { id: 'embiid', fullName: 'Joel Embiid', aliases: [], nbaTeam: 'PHI' },
  ]
  const base: EspnPlanInput = {
    records,
    // Draft: slot 1 took Jokic + Embiid, slot 2 took Brunson. Morant was a free agent.
    draftRosters: [['jokic', 'embiid'], ['brunson']],
    moves: [],
    injuries: [],
    teamNames: ['Old Name', 'Team 2'],
    teams: 2,
    userSlot: 1,
    weeks: [
      { id: 'w1', start: '2026-10-20', end: '2026-10-25', opponent: null, label: 'Somebody', owner: '', away: false },
      { id: 'w2', start: '2026-10-26', end: '2026-11-01', opponent: 1, label: 'Team 2', owner: '', away: false },
    ],
    today: '2026-10-21',
  }

  it('turns ESPN rosters into drops and adds, IR placements, names and opponents', () => {
    const plan = planEspnSync(snap, base)
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.moves).toEqual([
      { playerId: 'embiid', from: 0, to: null },
      { playerId: 'morant', from: null, to: 1 },
    ])
    expect(plan.irAdd).toEqual(['morant'])
    expect(plan.teamNames).toEqual(['First Pick', 'Second Pick'])
    expect(plan.weeks?.map((w) => [w.opponent, w.label, w.away])).toEqual([
      [1, 'Second Pick', false],
      [1, 'Second Pick', true],
    ])
    expect(plan.players.jokic).toEqual({ team: 'DEN', positions: ['C'], status: null })
    expect(plan.players.morant.status).toBe('OUT')
    expect(plan.changes).toContain('First Pick dropped Joel Embiid')
    expect(plan.changes).toContain('Second Pick added Ja Morant')
    expect(plan.unmatched).toEqual([])
  })

  it('is idempotent once applied, and only clears IR marks it made itself', () => {
    const applied: EspnPlanInput = {
      ...base,
      moves: [
        { id: 'a', at: 1, playerId: 'embiid', from: 0, to: null, note: 'ESPN' },
        { id: 'b', at: 1, playerId: 'morant', from: null, to: 1, note: 'ESPN' },
      ],
      injuries: [
        { playerId: 'morant', until: null, at: 1, note: ESPN_IR_NOTE },
        { playerId: 'brunson', until: null, at: 1, note: ESPN_IR_NOTE }, // ESPN no longer has him on IR
        { playerId: 'jokic', until: '2026-10-30', at: 1, note: '' }, // marked by hand: untouched
      ],
      teamNames: ['First Pick', 'Second Pick'],
    }
    const plan = planEspnSync(snap, applied)
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.moves).toEqual([])
    expect(plan.irAdd).toEqual([])
    expect(plan.irClear).toEqual(['brunson'])
    expect(plan.teamNames).toBeNull()
  })

  it('keeps a name you edited until ESPN’s own name changes', () => {
    const plan = planEspnSync(snap, { ...base, teamNames: ['My nickname', 'Second Pick'], lastEspnNames: ['First Pick', 'Second Pick'] })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.teamNames).toBeNull()
    const renamed = planEspnSync(snap, { ...base, teamNames: ['My nickname', 'Second Pick'], lastEspnNames: ['Older ESPN name', 'Second Pick'] })
    if ('error' in renamed) throw new Error(renamed.error)
    expect(renamed.teamNames).toEqual(['First Pick', 'Second Pick'])
  })

  it('refuses a league of a different size and lists players it cannot match', () => {
    expect(planEspnSync(snap, { ...base, teams: 12 })).toHaveProperty('error')
    const plan = planEspnSync(snap, { ...base, records: records.filter((r) => r.id !== 'brunson') })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.unmatched).toEqual(['Jalen Brunson (Second Pick)'])
  })
})

describe('live totals in the projection', () => {
  const snap: EspnSnapshot = snapshotFromEspn(rawLeague, rawPro, FETCHED)

  it('only applies to the matching week and the two slots', () => {
    expect(liveFor(snap.live, 2, 0, 1)).toBeUndefined()
    const lv = liveFor(snap.live, 1, 0, 1)!
    expect(lv.me?.pts).toBe(50)
    expect(lv.them?.fgPct).toBeCloseTo(15 / 38)
    expect([...lv.started].sort()).toEqual(['DEN', 'MEM'])
  })

  it('adds what is in the books to what is left; noise only counts what is left', () => {
    const now = weekTotals({ pts: 300, tpm: 30, reb: 120, ast: 70, stl: 20, blk: 15, tov: 40, fgm: 110, fga: 230, ftm: 50, fta: 60 })
    const left = weekTotals({ pts: 100, tpm: 10, reb: 40, ast: 20, stl: 6, blk: 5, tov: 12, fgm: 38, fga: 80, ftm: 15, fta: 20 })
    const total = addTotals(now, left)
    expect(total.pts).toBe(400)
    expect(total.fgPct).toBeCloseTo(148 / 310)
    const them = addTotals(now, left)
    const full = compareWeek(total, { ...them, pts: 390 })
    const live = compareWeek(total, { ...them, pts: 390 }, { me: left, them: left })
    const pts = (c: typeof full) => c.calls.find((x) => x.cat === 'PTS')!
    expect(pts(live).noise!).toBeLessThan(pts(full).noise!)
    // Nothing left to play: a lead is settled.
    const done = compareWeek(total, { ...them, pts: 399 }, { me: weekTotals({ ...left, pts: 0 }), them: weekTotals({ ...left, pts: 0 }) })
    expect(pts(done).closeness).toBe('clear')
  })
})

describe('ESPN requests are read-only', () => {
  afterEach(() => vi.unstubAllGlobals())
  const auth = { swid: '{X}', espnS2: 'Y', leagueId: 1, season: 2027 }

  it('refuses anything but ESPN’s read API, before any network call', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(espnRead('https://lm-api-writes.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leagues/1/transactions/', auth)).rejects.toThrow(/read-only/)
    await expect(espnRead('https://example.com/x', auth)).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('sends a GET with the cookies to the read hosts', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetch)
    await espnRead(`${ESPN_READ_BASE}/seasons/2027/segments/0/leagues/1?view=mTeam`, auth)
    await espnRead(`${ESPN_FAN_BASE}/%7BX%7D`, auth)
    expect(fetch).toHaveBeenCalledTimes(2)
    for (const call of fetch.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[1].method).toBe('GET')
      expect((call[1].headers as Record<string, string>).cookie).toBe('SWID={X}; espn_s2=Y')
    }
  })
})

describe('setup from ESPN', () => {
  const owned = {
    ...rawLeague,
    settings: { ...rawLeague.settings, rosterSettings: { lineupSlotCounts: { '0': 1, '4': 1, '5': 1, '9': 1, '11': 2, '12': 2, '13': 1, '14': 0 } } },
    teams: rawLeague.teams.map((t) => ({ ...t, owners: [t.id === 3 ? '{ABC-123}' : '{OTHER}'] })),
    draftDetail: {
      picks: [
        { overallPickNumber: 1, roundId: 1, teamId: 7, playerId: 70 },
        { overallPickNumber: 2, roundId: 1, teamId: 3, playerId: 30 },
        { overallPickNumber: 3, roundId: 2, teamId: 3, playerId: 99 }, // dropped since: named by the player lookup
        { overallPickNumber: 4, roundId: 2, teamId: 3, playerId: 31 }, // snake says slot 1: a traded pick
      ],
    },
  }

  it('reads the lineup, rounds and the cookie owner’s team', () => {
    const snap = snapshotFromEspn(owned, rawPro, FETCHED, { swid: '{abc-123}' })
    expect(snap.lineup).toEqual({ slots: ['PG', 'C', 'G', 'PF/C', 'UTIL', 'UTIL', 'BE', 'BE'], ir: 1 })
    expect(snap.rounds).toBe(2)
    expect(snap.mySlot).toBe(2)
    expect(snap.draft).toEqual([]) // only when asked for
  })

  it('names drafted players from rosters, else the lookup, and maps them to picks', () => {
    const snap = snapshotFromEspn(owned, rawPro, FETCHED, { players: new Map([[99, { name: 'Joel Embiid', proTeamId: 18 }]]) })
    expect(snap.draft.map((p) => [p.overall, p.slot, p.name, p.nbaTeam])).toEqual([
      [1, 1, 'Nikola Jokić', 'DEN'],
      [2, 2, 'Jalen Brunson', 'NYK'],
      [3, 2, 'Joel Embiid', 'NYK'],
      [4, 2, 'Ja Morant', 'MEM'],
    ])
    const records = [
      { id: 'jokic', fullName: 'Nikola Jokic', aliases: [], nbaTeam: 'DEN' },
      { id: 'brunson', fullName: 'Jalen Brunson', aliases: [], nbaTeam: 'NYK' },
      { id: 'embiid', fullName: 'Joel Embiid', aliases: [], nbaTeam: 'PHI' },
    ]
    const plan = planEspnDraft(snap.draft, records, 2)
    expect(plan.picks).toEqual([
      { overall: 1, playerId: 'jokic', teamIndex: 0, manualTeam: false },
      { overall: 2, playerId: 'brunson', teamIndex: 1, manualTeam: false },
      { overall: 3, playerId: 'embiid', teamIndex: 1, manualTeam: false },
      { overall: 4, playerId: 'espn-31', teamIndex: 1, manualTeam: true },
    ])
    expect(plan.stubs).toEqual([{ identity: { id: 'espn-31', fullName: 'Ja Morant', aliases: [], nbaTeam: 'MEM', espnId: '31', positions: [] }, projection: null }])
  })

  it('builds the schedule when 9dub has none, and reports a lineup that differs', () => {
    const snap = { ...snapshotFromEspn(owned, rawPro, FETCHED), weeks: [{ period: 1, start: '2026-10-20', end: '2026-10-25' }, { period: 2, start: '2026-10-26', end: '2026-11-01' }] }
    const plan = planEspnSync(snap, {
      records: [],
      draftRosters: [[], []],
      moves: [],
      injuries: [],
      teamNames: ['First Pick', 'Second Pick'],
      teams: 2,
      userSlot: 2,
      weeks: [],
      today: '2026-10-21',
      lineupSlots: ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL', 'UTIL', 'BE', 'BE', 'BE'],
      irSlots: 2,
    })
    if ('error' in plan) throw new Error(plan.error)
    expect(plan.weeks).toEqual([
      { id: 'espn-wk-1', start: '2026-10-20', end: '2026-10-25', opponent: 0, label: 'First Pick', owner: '', away: true },
      { id: 'espn-wk-2', start: '2026-10-26', end: '2026-11-01', opponent: 0, label: 'First Pick', owner: '', away: false },
    ])
    expect(plan.lineup).toEqual(snap.lineup)
  })
})

describe('the season calendar from ESPN', () => {
  const every = (from: string, to: string, skip: string[] = []) => datesBetween(from, to).filter((d) => !skip.includes(d))

  it('runs week 1 to the first Sunday, then Monday to Sunday, merging the All-Star week with the next', () => {
    // Opening Tuesday; a Thanksgiving gap (one day) and an unscheduled December stretch don't merge anything.
    const dates = [...every('2026-10-20', '2026-12-31', ['2026-11-26', '2026-12-05', '2026-12-06', '2026-12-07', '2026-12-08']), ...every('2027-01-01', '2027-03-14', ['2027-02-19', '2027-02-20', '2027-02-21', '2027-02-22', '2027-02-23'])]
    const weeks = matchupWeeks(dates, 22)
    expect(weeks[0]).toEqual({ period: 1, start: '2026-10-20', end: '2026-10-25' })
    expect(weeks[1]).toEqual({ period: 2, start: '2026-10-26', end: '2026-11-01' })
    expect(weeks.find((w) => w.start === '2026-11-30')?.end).toBe('2026-12-06')
    const allStar = weeks.find((w) => w.start === '2027-02-15')
    expect(allStar?.end).toBe('2027-02-28')
    expect(weeks[weeks.indexOf(allStar!) + 1].start).toBe('2027-03-01')
  })

  it('turns ESPN’s game list into 9dub’s NBA schedule, dated in US Eastern time', () => {
    // 10:30 PM Eastern on Oct 20 is already Oct 21 in UTC.
    const late = Date.parse('2026-10-21T02:30:00Z')
    const s = nbaScheduleFromEspn({ ...rawPro, games: [{ start: late, home: 7, away: 18 }] }, '2026-27', FETCHED)
    expect(s.games).toEqual([{ n: 1, date: '2026-10-20', away: 'NYK', home: 'DEN', neutral: false, cup: false }])
    expect(s.unscheduled.DEN).toBe(81)
    expect(NbaScheduleSchema.parse(s).season).toBe('2026-27')
  })

  it('names the season from the date', () => {
    expect(currentSeason(new Date(2026, 9, 26))).toBe('2026-27')
    expect(currentSeason(new Date(2027, 3, 1))).toBe('2026-27')
    expect(currentSeason(new Date(2027, 7, 1))).toBe('2027-28')
    expect(currentSeason(new Date(2099, 8, 1))).toBe('2099-00')
  })

  it('turns lineup labels into slots that accept the right positions', () => {
    const slots = slotDefs(['PG', 'G/F', 'F/C', 'UTIL', 'UTIL', 'BE', 'nonsense'])
    expect(slots.map((s) => [s.id, s.accepts.join(''), s.starter])).toEqual([
      ['PG', 'PG', true],
      ['G/F', 'PGSGSFPF', true],
      ['F/C', 'SFPFC', true],
      ['UTIL1', '', true],
      ['UTIL2', '', true],
      ['BE', '', false],
    ])
    expect(ESPN_DEFAULT_SLOTS.map((s) => s.id)).toEqual(['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL1', 'UTIL2', 'UTIL3', 'BE1', 'BE2', 'BE3'])
  })
})

describe('player stats for stand-in lines', () => {
  // ESPN stat ids: 0 PTS, 1 BLK, 2 STL, 3 AST, 6 REB, 11 TO, 13 FGM, 14 FGA, 15 FTM, 16 FTA, 17 3PM, 40 MIN, 42 GP.
  const ids = (o: Record<string, number>) => o
  const withStats = {
    ...rawLeague,
    teams: rawLeague.teams.map((t) =>
      t.id !== 7
        ? t
        : {
            ...t,
            roster: {
              entries: t.roster.entries.map((e) => ({
                ...e,
                playerPoolEntry: {
                  player: {
                    ...e.playerPoolEntry.player,
                    stats: [
                      { seasonId: 2027, statSourceId: 0, statSplitTypeId: 0, stats: ids({ '0': 26, '1': 2, '2': 3, '3': 9, '6': 11, '11': 3, '13': 9, '14': 19, '15': 6, '16': 8, '17': 2, '40': 90, '42': 4 }) },
                      { seasonId: 2027, statSourceId: 1, statSplitTypeId: 0, stats: ids({ '0': 999, '42': 70 }) }, // ESPN's projection: never used
                      { seasonId: 2027, statSourceId: 0, statSplitTypeId: 2, stats: ids({ '0': 26, '40': 90, '42': 4 }) },
                      { seasonId: 2026, statSourceId: 0, statSplitTypeId: 0, stats: ids({ '0': 400, '40': 900, '42': 50 }) },
                    ],
                  },
                },
              })),
            },
          },
    ),
  }
  const freeAgents = [
    { player: { id: 90, fullName: 'Fresh Pickup', proTeamId: 18, eligibleSlots: [0, 1], stats: [{ seasonId: 2027, statSourceId: 0, statSplitTypeId: 0, stats: ids({ '0': 30, '40': 60, '42': 3 }) }] } },
    { player: { id: 70, fullName: 'Nikola Jokić', proTeamId: 7, stats: [] } }, // also rostered: kept once
  ]
  const snap = snapshotFromEspn(withStats, rawPro, FETCHED, { freeAgents })

  it('reads actual stats only (this season, last 15 days, last season) for rostered players and free agents', () => {
    const jokic = snap.playerStats.find((p) => p.espnId === 70)!
    expect(jokic.season).toEqual({ gp: 4, min: 90, pts: 26, tpm: 2, reb: 11, ast: 9, stl: 3, blk: 2, tov: 3, fgm: 9, fga: 19, ftm: 6, fta: 8 })
    expect(jokic.recent).toMatchObject({ gp: 4, min: 90, pts: 26 })
    expect(jokic.prior).toMatchObject({ gp: 50, min: 900, pts: 400 })
    expect(snap.playerStats.filter((p) => p.espnId === 70)).toHaveLength(1)
    expect(snap.playerStats.find((p) => p.espnId === 90)).toMatchObject({ name: 'Fresh Pickup', nbaTeam: 'NYK', positions: ['PG', 'SG'], recent: null, prior: null })
    expect(snap.playerStats.find((p) => p.espnId === 30)).toMatchObject({ season: null, recent: null, prior: null }) // no stats given
  })

  it('keeps stats only for the players that need them (no projection)', () => {
    const records = [
      { id: 'jokic', fullName: 'Nikola Jokic', aliases: [], nbaTeam: 'DEN' },
      { id: 'brunson', fullName: 'Jalen Brunson', aliases: [], nbaTeam: 'NYK' },
      { id: 'morant', fullName: 'Ja Morant', aliases: [], nbaTeam: 'MEM' },
      { id: 'pickup', fullName: 'Fresh Pickup', aliases: [], nbaTeam: null },
    ]
    const input: EspnPlanInput = { records, draftRosters: [['jokic'], ['brunson', 'morant']], moves: [], injuries: [], teamNames: [], teams: 2, userSlot: 1, weeks: [], today: '2026-10-21' }
    const plan = planEspnSync(snap, { ...input, needsStats: new Set(['jokic', 'pickup']) })
    if ('error' in plan) throw new Error(plan.error)
    expect(Object.keys(plan.stats).sort()).toEqual(['jokic', 'pickup'])
    expect(plan.stats.pickup).toMatchObject({ team: 'NYK', positions: ['PG', 'SG'], season: { gp: 3, min: 60, pts: 30 } })
    // Roster matching is unaffected by the stats.
    expect(plan.moves).toEqual([])
  })
})
