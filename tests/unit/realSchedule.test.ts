/**
 * Checks the private schedule built by `npm run data:schedule` (git-ignored
 * .local-data/nba-schedule-*.json). Skipped when the file is absent.
 */
import { describe, expect, it } from 'vitest'
import { NbaScheduleSchema, REGULAR_SEASON_GAMES, teamsByDate } from '@/data/schedule'
import { NBA_TEAMS } from '@/data/normalize'

const files = import.meta.glob('/.local-data/nba-schedule-*.json', { eager: true, import: 'default' })
const raw = Object.values(files)[0]
const schedule = raw ? NbaScheduleSchema.parse(raw) : null

describe.skipIf(!schedule)('real NBA schedule file', () => {
  const s = schedule!
  it('covers all 30 teams with the same number of listed games and no duplicate game numbers', () => {
    const count = new Map<string, number>()
    for (const g of s.games) for (const t of [g.away, g.home]) count.set(t, (count.get(t) ?? 0) + 1)
    expect([...count.keys()].sort()).toEqual([...NBA_TEAMS].sort())
    expect(new Set(count.values()).size).toBe(1)
    expect(new Set(s.games.map((g) => g.n)).size).toBe(s.games.length)
    expect(s.games.every((g) => g.away !== g.home)).toBe(true)
  })

  it('accounts for every unscheduled game and places the gap in Nov–Dec', () => {
    const listed = s.games.length * 2
    const missing = Object.values(s.unscheduled).reduce((a, b) => a + b, 0)
    expect(listed + missing).toBe(30 * REGULAR_SEASON_GAMES)
    if (missing) {
      expect(s.tbdWindow).not.toBeNull()
      expect(['11', '12']).toContain(s.tbdWindow!.start.slice(5, 7))
      const byDate = teamsByDate(s)
      expect(byDate.has(s.tbdWindow!.start)).toBe(false)
    }
  })

  it('never has a team playing twice on one date', () => {
    const seen = new Set<string>()
    for (const g of s.games)
      for (const t of [g.away, g.home]) {
        const k = `${g.date}:${t}`
        expect(seen.has(k)).toBe(false)
        seen.add(k)
      }
  })
})
