import { CATEGORIES, catRecord, type CatRecord, type Category } from './categories'
import { mean, populationSd } from './math'
import type { StatLine, ValuationBasis, ValuationResult } from './types'
import { averageLine, basisTotal, basisZ, effectiveLine, hasFgVolume, hasFtVolume } from './valuation'

/** Context the team/league functions need. Built once per dataset+settings. */
export interface EngineContext {
  valuation: ValuationResult
  lines: Map<string, { line: StatLine; gp: number | null }>
  basis: ValuationBasis
  /** Roster spots per team (= draft rounds in V1). */
  rosterSize: number
}

export interface TeamTotals {
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
  /** sum(FGM) / sum(FGA) — attempts-weighted, never a mean of percentages. */
  fgPct: number | null
  ftPct: number | null
  /** Players excluded from FG% / FT% because the source has no attempts. */
  fgMissing: number
  ftMissing: number
}

export interface TeamProfile {
  playerIds: string[]
  count: number
  open: number
  rosterSize: number
  /** Raw per-game production of rostered players (basis-effective lines). */
  totals: TeamTotals
  /** Raw production with open slots filled by replacement-level lines. */
  totalsSlot: TeamTotals
  /** Sum of player z-scores per category (volume-correct for FG/FT). */
  zSum: CatRecord<number>
  /** zSum + open slots × replacement z — comparable across unequal roster sizes. */
  zSlot: CatRecord<number>
  /** zSum / count — average contribution per rostered player. */
  zPer: CatRecord<number>
  totalZ: number
  totalSlot: number
  /** Players whose z is unknown per category (incomplete source data). */
  missingByCat: CatRecord<number>
}

const EMPTY_TOTALS: TeamTotals = {
  pts: 0,
  tpm: 0,
  reb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  tov: 0,
  fgm: 0,
  fga: 0,
  ftm: 0,
  fta: 0,
  fgPct: null,
  ftPct: null,
  fgMissing: 0,
  ftMissing: 0,
}

/** Aggregate stat lines. FG% / FT% are sum(makes)/sum(attempts) over players with volume. */
export function aggregateLines(lines: readonly StatLine[]): TeamTotals {
  const t = { ...EMPTY_TOTALS }
  for (const l of lines) {
    t.pts += l.pts
    t.tpm += l.tpm
    t.reb += l.reb
    t.ast += l.ast
    t.stl += l.stl
    t.blk += l.blk
    t.tov += l.tov
    if (hasFgVolume(l)) {
      t.fgm += l.fgm!
      t.fga += l.fga!
    } else t.fgMissing++
    if (hasFtVolume(l)) {
      t.ftm += l.ftm!
      t.fta += l.fta!
    } else t.ftMissing++
  }
  t.fgPct = t.fga > 0 ? t.fgm / t.fga : null
  t.ftPct = t.fta > 0 ? t.ftm / t.fta : null
  return t
}

export function teamProfile(playerIds: readonly string[], ctx: EngineContext): TeamProfile {
  const { valuation, basis, rosterSize } = ctx
  const ids = playerIds.filter((id) => valuation.values.has(id))
  const lines: StatLine[] = []
  const zSum = catRecord(() => 0)
  const missingByCat = catRecord(() => 0)
  let totalZ = 0
  for (const id of ids) {
    const v = valuation.values.get(id)!
    const src = ctx.lines.get(id)
    if (src) lines.push(effectiveLine(src.line, src.gp, basis, valuation))
    const z = basisZ(v, basis)
    for (const c of CATEGORIES) {
      if (z[c] == null) missingByCat[c]++
      else zSum[c] += z[c]!
    }
    totalZ += basisTotal(v, basis)
  }
  const count = ids.length
  const open = Math.max(0, rosterSize - count)
  const r = valuation.replacement
  const zSlot = catRecord((c) => zSum[c] + open * r.z[c])
  const zPer = catRecord((c) => (count ? zSum[c] / count : 0))
  const totals = aggregateLines(lines)
  const totalsSlot = aggregateLines([...lines, ...Array.from({ length: open }, () => r.line)])
  // Replacement lines are synthetic, so they never count as "missing" volume.
  totalsSlot.fgMissing = totals.fgMissing
  totalsSlot.ftMissing = totals.ftMissing
  return {
    playerIds: ids,
    count,
    open,
    rosterSize,
    totals,
    totalsSlot,
    zSum,
    zSlot,
    zPer,
    totalZ,
    totalSlot: totalZ + open * r.total,
    missingByCat,
  }
}

/**
 * League-wide scale for team-level comparisons, from the "drafted band"
 * (top teams × rounds players by the chosen basis):
 *   typical full team per category  = R · mean_c
 *   construction scale sigma_c       = sqrt(R) · sd_c
 * These are construction indices, not calibrated weekly win probabilities.
 */
export interface LeagueScale {
  meanZ: CatRecord<number>
  sdZ: CatRecord<number>
  sigma: CatRecord<number>
  typicalFull: CatRecord<number>
  /** Mean z per category of the players valued in each round's band (index 0 = round 1). */
  roundMeans: CatRecord<number>[]
  rosterSize: number
}

export function leagueScale(ctx: EngineContext, teams: number): LeagueScale {
  const { valuation, basis, rosterSize } = ctx
  const order = basis === 'gpAware' ? valuation.orderGp : valuation.orderPerGame
  const zOf = (id: string) => basisZ(valuation.values.get(id)!, basis)
  const band = order.slice(0, Math.min(order.length, teams * rosterSize))
  const meanZ = catRecord((c) => mean(band.map((id) => zOf(id)[c] ?? 0)))
  const sdZ = catRecord((c) => populationSd(band.map((id) => zOf(id)[c] ?? 0)))
  const sigma = catRecord((c) => Math.max(0.5, Math.sqrt(rosterSize) * Math.max(sdZ[c], 0.25)))
  const roundMeans: CatRecord<number>[] = []
  for (let j = 0; j < rosterSize; j++) {
    const ids = order.slice(j * teams, (j + 1) * teams)
    roundMeans.push(catRecord((c) => (ids.length ? mean(ids.map((id) => zOf(id)[c] ?? 0)) : valuation.replacement.z[c])))
  }
  const typicalFull = catRecord((c) => roundMeans.reduce((s, m) => s + m[c], 0))
  return { meanZ, sdZ, sigma, typicalFull, roundMeans, rosterSize }
}

/**
 * Typical slot-adjusted team after k real picks: the average value of the
 * players in round bands 1..k (a value-ordered draft), with the remaining
 * slots at replacement level. Comparing a k-player roster against this keeps
 * comparisons stage-matched instead of pitting a partial roster against a
 * finished one.
 */
export function typicalAtStage(scale: LeagueScale, valuation: ValuationResult, k: number): CatRecord<number> {
  const r = valuation.replacement.z
  const kk = Math.max(0, Math.min(k, scale.rosterSize))
  return catRecord((c) => {
    let s = (scale.rosterSize - kk) * r[c]
    for (let j = 0; j < kk; j++) s += scale.roundMeans[j][c]
    return s
  })
}

export type CompareBasis = 'current' | 'perPlayer' | 'slotAdjusted'

export function teamCategoryScore(p: TeamProfile, basis: CompareBasis): CatRecord<number> {
  return basis === 'current' ? p.zSum : basis === 'perPlayer' ? p.zPer : p.zSlot
}

/** 1-based ranks (1 = best) of each team per category for a numeric matrix. Ties share the better rank. */
export function rankTeams(scores: readonly CatRecord<number>[]): CatRecord<number>[] {
  const ranks = scores.map(() => catRecord(() => 0))
  for (const c of CATEGORIES) {
    const vals = scores.map((s) => s[c])
    scores.forEach((s, i) => {
      ranks[i][c] = 1 + vals.filter((v) => v > s[c] + 1e-9).length
    })
  }
  return ranks
}

export type StageConfidence = 'low' | 'medium' | 'higher'

/** How much weight to put on a category standing given picks made so far. */
export function stageConfidence(picksMade: number, rosterSize: number): StageConfidence {
  if (picksMade < Math.max(3, Math.round(rosterSize * 0.3))) return 'low'
  if (picksMade < Math.round(rosterSize * 0.65)) return 'medium'
  return 'higher'
}

/** Plain-language label for a category standing. Used by My Build and League cards. */
export function categoryTier(slotScoreMinusTypical: number, sigma: number): 'strong' | 'solid' | 'neutral' | 'weak' | 'very weak' {
  const m = slotScoreMinusTypical / sigma
  if (m >= 0.6) return 'strong'
  if (m >= 0.2) return 'solid'
  if (m > -0.2) return 'neutral'
  if (m > -0.6) return 'weak'
  return 'very weak'
}

export function categoryList(): Category[] {
  return [...CATEGORIES]
}

/**
 * Expected value of the player taken at each overall pick if the draft went
 * in value order, smoothed over a ±window band. Used to fill a team's *unmade*
 * picks with a neutral, draft-position-fair expectation so teams with
 * different pick counts can be compared (it is not a forecast of who they
 * will actually take).
 */
export interface PickCurve {
  z: CatRecord<number>[]
  lines: StatLine[]
}

export function pickValueCurve(ctx: EngineContext, totalPicks: number, window = 6): PickCurve {
  const { valuation, basis } = ctx
  const order = basis === 'gpAware' ? valuation.orderGp : valuation.orderPerGame
  const z: CatRecord<number>[] = []
  const lines: StatLine[] = []
  for (let p = 1; p <= totalPicks; p++) {
    const lo = Math.max(0, p - 1 - window)
    const hi = Math.min(order.length, p + window)
    const ids = order.slice(lo, hi)
    z.push(catRecord((c) => mean(ids.map((id) => basisZ(valuation.values.get(id)!, basis)[c] ?? 0))))
    lines.push(
      averageLine(
        ids.map((id) => {
          const l = ctx.lines.get(id)!
          return effectiveLine(l.line, l.gp, basis, valuation)
        }),
      ),
    )
  }
  return { z, lines }
}

/** Category scores and raw totals with a team's remaining picks filled from the pick curve. */
export function pickAdjusted(
  profile: TeamProfile,
  ctx: EngineContext,
  remainingPicks: readonly number[],
  curve: PickCurve,
): { z: CatRecord<number>; total: number; totals: TeamTotals } {
  const fill = remainingPicks.slice(0, Math.max(0, profile.rosterSize - profile.count)).filter((p) => p >= 1 && p <= curve.z.length)
  const z = catRecord((c) => profile.zSum[c] + fill.reduce((s, p) => s + curve.z[p - 1][c], 0))
  const own = profile.playerIds.map((id) => {
    const l = ctx.lines.get(id)!
    return effectiveLine(l.line, l.gp, ctx.basis, ctx.valuation)
  })
  const totals = aggregateLines([...own, ...fill.map((p) => curve.lines[p - 1])])
  totals.fgMissing = profile.totals.fgMissing
  totals.ftMissing = profile.totals.ftMissing
  return { z, total: CATEGORIES.reduce((s, c) => s + z[c], 0), totals }
}
