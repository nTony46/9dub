import { z } from 'zod'
// Relative, not '@/': the dev server loads this file through vite.config.ts, where the alias doesn't apply.
import { CATEGORIES, type Category } from '../analytics/categories.ts'
import { addDays, unscheduledInfo, type NbaSchedule, type ScheduleGame } from './schedule.ts'

/**
 * Read-only ESPN league sync: the shape 9dub keeps from ESPN's fantasy
 * basketball league API (teams, rosters, IR, schedule), and the pure
 * conversion from ESPN's raw JSON. Fetching happens on the local dev server
 * (scripts/espn.ts) with the user's own cookies; nothing here talks to ESPN.
 */

/** ESPN lineup slot ids (fantasy basketball) → slot labels. */
export const ESPN_SLOTS: Readonly<Record<number, string>> = {
  0: 'PG',
  1: 'SG',
  2: 'SF',
  3: 'PF',
  4: 'C',
  5: 'G',
  6: 'F',
  7: 'SG/SF',
  8: 'G/F',
  9: 'PF/C',
  10: 'F/C',
  11: 'UTIL',
  12: 'BE',
  13: 'IR',
}

/** ESPN pro-team abbreviations that differ from 9dub's (NBA schedule) codes. */
const PRO_CODES: Readonly<Record<string, string>> = { NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS', NO: 'NOP', GS: 'GSW' }

export const EspnRosterEntrySchema = z.object({
  espnId: z.number(),
  name: z.string(),
  /** NBA team code (9dub's), null for free agents. */
  nbaTeam: z.string().nullable(),
  /** ESPN lineup slot label: PG … UTIL, BE, IR. */
  lineupSlot: z.string(),
  /** ESPN position eligibility (PG … C). */
  positions: z.array(z.enum(['PG', 'SG', 'SF', 'PF', 'C'])).default([]),
  /** ESPN injury designation (ACTIVE, OUT, DAY_TO_DAY, …), when given. */
  injuryStatus: z.string().nullable(),
})
export type EspnRosterEntry = z.infer<typeof EspnRosterEntrySchema>

/** A team's category totals so far in a matchup (makes and attempts kept so FG% / FT% can be combined). */
export const EspnTotalsSchema = z.object({
  pts: z.number(),
  tpm: z.number(),
  reb: z.number(),
  ast: z.number(),
  stl: z.number(),
  blk: z.number(),
  tov: z.number(),
  fgm: z.number(),
  fga: z.number(),
  ftm: z.number(),
  fta: z.number(),
})
export type EspnTotals = z.infer<typeof EspnTotalsSchema>

/** A player's actual totals over a span (a season, or the last 15 days), with games and minutes. */
export const EspnStatLineSchema = EspnTotalsSchema.extend({ gp: z.number(), min: z.number() })
export type EspnStatLine = z.infer<typeof EspnStatLineSchema>

/** ESPN's actual stats for a player (rostered, or a free agent near the top of the pool). */
export const EspnPlayerStatsSchema = z.object({
  espnId: z.number(),
  name: z.string(),
  nbaTeam: z.string().nullable(),
  positions: z.array(z.enum(['PG', 'SG', 'SF', 'PF', 'C'])).default([]),
  /** This season so far. */
  season: EspnStatLineSchema.nullable(),
  /** The last 15 days. */
  recent: EspnStatLineSchema.nullable(),
  /** Last season. */
  prior: EspnStatLineSchema.nullable(),
})
export type EspnPlayerStats = z.infer<typeof EspnPlayerStatsSchema>

export const EspnLiveSchema = z.object({
  /** ESPN matchup period (1 = the first week). */
  period: z.number().int(),
  /** When the totals were read. */
  asOf: z.string(),
  /** Local calendar day of `asOf`: games from this day on are still to be projected… */
  fromDate: z.string(),
  /** …except these NBA teams' games that day, already under way or over when the totals were read. */
  started: z.array(z.string()),
  /** Totals so far by draft slot (1-based). */
  teams: z.array(z.object({ slot: z.number().int(), totals: EspnTotalsSchema })),
})
export type EspnLive = z.infer<typeof EspnLiveSchema>

const CallSchema = z.enum(['W', 'L', 'T'])

/** One side of a finished matchup: categories won / lost / tied, final totals, and ESPN's call in each category. */
export const EspnResultSideSchema = z.object({
  /** 1-based draft slot. */
  slot: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  ties: z.number().int(),
  totals: EspnTotalsSchema,
  cats: z.partialRecord(z.enum(CATEGORIES), CallSchema).default({}),
})
export type EspnResultSide = z.infer<typeof EspnResultSideSchema>

/** A regular-season matchup ESPN has scored as final. */
export const EspnResultSchema = z.object({ period: z.number().int(), home: EspnResultSideSchema, away: EspnResultSideSchema })
export type EspnResult = z.infer<typeof EspnResultSchema>

/** A team's season record in categories (ESPN standings) and its place, ESPN's tiebreakers included. */
export const EspnStandingSchema = z.object({
  slot: z.number().int(),
  wins: z.number().int(),
  losses: z.number().int(),
  ties: z.number().int(),
  rank: z.number().int().nullable(),
})
export type EspnStanding = z.infer<typeof EspnStandingSchema>

/** A draft pick as ESPN recorded it (names come from rosters and, for players since dropped, a player lookup). */
export const EspnDraftPickSchema = z.object({
  overall: z.number().int(),
  /** 1-based draft slot of the team that made the pick. */
  slot: z.number().int(),
  espnId: z.number(),
  name: z.string().nullable(),
  nbaTeam: z.string().nullable(),
})
export type EspnDraftPick = z.infer<typeof EspnDraftPickSchema>

export const EspnSnapshotSchema = z.object({
  kind: z.literal('espn-league'),
  fetchedAt: z.string(),
  leagueId: z.number(),
  /** ESPN season id (2027 = the 2026–27 NBA season). */
  season: z.number(),
  name: z.string(),
  teams: z.array(
    z.object({
      espnId: z.number(),
      /** 1-based draft slot. */
      slot: z.number().int().min(1),
      name: z.string(),
      abbrev: z.string(),
      roster: z.array(EspnRosterEntrySchema),
    }),
  ),
  /** Regular-season matchups by draft slot (1-based); away null = bye. */
  schedule: z.array(z.object({ period: z.number().int(), home: z.number().int(), away: z.number().int().nullable() })),
  regularSeasonPeriods: z.number().int(),
  live: EspnLiveSchema.nullable(),
  /** Finished regular-season matchups. */
  results: z.array(EspnResultSchema).default([]),
  standings: z.array(EspnStandingSchema).default([]),
  /** The league's lineup: starting slots and bench in ESPN's order (ESPN_SLOTS labels, no IR), and IR slots. */
  lineup: z.object({ slots: z.array(z.string()), ir: z.number().int() }).nullable().default(null),
  /** Draft rounds (picks per team). */
  rounds: z.number().int().nullable().default(null),
  /** The signed-in user's team, as a 1-based draft slot (null when the cookies' account owns no team). */
  mySlot: z.number().int().nullable().default(null),
  /** Dates of each regular-season matchup period. */
  weeks: z.array(z.object({ period: z.number().int(), start: z.string(), end: z.string() })).default([]),
  /** The draft, only when the sync was asked for it (first-time setup). */
  draft: z.array(EspnDraftPickSchema).default([]),
  /** Actual stats of rostered players and the top free agents (stand-ins for players without a projection). */
  playerStats: z.array(EspnPlayerStatsSchema).default([]),
})
export type EspnSnapshot = z.infer<typeof EspnSnapshotSchema>

interface RawPlayer {
  id?: number
  fullName?: string
  proTeamId?: number
  injuryStatus?: string
  eligibleSlots?: number[]
  /** statSourceId 0 = actual (1 = ESPN's projection, never used); statSplitTypeId 0 = season, 2 = last 15 days. */
  stats?: { seasonId?: number; statSourceId?: number; statSplitTypeId?: number; stats?: Record<string, number> }[]
}
interface RawScore {
  wins?: number
  losses?: number
  ties?: number
  scoreByStat?: Record<string, { score?: number; result?: string | null } | null>
}
interface RawSide {
  teamId?: number
  cumulativeScore?: RawScore
  /** Up to the minute, games in progress included (with the mLiveScoring view); cumulativeScore lags by hours. */
  cumulativeScoreLive?: RawScore
}
interface RawEntry {
  playerId?: number
  lineupSlotId?: number
  playerPoolEntry?: { player?: RawPlayer }
}
interface RawTeam {
  id?: number
  name?: string
  location?: string
  nickname?: string
  abbrev?: string
  roster?: { entries?: RawEntry[] }
  owners?: string[]
  playoffSeed?: number
  record?: { overall?: { wins?: number; losses?: number; ties?: number } }
}
interface RawLeague {
  id?: number
  seasonId?: number
  settings?: {
    name?: string
    draftSettings?: { pickOrder?: number[] }
    scheduleSettings?: { matchupPeriodCount?: number }
    rosterSettings?: { lineupSlotCounts?: Record<string, number> }
  }
  draftDetail?: { picks?: { overallPickNumber?: number; roundId?: number; teamId?: number; playerId?: number }[] }
  teams?: RawTeam[]
  status?: { currentMatchupPeriod?: number }
  schedule?: { matchupPeriodId?: number; winner?: string; home?: RawSide; away?: RawSide }[]
}
/** proTeams with each game's start time (ms), as kept in the local cache. */
interface RawProTeams {
  settings?: { proTeams?: { id?: number; abbrev?: string }[] }
  games?: { start: number; home: number; away: number }[]
}

const POSITION_SLOTS: readonly ['PG', 'SG', 'SF', 'PF', 'C'] = ['PG', 'SG', 'SF', 'PF', 'C']
/** ESPN scoring stat ids → totals keys (FG% 19 and FT% 20 are recomputed from makes and attempts). */
const STAT_KEYS: Readonly<Record<string, keyof EspnTotals>> = { '0': 'pts', '1': 'blk', '2': 'stl', '3': 'ast', '6': 'reb', '11': 'tov', '13': 'fgm', '14': 'fga', '15': 'ftm', '16': 'fta', '17': 'tpm' }

/** ESPN scoring stat ids → the nine categories, for ESPN's per-category result. */
const CATEGORY_STATS: Readonly<Record<string, Category>> = { '19': 'FG', '20': 'FT', '17': '3PM', '0': 'PTS', '6': 'REB', '3': 'AST', '2': 'STL', '1': 'BLK', '11': 'TO' }
const CALLS: Readonly<Record<string, 'W' | 'L' | 'T'>> = { WIN: 'W', LOSS: 'L', TIE: 'T' }

/** ESPN player stat ids for games played and minutes. */
const GP_STAT = '42'
const MIN_STAT = '40'

/** One span of a player's actual stats (null when he hasn't played in it). */
function statLineOf(p: RawPlayer, seasonId: number, split: number): EspnStatLine | null {
  const s = p.stats?.find((x) => x.seasonId === seasonId && x.statSourceId === 0 && x.statSplitTypeId === split)?.stats
  const gp = Number(s?.[GP_STAT] ?? 0) || 0
  if (!s || gp <= 0) return null
  const line: EspnStatLine = { gp, min: Number(s[MIN_STAT] ?? 0) || 0, pts: 0, tpm: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, ftm: 0, fta: 0 }
  for (const [id, key] of Object.entries(STAT_KEYS)) line[key] = Number(s[id] ?? 0) || 0
  return line
}

/** A player's actual stats this season, over the last 15 days and last season. */
export function playerStatsOf(p: RawPlayer, seasonId: number, codes: ReadonlyMap<number, string>): EspnPlayerStats | null {
  if (p.id == null || !p.fullName) return null
  return {
    espnId: p.id,
    name: p.fullName,
    nbaTeam: p.proTeamId != null ? (codes.get(p.proTeamId) ?? null) : null,
    positions: POSITION_SLOTS.filter((_, i) => p.eligibleSlots?.includes(i)),
    season: statLineOf(p, seasonId, 0),
    recent: statLineOf(p, seasonId, 2),
    prior: statLineOf(p, seasonId - 1, 0),
  }
}

/** A side's category totals: the live ones for the week in progress, else the settled ones. */
function totalsOf(side: RawSide | undefined, live = false): EspnTotals {
  const score = (live ? side?.cumulativeScoreLive : undefined) ?? side?.cumulativeScore
  const out: EspnTotals = { pts: 0, tpm: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, ftm: 0, fta: 0 }
  for (const [id, key] of Object.entries(STAT_KEYS)) out[key] = Number(score?.scoreByStat?.[id]?.score ?? 0) || 0
  return out
}

/** Local calendar date (YYYY-MM-DD) of a moment. */
export function localDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** A game that tipped off within this window before `asOf` belongs to the current day. */
const GAME_WINDOW_MS = 12 * 60 * 60 * 1000

/** ESPN pro-team id → 9dub NBA code, from the season's proTeams list. */
export function proTeamCodes(raw: unknown): Map<number, string> {
  const out = new Map<number, string>()
  for (const t of (raw as RawProTeams)?.settings?.proTeams ?? []) {
    if (t.id == null || !t.abbrev || t.id === 0) continue
    const code = t.abbrev.toUpperCase()
    out.set(t.id, PRO_CODES[code] ?? code)
  }
  return out
}

/** Draft slot (1-based) for each ESPN team id: the league's pick order, else the first round of the draft. */
function draftSlots(league: RawLeague): Map<number, number> {
  const order = league.settings?.draftSettings?.pickOrder ?? []
  if (order.length) return new Map(order.map((teamId, i) => [teamId, i + 1]))
  const picks = [...(league.draftDetail?.picks ?? [])].sort((a, b) => (a.overallPickNumber ?? 0) - (b.overallPickNumber ?? 0))
  const out = new Map<number, number>()
  for (const p of picks) if (p.teamId != null && !out.has(p.teamId)) out.set(p.teamId, out.size + 1)
  return out
}

/** The NBA's own calendar date (US Eastern) of a tip-off. */
export function nbaDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
}

const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay()

/**
 * Matchup weeks from the NBA calendar, the way ESPN lays out a default season:
 * week 1 runs from opening night to the first Sunday, then Monday to Sunday.
 * The week the All-Star break starts in (the longest stretch without games
 * that begins between February 1 and March 15) is played together with the
 * next one, as one two-week matchup.
 */
export function matchupWeeks(gameDates: readonly string[], count: number): { period: number; start: string; end: string }[] {
  const days = new Set(gameDates)
  const sorted = [...days].sort()
  if (!sorted.length || count < 1) return []
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  let allStar: { start: string; len: number } | null = null
  for (let d = first, run = 0, from = ''; d <= last; d = addDays(d, 1)) {
    if (days.has(d)) {
      run = 0
      continue
    }
    if (run++ === 0) from = d
    const md = from.slice(5)
    if (md >= '02-01' && md <= '03-15' && run >= 3 && (!allStar || run > allStar.len)) allStar = { start: from, len: run }
  }
  const out: { period: number; start: string; end: string }[] = []
  let start = first
  while (out.length < count && start <= last) {
    let end = addDays(start, (7 - weekday(start)) % 7)
    if (out.length > 0 && allStar && allStar.start >= start && allStar.start <= end) end = addDays(end, 7)
    out.push({ period: out.length + 1, start, end })
    start = addDays(end, 1)
  }
  return out
}

/** The NBA schedule as 9dub uses it, from ESPN's list of games (team codes, ET dates). */
export function nbaScheduleFromEspn(rawProTeams: unknown, season: string, createdAt: string): NbaSchedule {
  const codes = proTeamCodes(rawProTeams)
  const games: ScheduleGame[] = ((rawProTeams as RawProTeams)?.games ?? [])
    .filter((g) => codes.has(g.home) && codes.has(g.away))
    .sort((a, b) => a.start - b.start)
    .map((g, i) => ({ n: i + 1, date: nbaDate(g.start), away: codes.get(g.away)!, home: codes.get(g.home)!, neutral: false, cup: false }))
  return { kind: 'nba-schedule', season, asOf: null, source: { file: 'ESPN', sha256: null }, createdAt, games, ...unscheduledInfo(games) }
}

/** ESPN lineup slot counts (slot id → count) → labels in ESPN's order, and IR slots. */
export function lineupFromEspn(counts: Record<string, number> | undefined): { slots: string[]; ir: number } | null {
  if (!counts) return null
  const slots: string[] = []
  for (let id = 0; id <= 12; id++) for (let k = 0; k < (counts[id] ?? 0); k++) slots.push(ESPN_SLOTS[id])
  return slots.length ? { slots, ir: counts[13] ?? 0 } : null
}

export interface SnapshotOptions {
  /** The cookie owner's SWID, to find their team (it is not copied into the snapshot). */
  swid?: string | null
  /** ESPN player id → name and pro team, for drafted players no longer on a roster; given only when the draft is wanted. */
  players?: ReadonlyMap<number, { name: string; proTeamId: number | null }>
  /** Raw free agents from ESPN's player list (`kona_player_info`), for their stats. */
  freeAgents?: readonly { player?: RawPlayer }[]
}

/** Raw ESPN league JSON (views mTeam, mRoster, mSettings, mMatchup, mDraftDetail) + proTeams → snapshot. Throws on a shape it can't read. */
export function snapshotFromEspn(rawLeague: unknown, rawProTeams: unknown, fetchedAt: string, opts: SnapshotOptions = {}): EspnSnapshot {
  const league = rawLeague as RawLeague
  if (!league || typeof league !== 'object' || !Array.isArray(league.teams)) throw new Error('ESPN response has no teams')
  const slots = draftSlots(league)
  const codes = proTeamCodes(rawProTeams)
  const teams = league.teams.map((t) => {
    const slot = t.id != null ? slots.get(t.id) : undefined
    if (slot == null) throw new Error(`ESPN team ${t.id} has no draft slot`)
    const name = t.name?.trim() || [t.location, t.nickname].filter(Boolean).join(' ').trim() || `Team ${slot}`
    const roster = (t.roster?.entries ?? []).map((e) => {
      const p = e.playerPoolEntry?.player ?? {}
      return {
        espnId: e.playerId ?? p.id ?? 0,
        name: p.fullName ?? `ESPN player ${e.playerId}`,
        nbaTeam: p.proTeamId != null ? (codes.get(p.proTeamId) ?? null) : null,
        lineupSlot: ESPN_SLOTS[e.lineupSlotId ?? -1] ?? 'BE',
        positions: POSITION_SLOTS.filter((_, i) => p.eligibleSlots?.includes(i)),
        injuryStatus: p.injuryStatus ?? null,
      }
    })
    return { espnId: t.id!, slot, name, abbrev: t.abbrev ?? '', roster }
  })
  const regularSeasonPeriods = league.settings?.scheduleSettings?.matchupPeriodCount ?? 0
  const schedule = (league.schedule ?? [])
    .filter((m) => m.matchupPeriodId != null && (!regularSeasonPeriods || m.matchupPeriodId <= regularSeasonPeriods) && m.home?.teamId != null)
    .map((m) => ({ period: m.matchupPeriodId!, home: slots.get(m.home!.teamId!) ?? 0, away: m.away?.teamId != null ? (slots.get(m.away.teamId) ?? null) : null }))
    .filter((m) => m.home > 0)
  // The matchup in progress: every team's totals so far, and which NBA games had started when they were read.
  const period = league.status?.currentMatchupPeriod
  const asOf = Date.parse(fetchedAt)
  const current = (league.schedule ?? []).filter((m) => m.matchupPeriodId === period)
  const live =
    period != null && current.length
      ? {
          period,
          asOf: fetchedAt,
          fromDate: localDate(asOf),
          started: [
            ...new Set(
              ((rawProTeams as RawProTeams)?.games ?? [])
                .filter((g) => g.start <= asOf && g.start > asOf - GAME_WINDOW_MS)
                .flatMap((g) => [codes.get(g.home), codes.get(g.away)])
                .filter((c): c is string => !!c),
            ),
          ],
          teams: current
            .flatMap((m) => [m.home, m.away])
            .filter((side): side is RawSide => side?.teamId != null && slots.has(side.teamId))
            .map((side) => ({ slot: slots.get(side.teamId!)!, totals: totalsOf(side, true) })),
        }
      : null
  // Finished matchups (ESPN names a winner once the week is scored) and the standings that follow from them.
  const sideResult = (side: RawSide) => {
    const c = side.cumulativeScore ?? {}
    const cats: Partial<Record<Category, 'W' | 'L' | 'T'>> = {}
    for (const [id, cat] of Object.entries(CATEGORY_STATS)) {
      const call = CALLS[c.scoreByStat?.[id]?.result ?? '']
      if (call) cats[cat] = call
    }
    return { slot: slots.get(side.teamId!)!, wins: c.wins ?? 0, losses: c.losses ?? 0, ties: c.ties ?? 0, totals: totalsOf(side), cats }
  }
  const results = (league.schedule ?? [])
    .filter(
      (m) =>
        m.matchupPeriodId != null &&
        (!regularSeasonPeriods || m.matchupPeriodId <= regularSeasonPeriods) &&
        (m.winner === 'HOME' || m.winner === 'AWAY' || m.winner === 'TIE') &&
        m.home?.teamId != null &&
        m.away?.teamId != null &&
        slots.has(m.home.teamId) &&
        slots.has(m.away.teamId),
    )
    .map((m) => ({ period: m.matchupPeriodId!, home: sideResult(m.home!), away: sideResult(m.away!) }))
  const standings = league.teams
    .filter((t) => t.record?.overall)
    .map((t) => ({
      slot: slots.get(t.id!)!,
      wins: t.record!.overall!.wins ?? 0,
      losses: t.record!.overall!.losses ?? 0,
      ties: t.record!.overall!.ties ?? 0,
      rank: t.playoffSeed && t.playoffSeed > 0 ? t.playoffSeed : null,
    }))
    .sort((a, b) => a.slot - b.slot)
  const swid = opts.swid?.toUpperCase()
  const mine = swid ? league.teams.find((t) => t.owners?.some((o) => o.toUpperCase() === swid)) : undefined
  const picks = league.draftDetail?.picks ?? []
  const rounds = picks.length ? Math.max(...picks.map((p) => p.roundId ?? 0)) || null : null
  // Drafted players: named from today's rosters, else from the player lookup.
  const known = new Map<number, { name: string; nbaTeam: string | null }>()
  for (const t of teams) for (const e of t.roster) known.set(e.espnId, { name: e.name, nbaTeam: e.nbaTeam })
  const draft = opts.players
    ? picks
        .filter((p) => p.overallPickNumber != null && p.playerId != null && p.teamId != null && slots.has(p.teamId))
        .map((p) => {
          const k = known.get(p.playerId!)
          const o = opts.players!.get(p.playerId!)
          return {
            overall: p.overallPickNumber!,
            slot: slots.get(p.teamId!)!,
            espnId: p.playerId!,
            name: k?.name ?? o?.name ?? null,
            nbaTeam: k?.nbaTeam ?? (o?.proTeamId != null ? (codes.get(o.proTeamId) ?? null) : null),
          }
        })
        .sort((a, b) => a.overall - b.overall)
    : []
  const gameDates = ((rawProTeams as RawProTeams)?.games ?? []).map((g) => nbaDate(g.start))
  const statsSeason = league.seasonId ?? 0
  const seen = new Set<number>()
  const playerStats = [
    ...league.teams.flatMap((t) => (t.roster?.entries ?? []).map((e) => e.playerPoolEntry?.player)),
    ...(opts.freeAgents ?? []).map((f) => f.player),
  ]
    .map((p) => (p ? playerStatsOf(p, statsSeason, codes) : null))
    .filter((p): p is EspnPlayerStats => p != null && !seen.has(p.espnId) && !!seen.add(p.espnId))
  return EspnSnapshotSchema.parse({
    kind: 'espn-league',
    fetchedAt,
    leagueId: league.id ?? 0,
    season: league.seasonId ?? 0,
    name: league.settings?.name ?? 'ESPN league',
    teams: teams.sort((a, b) => a.slot - b.slot),
    schedule,
    regularSeasonPeriods,
    live,
    results,
    standings,
    lineup: lineupFromEspn(league.settings?.rosterSettings?.lineupSlotCounts),
    rounds,
    mySlot: mine?.id != null ? (slots.get(mine.id) ?? null) : null,
    weeks: matchupWeeks(gameDates, regularSeasonPeriods),
    draft,
    playerStats,
  })
}

/** ESPN season id for a 9dub season label: "2026-27" → 2027. */
export function espnSeasonId(label: string): number {
  const m = /^(\d{4})-(\d{2})$/.exec(label)
  return m ? Number(m[1]) + 1 : new Date().getFullYear() + 1
}
