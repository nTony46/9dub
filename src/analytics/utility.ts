import { CATEGORIES, catRecord, type CatRecord } from './categories'
import { clamp, normalCdf } from './math'
import type { ValuationBasis, ValuationResult } from './types'
import { basisTotal, basisZ } from './valuation'

/**
 * Category-edge utility: for each category, how a team's slot-adjusted strength
 * compares with its opponents', passed through a smooth saturating curve:
 *
 *   edge_c = mean_over_opponents Φ((s_c − o_c) / σ_c)
 *   U      = Σ_c w_c · edge_c
 *
 * Φ gives diminishing returns (a category already far ahead gains little from
 * more), and steepest gains where the league is competitive. The output is a
 * *construction index* in "category edges", not a calibrated win probability.
 */
export interface UtilityContext {
  sigma: CatRecord<number>
  opponents: readonly CatRecord<number>[]
  weights: CatRecord<number>
}

export function categoryEdges(s: CatRecord<number>, u: UtilityContext): CatRecord<number> {
  return catRecord((c) => {
    if (u.opponents.length === 0) return 0.5
    let e = 0
    for (const o of u.opponents) e += normalCdf((s[c] - o[c]) / u.sigma[c])
    return e / u.opponents.length
  })
}

export function utility(s: CatRecord<number>, u: UtilityContext): number {
  const e = categoryEdges(s, u)
  let t = 0
  for (const c of CATEGORIES) t += u.weights[c] * e[c]
  return t
}

/** Per-category utility change from adding a z vector into one open (replacement) slot. */
export function marginalEdges(
  s: CatRecord<number>,
  add: CatRecord<number>,
  u: UtilityContext,
): { before: CatRecord<number>; after: CatRecord<number>; delta: CatRecord<number>; total: number } {
  const after = catRecord((c) => s[c] + add[c])
  const eb = categoryEdges(s, u)
  const ea = categoryEdges(after, u)
  const delta = catRecord((c) => u.weights[c] * (ea[c] - eb[c]))
  let total = 0
  for (const c of CATEGORIES) total += delta[c]
  return { before: eb, after: ea, delta, total }
}

/**
 * Category scarcity among the best remaining players. Supply is the sum of
 * positive z in each category across the top `horizon` available players.
 * Scarce categories (assists/steals often) get a multiplier > 1, plentiful
 * ones < 1; bounded to [0.8, 1.25] so scarcity nudges rather than dominates.
 */
export function categoryScarcity(
  availableIds: readonly string[],
  valuation: ValuationResult,
  basis: ValuationBasis,
  horizon: number,
): { multiplier: CatRecord<number>; supply: CatRecord<number> } {
  const top = [...availableIds]
    .filter((id) => valuation.values.has(id))
    .sort((a, b) => basisTotal(valuation.values.get(b)!, basis) - basisTotal(valuation.values.get(a)!, basis))
    .slice(0, Math.max(1, horizon))
  const supply = catRecord((c) => {
    let s = 0
    for (const id of top) s += Math.max(0, basisZ(valuation.values.get(id)!, basis)[c] ?? 0)
    return s
  })
  const avg = CATEGORIES.reduce((a, c) => a + supply[c], 0) / CATEGORIES.length
  const multiplier = catRecord((c) => clamp(Math.sqrt(avg / Math.max(supply[c], 0.1)), 0.8, 1.25))
  return { multiplier, supply }
}
