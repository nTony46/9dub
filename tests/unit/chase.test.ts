import { describe, expect, it } from 'vitest'
import { bestPerCategory, chaseVerdict, outlookOf, rankPickups, subtractTotals } from '@/analytics/chase'
import { compareWeek, countVariance, weekTotals, type WeekTotals } from '@/analytics/matchup'

const t = (o: Partial<Omit<WeekTotals, 'fgPct' | 'ftPct'>> = {}): WeekTotals =>
  weekTotals({ pts: 400, tpm: 40, reb: 160, ast: 90, stl: 25, blk: 18, tov: 50, fgm: 150, fga: 320, ftm: 60, fta: 75, ...o })

describe('category spread', () => {
  it('counts are Poisson; points are 2s, 3s and free throws (compound Poisson)', () => {
    const x = t({ pts: 2 * 110 + 3 * 40 + 60, fgm: 150, tpm: 40, ftm: 60 })
    expect(countVariance(x, 'REB')).toBe(160)
    expect(countVariance(x, 'PTS')).toBeCloseTo(4 * 110 + 9 * 40 + 60)
    // A points total has more spread than a Poisson count of the same size.
    expect(countVariance(x, 'PTS')).toBeGreaterThan(x.pts)
  })

  it('gives every category a share between 0 and 1 that follows the margin', () => {
    const close = compareWeek(t({ reb: 160 }), t({ reb: 163 })).calls.find((c) => c.cat === 'REB')!
    const far = compareWeek(t({ reb: 160 }), t({ reb: 220 })).calls.find((c) => c.cat === 'REB')!
    expect(close.share!).toBeGreaterThan(far.share!)
    expect(close.share!).toBeLessThan(0.5)
    expect(far.share!).toBeLessThan(0.01)
  })
})

describe('chasing a category', () => {
  it('maps calls to outlooks', () => {
    const w = compareWeek(t({ reb: 160, blk: 26, stl: 25 }), t({ reb: 220, blk: 18, stl: 26 }))
    const by = (cat: string) => w.calls.find((c) => c.cat === cat)!
    expect(outlookOf(by('REB'))).toBe('far-behind')
    expect(outlookOf(by('BLK'))).toBe('ahead')
    expect(outlookOf(by('STL'))).toBe('toss-up')
  })

  it('chases when one pickup clearly helps, lets go when none does, and ignores categories already won', () => {
    const w = compareWeek(t({ reb: 150, blk: 40 }), t({ reb: 162 }))
    const reb = w.calls.find((c) => c.cat === 'REB')!
    expect(chaseVerdict(reb, reb.share! + 0.3)).toBe('chase')
    expect(chaseVerdict(reb, reb.share! + 0.05)).toBe('let-go')
    expect(chaseVerdict(reb, null)).toBe('let-go')
    expect(chaseVerdict(w.calls.find((c) => c.cat === 'BLK')!, 1)).toBeNull()
  })

  it('re-scores only what is left to play and ranks pickups by expected categories won', () => {
    // Live: 60 rebounds already in the books for me, 70 for them; 3 days left.
    const restMe = t({ reb: 90, pts: 200, fgm: 75, fga: 160, tpm: 20, ftm: 30, fta: 38 })
    const restThem = t({ reb: 92, pts: 200, fgm: 75, fga: 160, tpm: 20, ftm: 30, fta: 38 })
    const me = weekTotals({ ...restMe, reb: 150, pts: 400, fgm: 150, fga: 320, tpm: 40, ftm: 60, fta: 75 })
    const them = weekTotals({ ...restThem, reb: 162, pts: 400, fgm: 150, fga: 320, tpm: 40, ftm: 60, fta: 75 })
    const big = { id: 'big', starts: 3, restMe: weekTotals({ ...restMe, reb: restMe.reb + 25, blk: restMe.blk + 4, ftm: restMe.ftm + 2, fta: restMe.fta + 6 }) }
    const guard = { id: 'guard', starts: 3, restMe: weekTotals({ ...restMe, ast: restMe.ast + 1 }) }
    const { baseCall, results } = rankPickups({ me, them, restMe, restThem, live: true }, [guard, big])
    expect(results[0].id).toBe('big')
    expect(results[0].gain).toBeGreaterThan(results[1].gain)
    expect(results[0].adds.reb).toBe(25)
    // Settled totals are kept: my final REB = 60 settled + 115 remaining.
    expect(results[0].call.calls.find((c) => c.cat === 'REB')!.mine).toBe(175)
    const best = bestPerCategory(baseCall, results)
    expect(best.REB?.id).toBe('big')
    expect(best.REB?.add).toBe(25)
    expect(subtractTotals(me, restMe).reb).toBe(60)
  })
})
