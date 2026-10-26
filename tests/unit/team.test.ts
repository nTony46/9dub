import { describe, expect, it } from 'vitest'
import { aggregateLines, teamProfile, rankTeams, stageConfidence, typicalAtStage } from '@/analytics/team'
import { demoEngine, line } from '../fixtures/engine'

describe('team shooting aggregation', () => {
  it('computes FG% and FT% from makes/attempts, never the mean of player percentages', () => {
    // 1/2 (50%) and 10/25 (40%): mean of % = 45%, true team FG% = 11/27 = 40.74%.
    const t = aggregateLines([line({ fg: [1, 2], ft: [9, 10] }), line({ fg: [10, 25], ft: [1, 4] })])
    expect(t.fgm).toBe(11)
    expect(t.fga).toBe(27)
    expect(t.fgPct).toBeCloseTo(11 / 27, 10)
    expect(t.fgPct).not.toBeCloseTo(0.45, 2)
    // 9/10 (90%) and 1/4 (25%): mean 57.5%, true 10/14 = 71.4%.
    expect(t.ftPct).toBeCloseTo(10 / 14, 10)
  })

  it('excludes players without attempts from the ratio and counts them', () => {
    const t = aggregateLines([line({ fg: [5, 10] }), line({ fgm: null, fga: null })])
    expect(t.fgPct).toBeCloseTo(0.5, 10)
    expect(t.fgMissing).toBe(1)
  })
})

describe('unequal roster sizes', () => {
  const { ctx, valuation } = demoEngine()
  const order = valuation.orderPerGame
  const repl = valuation.replacement.ids[0]

  it('raw sums differ by roster size but slot-adjusted strength is comparable', () => {
    const two = teamProfile([order[3], order[30]], ctx)
    const three = teamProfile([order[3], order[30], repl], ctx)
    expect(three.count).toBe(3)
    expect(two.open).toBe(11)
    // Adding a replacement-level player barely changes slot-adjusted strength…
    expect(Math.abs(three.totalSlot - two.totalSlot)).toBeLessThan(1.2)
    // …while the naive raw sum treats it as a change (the replacement player has negative z).
    expect(three.totalZ).toBeLessThan(two.totalZ)
    // Per-player averages are also available for comparisons.
    expect(two.zPer.PTS).toBeCloseTo(two.zSum.PTS / 2, 10)
  })

  it('labels early standings as low confidence', () => {
    expect(stageConfidence(2, 13)).toBe('low')
    expect(stageConfidence(6, 13)).toBe('medium')
    expect(stageConfidence(11, 13)).toBe('higher')
  })

  it('ranks teams per category with 1 = best', () => {
    const a = teamProfile(order.slice(0, 3), ctx).zSlot
    const b = teamProfile(order.slice(100, 103), ctx).zSlot
    const ranks = rankTeams([b, a])
    const better = Object.values(ranks[1]).filter((r) => r === 1).length
    expect(better).toBeGreaterThanOrEqual(5)
  })

  it('stage-matched typical team has replacement-level open slots', () => {
    const t0 = typicalAtStage(demoEngine().scale, valuation, 0)
    expect(t0.PTS).toBeCloseTo(13 * valuation.replacement.z.PTS, 9)
  })
})
