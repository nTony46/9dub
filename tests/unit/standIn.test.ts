import { describe, expect, it } from 'vitest'
import { PRIOR_GAMES, PRIOR_MINUTES, standInLine, type SpanTotals } from '@/analytics/standIn'

const span = (gp: number, min: number, o: Partial<SpanTotals> = {}): SpanTotals => ({ gp, min, pts: 0, tpm: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, ...o })

describe('stand-in line from actual stats', () => {
  // 4 games, 80 minutes, 24 points; last 15 days = the same 4 games.
  const season = span(4, 80, { pts: 24, fgm: 8, fga: 20 })
  const recent = span(4, 80, { pts: 24, fgm: 8, fga: 20 })

  it('takes minutes from this season, recent games counted twice', () => {
    const longer = span(10, 150, { pts: 40 }) // 15 mpg over the season…
    const lately = span(4, 120, { pts: 30 }) // …30 mpg lately (a bigger role)
    const s = standInLine(longer, lately, null, null)!
    expect(s.mpg).toBeCloseTo((150 + 120) / (10 + 4), 9)
  })

  it('keeps one big game from setting his minutes', () => {
    const one = span(1, 29, { pts: 12 })
    const prior = span(40, 400, { pts: 160 }) // 10 mpg last season
    const s = standInLine(one, one, prior, null)!
    expect(s.mpg).toBeCloseTo((29 + 29 + PRIOR_GAMES * 10) / (1 + 1 + PRIOR_GAMES), 9)
    expect(s.mpg).toBeLessThan(20)
  })

  it('blends per-minute production with last season by minutes played', () => {
    const prior = span(60, 1200, { pts: 480, fgm: 180, fga: 400 }) // 0.4 pts/min, 45% FG
    const s = standInLine(season, recent, prior, null)!
    expect(s.prior).toBe('last-season')
    const ptsRate = (24 + PRIOR_MINUTES * (480 / 1200)) / (80 + PRIOR_MINUTES)
    const mpg = (80 + 80 + PRIOR_GAMES * 20) / (4 + 4 + PRIOR_GAMES)
    expect(s.line.pts).toBeCloseTo(ptsRate * mpg, 9)
    // FG% sits between this season's 40% and last season's 45%, nearer last season's on 20 attempts.
    const fg = s.line.fgm! / s.line.fga!
    expect(fg).toBeGreaterThan(0.4)
    expect(fg).toBeLessThan(0.45)
    expect(fg).toBeGreaterThan(0.425)
  })

  it('leans on a typical player without a usable last season (rookies, short stints)', () => {
    const typical = { line: { pts: 9, tpm: 1, reb: 4, ast: 2, stl: 0.7, blk: 0.4, tov: 1.2, fgm: 3.5, fga: 7.5, ftm: 1, fta: 1.3 }, mpg: 22.5 }
    const s = standInLine(season, recent, span(5, 60, { pts: 30 }), typical)!
    expect(s.prior).toBe('typical')
    const mpg = (80 + 80 + PRIOR_GAMES * 22.5) / (4 + 4 + PRIOR_GAMES)
    expect(s.line.pts).toBeCloseTo(((24 + PRIOR_MINUTES * (9 / 22.5)) / (80 + PRIOR_MINUTES)) * mpg, 9)
  })

  it('uses this season alone when there is no prior at all', () => {
    const s = standInLine(season, null, null, null)!
    expect(s.prior).toBe('none')
    expect(s.line.pts).toBeCloseTo(6, 9) // 24 points in 4 games
  })

  it('falls back to last season per game when he has not played this season, else nothing', () => {
    const s = standInLine(null, null, span(50, 1000, { pts: 500 }), null)!
    expect(s.games).toBe(0)
    expect(s.line.pts).toBeCloseTo(10, 9)
    expect(standInLine(null, null, span(3, 30, { pts: 12 }), null)).toBeNull()
  })
})
