import { useMemo } from 'react'
import { bestPerCategory, rankPickups, type BestForCategory, type PickupResult } from '@/analytics/chase'
import type { Category } from '@/analytics/categories'
import type { StatLine } from '@/analytics/types'
import { addTotals, compareWeek, projectSide, weekTotals, type MatchupPlayer, type SideProjection, type WeekCall, type WeekTotals } from '@/analytics/matchup'
import { ESPN_DEFAULT_SLOTS, fillLineup, type SlotDef } from '@/analytics/positions'
import type { EspnResultSide } from '@/data/espn'
import { addDays, datesBetween, teamsByDate, type NbaSchedule } from '@/data/schedule'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useApp } from '@/store/appStore'
import { teamLabel, useDraft, type EngineData, type PlayerInfo } from '@/store/derived'
import { activeInjuries, currentRosters, todayIso, whoSits, type CurrentRosters } from '@/store/season'
import type { EspnSync, Injury, LeagueSettings, MatchupWeek } from '@/store/schema'

/**
 * Windows at least this wide dock the waiver wire in a column left of the
 * matchup (room for it and a full-width week grid); narrower ones show it
 * inline under the categories.
 */
export const WIRE_DOCK_QUERY = '(min-width: 1440px)'

/** Where the waiver wire goes: hidden (turned off), docked beside the matchup, or inline. */
export function useWirePlacement(): 'hidden' | 'dock' | 'inline' {
  const open = useApp((s) => s.prefs.waiverWire)
  const wide = useMediaQuery(WIRE_DOCK_QUERY)
  return !open ? 'hidden' : wide ? 'dock' : 'inline'
}

/** Draft rosters + post-draft moves. */
export function useCurrentRosters(): CurrentRosters {
  const d = useDraft()
  const moves = useApp((s) => s.season.rosterMoves)
  return useMemo(() => currentRosters(d.rosters, moves), [d.rosters, moves])
}

export interface ScheduleIndex {
  schedule: NbaSchedule
  byDate: Map<string, Set<string>>
  /** date → team → that day's opponent ("vs BOS" / "@ NYK"). */
  gameOf: Map<string, Map<string, string>>
}

export function useScheduleIndex(): ScheduleIndex | null {
  const schedule = useApp((s) => s.nbaSchedule)
  return useMemo(() => {
    if (!schedule) return null
    const gameOf = new Map<string, Map<string, string>>()
    for (const g of schedule.games) {
      const m = gameOf.get(g.date) ?? new Map<string, string>()
      m.set(g.away, `@ ${g.home}`)
      m.set(g.home, `vs ${g.away}`)
      gameOf.set(g.date, m)
    }
    return { schedule, byDate: teamsByDate(schedule), gameOf }
  }, [schedule])
}

/** Everyone who sits and until when, your marks and ESPN's statuses combined (see `effectiveInjuries`). */
export function useEffectiveInjuries(): Injury[] {
  const injuries = useApp((s) => s.season.injuries)
  const espn = useApp((s) => s.season.espn)
  const games = useApp((s) => s.nbaSchedule?.games)
  const weeks = useApp((s) => s.season.matchups)
  const today = todayIso()
  return useMemo(() => whoSits(injuries, espn, games, weeks, today), [injuries, espn, games, weeks, today])
}

/** Who sits today → out through (null = until further notice); expired marks drop off automatically. */
export function useInjuries(): Map<string, string | null> {
  const list = useEffectiveInjuries()
  return useMemo(() => activeInjuries(list, todayIso()), [list])
}

export interface ProjectionOptions {
  /** Scale each game by projected GP / full season (expected missed games). */
  availability: boolean
  /** Player id → out through (null = until further notice). */
  injuries?: ReadonlyMap<string, string | null>
  /** The league's lineup (default: ESPN's standard slots). */
  slots?: readonly SlotDef[]
  /** Player id → the days he's on his roster, for moves ESPN has queued (see `pendingWindows`). */
  windows?: ReadonlyMap<string, { from?: string; until?: string }>
  /** Everyone's actual ESPN lineup slots from the last sync: the daily engine starts who the manager starts. */
  lineups?: EspnSync['lineups']
}

/**
 * A player's ESPN lineup slot on `date`: the sync day's lineup, then the next
 * day's from that day on (ESPN carries a lineup forward until it's changed).
 * Undefined before the sync day, or for a player ESPN didn't list.
 */
export function espnSlotOn(lineups: EspnSync['lineups'] | undefined, id: string, date: string): string | undefined {
  if (!lineups || date < lineups.date) return undefined
  if (lineups.next && lineups.nextDate && date >= lineups.nextDate) return lineups.next[id]
  return lineups.slots[id]
}

/**
 * Rostered players as the weekly engine sees them. A player your data has no
 * projection for (often a fresh waiver pickup) still plays his games and takes
 * a lineup seat like on ESPN. He counts at his stand-in line from ESPN's actual
 * stats when the sync has them, else at replacement level (the stand-in the
 * draft engine uses for unprojected roster spots).
 */
export function matchupPlayers(ids: readonly string[], engine: EngineData, opts: ProjectionOptions): MatchupPlayer[] {
  const { valuation, ctx } = engine
  const full = valuation.settings.fullSeasonGames
  return ids
    .map((id) => engine.byId.get(id))
    .filter((p) => p != null)
    .map((p) => {
      const v = valuation.values.get(p.id)
      return {
        id: p.id,
        nbaTeam: p.team,
        positions: p.positions,
        line: p.line ?? p.standIn?.line ?? valuation.replacement.line,
        priority: v ? (ctx.basis === 'gpAware' ? v.rankGp : v.rank) : 9999,
        availability: opts.availability && p.gp != null ? Math.min(1, p.gp / full) : 1,
        outThrough: opts.injuries?.has(p.id) ? (opts.injuries.get(p.id) ?? null) : undefined,
        ...opts.windows?.get(p.id),
        ...(opts.lineups ? { slotOn: (date: string) => espnSlotOn(opts.lineups, p.id, date) } : {}),
      }
    })
}

export type PendingMoves = NonNullable<EspnSync['pending']>

/** The roster moves ESPN has queued for tomorrow, while they're still ahead (null once their day has come). */
export function usePendingMoves(): PendingMoves | null {
  const pending = useApp((s) => s.season.espn?.pending ?? null)
  const today = todayIso()
  return pending && pending.date > today ? pending : null
}

/**
 * Roster windows for queued moves: a player joining counts from the move's
 * date, one leaving through the day before. (A player moving between two
 * teams counts for his new one only.)
 */
export function pendingWindows(p: PendingMoves | null): Map<string, { from?: string; until?: string }> | undefined {
  if (!p) return undefined
  const out = new Map<string, { from?: string; until?: string }>()
  for (const l of p.leaving) out.set(l.playerId, { until: addDays(p.date, -1) })
  for (const id of p.joining) out.set(id, { from: p.date })
  return out
}

/** Rosters for a week that starts before the queued moves land: players leaving are still on them until then. */
export function rostersForWeek(rosters: string[][], p: PendingMoves | null, start: string): string[][] {
  if (!p || start >= p.date) return rosters
  const moving = new Set(p.joining)
  const leaving = p.leaving.filter((l) => !moving.has(l.playerId) && rosters[l.team] && !rosters[l.team].includes(l.playerId))
  if (!leaving.length) return rosters
  const out = rosters.map((r) => [...r])
  for (const l of leaving) out[l.team].push(l.playerId)
  return out
}

/** Where a player's weekly numbers come from when he has no projection: a short tag and a sentence (null = his projection). */
export function lineSource(p: Pick<PlayerInfo, 'line' | 'standIn'>): { tag: string; text: string } | null {
  if (p.line) return null
  const s = p.standIn
  if (!s) return { tag: 'repl.', text: 'No projection or ESPN stats: counts at replacement level.' }
  if (!s.games) return { tag: 'est.', text: 'No projection: last season’s per-game stats (ESPN), since he hasn’t played this season.' }
  const blend = s.prior === 'last-season' ? ', blended with last season' : s.prior === 'typical' ? ', blended with a typical waiver-level player' : ''
  return { tag: 'est.', text: `No projection: estimated from ESPN stats, ${s.games} game${s.games === 1 ? '' : 's'} this season at ${s.mpg.toFixed(1)} min${blend}.` }
}

export interface WeekProjection {
  dates: string[]
  /** Each side's week; with live totals, `totals` = so far (ESPN) + projected for what's left. */
  me: SideProjection
  them: SideProjection
  call: WeekCall
  /** Days in the NBA's still-unscheduled window (NBA Cup knockout + make-up games). */
  tbdDays: string[]
  /** The matchup in progress: ESPN's totals so far, the score they make right now, and each side's starts still to play. */
  live: { me: WeekTotals; them: WeekTotals; now: WeekCall; asOf: string; left: { me: number; them: number } } | null
}

/** ESPN's totals so far for the two sides of the matchup in progress. */
export interface LiveTotals {
  me: WeekTotals | null
  them: WeekTotals | null
  /** Games from this day on are projected; `started` teams' games that day are in the totals as far as they've gone. */
  fromDate: string
  started: ReadonlySet<string>
  /** The share still to come of `started` teams' games under way (absent = over). */
  underway?: Readonly<Record<string, number>>
  asOf: string
}

/** Live totals for week `weekNo` (1-based) between two draft slots (0-based), when ESPN's matchup in progress is that week. */
export function liveFor(live: EspnSync['live'] | undefined, weekNo: number, me: number, them: number | null): LiveTotals | undefined {
  if (!live || live.period !== weekNo) return undefined
  const of = (slot: number | null) => {
    const t = slot == null ? undefined : live.teams.find((x) => x.slot === slot + 1)
    return t ? weekTotals(t.totals) : null
  }
  return { me: of(me), them: of(them), fromDate: live.fromDate, started: new Set(live.started), underway: live.underway, asOf: live.asOf }
}

export interface FinalResult {
  /** Opponent's draft slot (0-based). */
  opp: number
  me: EspnResultSide
  them: EspnResultSide
}

/** ESPN's final score for week `weekNo` (1-based) of draft slot `me` (0-based), once ESPN has scored that week. */
export function finalFor(results: EspnSync['results'] | undefined, weekNo: number, me: number): FinalResult | undefined {
  const r = results?.find((x) => x.period === weekNo && (x.home.slot === me + 1 || x.away.slot === me + 1))
  if (!r) return undefined
  const [mine, theirs] = r.home.slot === me + 1 ? [r.home, r.away] : [r.away, r.home]
  return { opp: theirs.slot - 1, me: mine, them: theirs }
}

/** What a side still has to come in a live week. */
export interface RestOfWeek {
  totals: WeekTotals
  /** Starts in games that haven't tipped off yet (the rest of a game under way isn't a start to come). */
  starts: number
  startsOf: (id: string) => number
  days: SideProjection['days']
}

/**
 * The rest of a live week. On the sync day the lineup is set by that day's whole
 * slate: a player whose game has tipped still holds his seat, so nobody on the
 * bench inherits it for a later game. Seated players yet to tip count in full,
 * and those mid-game count for the share of it left. Later days are projected as usual.
 * `added` is a pickup being tried: he can't play in a game already under way.
 */
export function restOfWeek(
  players: readonly MatchupPlayer[],
  dates: readonly string[],
  live: Pick<LiveTotals, 'fromDate' | 'started' | 'underway'>,
  byDate: ReadonlyMap<string, ReadonlySet<string>>,
  slots: readonly SlotDef[],
  added?: string,
): RestOfWeek {
  const playing = (d: string) => byDate.get(d)
  const later = projectSide(players, dates.filter((d) => d > live.fromDate), playing, slots)
  const tipped = (p: MatchupPlayer) => !!p.nbaTeam && live.started.has(p.nbaTeam)
  const startsLater = (id: string) => later.players.get(id)?.starts ?? 0
  if (!dates.includes(live.fromDate)) return { totals: later.totals, starts: later.starts, startsOf: startsLater, days: later.days }
  const eligible = players.filter((p) => p.id !== added || !tipped(p))
  const seated = new Set(projectSide(eligible, [live.fromDate], playing, slots).days[0].started)
  const yetToTip = eligible.filter((p) => seated.has(p.id) && !tipped(p))
  const midGame = eligible.flatMap((p) => {
    const left = seated.has(p.id) && p.id !== added && p.nbaTeam ? (live.underway?.[p.nbaTeam] ?? 0) : 0
    return left > 0 ? [{ ...p, availability: (p.availability ?? 1) * left }] : []
  })
  const tonight = projectSide(yetToTip, [live.fromDate], playing, slots)
  const rest = projectSide(midGame, [live.fromDate], playing, slots)
  return {
    totals: addTotals(addTotals(tonight.totals, rest.totals), later.totals),
    starts: tonight.starts + later.starts,
    startsOf: (id) => (tonight.players.get(id)?.starts ?? 0) + startsLater(id),
    days: [...tonight.days, ...later.days],
  }
}

export function projectWeek(
  engine: EngineData,
  index: Pick<ScheduleIndex, 'schedule' | 'byDate'>,
  mine: readonly string[],
  theirs: readonly string[],
  start: string,
  end: string,
  opts: ProjectionOptions,
  live?: LiveTotals,
): WeekProjection {
  const dates = datesBetween(start, end)
  const playing = (d: string) => index.byDate.get(d)
  const mineP = matchupPlayers(mine, engine, opts)
  const theirsP = matchupPlayers(theirs, engine, opts)
  const slots = opts.slots ?? ESPN_DEFAULT_SLOTS
  const me = projectSide(mineP, dates, playing, slots, homeSlots(mine, engine, slots))
  const them = projectSide(theirsP, dates, playing, slots, homeSlots(theirs, engine, slots))
  const w = index.schedule.tbdWindow
  const tbdDays = w ? dates.filter((d) => d >= w.start && d <= w.end) : []
  if (!live || (!live.me && !live.them)) return { dates, me, them, call: compareWeek(me.totals, them.totals), tbdDays, live: null }
  // Live: ESPN's totals so far + a projection of what's still to come.
  const rest = dates.filter((d) => d >= live.fromDate)
  const meRestSide = restOfWeek(mineP, rest, live, index.byDate, slots)
  const themRestSide = restOfWeek(theirsP, rest, live, index.byDate, slots)
  const meRest = meRestSide.totals
  const themRest = themRestSide.totals
  const meNow = live.me ?? weekTotals(ZERO)
  const themNow = live.them ?? weekTotals(ZERO)
  const meTotal = addTotals(meNow, meRest)
  const themTotal = addTotals(themNow, themRest)
  return {
    dates,
    me: { ...me, totals: meTotal },
    them: { ...them, totals: themTotal },
    call: compareWeek(meTotal, themTotal, { me: meRest, them: themRest }),
    tbdDays,
    live: { me: meNow, them: themNow, now: compareWeek(meNow, themNow), asOf: live.asOf, left: { me: meRestSide.starts, them: themRestSide.starts } },
  }
}

const ZERO = { pts: 0, tpm: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, ftm: 0, fta: 0 }

export interface ChasePlan {
  /** First day a pickup could play. */
  from: string
  restDays: number
  /** Both sides' production still to come (current rosters). */
  restMe: WeekTotals
  restThem: WeekTotals
  /** The week as it stands (same call as the matchup header). */
  baseCall: WeekCall
  /** Pickups ranked by the change in expected categories won. */
  options: PickupResult[]
  best: Partial<Record<Category, BestForCategory>>
}

/**
 * A player's actual per-game line from ESPN: the last 15 days (with at least
 * two games there), else this season; null when he hasn't played.
 */
export function actualLine(s: Pick<EspnSync['stats'][string], 'season' | 'recent'> | undefined): { line: StatLine; mpg: number; span: 'last 15 days' | 'this season' } | null {
  const pick = s?.recent && s.recent.gp >= 2 ? { t: s.recent, span: 'last 15 days' as const } : s?.season && s.season.gp >= 1 ? { t: s.season, span: 'this season' as const } : null
  if (!pick) return null
  const { t, span } = pick
  const g = (v: number) => v / t.gp
  return {
    line: { pts: g(t.pts), tpm: g(t.tpm), reb: g(t.reb), ast: g(t.ast), stl: g(t.stl), blk: g(t.blk), tov: g(t.tov), fgm: g(t.fgm), fga: g(t.fga), ftm: g(t.ftm), fta: g(t.fta) },
    mpg: g(t.min),
    span,
  }
}

/** How pickups are tried, beyond their projection. */
export interface PickupOptions {
  /** Per-game line to try a pickup at instead of his own (e.g. his last 15 days); null = his own. */
  lineFor?: (id: string) => StatLine | null
  /** First day a pickup can play (when his waiver claim clears); null = right away. */
  firstDay?: (id: string) => string | null
}

/**
 * Every free agent tried as a pickup for the rest of the week (dropping
 * `drop`, if the roster is full): the remaining days are re-projected with the
 * daily lineup engine, so he only counts on nights he'd actually start, from
 * the day he can play.
 */
export function chasePlan(
  engine: EngineData,
  index: Pick<ScheduleIndex, 'schedule' | 'byDate'>,
  mine: readonly string[],
  theirs: readonly string[],
  start: string,
  end: string,
  opts: ProjectionOptions,
  live: LiveTotals | undefined,
  pool: readonly string[],
  drop: string | null,
  today: string,
  pick: PickupOptions = {},
): ChasePlan | null {
  const from = live?.fromDate && live.fromDate > start ? live.fromDate : today > start ? today : start
  const rest = datesBetween(start, end).filter((d) => d >= from)
  if (!rest.length) return null
  const restPlaying = (d: string) => {
    const teams = index.byDate.get(d)
    return live && d === live.fromDate && teams ? new Set([...teams].filter((t) => !live.started.has(t))) : teams
  }
  const slots = opts.slots ?? ESPN_DEFAULT_SLOTS
  // The same rest of the week `projectWeek` adds to the live totals, so the two always agree.
  const sideOf = (players: readonly MatchupPlayer[], added?: string): RestOfWeek => {
    if (live) return restOfWeek(players, rest, live, index.byDate, slots, added)
    const s = projectSide(players, rest, restPlaying, slots)
    return { totals: s.totals, starts: s.starts, startsOf: (id) => s.players.get(id)?.starts ?? 0, days: s.days }
  }
  const restOf = (ids: readonly string[]) => sideOf(matchupPlayers(ids, engine, opts))
  const kept = mine.filter((id) => id !== drop)
  // The pickup at his tried line, out until the day he can play.
  const withPickup = (id: string) =>
    sideOf(
      matchupPlayers([...kept, id], engine, opts).map((p) => {
        if (p.id !== id) return p
        const line = pick.lineFor?.(id)
        const first = pick.firstDay?.(id)
        const waiting = first && first > from ? addDays(first, -1) : undefined
        const outThrough = waiting && p.outThrough !== null && (p.outThrough == null || waiting > p.outThrough) ? waiting : p.outThrough
        return { ...p, ...(line ? { line } : {}), outThrough }
      }),
      id,
    )
  const restMe = restOf(mine).totals
  const restThem = restOf(theirs).totals
  const week = projectWeek(engine, index, mine, theirs, start, end, opts, live)
  const playsLeft = new Set(rest.flatMap((d) => [...(restPlaying(d) ?? [])]))
  const inputs = pool
    .filter((id) => {
      const team = engine.byId.get(id)?.team
      return team != null && playsLeft.has(team)
    })
    .map((id) => {
      const side = withPickup(id)
      return { id, starts: side.startsOf(id), days: side.days.filter((d) => d.started.includes(id)).map((d) => d.date), restMe: side.totals }
    })
    .filter((o) => o.starts > 0)
  const { baseCall, results } = rankPickups({ me: week.me.totals, them: week.them.totals, restMe, restThem, live: !!live && !!(live.me || live.them) }, inputs)
  return { from, restDays: rest.length, restMe, restThem, baseCall, options: results, best: bestPerCategory(baseCall, results) }
}

export function opponentName(settings: LeagueSettings, w: Pick<MatchupWeek, 'opponent' | 'label'>): string {
  if (w.opponent != null) return teamLabel(settings, w.opponent)
  return w.label || 'Unassigned opponent'
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Oct 20 – 25" / "Oct 26 – Nov 1". */
export function rangeText(start: string, end: string): string {
  const [, sm, sd] = start.split('-').map(Number)
  const [, em, ed] = end.split('-').map(Number)
  return sm === em ? `${MONTH[sm - 1]} ${sd} – ${ed}` : `${MONTH[sm - 1]} ${sd} – ${MONTH[em - 1]} ${ed}`
}

export function dayLabel(iso: string): { dow: string; day: string } {
  const [y, m, d] = iso.split('-').map(Number)
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return { dow, day: `${MONTH[m - 1]} ${d}` }
}

export interface BaseRow {
  slot: string
  id: string | null
}

/**
 * One stable row per roster spot for the week view, like ESPN's roster page:
 * the manager's actual ESPN lineup when the sync has it (`slotOf`), else the
 * best lineup by 9-cat value, fills the starting slots; the rest sit on BE,
 * injured players fill IR. Day cells still show who actually plays each night.
 */
export function baseLineup(
  roster: readonly string[],
  engine: EngineData,
  ir: readonly string[],
  irSlots: number,
  benchSlots: number,
  slots: readonly SlotDef[] = ESPN_DEFAULT_SLOTS,
  slotOf?: (id: string) => string | undefined,
): BaseRow[] {
  const starters = slots.filter((s) => s.starter)
  const onIr = new Set(ir)
  const rank = (id: string) => {
    const v = engine.valuation.values.get(id)
    return v ? (engine.ctx.basis === 'gpAware' ? v.rankGp : v.rank) : 9999
  }
  const active = roster.filter((id) => !onIr.has(id)).sort((a, b) => rank(a) - rank(b))
  const fill = slotOf && active.some((id) => slotOf(id) != null)
    ? espnFill(active, starters, slotOf)
    : fillLineup(
        active.map((id) => ({ id, positions: engine.byId.get(id)?.positions ?? [] })),
        starters,
      )
  const placed = new Set(fill.assignment.filter((x): x is string => x != null))
  const bench = active.filter((id) => !placed.has(id))
  return [
    ...starters.map((s, i) => ({ slot: s.label, id: fill.assignment[i] })),
    ...bench.map((id) => ({ slot: 'BE', id })),
    ...Array.from({ length: Math.max(0, benchSlots - bench.length) }, () => ({ slot: 'BE', id: null })),
    ...Array.from({ length: irSlots }, (_, i) => ({ slot: 'IR', id: ir[i] ?? null })),
  ]
}

/** Starters placed in their ESPN slots (a repeated label like UTIL takes the next free one); a slot ESPN leaves empty stays empty. */
function espnFill(active: readonly string[], starters: readonly SlotDef[], slotOf: (id: string) => string | undefined): { assignment: (string | null)[] } {
  const assignment: (string | null)[] = starters.map(() => null)
  for (const id of active) {
    const s = slotOf(id)
    const i = s == null ? -1 : starters.findIndex((x, k) => x.label === s && assignment[k] == null)
    if (i >= 0) assignment[i] = id
  }
  return { assignment }
}

/** Each player's usual starting slot (index into ESPN's starter slots): the best lineup by 9-cat value. */
export function homeSlots(roster: readonly string[], engine: EngineData, slots: readonly SlotDef[] = ESPN_DEFAULT_SLOTS): Map<string, number> {
  const out = new Map<string, number>()
  baseLineup(roster, engine, [], 0, 0, slots).forEach((r, i) => {
    if (r.id && r.slot !== 'BE' && r.slot !== 'IR') out.set(r.id, i)
  })
  return out
}

const NAME_SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i

/** "Nickeil Alexander-Walker" → "Alexander-Walker", "Darius Acuff Jr." → "Acuff". */
export function shortName(full: string): string {
  const parts = full.split(' ').filter((p) => !NAME_SUFFIX.test(p))
  return parts.length > 1 ? parts.slice(1).join(' ') : full
}
