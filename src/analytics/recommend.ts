import { CATEGORIES, CATEGORY_META, catLabel, catRecord, type CatRecord, type Category } from './categories'
import { buildWeights, type BuildLock, DEFAULT_SOFT_PUNT_WEIGHT } from './builds'
import { clamp } from './math'
import { ESPN_DEFAULT_SLOTS, fillLineup, type Position, type SlotDef } from './positions'
import { teamProfile, typicalAtStage, type EngineContext, type LeagueScale, type TeamProfile } from './team'
import { goneByPickUrgency, riskLabel, type RiskLabel } from './timing'
import { categoryScarcity, marginalEdges, type UtilityContext } from './utility'
import { basisRank, basisTotal, basisZ } from './valuation'

export type RecMode = 'adaptive' | 'bpa' | 'fit' | 'build'

export const REC_MODE_LABEL: Record<RecMode, string> = {
  adaptive: 'Adaptive',
  bpa: 'Best Player Available',
  fit: 'Team Fit',
  build: 'Optimize Selected Build',
}

export interface LaneWeights {
  q: number
  f: number
  t: number
}

/**
 * Blend weights for the "Best Draft Decision" lane. Quality always carries
 * the largest share outside of explicit Team Fit mode. Rounds follow the
 * product's soft prior: early quality/upside, later marginal contribution.
 * Stress-tested in tests/unit/recommend.test.ts.
 */
export function laneWeights(mode: RecMode, round: number, hasTiming: boolean): LaneWeights {
  let w: LaneWeights
  switch (mode) {
    case 'bpa':
      w = { q: 0.85, f: 0, t: 0.15 }
      break
    case 'fit':
      w = { q: 0.35, f: 0.55, t: 0.1 }
      break
    case 'build':
      w = { q: 0.45, f: 0.4, t: 0.15 }
      break
    default:
      w =
        round <= 3
          ? { q: 0.75, f: 0.1, t: 0.15 }
          : round <= 6
            ? { q: 0.55, f: 0.3, t: 0.15 }
            : round <= 10
              ? { q: 0.45, f: 0.35, t: 0.2 }
              : { q: 0.4, f: 0.4, t: 0.2 }
  }
  if (!hasTiming) {
    const s = w.q + w.f
    w = s > 0 ? { q: w.q / s, f: w.f / s, t: 0 } : { q: 1, f: 0, t: 0 }
  }
  return w
}

export interface TimingContext {
  /** Next overall pick to be made in the draft. */
  currentPick: number
  /** My next pick (≥ currentPick), or null when I have none left. */
  decisionPick: number | null
  /** My pick after the decision pick, or null. */
  followingPick: number | null
}

export interface RecommendInput {
  ctx: EngineContext
  scale: LeagueScale
  teams: number
  available: readonly string[]
  myRoster: readonly string[]
  /** Other teams' rosters (live draft). null → compare to a typical team at the same stage. */
  opponentRosters: readonly (readonly string[])[] | null
  adp: (id: string) => number | null
  timing: TimingContext | null
  mode: RecMode
  lock: BuildLock | null
  softWeight?: number
  /** Round of the decision pick (or roster size + 1 outside a live draft). */
  round: number
  /**
   * Position eligibility (all rostered ids, including unprojected players). When given,
   * a candidate who cannot fill any open starter slot is kept out of the Decision and
   * Fit lanes once the remaining picks are no more than the open starter slots.
   */
  positions?: (id: string) => readonly Position[]
  slots?: readonly SlotDef[]
}

export interface CandidateScore {
  id: string
  quality: number
  rank: number
  /** Value over replacement (total z − replacement total). */
  vorp: number
  q: number
  /** Weighted change in category edges from adding the player (utility units). */
  fit: number
  f: number
  /** Change in slot-adjusted category strength (z − replacement z). */
  catDelta: CatRecord<number>
  /** Weighted per-category edge change. */
  edgeDelta: CatRecord<number>
  /** Urgency that the player is gone by my following pick (heuristic). */
  urgency: number | null
  /** Urgency that the player is gone before my decision pick. */
  goneBefore: number | null
  riskBefore: RiskLabel | null
  t: number
  decision: number
  eligibleDecision: boolean
  eligibleFit: boolean
  missing: Category[]
  /** Open starter slots this player cannot fill while the lineup is tight (empty = no constraint). */
  positionBlocked: string[]
}

export interface RecommendResult {
  weights: LaneWeights
  catWeights: CatRecord<number>
  scarcity: CatRecord<number>
  my: TeamProfile
  myEdges: CatRecord<number>
  vorpRef: number
  floors: { decision: number; fit: number }
  scores: Map<string, CandidateScore>
  bestOverall: CandidateScore[]
  bestFit: CandidateScore[]
  bestDecision: CandidateScore[]
  /** Highest-fit players excluded by the quality floor (shown as context, not recommended). */
  floorExcluded: CandidateScore[]
  rosterFull: boolean
  /** Open position-specific starter slots, and whether every remaining pick must fill one. */
  lineup: { open: string[]; picksLeft: number; tight: boolean } | null
}

/** Quality-floor windows (z units). Specialists can reorder close values, not leapfrog tiers. */
export function qualityFloors(vorpRef: number): { decision: number; fit: number } {
  return {
    decision: vorpRef - Math.max(1.5, 0.35 * Math.abs(vorpRef)),
    fit: vorpRef - Math.max(2.0, 0.5 * Math.abs(vorpRef)),
  }
}

export function recommend(input: RecommendInput): RecommendResult {
  const { ctx, scale, timing } = input
  const { valuation, basis } = ctx
  const r = valuation.replacement
  const my = teamProfile(input.myRoster, ctx)
  const rosterFull = my.open === 0

  const opponents: CatRecord<number>[] =
    input.opponentRosters && input.opponentRosters.length
      ? input.opponentRosters.map((ros) => teamProfile(ros, ctx).zSlot)
      : [typicalAtStage(scale, valuation, my.count)]

  const scarcity = categoryScarcity(input.available, valuation, basis, Math.max(24, input.teams * 2)).multiplier
  const lockW = input.lock
    ? buildWeights(input.lock.punts, input.lock.mode, input.softWeight ?? DEFAULT_SOFT_PUNT_WEIGHT)
    : catRecord(() => 1)
  // In "build" mode without a lock, fit is plain team fit.
  const catWeights = catRecord((c) => lockW[c] * scarcity[c])
  const u: UtilityContext = { sigma: scale.sigma, opponents, weights: catWeights }
  const myEdges = marginalEdges(my.zSlot, catRecord(() => 0), u).before

  const hasTiming = !!timing && timing.decisionPick != null
  const weights = laneWeights(input.mode, input.round, hasTiming)

  // Lineup feasibility: once the picks left can only just cover the open position-specific
  // starter slots, a player who fills none of them would leave a starter slot permanently empty.
  let lineup: RecommendResult['lineup'] = null
  const posOf = input.positions
  const slots = input.slots ?? ESPN_DEFAULT_SLOTS
  const rosterPlayers = posOf ? input.myRoster.map((id) => ({ id, positions: posOf(id) })) : []
  const openNow = posOf ? fillLineup(rosterPlayers, slots).unfilledStarters : []
  if (posOf) {
    const picksLeft = Math.max(0, ctx.rosterSize - input.myRoster.length)
    lineup = { open: openNow.map((x) => x.label), picksLeft, tight: openNow.length > 0 && picksLeft <= openNow.length }
  }
  const blockedFor = (id: string): string[] => {
    if (!lineup?.tight || !posOf) return []
    const after = fillLineup([...rosterPlayers, { id, positions: posOf(id) }], slots).unfilledStarters
    return after.length < openNow.length ? [] : [...new Set(openNow.map((x) => x.label))]
  }

  const raw: CandidateScore[] = []
  for (const id of input.available) {
    const v = valuation.values.get(id)
    if (!v) continue
    const z = basisZ(v, basis)
    const quality = basisTotal(v, basis)
    const catDelta = catRecord((c) => (z[c] == null ? 0 : z[c]! - r.z[c]))
    const m = rosterFull ? null : marginalEdges(my.zSlot, catDelta, u)
    const adp = input.adp(id)
    let goneBefore: number | null = null
    let urgency: number | null = null
    if (timing && timing.decisionPick != null) {
      goneBefore = timing.decisionPick > timing.currentPick ? goneByPickUrgency(adp, timing.decisionPick) : 0
      urgency = timing.followingPick != null ? goneByPickUrgency(adp, timing.followingPick) : null
    }
    raw.push({
      id,
      quality,
      rank: basisRank(v, basis),
      vorp: quality - r.total,
      q: 0,
      fit: m ? m.total : 0,
      f: 0,
      catDelta,
      edgeDelta: m ? m.delta : catRecord(() => 0),
      urgency,
      goneBefore,
      riskBefore: goneBefore != null && goneBefore > 0 ? riskLabel(goneBefore) : null,
      t: urgency ?? 0.5,
      decision: 0,
      eligibleDecision: false,
      eligibleFit: false,
      missing: v.missing,
      positionBlocked: blockedFor(id),
    })
  }

  // Reference value: best player plausibly available at my decision pick.
  const plausible = raw.filter((s) => s.goneBefore == null || s.goneBefore < 0.7)
  const refPool = plausible.length ? plausible : raw
  const vorpRef = refPool.reduce((mx, s) => Math.max(mx, s.vorp), -Infinity)
  const floors = qualityFloors(vorpRef)
  const fitMax = refPool.reduce((mx, s) => Math.max(mx, s.fit), 0)
  const qDen = vorpRef > 0.25 ? vorpRef : 0
  const qualities = raw.map((s) => s.quality)
  const qMin = Math.min(...qualities)
  const qMax = Math.max(...qualities)

  for (const s of raw) {
    s.q = qDen > 0 ? clamp(s.vorp / qDen, -0.5, 1) : qMax > qMin ? (s.quality - qMin) / (qMax - qMin) : 0
    s.f = fitMax > 0 ? clamp(s.fit / fitMax, -0.5, 1) : 0
    s.eligibleDecision = s.vorp >= floors.decision && !s.positionBlocked.length
    s.eligibleFit = s.vorp >= floors.fit && !s.positionBlocked.length
    const base = weights.q * s.q + weights.f * s.f + weights.t * s.t
    // Discount players who probably won't reach my pick (only when I'm not on the clock).
    s.decision = base * (1 - 0.6 * (s.goneBefore ?? 0))
  }

  // A partial line (e.g. FG%/FT% without attempts) treats the unknown categories as average, so it
  // ranks after every complete line and cannot win the fit or decision lanes while complete players remain.
  const anyComplete = raw.some((s) => !s.missing.length)
  const usable = (s: CandidateScore) => !anyComplete || !s.missing.length
  const scores = new Map(raw.map((s) => [s.id, s]))
  const byQuality = [...raw].sort((a, b) => Number(usable(b)) - Number(usable(a)) || b.quality - a.quality)
  const bestFit = raw.filter((s) => s.eligibleFit && usable(s) && !rosterFull).sort((a, b) => b.fit - a.fit)
  const bestDecision = raw.filter((s) => s.eligibleDecision && usable(s)).sort((a, b) => b.decision - a.decision)
  const fitIds = new Set(bestFit.slice(0, 5).map((s) => s.id))
  const floorExcluded = raw
    .filter((s) => !s.eligibleFit && !s.positionBlocked.length && !fitIds.has(s.id) && s.fit > (bestFit[0]?.fit ?? Infinity))
    .sort((a, b) => b.fit - a.fit)
    .slice(0, 3)

  return {
    weights,
    catWeights,
    scarcity,
    my,
    myEdges,
    vorpRef,
    floors,
    scores,
    bestOverall: byQuality,
    bestFit,
    bestDecision,
    floorExcluded,
    rosterFull,
    lineup,
  }
}

// ───────────────────────── Explanations (deterministic) ─────────────────────────

export interface Reason {
  kind: 'quality' | 'strength' | 'cost' | 'fit' | 'timing' | 'data' | 'guardrail'
  tone: 'good' | 'bad' | 'neutral'
  text: string
}

function sgn(x: number, d = 1): string {
  return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d)
}

export interface ExplainContext {
  adp: number | null
  gp: number | null
  fullSeasonGames: number
  timing: TimingContext | null
  /** Plain stat context for percentage categories. */
  fga: number | null
  fta: number | null
}

export function explainCandidate(s: CandidateScore, res: RecommendResult, ec: ExplainContext): Reason[] {
  const out: Reason[] = []
  out.push({
    kind: 'quality',
    tone: s.vorp > 0 ? 'good' : 'neutral',
    text: `9-cat value ${sgn(s.quality)} (rank #${s.rank}); ${sgn(s.vorp)} over replacement.`,
  })
  const z = CATEGORIES.map((c) => ({ c, d: s.catDelta[c] }))
  const strengths = [...z].sort((a, b) => b.d - a.d).filter((x) => x.d >= 0.75).slice(0, 3)
  if (strengths.length)
    out.push({
      kind: 'strength',
      tone: 'good',
      text: `Adds ${strengths.map((x) => `${catLabel(x.c)} ${sgn(x.d)}`).join(', ')} vs. a replacement player.`,
    })
  const costs = [...z].sort((a, b) => a.d - b.d).filter((x) => x.d <= -0.75).slice(0, 2)
  if (costs.length)
    out.push({
      kind: 'cost',
      tone: 'bad',
      text: `Costs ${costs
        .map((x) => {
          const vol =
            x.c === 'FG' && ec.fga != null ? ` on ${ec.fga.toFixed(1)} FGA` : x.c === 'FT' && ec.fta != null ? ` on ${ec.fta.toFixed(1)} FTA` : ''
          return `${catLabel(x.c)} ${sgn(x.d)}${vol}`
        })
        .join(', ')}.`,
    })
  if (!res.rosterFull) {
    const edgeGains = CATEGORIES.map((c) => ({ c, d: s.edgeDelta[c] }))
      .filter((x) => x.d > 0.004)
      .sort((a, b) => b.d - a.d)
      .slice(0, 3)
    const contested = edgeGains.filter((x) => res.myEdges[x.c] > 0.25 && res.myEdges[x.c] < 0.75)
    const allContested = CATEGORIES.every((c) => res.myEdges[c] > 0.25 && res.myEdges[c] < 0.75)
    if (edgeGains.length) {
      const allGainsContested = contested.length === edgeGains.length
      out.push({
        kind: 'fit',
        tone: 'good',
        text: `Biggest roster gains: ${edgeGains.map((x) => catLabel(x.c)).join(', ')}${
          allContested ? '' : allGainsContested ? ' — all still contested' : contested.length ? ` (${contested.map((x) => catLabel(x.c)).join(', ')} still contested)` : ''
        }.`,
      })
    }
    const saturated = strengths.filter((x) => res.myEdges[x.c] >= 0.85)
    if (saturated.length)
      out.push({
        kind: 'fit',
        tone: 'neutral',
        text: `${saturated.map((x) => catLabel(x.c)).join(', ')} already strong for you — diminishing returns.`,
      })
    const punted = CATEGORIES.filter((c) => res.catWeights[c] === 0 && s.catDelta[c] > 0.75)
    if (punted.length)
      out.push({ kind: 'fit', tone: 'neutral', text: `Strength in punted ${punted.map(catLabel).join(', ')} is not counted for fit.` })
  }
  if (ec.timing && ec.adp != null) {
    if (s.goneBefore != null && s.goneBefore >= 0.4 && ec.timing.decisionPick != null && ec.timing.decisionPick > ec.timing.currentPick)
      out.push({
        kind: 'timing',
        tone: 'bad',
        text: `ADP ${ec.adp.toFixed(1)} — may be gone before your pick #${ec.timing.decisionPick} (rough ADP heuristic).`,
      })
    else if (s.urgency != null && ec.timing.followingPick != null) {
      const l = riskLabel(s.urgency)
      out.push({
        kind: 'timing',
        tone: l === 'likely-gone' ? 'good' : 'neutral',
        text:
          l === 'likely-gone'
            ? `ADP ${ec.adp.toFixed(1)} — unlikely to last to your following pick #${ec.timing.followingPick} (heuristic).`
            : l === 'at-risk'
              ? `ADP ${ec.adp.toFixed(1)} — might last to pick #${ec.timing.followingPick} (heuristic).`
              : `ADP ${ec.adp.toFixed(1)} — often still there at pick #${ec.timing.followingPick}; you may be able to wait (heuristic).`,
      })
    }
  } else if (ec.timing && ec.adp == null) {
    out.push({ kind: 'timing', tone: 'neutral', text: 'No ADP in dataset — timing not assessed.' })
  }
  if (s.missing.length)
    out.push({
      kind: 'data',
      tone: 'bad',
      text: `Missing ${s.missing.map((c) => (CATEGORY_META[c].kind === 'pct' ? `${catLabel(c)} volume` : catLabel(c))).join(', ')} — that category is treated as unknown, not zero.`,
    })
  if (ec.gp != null && ec.gp < ec.fullSeasonGames * 0.8)
    out.push({ kind: 'data', tone: 'bad', text: `Projected for ${Math.round(ec.gp)} games — availability risk.` })
  if (s.positionBlocked.length)
    out.push({
      kind: 'guardrail',
      tone: 'bad',
      text: `Can't fill an open starter slot (${s.positionBlocked.join(', ')}) and you have only ${res.lineup?.picksLeft ?? 0} pick${res.lineup?.picksLeft === 1 ? '' : 's'} left — your lineup would be short.`,
    })
  else if (!s.eligibleDecision)
    out.push({
      kind: 'guardrail',
      tone: 'bad',
      text: `Below the current quality floor (value over replacement < ${res.floors.decision.toFixed(1)}); not recommended as a draft decision yet.`,
    })
  return out
}

/**
 * Deterministic comparison of the recommended pick vs. a higher-fit alternative,
 * e.g. "A offers +3.1 more 9-cat value; B adds more REB, but that gain is
 * replaceable: 9 players in the next ~2 rounds add ≥ +1.0 REB."
 */
export function compareForFit(
  pick: CandidateScore,
  alt: CandidateScore,
  res: RecommendResult,
  names: (id: string) => string,
): string | null {
  if (pick.id === alt.id) return null
  const dq = pick.quality - alt.quality
  const altEdge = CATEGORIES.map((c) => ({ c, d: alt.catDelta[c] - pick.catDelta[c] }))
    .filter((x) => x.d > 0.5)
    .sort((a, b) => b.d - a.d)
    .slice(0, 2)
  if (dq <= 0.25 || altEdge.length === 0) return null
  const cats = altEdge.map((x) => catLabel(x.c))
  const supply = altEdge.map((x) => {
    let n = 0
    for (const s of res.bestOverall.slice(0, 36)) if (s.id !== alt.id && s.catDelta[x.c] >= 1) n++
    return n
  })
  const replaceable = supply.every((n) => n >= 4)
  const pickAhead = CATEGORIES.filter((c) => pick.catDelta[c] > 0.25).length
  return `${names(pick.id)} offers ${sgn(dq)} more 9-cat value than ${names(alt.id)}. ${names(alt.id)} would add more ${cats.join(' and ')}${
    replaceable
      ? `, but that gain is comparatively replaceable (${supply.join('/')} similar sources among the top 36 available)`
      : `, and those sources are thin on the board — worth weighing`
  }; ${names(pick.id)} helps in ${pickAhead} categories.`
}
