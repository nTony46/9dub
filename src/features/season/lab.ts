import { CATEGORIES, type Category } from '@/analytics/categories'
import { compareWeek, projectSide, type MatchupPlayer, type WeekTotals } from '@/analytics/matchup'
import type { SlotDef } from '@/analytics/positions'
import type { StatLine } from '@/analytics/types'
import { datesBetween } from '@/data/schedule'
import type { EngineData } from '@/store/derived'
import type { EspnSync, MatchupWeek } from '@/store/schema'
import { matchupPlayers, type ProjectionOptions } from './model'

/**
 * Roster Lab: how roster changes and trades move your league ranks over the
 * rest of the regular season. Every team's weeks are projected with the daily
 * lineup engine on the real NBA schedule, then compared category by category
 * against every other team (all-play), the way your category record builds up.
 */

/** "This season": ESPN's actual stats blended toward last season (the stand-in model, for everyone); "Projections": 9dub's projections. */
export type LabBasis = 'season' | 'projection'

export interface LabChange {
  /** One of your players to drop (null = none: an add into an open spot). */
  drop: string | null
  /** A free agent or waiver player to add (null = not chosen yet). */
  add: string | null
}

export interface LabTrade {
  /** The other team (0-based draft slot). */
  team: number
  give: string[]
  get: string[]
}

/** The regular-season weeks still to play (the week in progress counts in full: these are strength ranks, not this week's score). */
export function labWeeks(weeks: readonly Pick<MatchupWeek, 'start' | 'end'>[], today: string): string[][] {
  return [...weeks]
    .sort((a, b) => a.start.localeCompare(b.start))
    .filter((w) => w.end >= today)
    .map((w) => datesBetween(w.start, w.end))
}

type Span = NonNullable<EspnSync['stats'][string]['season']>

/** League-wide per-minute rates and shooting, the prior for players with no usable last season. */
export interface LeagueRates {
  stl: number
  blk: number
  tpm: number
  fg: number
  ft: number
}

export function leagueRates(stats: EspnSync['stats']): LeagueRates {
  const spans = Object.values(stats)
    .map((s) => s.season)
    .filter((s): s is Span => !!s && s.gp >= 3 && s.min > 0)
  const sum = (k: keyof Span) => spans.reduce((a, s) => a + (s[k] as number), 0)
  const min = Math.max(1e-9, sum('min'))
  return { stl: sum('stl') / min, blk: sum('blk') / min, tpm: sum('tpm') / min, fg: sum('fgm') / Math.max(1e-9, sum('fga')), ft: sum('ftm') / Math.max(1e-9, sum('fta')) }
}

/** Minutes of last season blended into this season's per-minute rate: light for volume stats, heavier for the noisy ones. */
const VOLUME_PRIOR_MIN = 60
const NOISY_PRIOR_MIN = 300
/** Attempts of last season's shooting blended into this season's FG% / FT%. */
const FG_PRIOR_ATT = 100
const FT_PRIOR_ATT = 40
/** Last season counts as a prior with at least this many minutes. */
const USABLE_PRIOR_MIN = 500

/**
 * This season's per-game line, current-season first: this season's minutes,
 * and per-minute points, rebounds, assists, turnovers and attempts mostly from
 * this season (`VOLUME_PRIOR_MIN` of last season's rates mixed in). Steals,
 * blocks, threes and shooting percentages are noisier over a few games, so
 * they lean more on last season, or on league rates for a player without one.
 * Under 3 games: last season's per-game line (20+ games), else this season's raw.
 */
export function seasonLine(season: Span | null, prior: Span | null, league: LeagueRates): StatLine | null {
  const pr = prior && prior.min >= USABLE_PRIOR_MIN ? prior : null
  if (!season || season.gp < 3 || season.min <= 0) {
    const s = prior && prior.gp >= 20 ? prior : season && season.gp > 0 ? season : null
    if (!s) return null
    const g = (v: number) => v / s.gp
    return { pts: g(s.pts), tpm: g(s.tpm), reb: g(s.reb), ast: g(s.ast), stl: g(s.stl), blk: g(s.blk), tov: g(s.tov), fgm: g(s.fgm), fga: g(s.fga), ftm: g(s.ftm), fta: g(s.fta) }
  }
  const mpg = season.min / season.gp
  const rate = (k: 'pts' | 'reb' | 'ast' | 'tov' | 'fga' | 'fta' | 'stl' | 'blk' | 'tpm', priorMin: number, lg?: number) => {
    if (pr) return (season[k] + (pr[k] / pr.min) * priorMin) / (season.min + priorMin)
    if (lg != null) return (season[k] + lg * (priorMin / 2)) / (season.min + priorMin / 2)
    return season[k] / season.min
  }
  const fga = rate('fga', VOLUME_PRIOR_MIN) * mpg
  const fta = rate('fta', VOLUME_PRIOR_MIN) * mpg
  const fg = pr && pr.fga >= 200 ? (season.fgm + (pr.fgm / pr.fga) * FG_PRIOR_ATT) / (season.fga + FG_PRIOR_ATT) : (season.fgm + league.fg * 60) / (season.fga + 60)
  const ft = pr && pr.fta >= 60 ? (season.ftm + (pr.ftm / pr.fta) * FT_PRIOR_ATT) / (season.fta + FT_PRIOR_ATT) : (season.ftm + league.ft * 30) / (season.fta + 30)
  return {
    pts: rate('pts', VOLUME_PRIOR_MIN) * mpg,
    reb: rate('reb', VOLUME_PRIOR_MIN) * mpg,
    ast: rate('ast', VOLUME_PRIOR_MIN) * mpg,
    tov: rate('tov', VOLUME_PRIOR_MIN) * mpg,
    stl: rate('stl', NOISY_PRIOR_MIN, league.stl) * mpg,
    blk: rate('blk', NOISY_PRIOR_MIN, league.blk) * mpg,
    tpm: rate('tpm', NOISY_PRIOR_MIN, league.tpm) * mpg,
    fga,
    fgm: fga * fg,
    fta,
    ftm: fta * ft,
  }
}

/** Per-game lines on the chosen basis; null = keep 9dub's own line for him. */
export function labLineFor(stats: EspnSync['stats'] | undefined, basis: LabBasis): (id: string) => StatLine | null {
  if (basis === 'projection' || !stats) return () => null
  const league = leagueRates(stats)
  const cache = new Map<string, StatLine | null>()
  return (id) => {
    if (cache.has(id)) return cache.get(id)!
    const s = stats[id]
    const line = s ? seasonLine(s.season, s.prior, league) : null
    cache.set(id, line)
    return line
  }
}

/**
 * Nine-category value of each line against the pool (z-scores summed; FG% and
 * FT% as makes above the pool's rate on the player's attempts; fewer turnovers
 * is better). Orders who starts when a lineup is full.
 */
export function lineValues(lines: ReadonlyMap<string, StatLine>): Map<string, number> {
  const all = [...lines.values()]
  const sum = (f: (l: StatLine) => number) => all.reduce((a, l) => a + f(l), 0)
  const fgRate = sum((l) => l.fgm ?? 0) / Math.max(1e-9, sum((l) => l.fga ?? 0))
  const ftRate = sum((l) => l.ftm ?? 0) / Math.max(1e-9, sum((l) => l.fta ?? 0))
  const parts: ((l: StatLine) => number)[] = [
    (l) => (l.fgm ?? 0) - fgRate * (l.fga ?? 0),
    (l) => (l.ftm ?? 0) - ftRate * (l.fta ?? 0),
    (l) => l.tpm,
    (l) => l.pts,
    (l) => l.reb,
    (l) => l.ast,
    (l) => l.stl,
    (l) => l.blk,
    (l) => -l.tov,
  ]
  const stats = parts.map((f) => {
    const v = all.map(f)
    const m = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, v.length)) || 1
    return { f, m, sd }
  })
  return new Map([...lines].map(([id, l]) => [id, stats.reduce((a, s) => a + (s.f(l) - s.m) / s.sd, 0)]))
}

/** The lab's players: 9dub's weekly-engine players with the basis's lines, ordered by their value on that basis. */
export function labPlayers(ids: readonly string[], engine: EngineData, opts: ProjectionOptions, lineFor: (id: string) => StatLine | null, value: (id: string) => number): MatchupPlayer[] {
  return matchupPlayers(ids, engine, opts).map((p) => ({ ...p, line: lineFor(p.id) ?? p.line, priority: -value(p.id) }))
}

/** One team's projected week totals, week by week (scaled by `volume`, see `volumeFactor`). */
export function teamWeeks(players: readonly MatchupPlayer[], weeks: readonly string[][], playing: (d: string) => ReadonlySet<string> | undefined, slots: readonly SlotDef[], volume = 1): WeekTotals[] {
  return weeks.map((dates) => scaleWeek(projectSide(players, dates, playing, slots).totals, volume))
}

/** A week's totals with every count (and makes and attempts) scaled by `f`; percentages unchanged. */
export function scaleWeek(t: WeekTotals, f: number): WeekTotals {
  if (f === 1) return t
  return { ...t, pts: t.pts * f, tpm: t.tpm * f, reb: t.reb * f, ast: t.ast * f, stl: t.stl * f, blk: t.blk * f, tov: t.tov * f, fgm: t.fgm * f, fga: t.fga * f, ftm: t.ftm * f, fta: t.fta * f }
}

/** The range a team's volume factor is kept in: two or three weeks of results are a small sample. */
const VOLUME_RANGE = [0.8, 1.25] as const

/**
 * How much a team has actually played compared with what its roster projects:
 * field-goal attempts in the finished weeks (ESPN's results) ÷ the projection
 * of the same days with today's roster. Above 1 = it streams pickups or fills
 * its lineup more than its roster alone suggests. 1 when there's nothing to go on.
 */
export function volumeFactor(actualFga: number, projectedFga: number): number {
  if (!(actualFga > 0) || !(projectedFga > 0)) return 1
  return Math.min(VOLUME_RANGE[1], Math.max(VOLUME_RANGE[0], actualFga / projectedFga))
}

/** Each team's volume factor from its finished weeks (see `volumeFactor`); a scenario keeps the unchanged league's factors. */
export function volumeFactors(
  players: readonly (readonly MatchupPlayer[])[],
  finished: readonly { dates: string[]; fga: ReadonlyMap<number, number> }[],
  playing: (d: string) => ReadonlySet<string> | undefined,
  slots: readonly SlotDef[],
): number[] {
  return players.map((ps, t) => {
    let actual = 0
    let projected = 0
    for (const w of finished) {
      const a = w.fga.get(t)
      if (a == null) continue
      actual += a
      projected += projectSide(ps, w.dates, playing, slots).totals.fga
    }
    return volumeFactor(actual, projected)
  })
}

/** Finished regular-season weeks (1-based period, its dates) with every team's actual field-goal attempts from ESPN. */
export function finishedWeeks(weeks: readonly Pick<MatchupWeek, 'start' | 'end'>[], results: EspnSync['results'] | undefined, today: string): { dates: string[]; fga: Map<number, number> }[] {
  const sorted = [...weeks].sort((a, b) => a.start.localeCompare(b.start))
  const out: { dates: string[]; fga: Map<number, number> }[] = []
  sorted.forEach((w, k) => {
    if (w.end >= today) return
    const fga = new Map<number, number>()
    for (const r of results ?? []) if (r.period === k + 1) for (const s of [r.home, r.away]) fga.set(s.slot - 1, s.totals.fga)
    if (fga.size) out.push({ dates: datesBetween(w.start, w.end), fga })
  })
  return out
}

export interface LabMetrics {
  /** League rank (1 = best) in each category, from average weekly totals. */
  ranks: Record<Category, number>
  /** Average weekly totals (FG / FT as percentages). */
  weekly: Record<Category, number>
  /** Expected opponents beaten in each category in a typical week (of teams − 1). */
  wins: Record<Category, number>
  /** Expected categories won per matchup (all-play average). */
  cpm: number
  /** Chance to win 5+ / 6+ categories in a typical matchup. */
  p5: number
  p6: number
  /** Chance to win 5+ against the four strongest other teams. */
  top4: number
  /** Rank (1 = best) of expected categories won per matchup among all teams. */
  overall: number
  /** Every team's expected categories won per matchup, by team. */
  strength: number[]
}

const KEY: Record<Exclude<Category, 'FG' | 'FT'>, keyof WeekTotals> = { '3PM': 'tpm', PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk', TO: 'tov' }

/** Average weekly totals per category (percentages from summed makes and attempts). */
export function averageWeek(weeks: readonly WeekTotals[]): Record<Category, number> {
  const n = Math.max(1, weeks.length)
  const s = (k: keyof WeekTotals) => weeks.reduce((a, w) => a + ((w[k] as number) ?? 0), 0)
  const out = { FG: s('fgm') / Math.max(1e-9, s('fga')), FT: s('ftm') / Math.max(1e-9, s('fta')) } as Record<Category, number>
  for (const [c, k] of Object.entries(KEY)) out[c as Category] = s(k) / n
  return out
}

/** P(at least k of the categories), categories independent. */
function atLeast(shares: readonly number[], k: number): number {
  let dist = [1]
  for (const q of shares) {
    const next = new Array(dist.length + 1).fill(0)
    dist.forEach((x, i) => {
      next[i] += x * (1 - q)
      next[i + 1] += x * q
    })
    dist = next
  }
  return dist.slice(k).reduce((a, b) => a + b, 0)
}

/** Category shares (win = 1, tie = ½) of team a against team b in each week. */
function pairShares(a: readonly WeekTotals[], b: readonly WeekTotals[]): number[][] {
  return a.map((w, i) => compareWeek(w, b[i]).calls.map((c) => c.share ?? 0.5))
}

/**
 * Ranks and matchup odds for team `me`, given every team's projected weeks.
 * `top4` names the four strongest other teams (from the unchanged league), so
 * a scenario is judged against the same opponents as the roster it's compared with.
 */
export function leagueMetrics(weeks: readonly (readonly WeekTotals[])[], me: number, top4?: readonly number[]): LabMetrics {
  const teams = weeks.length
  const nw = Math.max(1, weeks[me].length)
  const strength = new Array(teams).fill(0)
  const wins = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>
  let p5 = 0
  let p6 = 0
  const p5vs = new Array(teams).fill(0)
  for (let i = 0; i < teams; i++)
    for (let j = i + 1; j < teams; j++) {
      const sh = pairShares(weeks[i], weeks[j])
      for (const wk of sh) {
        const total = wk.reduce((a, b) => a + b, 0)
        strength[i] += total
        strength[j] += CATEGORIES.length - total
        if (i === me || j === me) {
          const mine = i === me ? wk : wk.map((x) => 1 - x)
          CATEGORIES.forEach((c, k) => (wins[c] += mine[k] / nw))
          const q5 = atLeast(mine, 5)
          p5 += q5
          p6 += atLeast(mine, 6)
          p5vs[i === me ? j : i] += q5 / nw
        }
      }
    }
  const games = Math.max(1, (teams - 1) * nw)
  for (let i = 0; i < teams; i++) strength[i] /= games
  const avg = weeks.map(averageWeek)
  const mine = avg[me]
  const ranks = Object.fromEntries(
    CATEGORIES.map((c) => [c, 1 + avg.filter((o, t) => t !== me && (c === 'TO' ? o[c] < mine[c] - 1e-9 : o[c] > mine[c] + 1e-9)).length]),
  ) as Record<Category, number>
  const field = top4 ?? strongest(strength, me, 4)
  return {
    ranks,
    weekly: mine,
    wins,
    cpm: strength[me],
    p5: p5 / games,
    p6: p6 / games,
    top4: field.length ? field.reduce((a, t) => a + p5vs[t], 0) / field.length : 0,
    overall: 1 + strength.filter((s, t) => t !== me && s > strength[me] + 1e-9).length,
    strength,
  }
}

/** The `n` strongest teams other than `me`, by expected categories won per matchup. */
export function strongest(strength: readonly number[], me: number, n: number): number[] {
  return strength
    .map((s, t) => ({ s, t }))
    .filter((x) => x.t !== me)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.t)
}

/** Win (beat 7+ of 11 in a typical week, scaled to the league size), swing (4–7), punt (under 4). */
export function tierOf(wins: number, opponents: number): 'win' | 'swing' | 'punt' {
  const r = wins / Math.max(1, opponents)
  return r >= 7 / 11 ? 'win' : r >= 4 / 11 ? 'swing' : 'punt'
}

/** Rosters after the changes: your swaps, then the trade (players move both ways). */
export function applyLab(rosters: readonly (readonly string[])[], me: number, changes: readonly LabChange[], trade: LabTrade | null): string[][] {
  const out = rosters.map((r) => [...r])
  for (const c of changes) {
    if (!c.add) continue
    if (c.drop) out[me] = out[me].filter((id) => id !== c.drop)
    if (!out[me].includes(c.add)) out[me].push(c.add)
  }
  if (trade && (trade.give.length || trade.get.length) && trade.team !== me && out[trade.team]) {
    out[me] = out[me].filter((id) => !trade.give.includes(id)).concat(trade.get.filter((id) => !out[me].includes(id)))
    out[trade.team] = out[trade.team].filter((id) => !trade.get.includes(id)).concat(trade.give.filter((id) => !out[trade.team].includes(id)))
  }
  return out
}
