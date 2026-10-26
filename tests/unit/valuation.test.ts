import { describe, expect, it } from 'vitest'
import { computeReferenceParams, rawCategoryValue, valuePlayers } from '@/analytics/valuation'
import { line, player } from '../fixtures/engine'

/**
 * Hand-worked three-player pool (pool size 3 → the pool is everyone).
 *
 *        PTS  TO   FGM/FGA        FTM/FTA
 *   A    20   2    8 / 16 (50%)   4.0 / 5 (80%)
 *   B    10   1    4.5 / 7.5 (60%) 1.0 / 2 (50%)
 *   C    15   3    5.5 / 13.75 (40%) 2.7 / 3 (90%)
 *
 * FG baseline = 18 / 37.25 = 0.483221   (attempt-weighted, not mean of %)
 * FG impact   A = 8 − 0.483221·16 = 0.268456
 *             B = 4.5 − 0.483221·7.5 = 0.875839
 *             C = 5.5 − 0.483221·13.75 = −1.144295   (sum = 0)
 * SD (population) = sqrt((0.0720687 + 0.7670937 + 1.3094117)/3) = sqrt(0.7161914) = 0.846281
 * z_FG: A 0.31722, B 1.03493, C −1.35215
 *
 * FT baseline = 7.7/10 = 0.77; impacts A 0.15, B −0.54, C 0.39; SD 0.394208
 * z_FT: A 0.38051, B −1.36983, C 0.98932
 *
 * PTS mean 15, SD 4.08248 → z A 1.22474, B −1.22474, C 0
 * TO  mean 2,  SD 0.81650 → z (inverted) A 0, B +1.22474, C −1.22474
 */
const A = player('A', line({ pts: 20, tov: 2, fg: [8, 16], ft: [4, 5] }))
const B = player('B', line({ pts: 10, tov: 1, fg: [4.5, 7.5], ft: [1, 2] }))
const C = player('C', line({ pts: 15, tov: 3, fg: [5.5, 13.75], ft: [2.7, 3] }))
const settings = { poolSize: 3, teams: 1, rounds: 1, fullSeasonGames: 82 }

describe('reference parameters (hand-worked)', () => {
  const params = computeReferenceParams([A, B, C], settings)

  it('uses an attempt-weighted shooting baseline', () => {
    expect(params.fgBaseline).toBeCloseTo(18 / 37.25, 6)
    expect(params.fgBaseline).toBeCloseTo(0.483221, 5)
    expect(params.ftBaseline).toBeCloseTo(0.77, 6)
    // A mean of the three percentages would be 0.5 — explicitly not what we use.
    expect(params.fgBaseline).not.toBeCloseTo(0.5, 2)
  })

  it('computes impact SDs and counting-stat SDs', () => {
    expect(params.mean.FG).toBeCloseTo(0, 9)
    expect(params.sd.FG).toBeCloseTo(0.846281, 5)
    expect(params.sd.FT).toBeCloseTo(0.394208, 5)
    expect(params.mean.PTS).toBeCloseTo(15, 9)
    expect(params.sd.PTS).toBeCloseTo(4.08248, 4)
    expect(params.sd.TO).toBeCloseTo(0.8165, 4)
  })
})

describe('player z-scores (hand-worked)', () => {
  const v = valuePlayers([A, B, C], settings).values

  it('volume-weights FG% and FT% through impact', () => {
    expect(v.get('A')!.z.FG).toBeCloseTo(0.31722, 4)
    expect(v.get('B')!.z.FG).toBeCloseTo(1.03493, 4)
    expect(v.get('C')!.z.FG).toBeCloseTo(-1.35215, 4)
    expect(v.get('A')!.z.FT).toBeCloseTo(0.38051, 4)
    expect(v.get('B')!.z.FT).toBeCloseTo(-1.36983, 4)
    expect(v.get('C')!.z.FT).toBeCloseTo(0.98932, 4)
  })

  it('inverts turnovers so fewer is better', () => {
    expect(v.get('A')!.z.TO).toBeCloseTo(0, 6)
    expect(v.get('B')!.z.TO).toBeCloseTo(1.22474, 4)
    expect(v.get('C')!.z.TO).toBeCloseTo(-1.22474, 4)
    expect(v.get('A')!.z.PTS).toBeCloseTo(1.22474, 4)
  })
})

describe('percentage volume', () => {
  it('gives a high-volume efficient shooter more FG value than a tiny-volume high-% shooter', () => {
    // Baseline will be close to 47%: X shoots 60% on 2 FGA, Y 55% on 15 FGA.
    const pool = [
      player('X', line({ fg: [1.2, 2] })),
      player('Y', line({ fg: [8.25, 15] })),
      ...Array.from({ length: 8 }, (_, i) => player(`F${i}`, line({ fg: [4.7, 10] }))),
    ]
    const res = valuePlayers(pool, { poolSize: 10, teams: 1, rounds: 1, fullSeasonGames: 82 })
    const b = res.params.fgBaseline!
    expect(rawCategoryValue(pool[0].line, 'FG', { fg: b, ft: null })).toBeCloseTo(1.2 - b * 2, 9)
    const zx = res.values.get('X')!.z.FG!
    const zy = res.values.get('Y')!.z.FG!
    expect(zy).toBeGreaterThan(zx)
    expect(zx).toBeGreaterThan(0)
  })

  it('penalises inefficient volume more than inefficient low volume', () => {
    const pool = [
      player('lowVol', line({ fg: [0.8, 2] })), // 40% on 2
      player('highVol', line({ fg: [8, 20] })), // 40% on 20
      ...Array.from({ length: 8 }, (_, i) => player(`F${i}`, line({ fg: [4.8, 10] }))),
    ]
    const res = valuePlayers(pool, { poolSize: 10, teams: 1, rounds: 1, fullSeasonGames: 82 })
    expect(res.values.get('highVol')!.z.FG!).toBeLessThan(res.values.get('lowVol')!.z.FG!)
    expect(res.values.get('highVol')!.z.FG!).toBeLessThan(0)
  })
})

describe('turnovers and missing data', () => {
  it('more turnovers lower intrinsic value, all else equal', () => {
    const base = { pts: 18, reb: 5, ast: 4, fg: [7, 15] as [number, number], ft: [3, 3.8] as [number, number] }
    const pool = [
      player('lowTO', line({ ...base, tov: 1.2 })),
      player('highTO', line({ ...base, tov: 3.4 })),
      ...Array.from({ length: 10 }, (_, i) => player(`F${i}`, line({ pts: 10 + i, tov: 1 + i * 0.2, fg: [4, 9], ft: [1.5, 2] }))),
    ]
    const v = valuePlayers(pool, { poolSize: 12, teams: 1, rounds: 1, fullSeasonGames: 82 }).values
    expect(v.get('highTO')!.total).toBeLessThan(v.get('lowTO')!.total)
    expect(v.get('highTO')!.z.TO!).toBeLessThan(v.get('lowTO')!.z.TO!)
  })

  it('flags missing FGA/FTA as unknown instead of silently treating it as zero', () => {
    const pool = [
      player('noVol', line({ pts: 15, fgm: null, fga: null, ftm: null, fta: null })),
      ...Array.from({ length: 6 }, (_, i) => player(`F${i}`, line({ pts: 10 + i, fg: [4 + i * 0.2, 9], ft: [1.5, 2] }))),
    ]
    const v = valuePlayers(pool, { poolSize: 7, teams: 1, rounds: 1, fullSeasonGames: 82 }).values.get('noVol')!
    expect(v.z.FG).toBeNull()
    expect(v.z.FT).toBeNull()
    expect(v.raw.FG).toBeNull()
    expect(v.missing).toEqual(['FG', 'FT'])
    expect(v.coveredCats).toBe(7)
  })
})

describe('GP-aware valuation', () => {
  it('blends missed games with replacement level instead of multiplying by GP', () => {
    const pool = Array.from({ length: 30 }, (_, i) =>
      i === 0
        ? player('P0', line({ pts: 32, reb: 10, ast: 8, stl: 1.6, blk: 1, fg: [11, 21], ft: [7, 8] }), 41)
        : player(`P${i}`, line({ pts: 26 - i * 0.6, reb: 3 + (i % 5), ast: 2 + (i % 4), fg: [6, 13], ft: [2, 2.6] }), 82),
    )
    const res = valuePlayers(pool, { poolSize: 20, teams: 4, rounds: 5, fullSeasonGames: 82 })
    const star = res.values.get('P0')!
    expect(star.gp.availability).toBeCloseTo(0.5, 6)
    // Half the games at the star's level, half at replacement level.
    for (const c of ['PTS', 'REB'] as const)
      expect(star.gp.z[c]!).toBeCloseTo(0.5 * star.z[c]! + 0.5 * res.replacement.z[c], 9)
    expect(star.gp.total).toBeLessThan(star.total)
    expect(star.gp.total).not.toBeCloseTo(star.total * 0.5, 1)
    expect(star.rankGp).toBeGreaterThanOrEqual(star.rank)
    // Full-season players are unchanged.
    expect(res.values.get('P1')!.gp.total).toBeCloseTo(res.values.get('P1')!.total, 9)
  })
})

describe('frozen reference pool', () => {
  it('is deterministic and independent of draft state', () => {
    const pool = Array.from({ length: 40 }, (_, i) => player(`P${i}`, line({ pts: 8 + i * 0.5, reb: 3 + (i % 7), fg: [3 + i * 0.1, 7 + i * 0.15], ft: [1, 1.3] })))
    const a = valuePlayers(pool, { poolSize: 25, teams: 4, rounds: 5, fullSeasonGames: 82 })
    const b = valuePlayers([...pool].reverse(), { poolSize: 25, teams: 4, rounds: 5, fullSeasonGames: 82 })
    expect(b.params.mean).toEqual(a.params.mean)
    expect(b.params.sd).toEqual(a.params.sd)
    expect(b.orderPerGame).toEqual(a.orderPerGame)
    expect(a.params.converged).toBe(true)
    expect(new Set(a.params.poolIds).size).toBe(25)
  })
})
