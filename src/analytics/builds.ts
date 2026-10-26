import { CATEGORIES, catLabel, catRecord, type CatRecord, type Category } from './categories'
import { normalCdf, pearson } from './math'
import { stageConfidence, teamProfile, typicalAtStage, type EngineContext, type LeagueScale, type StageConfidence } from './team'
import type { ValuationBasis, ValuationResult } from './types'
import { basisTotal, basisZ, weightedTotal } from './valuation'

export type PuntMode = 'soft' | 'hard'

export interface BuildDef {
  id: string
  punts: Category[]
  kind: 'balanced' | 'single' | 'double'
  label: string
  /** Why this candidate was generated (for doubles: correlation / roster). */
  origin?: string
}

export interface BuildLock {
  punts: Category[]
  mode: PuntMode
}

export const DEFAULT_SOFT_PUNT_WEIGHT = 0.35

export function sortCats(cats: readonly Category[]): Category[] {
  return [...cats].sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b))
}

export function buildId(punts: readonly Category[]): string {
  return punts.length === 0 ? 'balanced' : `punt-${sortCats(punts).join('-')}`
}

export function buildLabel(punts: readonly Category[]): string {
  return punts.length === 0 ? 'Balanced' : `Punt ${sortCats(punts).map(catLabel).join(' + ')}`
}

export function makeBuild(punts: readonly Category[], origin?: string): BuildDef {
  const p = sortCats(punts)
  return {
    id: buildId(p),
    punts: p,
    kind: p.length === 0 ? 'balanced' : p.length === 1 ? 'single' : 'double',
    label: buildLabel(p),
    origin,
  }
}

/** Category weights for a build. Hard punt → 0; soft punt → `softWeight`. */
export function buildWeights(
  punts: readonly Category[],
  mode: PuntMode = 'hard',
  softWeight = DEFAULT_SOFT_PUNT_WEIGHT,
): CatRecord<number> {
  return catRecord((c) => (punts.includes(c) ? (mode === 'hard' ? 0 : softWeight) : 1))
}

export interface CategoryPair {
  a: Category
  b: Category
  r: number
}

/** Pearson correlations of category z-scores across the frozen reference pool. */
export function categoryCorrelations(valuation: ValuationResult, basis: ValuationBasis): CategoryPair[] {
  const pool = valuation.params.poolIds
    .map((id) => valuation.values.get(id)!)
    .filter((v) => v.coveredCats === 9)
  const col = (c: Category) => pool.map((v) => basisZ(v, basis)[c]!)
  const out: CategoryPair[] = []
  for (let i = 0; i < CATEGORIES.length; i++)
    for (let j = i + 1; j < CATEGORIES.length; j++) {
      const a = CATEGORIES[i]
      const b = CATEGORIES[j]
      out.push({ a, b, r: pearson(col(a), col(b)) })
    }
  return out.sort((x, y) => y.r - x.r)
}

/**
 * Candidate builds: balanced, all nine single punts, and only *sensible*
 * double punts — pairs whose z-scores are positively correlated in the
 * reference pool (players weak in one tend to be weak in the other, so
 * sacrificing both concentrates value), plus the user's two weakest
 * categories once the roster is meaningful. No triple punts in V1.
 */
export function candidateBuilds(
  pairs: readonly CategoryPair[],
  opts: { minCorrelation?: number; maxDoubles?: number; rosterWeakest?: readonly Category[] } = {},
): BuildDef[] {
  const minR = opts.minCorrelation ?? 0.15
  const maxD = opts.maxDoubles ?? 8
  const builds: BuildDef[] = [makeBuild([])]
  for (const c of CATEGORIES) builds.push(makeBuild([c]))
  const seen = new Set<string>()
  for (const p of pairs) {
    if (p.r < minR || seen.size >= maxD) break
    const b = makeBuild([p.a, p.b], `correlated in reference pool (r = ${p.r.toFixed(2)})`)
    seen.add(b.id)
    builds.push(b)
  }
  if (opts.rosterWeakest && opts.rosterWeakest.length >= 2) {
    const b = makeBuild(opts.rosterWeakest.slice(0, 2), 'your two weakest categories so far')
    if (!seen.has(b.id)) builds.push(b)
  }
  return builds
}

export interface BuildSimInput {
  ctx: EngineContext
  scale: LeagueScale
  myRoster: readonly string[]
  available: readonly string[]
  /** Available ids in expected draft order (ADP, falling back to value rank). */
  adpOrder: readonly string[]
  /** My remaining overall picks, ascending, starting at my next decision pick. */
  myFuturePicks: readonly number[]
  /** Next overall pick to be made in the draft. */
  currentPick: number
}

export interface BuildSim {
  picks: string[]
  /** Top candidates for this build at my next pick (after expected opponent picks). */
  nextTargets: string[]
  end: CatRecord<number>
}

/** Candidates examined per simulated pick (top by weighted value); keeps the sim cheap. */
const SIM_CANDIDATES = 150

/**
 * Deterministic "draft toward this build" simulation: opponents take players
 * in expected-draft (ADP) order; at each of my picks I take the player with
 * the largest gain in weighted category edges against a typical finished team
 * (policy 'utility' — diminishing returns keep the build balanced across its
 * winnable categories), or simply the highest raw value (policy 'value', used
 * as the best-player-available baseline for opportunity cost).
 * Transparent and cheap; it is not a forecast of other managers.
 */
export function simulateBuild(
  input: BuildSimInput,
  weights: CatRecord<number>,
  policy: 'utility' | 'value' = 'utility',
): BuildSim {
  const { ctx, myRoster, scale } = input
  const { valuation, basis, rosterSize } = ctx
  const r = valuation.replacement.z
  const zOf = (id: string) => basisZ(valuation.values.get(id)!, basis)
  const order = [...input.available]
    .filter((id) => valuation.values.has(id))
    .sort((a, b) =>
      policy === 'value'
        ? basisTotal(valuation.values.get(b)!, basis) - basisTotal(valuation.values.get(a)!, basis)
        : weightedTotal(zOf(b), weights) - weightedTotal(zOf(a), weights),
    )
  const gone = new Set<string>()
  const queue = input.adpOrder.filter((id) => valuation.values.has(id))
  let qi = 0
  let cursor = input.currentPick
  const open = Math.max(0, rosterSize - myRoster.length)
  const picks: string[] = []
  let nextTargets: string[] = []
  const prof = teamProfile(myRoster, ctx)
  // Slot-adjusted state: rostered players + open slots at replacement level.
  const state = catRecord((c) => prof.zSlot[c])

  let k = prof.count
  // Gains are measured against a typical team at the *same* stage (k + 1 picks).
  const gainOf = (id: string, target: CatRecord<number>): number => {
    const z = zOf(id)
    let g = 0
    for (const c of CATEGORIES) {
      if (weights[c] === 0) continue
      const d = (z[c] ?? r[c]) - r[c]
      const sg = scale.sigma[c]
      g += weights[c] * (normalCdf((state[c] + d - target[c]) / sg) - normalCdf((state[c] - target[c]) / sg))
    }
    return g
  }

  for (const p of input.myFuturePicks.slice(0, open)) {
    let others = Math.max(0, p - cursor)
    while (others > 0 && qi < queue.length) {
      const id = queue[qi++]
      if (!gone.has(id)) {
        gone.add(id)
        others--
      }
    }
    const remaining: string[] = []
    for (const id of order) {
      if (!gone.has(id)) remaining.push(id)
      if (remaining.length >= SIM_CANDIDATES) break
    }
    if (!remaining.length) break
    let ranked = remaining
    if (policy === 'utility') {
      const target = typicalAtStage(scale, valuation, k + 1)
      const g = new Map(remaining.map((id) => [id, gainOf(id, target)]))
      ranked = [...remaining].sort((a, b) => g.get(b)! - g.get(a)!)
    }
    if (picks.length === 0) nextTargets = ranked.slice(0, 3)
    const best = ranked[0]
    gone.add(best)
    picks.push(best)
    const z = zOf(best)
    for (const c of CATEGORIES) state[c] += (z[c] ?? r[c]) - r[c]
    k++
    cursor = p + 1
  }

  return { picks, nextTargets, end: state }
}

export type BuildViability = 'strong' | 'viable' | 'fragile' | 'unlikely'

export interface BuildEvaluation {
  build: BuildDef
  weights: CatRecord<number>
  sim: BuildSim
  /** (end − typical full team) / σ per category. */
  margins: CatRecord<number>
  /** Σ Φ(margin) over all nine — "category edges" vs a typical finished team. */
  expectedCats: number
  catsAhead: Category[]
  /** Raw (unweighted) value given up vs. drafting best-available. ≥ 0 means a cost. */
  opportunityCost: number
  /** Value already invested in the punted categories (wasted if you punt). */
  wasted: number
  /** Existing deficit in the punted categories (a punt "uses" it). */
  aligned: number
  needs: Category[]
  viability: BuildViability
  confidence: StageConfidence
  /** Expected-cats difference vs the balanced build. */
  vsBalanced: number
  rationale: string[]
}

/**
 * Viability is judged *relative to the balanced build*, because the absolute
 * edge count inherits optimism from the simulation's opponent model. A build
 * that cannot stay ahead in at least five categories is never better than
 * "unlikely", whatever its relative score.
 */
export function viabilityLabel(expectedCats: number, vsBalanced: number, catsAhead: number): BuildViability {
  if (catsAhead < 5 || expectedCats < 4.6) return 'unlikely'
  if (vsBalanced >= 0.2) return 'strong'
  if (vsBalanced >= -0.25) return 'viable'
  return 'fragile'
}

export function evaluateBuilds(input: BuildSimInput, builds: readonly BuildDef[]): BuildEvaluation[] {
  const { ctx, scale } = input
  const { valuation, basis } = ctx
  const prof = teamProfile(input.myRoster, ctx)
  const confidence = stageConfidence(prof.count, ctx.rosterSize)
  const rawOf = (id: string) => basisTotal(valuation.values.get(id)!, basis)

  const bpaSim = simulateBuild(input, buildWeights([]), 'value')
  const bpaRaw = bpaSim.picks.reduce((s, id) => s + rawOf(id), 0)

  const evals = builds.map((build) => {
    const weights = buildWeights(build.punts, 'hard')
    const sim = simulateBuild(input, weights, 'utility')
    const margins = catRecord((c) => (sim.end[c] - scale.typicalFull[c]) / scale.sigma[c])
    const expectedCats = CATEGORIES.reduce((s, c) => s + normalCdf(margins[c]), 0)
    const catsAhead = CATEGORIES.filter((c) => margins[c] > 0)
    const opportunityCost = bpaRaw - sim.picks.reduce((s, id) => s + rawOf(id), 0)
    let wasted = 0
    let aligned = 0
    for (const c of build.punts) {
      wasted += Math.max(0, prof.zSum[c])
      aligned += Math.max(0, -prof.zSum[c])
    }
    // Relative thin spots: the weakest winnable categories at the end of the sim.
    const needs = CATEGORIES.filter((c) => !build.punts.includes(c))
      .sort((a, b) => margins[a] - margins[b])
      .slice(0, 2)
    return {
      build,
      weights,
      sim,
      margins,
      expectedCats,
      catsAhead,
      opportunityCost,
      wasted,
      aligned,
      needs,
      viability: 'viable' as BuildViability,
      confidence,
      vsBalanced: 0,
      rationale: [] as string[],
    }
  })

  const balancedExp = evals.find((e) => e.build.punts.length === 0)?.expectedCats ?? 0
  for (const e of evals) {
    e.vsBalanced = e.expectedCats - balancedExp
    e.viability = viabilityLabel(e.expectedCats, e.vsBalanced, e.catsAhead.length)
    // Punting a category you already dominate gains nothing and throws value away.
    if (e.wasted > 1.5 && (e.viability === 'strong' || e.viability === 'viable')) e.viability = 'fragile'
    e.rationale = buildRationale(e, prof.count)
  }
  // Viability tier first (a build that throws away drafted value never outranks a
  // clean one), then projected edges; near-ties are broken by roster compatibility.
  const tier: Record<BuildViability, number> = { strong: 0, viable: 1, fragile: 2, unlikely: 3 }
  const key = (e: BuildEvaluation) => Math.round(e.expectedCats * 20) / 20
  return evals.sort((a, b) => tier[a.viability] - tier[b.viability] || key(b) - key(a) || b.aligned - b.wasted - (a.aligned - a.wasted))
}

function fmt(x: number): string {
  return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1)
}

function buildRationale(e: BuildEvaluation, picksMade: number): string[] {
  const out: string[] = []
  const ahead = e.catsAhead.map(catLabel)
  out.push(
    `Ahead of a typical finished team in ${ahead.length} of 9 categories${ahead.length ? ` (${ahead.join(', ')})` : ''} if you draft toward it.`,
  )
  if (e.build.punts.length) {
    if (e.wasted > 0.4)
      out.push(`Abandons ${fmt(e.wasted)} z already drafted in ${e.build.punts.map(catLabel).join('/')}.`)
    else if (e.aligned > 0.4)
      out.push(`Your roster already trails in ${e.build.punts.map(catLabel).join('/')} (${fmt(-e.aligned)} z), so little is lost.`)
    else if (picksMade > 0) out.push(`You have little invested in ${e.build.punts.map(catLabel).join('/')} either way.`)
  }
  if (e.opportunityCost > 0.75)
    out.push(`Costs about ${e.opportunityCost.toFixed(1)} total z of raw value vs. best-available drafting.`)
  else if (e.build.punts.length) out.push('Little raw value lost vs. best-available drafting.')
  if (e.build.punts.length && Math.abs(e.vsBalanced) >= 0.05)
    out.push(`${e.vsBalanced > 0 ? 'More' : 'Fewer'} projected category edges than staying balanced (${fmt(e.vsBalanced)}).`)
  if (e.needs.length) out.push(`Relative thin spots: ${e.needs.map(catLabel).join(', ')}.`)
  if (e.confidence === 'low') out.push('Exploratory: too few picks to judge this build with confidence.')
  return out
}
