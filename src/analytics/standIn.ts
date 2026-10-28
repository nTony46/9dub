import type { StatLine } from './types'

/** Totals over a span of games (a season, or the last 15 days). */
export interface SpanTotals {
  gp: number
  min: number
  pts: number
  tpm: number
  reb: number
  ast: number
  stl: number
  blk: number
  tov: number
  fgm: number
  fga: number
  ftm: number
  fta: number
}

export interface StandIn {
  /** Per-game line used in place of a projection. */
  line: StatLine
  /** Minutes per game it assumes. */
  mpg: number
  /** Games played this season (0 = last season's line alone). */
  games: number
  /** What the per-minute rates lean on while this season's sample is small. */
  prior: 'last-season' | 'typical' | 'none'
}

/**
 * Minutes of the prior blended into this season's per-minute rates: after
 * about 300 minutes (10–15 games for a rotation player) this season's own
 * production counts for half.
 */
export const PRIOR_MINUTES = 300
/** Games of prior minutes per game blended into this season's (recent games count twice), so one spot start can't set a role. */
export const PRIOR_GAMES = 3
/** Last season counts as a prior only with at least this many minutes. */
const MIN_PRIOR_MINUTES = 200
/** Last season alone stands in (no games yet this season) only with at least this many games. */
const MIN_PRIOR_GAMES = 10

const KEYS = ['pts', 'tpm', 'reb', 'ast', 'stl', 'blk', 'tov', 'fgm', 'fga', 'ftm', 'fta'] as const

/**
 * A stand-in per-game line for a player with no projection, from his actual stats.
 *
 * - **Minutes per game** come from this season, with the last 15 days counted
 *   twice, so a bigger role (a teammate out, a new starter) shows up within a
 *   few games; `PRIOR_GAMES` of last season's (or a typical player's) minutes
 *   keep a single game from setting it.
 * - **Per-minute production** blends this season with `PRIOR_MINUTES` of a
 *   prior: last season's rates, or, without a usable last season, `typical`
 *   (replacement-level rates). Makes and attempts blend separately, so FG% and
 *   FT% are shrunk by volume too.
 * - No games this season: last season's per-game line, if he played enough.
 *
 * Returns null when there is nothing to go on.
 */
export function standInLine(
  season: SpanTotals | null,
  recent: SpanTotals | null,
  prior: SpanTotals | null,
  typical: { line: StatLine; mpg: number } | null,
): StandIn | null {
  const usablePrior = prior && prior.min >= MIN_PRIOR_MINUTES ? prior : null
  if (season && season.gp > 0 && season.min > 0) {
    const priorMpg = usablePrior ? usablePrior.min / usablePrior.gp : typical && typical.mpg > 0 ? typical.mpg : null
    const priorGames = priorMpg == null ? 0 : PRIOR_GAMES
    const mpg = (season.min + (recent?.min ?? 0) + priorGames * (priorMpg ?? 0)) / (season.gp + (recent?.gp ?? 0) + priorGames)
    const priorRate = (k: (typeof KEYS)[number]): number | null => {
      if (usablePrior) return usablePrior[k] / usablePrior.min
      const t = typical?.line[k]
      return typical && typical.mpg > 0 && t != null ? t / typical.mpg : null
    }
    const usesPrior = usablePrior ? 'last-season' : typical && typical.mpg > 0 ? 'typical' : 'none'
    const rate = (k: (typeof KEYS)[number]) => {
      const p = usesPrior === 'none' ? null : priorRate(k)
      return p == null ? season[k] / season.min : (season[k] + PRIOR_MINUTES * p) / (season.min + PRIOR_MINUTES)
    }
    const line = Object.fromEntries(KEYS.map((k) => [k, rate(k) * mpg])) as unknown as StatLine
    return { line, mpg, games: season.gp, prior: usesPrior }
  }
  if (prior && prior.gp >= MIN_PRIOR_GAMES) {
    const line = Object.fromEntries(KEYS.map((k) => [k, prior[k] / prior.gp])) as unknown as StatLine
    return { line, mpg: prior.min / prior.gp, games: 0, prior: 'last-season' }
  }
  return null
}
