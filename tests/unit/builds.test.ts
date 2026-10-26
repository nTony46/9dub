import { describe, expect, it } from 'vitest'
import { candidateBuilds, categoryCorrelations, evaluateBuilds, viabilityLabel } from '@/analytics/builds'
import { picksForSlot } from '@/analytics/draftOrder'
import { demoEngine } from '../fixtures/engine'

describe('build candidates', () => {
  const env = demoEngine()
  const pairs = categoryCorrelations(env.valuation, 'perGame')
  const builds = candidateBuilds(pairs)

  it('includes balanced, all nine single punts and only correlated doubles (no triples)', () => {
    expect(builds[0].id).toBe('balanced')
    expect(builds.filter((b) => b.kind === 'single')).toHaveLength(9)
    const doubles = builds.filter((b) => b.kind === 'double')
    expect(doubles.length).toBeGreaterThan(0)
    expect(doubles.length).toBeLessThanOrEqual(9)
    expect(builds.every((b) => b.punts.length <= 2)).toBe(true)
    for (const d of doubles.filter((b) => b.origin?.startsWith('correlated'))) {
      const p = pairs.find((x) => (x.a === d.punts[0] && x.b === d.punts[1]) || (x.a === d.punts[1] && x.b === d.punts[0]))!
      expect(p.r).toBeGreaterThanOrEqual(0.15)
    }
  })

  it('finds the classic big-man correlation (REB with BLK) among doubles', () => {
    expect(builds.some((b) => b.id === 'punt-REB-BLK')).toBe(true)
  })
})

describe('build evaluation', () => {
  const env = demoEngine()
  const builds = candidateBuilds(categoryCorrelations(env.valuation, 'perGame'))
  const adpOrder = [...env.valuation.orderPerGame].sort((a, b) => (env.adp.get(a) ?? 999) - (env.adp.get(b) ?? 999))

  it('is low-confidence (exploratory) after one or two picks', () => {
    const mine = [env.valuation.orderPerGame[4]]
    const available = env.valuation.orderPerGame.filter((id) => !mine.includes(id)).slice(11)
    const evals = evaluateBuilds(
      { ctx: env.ctx, scale: env.scale, myRoster: mine, available, adpOrder: adpOrder.filter((id) => available.includes(id)), myFuturePicks: picksForSlot(6, 12, 13).slice(1), currentPick: 13 },
      builds,
    )
    expect(evals.every((e) => e.confidence === 'low')).toBe(true)
    expect(evals[0].rationale.join(' ')).toMatch(/Exploratory/)
  })

  it('a punt that keeps fewer than five categories ahead is never better than unlikely', () => {
    expect(viabilityLabel(6, 1, 4)).toBe('unlikely')
    expect(viabilityLabel(6, 0.5, 6)).toBe('strong')
    expect(viabilityLabel(6, 0, 6)).toBe('viable')
    expect(viabilityLabel(6, -0.6, 6)).toBe('fragile')
  })

  it('evolves with roster construction: a big-heavy roster makes punting FT% cheaper than punting REB', () => {
    const bigs = env.valuation.orderPerGame.filter((id) => /rim-protector|post-big|energy-big/.test(env.archetype.get(id) ?? '')).slice(0, 6)
    const available = env.valuation.orderPerGame.filter((id) => !bigs.includes(id)).slice(60)
    const evals = evaluateBuilds(
      { ctx: env.ctx, scale: env.scale, myRoster: bigs, available, adpOrder: adpOrder.filter((id) => available.includes(id)), myFuturePicks: picksForSlot(6, 12, 13).slice(6), currentPick: 70 },
      builds,
    )
    const ft = evals.find((e) => e.build.id === 'punt-FT')!
    const reb = evals.find((e) => e.build.id === 'punt-REB')!
    expect(ft.aligned).toBeGreaterThan(0)
    expect(reb.wasted).toBeGreaterThan(ft.wasted)
    expect(ft.expectedCats).toBeGreaterThanOrEqual(reb.expectedCats - 0.05)
    expect(evals.indexOf(ft)).toBeLessThan(evals.indexOf(reb))
    expect(reb.viability).not.toBe('strong')
    expect(reb.rationale.join(' ')).toMatch(/Abandons/)
    expect(ft.confidence).toBe('medium')
  })
})
