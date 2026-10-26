import { CATEGORIES, catRecord, type CatRecord, type Category } from './categories'
import { clamp, mean, populationSd } from './math'
import type {
  EnginePlayer,
  PlayerValue,
  ReferenceParams,
  ReplacementLevel,
  StatLine,
  ValuationBasis,
  ValuationResult,
  ValuationSettings,
} from './types'

export const DEFAULT_VALUATION_SETTINGS: ValuationSettings = {
  poolSize: 200,
  teams: 12,
  rounds: 13,
  fullSeasonGames: 82,
}

const MAX_POOL_ITERATIONS = 8
/** Guard against a degenerate (zero-variance) category. */
const MIN_SD = 1e-6

/** True when the line carries usable FG volume (attempts > 0 and makes known). */
export function hasFgVolume(line: StatLine): boolean {
  return line.fga != null && line.fga > 0 && line.fgm != null
}

export function hasFtVolume(line: StatLine): boolean {
  return line.fta != null && line.fta > 0 && line.ftm != null
}

/**
 * Raw per-game value for a category.
 * - Counting categories: the per-game stat.
 * - FG / FT: impact = makes − baseline × attempts (needs a baseline and volume).
 * - TO: raw turnovers (direction is inverted in the z-score, not here).
 * Returns null when the input needed is unavailable — never a fake zero.
 */
export function rawCategoryValue(
  line: StatLine,
  cat: Category,
  baselines: { fg: number | null; ft: number | null },
): number | null {
  switch (cat) {
    case 'FG':
      if (!hasFgVolume(line) || baselines.fg == null) return null
      return line.fgm! - baselines.fg * line.fga!
    case 'FT':
      if (!hasFtVolume(line) || baselines.ft == null) return null
      return line.ftm! - baselines.ft * line.fta!
    case '3PM':
      return line.tpm
    case 'PTS':
      return line.pts
    case 'REB':
      return line.reb
    case 'AST':
      return line.ast
    case 'STL':
      return line.stl
    case 'BLK':
      return line.blk
    case 'TO':
      return line.tov
  }
}

/** Direction-corrected z: higher is always better (TO is inverted). */
export function zFromRaw(raw: number, cat: Category, params: Pick<ReferenceParams, 'mean' | 'sd'>): number {
  const sd = params.sd[cat]
  return cat === 'TO' ? (params.mean[cat] - raw) / sd : (raw - params.mean[cat]) / sd
}

/** Compute baselines, means and SDs from an explicit pool of players. */
export function paramsFromPool(
  pool: readonly EnginePlayer[],
): Pick<ReferenceParams, 'fgBaseline' | 'ftBaseline' | 'mean' | 'sd' | 'n'> {
  let fgm = 0
  let fga = 0
  let ftm = 0
  let fta = 0
  for (const p of pool) {
    if (hasFgVolume(p.line)) {
      fgm += p.line.fgm!
      fga += p.line.fga!
    }
    if (hasFtVolume(p.line)) {
      ftm += p.line.ftm!
      fta += p.line.fta!
    }
  }
  // Attempt-weighted baseline: the pool's aggregate make rate, not a mean of percentages.
  const fgBaseline = fga > 0 ? fgm / fga : null
  const ftBaseline = fta > 0 ? ftm / fta : null
  const baselines = { fg: fgBaseline, ft: ftBaseline }

  const meanRec = {} as CatRecord<number>
  const sdRec = {} as CatRecord<number>
  const nRec = {} as CatRecord<number>
  for (const c of CATEGORIES) {
    const xs: number[] = []
    for (const p of pool) {
      const v = rawCategoryValue(p.line, c, baselines)
      if (v != null && Number.isFinite(v)) xs.push(v)
    }
    meanRec[c] = mean(xs)
    const sd = populationSd(xs)
    sdRec[c] = sd > MIN_SD ? sd : 1
    nRec[c] = xs.length
  }
  return { fgBaseline, ftBaseline, mean: meanRec, sd: sdRec, n: nRec }
}

function zLine(
  p: EnginePlayer,
  params: Pick<ReferenceParams, 'fgBaseline' | 'ftBaseline' | 'mean' | 'sd'>,
): { raw: CatRecord<number | null>; z: CatRecord<number | null>; total: number; covered: number } {
  const baselines = { fg: params.fgBaseline, ft: params.ftBaseline }
  const raw = catRecord((c) => rawCategoryValue(p.line, c, baselines))
  const z = catRecord((c) => (raw[c] == null ? null : zFromRaw(raw[c]!, c, params)))
  let total = 0
  let covered = 0
  for (const c of CATEGORIES)
    if (z[c] != null) {
      total += z[c]!
      covered++
    }
  return { raw, z, total, covered }
}

/**
 * Ranking order: players whose nine categories are all computable come first,
 * then partially valued players (e.g. FG%/FT% without attempts). A partial
 * total treats the missing categories as zero, i.e. exactly average, which
 * flatters poor shooters — so it must never outrank a fully valued player.
 * When nobody has shooting volume, everyone is in the same tier.
 */
function byTierThenTotal(totals: Map<string, number>, covered: Map<string, number>) {
  return (a: EnginePlayer, b: EnginePlayer) =>
    (covered.get(b.id)! === 9 ? 1 : 0) - (covered.get(a.id)! === 9 ? 1 : 0) ||
    totals.get(b.id)! - totals.get(a.id)! ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

function topIds(players: readonly EnginePlayer[], totals: Map<string, number>, covered: Map<string, number>, k: number): string[] {
  return [...players]
    .sort(byTierThenTotal(totals, covered))
    .slice(0, k)
    .map((p) => p.id)
}

/**
 * Iteratively determine a draft-relevant reference pool:
 *   1. value everyone against the whole dataset,
 *   2. take the top `poolSize` by total z,
 *   3. recompute baselines / means / SDs on that pool,
 *   4. repeat until pool membership stops changing (or MAX iterations).
 * Deterministic (ties broken by id). Depends only on the projection dataset
 * and settings — never on draft status — so it can be frozen per snapshot.
 */
export function computeReferenceParams(
  players: readonly EnginePlayer[],
  settings: Pick<ValuationSettings, 'poolSize'>,
): ReferenceParams {
  const poolSize = Math.max(2, Math.min(settings.poolSize, players.length))
  let pool: readonly EnginePlayer[] = players
  let params = paramsFromPool(pool)
  let poolIds = players.map((p) => p.id)
  let iterations = 0
  let converged = false
  const byId = new Map(players.map((p) => [p.id, p]))

  for (let i = 0; i < MAX_POOL_ITERATIONS; i++) {
    iterations = i + 1
    const lines = new Map(players.map((p) => [p.id, zLine(p, params)]))
    const totals = new Map([...lines].map(([id, l]) => [id, l.total]))
    const covered = new Map([...lines].map(([id, l]) => [id, l.covered]))
    const nextIds = topIds(players, totals, covered, poolSize)
    const same = nextIds.length === poolIds.length && new Set(nextIds).size === new Set([...nextIds, ...poolIds]).size
    poolIds = nextIds
    pool = nextIds.map((id) => byId.get(id)!)
    params = paramsFromPool(pool)
    if (same) {
      converged = true
      break
    }
  }

  return { poolSize, poolIds, iterations, converged, ...params, playerCount: players.length }
}

export function averageLine(lines: readonly StatLine[]): StatLine {
  const avg = (f: (l: StatLine) => number) => mean(lines.map(f))
  const withFg = lines.filter(hasFgVolume)
  const withFt = lines.filter(hasFtVolume)
  return {
    pts: avg((l) => l.pts),
    tpm: avg((l) => l.tpm),
    reb: avg((l) => l.reb),
    ast: avg((l) => l.ast),
    stl: avg((l) => l.stl),
    blk: avg((l) => l.blk),
    tov: avg((l) => l.tov),
    fgm: withFg.length ? mean(withFg.map((l) => l.fgm!)) : null,
    fga: withFg.length ? mean(withFg.map((l) => l.fga!)) : null,
    ftm: withFt.length ? mean(withFt.map((l) => l.ftm!)) : null,
    fta: withFt.length ? mean(withFt.map((l) => l.fta!)) : null,
  }
}

/**
 * Value every player: per-game z-scores against the frozen pool, a replacement
 * level (the players ranked just after the league's total roster spots), and
 * an availability-adjusted ("GP-aware") view:
 *
 *   gpZ_c = a · z_c + (1 − a) · replacementZ_c,   a = min(GP, G) / G
 *
 * i.e. games a player misses are filled by replacement-level production rather
 * than by zeros — a calibrated alternative to multiplying total z by GP.
 */
export function valuePlayers(
  players: readonly EnginePlayer[],
  settings: ValuationSettings = DEFAULT_VALUATION_SETTINGS,
): ValuationResult {
  const params = computeReferenceParams(players, settings)
  const base = new Map(players.map((p) => [p.id, zLine(p, params)]))

  const covered = new Map([...base].map(([id, l]) => [id, l.covered]))
  const orderPerGame = [...players].sort(byTierThenTotal(new Map([...base].map(([id, l]) => [id, l.total])), covered)).map((p) => p.id)

  // Replacement band: the `teams` players ranked just after every roster spot is filled.
  const drafted = settings.teams * settings.rounds
  let rankStart = drafted + 1
  let rankEnd = drafted + settings.teams
  if (rankEnd > orderPerGame.length) {
    rankEnd = orderPerGame.length
    rankStart = Math.max(1, rankEnd - settings.teams + 1)
  }
  const bandIds = orderPerGame.slice(rankStart - 1, rankEnd)
  const byId = new Map(players.map((p) => [p.id, p]))
  const replacementZ = catRecord((c) => {
    const xs = bandIds.map((id) => base.get(id)!.z[c]).filter((v): v is number => v != null)
    return mean(xs)
  })
  const replacement: ReplacementLevel = {
    rankStart,
    rankEnd,
    ids: bandIds,
    z: replacementZ,
    total: CATEGORIES.reduce((s, c) => s + replacementZ[c], 0),
    line: averageLine(bandIds.map((id) => byId.get(id)!.line)),
  }

  const values = new Map<string, PlayerValue>()
  const gpTotals = new Map<string, number>()
  for (const p of players) {
    const b = base.get(p.id)!
    const availability = p.gp == null ? null : clamp(p.gp / settings.fullSeasonGames, 0, 1)
    const gz = catRecord((c) => {
      const z = b.z[c]
      if (z == null) return null
      return availability == null ? z : availability * z + (1 - availability) * replacementZ[c]
    })
    let gpTotal = 0
    for (const c of CATEGORIES) if (gz[c] != null) gpTotal += gz[c]!
    gpTotals.set(p.id, gpTotal)
    const missing = CATEGORIES.filter((c) => b.z[c] == null)
    values.set(p.id, {
      id: p.id,
      raw: b.raw,
      z: b.z,
      total: b.total,
      coveredCats: 9 - missing.length,
      complete: missing.length === 0,
      missing,
      gp: { availability, z: gz, total: gpTotal },
      rank: 0,
      rankGp: 0,
    })
  }

  orderPerGame.forEach((id, i) => (values.get(id)!.rank = i + 1))
  const orderGp = [...players].sort(byTierThenTotal(gpTotals, covered)).map((p) => p.id)
  orderGp.forEach((id, i) => (values.get(id)!.rankGp = i + 1))

  return { settings, params, replacement, values, orderPerGame, orderGp }
}

/** Z vector and total for the chosen valuation basis. */
export function basisZ(v: PlayerValue, basis: ValuationBasis): CatRecord<number | null> {
  return basis === 'gpAware' ? v.gp.z : v.z
}

export function basisTotal(v: PlayerValue, basis: ValuationBasis): number {
  return basis === 'gpAware' ? v.gp.total : v.total
}

export function basisRank(v: PlayerValue, basis: ValuationBasis): number {
  return basis === 'gpAware' ? v.rankGp : v.rank
}

/**
 * Category-weighted total, used for punt comparisons. Weights of 0 drop a
 * category (hard punt), fractional weights de-emphasise it (soft punt).
 * The intrinsic (unweighted) total is never overwritten.
 */
export function weightedTotal(z: CatRecord<number | null>, weights: CatRecord<number>): number {
  let s = 0
  for (const c of CATEGORIES) if (z[c] != null) s += weights[c] * z[c]!
  return s
}

/** Effective per-game line under a basis; GP-aware blends with the replacement line. */
export function effectiveLine(line: StatLine, gp: number | null, basis: ValuationBasis, result: ValuationResult): StatLine {
  if (basis === 'perGame' || gp == null) return line
  const a = clamp(gp / result.settings.fullSeasonGames, 0, 1)
  const r = result.replacement.line
  const mix = (x: number, y: number) => a * x + (1 - a) * y
  const mixN = (x: number | null, y: number | null) => (x == null ? null : y == null ? a * x : mix(x, y))
  return {
    pts: mix(line.pts, r.pts),
    tpm: mix(line.tpm, r.tpm),
    reb: mix(line.reb, r.reb),
    ast: mix(line.ast, r.ast),
    stl: mix(line.stl, r.stl),
    blk: mix(line.blk, r.blk),
    tov: mix(line.tov, r.tov),
    fgm: line.fga == null ? null : mixN(line.fgm, r.fgm),
    fga: line.fga == null ? null : mixN(line.fga, r.fga),
    ftm: line.fta == null ? null : mixN(line.ftm, r.ftm),
    fta: line.fta == null ? null : mixN(line.fta, r.fta),
  }
}
