import { describe, expect, it } from 'vitest'
import { compareForFit, explainCandidate, laneWeights, recommend, type RecommendInput } from '@/analytics/recommend'
import { CATEGORIES } from '@/analytics/categories'
import { GLASS_SPECIALIST, MURPHY_LIKE, demoEngine, line, player } from '../fixtures/engine'

/**
 * Simulate a value-ordered draft: my roster = `mine`, every other team takes
 * the best remaining players in snake order until `picksEach` each.
 */
function draftState(env: ReturnType<typeof demoEngine>, mine: string[], picksEach: number, reserved: string[]) {
  const taken = new Set([...mine, ...reserved])
  const others: string[][] = Array.from({ length: env.teams - 1 }, () => [])
  const pool = env.valuation.orderPerGame.filter((id) => !taken.has(id))
  let i = 0
  for (let r = 0; r < picksEach; r++) for (const team of others) team.push(pool[i++])
  const used = new Set(others.flat())
  const available = env.valuation.orderPerGame.filter((id) => !used.has(id) && !mine.includes(id))
  return { others, available }
}

describe('bench-specialist trap', () => {
  const env = demoEngine([MURPHY_LIKE, GLASS_SPECIALIST])
  const v = env.valuation.values
  // A guard-heavy roster after six rounds: weak in REB/BLK/FG.
  const guards = env.valuation.orderPerGame.filter((id) => /guard/.test(env.archetype.get(id) ?? '')).slice(2, 8)
  const { others, available } = draftState(env, guards, 6, [MURPHY_LIKE.id, GLASS_SPECIALIST.id])

  const input: RecommendInput = {
    ctx: env.ctx,
    scale: env.scale,
    teams: env.teams,
    available,
    myRoster: guards,
    opponentRosters: others,
    adp: () => null,
    timing: null,
    mode: 'adaptive',
    lock: null,
    round: 7,
  }
  const res = recommend(input)
  const murphy = res.scores.get(MURPHY_LIKE.id)!
  const spec = res.scores.get(GLASS_SPECIALIST.id)!

  it('fixture sanity: the specialist is the bigger rebound patch, the wing the better player', () => {
    expect(spec.catDelta.REB).toBeGreaterThan(murphy.catDelta.REB + 1)
    expect(v.get(MURPHY_LIKE.id)!.total).toBeGreaterThan(v.get(GLASS_SPECIALIST.id)!.total + 3)
  })

  it('ranks the high-value wing above the specialist for the draft decision', () => {
    expect(murphy.decision).toBeGreaterThan(spec.decision)
    const idx = (id: string) => res.bestDecision.findIndex((s) => s.id === id)
    expect(idx(MURPHY_LIKE.id)).toBeGreaterThanOrEqual(0)
    expect(idx(MURPHY_LIKE.id)).toBeLessThan(5)
    // The specialist is not recommended as a decision at all (quality floor).
    expect(spec.eligibleDecision).toBe(false)
  })

  it('does not let Team Fit mode promote the specialist above the wing either', () => {
    const fit = recommend({ ...input, mode: 'fit' })
    expect(fit.scores.get(MURPHY_LIKE.id)!.decision).toBeGreaterThan(fit.scores.get(GLASS_SPECIALIST.id)!.decision)
  })

  it('explains the choice deterministically', () => {
    const names = (id: string) => (id === MURPHY_LIKE.id ? 'Wing' : id === GLASS_SPECIALIST.id ? 'Specialist' : id)
    const text = compareForFit(murphy, spec, res, names)
    expect(text).toMatch(/Wing offers \+\d/)
    expect(text).toMatch(/REB/)
    const reasons = explainCandidate(spec, res, { adp: null, gp: 70, fullSeasonGames: 82, timing: null, fga: 5.6, fta: 2.1 })
    expect(reasons.some((r) => r.kind === 'guardrail')).toBe(true)
  })
})

describe('fit reorders closely valued players', () => {
  // Two wings of near-identical value: one rebounds, one passes.
  const board = player('fx-board-wing', line({ pts: 17, tpm: 2.2, reb: 8.6, ast: 2.4, stl: 1.1, blk: 0.6, tov: 1.5, fg: [6.4, 13.4], ft: [2.4, 2.9] }), 74)
  const dish = player('fx-dish-wing', line({ pts: 17, tpm: 2.2, reb: 4.6, ast: 5.7, stl: 1.1, blk: 0.6, tov: 1.5, fg: [6.4, 13.4], ft: [2.4, 2.9] }), 74)
  const env = demoEngine([board, dish])
  const v = env.valuation.values
  const guards = env.valuation.orderPerGame.filter((id) => /lead-guard|scoring-guard/.test(env.archetype.get(id) ?? '')).slice(0, 6)
  const { others, available } = draftState(env, guards, 6, [board.id, dish.id])
  const res = recommend({
    ctx: env.ctx, scale: env.scale, teams: env.teams, available, myRoster: guards, opponentRosters: others,
    adp: () => null, timing: null, mode: 'adaptive', lock: null, round: 7,
  })

  it('fixture sanity: values within half a z', () => {
    expect(Math.abs(v.get(board.id)!.total - v.get(dish.id)!.total)).toBeLessThan(0.5)
  })

  it('prefers the player who fills the weak category', () => {
    expect(res.scores.get(board.id)!.fit).toBeGreaterThan(res.scores.get(dish.id)!.fit)
    expect(res.scores.get(board.id)!.decision).toBeGreaterThan(res.scores.get(dish.id)!.decision)
  })
})

describe('early rounds are quality-dominated', () => {
  const env = demoEngine()
  const res = recommend({
    ctx: env.ctx, scale: env.scale, teams: env.teams, available: env.valuation.orderPerGame, myRoster: [],
    opponentRosters: Array.from({ length: 11 }, () => []), adp: () => null, timing: null, mode: 'adaptive', lock: null, round: 1,
  })
  it('top decision is one of the three most valuable players', () => {
    expect(env.valuation.orderPerGame.slice(0, 3)).toContain(res.bestDecision[0].id)
  })
  it('weights favour quality early and fit later', () => {
    expect(laneWeights('adaptive', 1, true).q).toBeGreaterThan(laneWeights('adaptive', 8, true).q)
    expect(laneWeights('adaptive', 12, true).f).toBeGreaterThan(laneWeights('adaptive', 2, true).f)
    expect(laneWeights('bpa', 5, true).f).toBe(0)
    const w = laneWeights('adaptive', 5, false)
    expect(w.t).toBe(0)
    expect(w.q + w.f).toBeCloseTo(1, 10)
  })
})

describe('locked builds', () => {
  const env = demoEngine()
  const base = {
    ctx: env.ctx, scale: env.scale, teams: env.teams, available: env.valuation.orderPerGame, myRoster: env.valuation.orderPerGame.slice(40, 44),
    opponentRosters: null, adp: () => null, timing: null, round: 5,
  } as const
  it('never rewrite intrinsic quality, only fit weights', () => {
    const open = recommend({ ...base, mode: 'adaptive', lock: null })
    const locked = recommend({ ...base, mode: 'build', lock: { punts: ['FT'], mode: 'hard' } })
    for (const id of env.valuation.orderPerGame.slice(50, 60)) {
      expect(locked.scores.get(id)!.quality).toBe(open.scores.get(id)!.quality)
    }
    expect(locked.catWeights.FT).toBe(0)
    for (const c of CATEGORIES) if (c !== 'FT') expect(locked.catWeights[c]).toBeGreaterThan(0)
  })
  it('soft punts de-emphasise rather than drop the category', () => {
    const soft = recommend({ ...base, mode: 'build', lock: { punts: ['FT'], mode: 'soft' }, softWeight: 0.35 })
    expect(soft.catWeights.FT).toBeGreaterThan(0)
    expect(soft.catWeights.FT).toBeLessThan(soft.catWeights.PTS)
  })
})

describe('draft state never moves player values', () => {
  it('bestOverall order of remaining players is a subsequence of the frozen ranking', () => {
    const env = demoEngine()
    const taken = new Set(env.valuation.orderPerGame.filter((_, i) => i % 3 === 0).slice(0, 40))
    const available = env.valuation.orderPerGame.filter((id) => !taken.has(id))
    const res = recommend({
      ctx: env.ctx, scale: env.scale, teams: 12, available, myRoster: [], opponentRosters: null,
      adp: () => null, timing: null, mode: 'adaptive', lock: null, round: 4,
    })
    expect(res.bestOverall.map((s) => s.id)).toEqual(available)
  })
})
