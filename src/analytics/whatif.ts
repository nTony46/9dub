import { CATEGORIES, catRecord, type CatRecord } from './categories'
import { teamProfile, type EngineContext, type TeamProfile } from './team'
import { categoryEdges, type UtilityContext } from './utility'

export interface WhatIfResult {
  before: TeamProfile
  after: TeamProfile
  /** Change in slot-adjusted category strength (z). */
  deltaZ: CatRecord<number>
  edgesBefore: CatRecord<number>
  edgesAfter: CatRecord<number>
  /** League rank (1 = best) of slot-adjusted strength among me + opponents. */
  rankBefore: CatRecord<number>
  rankAfter: CatRecord<number>
}

function rankAmong(mine: CatRecord<number>, opps: readonly CatRecord<number>[]): CatRecord<number> {
  return catRecord((c) => 1 + opps.filter((o) => o[c] > mine[c] + 1e-9).length)
}

/** "What if I take X (and Y)?" — before/after deltas without touching the draft. */
export function whatIf(ctx: EngineContext, roster: readonly string[], add: readonly string[], u: UtilityContext): WhatIfResult {
  const before = teamProfile(roster, ctx)
  const after = teamProfile([...roster, ...add.filter((id) => !roster.includes(id))], ctx)
  const deltaZ = catRecord((c) => after.zSlot[c] - before.zSlot[c])
  return {
    before,
    after,
    deltaZ,
    edgesBefore: categoryEdges(before.zSlot, u),
    edgesAfter: categoryEdges(after.zSlot, u),
    rankBefore: rankAmong(before.zSlot, u.opponents),
    rankAfter: rankAmong(after.zSlot, u.opponents),
  }
}

export function sumEdges(e: CatRecord<number>, weights?: CatRecord<number>): number {
  return CATEGORIES.reduce((s, c) => s + (weights ? weights[c] : 1) * e[c], 0)
}
