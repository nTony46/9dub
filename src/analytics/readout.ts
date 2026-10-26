import { CATEGORIES, catLabel, type CatRecord, type Category } from './categories'
import type { BuildEvaluation } from './builds'

export type CategoryStanding = 'strength' | 'solid' | 'neutral' | 'recoverable' | 'punt-candidate'

export interface CategoryReadout {
  margin: CatRecord<number>
  standing: CatRecord<CategoryStanding>
  strengths: Category[]
  recoverable: Category[]
  puntCandidates: Category[]
  /** Short, deterministic label for the roster's current shape. */
  label: string
}

/**
 * Classify each category by its slot-adjusted margin vs. a benchmark
 * (league opponents' mean or a typical team at the same stage), in σ units.
 *
 * A weak category is only a *punt candidate* when the roster is meaningful
 * (≥ 4 picks), the gap is large (≤ −0.6σ) and either
 *   • a viable build among the top three punts it (single or double), or
 *   • the deficit is deep (≤ −1.5σ) with most of the roster already drafted —
 *     the category has effectively been sacrificed by construction.
 * Otherwise it is "weak but recoverable". Nothing here locks a build.
 */
export function categoryReadout(
  mine: CatRecord<number>,
  benchmark: CatRecord<number>,
  sigma: CatRecord<number>,
  picks: number,
  builds?: readonly BuildEvaluation[],
  /** The roster is final (draft over): labels drop draft-time hedges like "so far". */
  settled = false,
): CategoryReadout {
  const margin = {} as CatRecord<number>
  const standing = {} as CatRecord<CategoryStanding>
  const topPunts = new Set<string>()
  builds
    ?.slice(0, 3)
    .filter((b) => b.build.punts.length && (b.viability === 'strong' || b.viability === 'viable'))
    .forEach((b) => b.build.punts.forEach((c) => topPunts.add(c)))
  const rosterSize = builds?.[0] ? Math.max(picks, picks + (builds[0].sim.picks.length ?? 0)) : null
  const lateDraft = rosterSize != null ? picks >= 0.6 * rosterSize : picks >= 8
  for (const c of CATEGORIES) {
    const m = (mine[c] - benchmark[c]) / sigma[c]
    margin[c] = m
    let s: CategoryStanding
    if (m >= 0.6) s = 'strength'
    else if (m >= 0.2) s = 'solid'
    else if (m > -0.2) s = 'neutral'
    else if (m <= -0.6 && picks >= 4 && ((builds ? topPunts.has(c) : m <= -0.9) || (m <= -1.5 && lateDraft))) s = 'punt-candidate'
    else s = 'recoverable'
    standing[c] = s
  }
  const by = (s: CategoryStanding) => CATEGORIES.filter((c) => standing[c] === s).sort((a, b) => margin[b] - margin[a])
  const strengths = [...by('strength'), ...by('solid')]
  const recoverable = by('recoverable').reverse()
  const puntCandidates = by('punt-candidate').reverse()
  let label: string
  if (picks < 3) label = 'Too early to call'
  else if (puntCandidates.length) label = `Punt-leaning ${puntCandidates.slice(0, 2).map(catLabel).join(' + ')}`
  else {
    const bigs = (['FG', 'REB', 'BLK'] as Category[]).reduce((s, c) => s + margin[c], 0)
    const guards = (['FT', '3PM', 'AST', 'STL'] as Category[]).reduce((s, c) => s + margin[c], 0) * 0.75
    label = bigs - guards > 1.2 ? 'Big-man lean' : guards - bigs > 1.2 ? 'Guard/wing lean' : settled ? 'Balanced' : 'Balanced so far'
  }
  return { margin, standing, strengths, recoverable, puntCandidates, label }
}

export const STANDING_TEXT: Record<CategoryStanding, string> = {
  strength: 'Strength',
  solid: 'Solid',
  neutral: 'Neutral',
  recoverable: 'Weak · recoverable',
  'punt-candidate': 'Punt candidate',
}
