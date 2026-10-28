import { useMemo } from 'react'
import { bestPerCategory, rankPickups, type BestForCategory, type PickupResult } from '@/analytics/chase'
import type { Category } from '@/analytics/categories'
import { addTotals, compareWeek, projectSide, weekTotals, type MatchupPlayer, type SideProjection, type WeekCall, type WeekTotals } from '@/analytics/matchup'
import { ESPN_DEFAULT_SLOTS, fillLineup, type SlotDef } from '@/analytics/positions'
import type { EspnResultSide } from '@/data/espn'
import { datesBetween, teamsByDate, type NbaSchedule } from '@/data/schedule'
import { useApp } from '@/store/appStore'
import { teamLabel, useDraft, type EngineData } from '@/store/derived'
import { activeInjuries, currentRosters, todayIso, type CurrentRosters } from '@/store/season'
import type { EspnSync, LeagueSettings, MatchupWeek } from '@/store/schema'

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

/** Injuries in effect today (expired ones drop off automatically). */
export function useInjuries(): Map<string, string | null> {
  const injuries = useApp((s) => s.season.injuries)
  return useMemo(() => activeInjuries(injuries, todayIso()), [injuries])
}

export interface ProjectionOptions {
  /** Scale each game by projected GP / full season (expected missed games). */
  availability: boolean
  /** Player id → out through (null = until further notice). */
  injuries?: ReadonlyMap<string, string | null>
  /** The league's lineup (default: ESPN's standard slots). */
  slots?: readonly SlotDef[]
}

/**
 * Rostered players as the weekly engine sees them. A player your data has no
 * projection for (often a fresh waiver pickup) still plays his games: he takes
 * a lineup seat like on ESPN and counts at replacement level, the same
 * stand-in the draft engine uses for unprojected roster spots.
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
        line: p.line ?? valuation.replacement.line,
        priority: v ? (ctx.basis === 'gpAware' ? v.rankGp : v.rank) : 9999,
        availability: opts.availability && p.gp != null ? Math.min(1, p.gp / full) : 1,
        outThrough: opts.injuries?.has(p.id) ? (opts.injuries.get(p.id) ?? null) : undefined,
      }
    })
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
  /** Games from this day on are projected, except `started` teams' games that day (already in the totals). */
  fromDate: string
  started: ReadonlySet<string>
  asOf: string
}

/** Live totals for week `weekNo` (1-based) between two draft slots (0-based), when ESPN's matchup in progress is that week. */
export function liveFor(live: EspnSync['live'] | undefined, weekNo: number, me: number, them: number | null): LiveTotals | undefined {
  if (!live || live.period !== weekNo) return undefined
  const of = (slot: number | null) => {
    const t = slot == null ? undefined : live.teams.find((x) => x.slot === slot + 1)
    return t ? weekTotals(t.totals) : null
  }
  return { me: of(me), them: of(them), fromDate: live.fromDate, started: new Set(live.started), asOf: live.asOf }
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
  // Live: ESPN's totals so far + a projection of only what hasn't tipped off yet.
  const rest = dates.filter((d) => d >= live.fromDate)
  const restPlaying = (d: string) => {
    const teams = index.byDate.get(d)
    return d === live.fromDate && teams ? new Set([...teams].filter((t) => !live.started.has(t))) : teams
  }
  const meRestSide = projectSide(mineP, rest, restPlaying, slots)
  const themRestSide = projectSide(theirsP, rest, restPlaying, slots)
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
 * Every free agent tried as a pickup for the rest of the week (dropping
 * `drop`, if the roster is full): the remaining days are re-projected with the
 * daily lineup engine, so he only counts on nights he'd actually start.
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
): ChasePlan | null {
  const from = live?.fromDate && live.fromDate > start ? live.fromDate : today > start ? today : start
  const rest = datesBetween(start, end).filter((d) => d >= from)
  if (!rest.length) return null
  const restPlaying = (d: string) => {
    const teams = index.byDate.get(d)
    return live && d === live.fromDate && teams ? new Set([...teams].filter((t) => !live.started.has(t))) : teams
  }
  const restOf = (ids: readonly string[]) => projectSide(matchupPlayers(ids, engine, opts), rest, restPlaying, opts.slots ?? ESPN_DEFAULT_SLOTS)
  const restMe = restOf(mine).totals
  const restThem = restOf(theirs).totals
  const week = projectWeek(engine, index, mine, theirs, start, end, opts, live)
  const kept = mine.filter((id) => id !== drop)
  const playsLeft = new Set(rest.flatMap((d) => [...(restPlaying(d) ?? [])]))
  const inputs = pool
    .filter((id) => {
      const team = engine.byId.get(id)?.team
      return team != null && playsLeft.has(team)
    })
    .map((id) => {
      const side = restOf([...kept, id])
      return { id, starts: side.players.get(id)?.starts ?? 0, restMe: side.totals }
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
 * the best lineup by 9-cat value fills the starting slots, the rest sit on BE,
 * injured players fill IR. Day cells still show who actually plays each night.
 */
export function baseLineup(
  roster: readonly string[],
  engine: EngineData,
  ir: readonly string[],
  irSlots: number,
  benchSlots: number,
  slots: readonly SlotDef[] = ESPN_DEFAULT_SLOTS,
): BaseRow[] {
  const starters = slots.filter((s) => s.starter)
  const onIr = new Set(ir)
  const rank = (id: string) => {
    const v = engine.valuation.values.get(id)
    return v ? (engine.ctx.basis === 'gpAware' ? v.rankGp : v.rank) : 9999
  }
  const active = roster.filter((id) => !onIr.has(id)).sort((a, b) => rank(a) - rank(b))
  const fill = fillLineup(
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
