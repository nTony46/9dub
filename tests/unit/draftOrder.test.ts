import { describe, expect, it } from 'vitest'
import { formatPick, nextPickForTeam, pickSlot, picksForSlot, snakeOrder } from '@/analytics/draftOrder'

describe('snake draft order (12 teams × 13 rounds)', () => {
  const order = snakeOrder(12, 13)

  it('has 156 selections', () => {
    expect(order).toHaveLength(156)
  })

  it('round 1 ascends, round 2 descends, round 3 ascends', () => {
    expect(order.slice(0, 12).map((p) => p.teamIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(order.slice(12, 24).map((p) => p.teamIndex)).toEqual([11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
    expect(order.slice(24, 36).map((p) => p.teamIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('checks picks 1, 12, 13, 24 and 25', () => {
    expect(pickSlot(1, 12)).toMatchObject({ round: 1, pickInRound: 1, teamIndex: 0 })
    expect(pickSlot(12, 12)).toMatchObject({ round: 1, pickInRound: 12, teamIndex: 11 })
    expect(pickSlot(13, 12)).toMatchObject({ round: 2, pickInRound: 1, teamIndex: 11 })
    expect(pickSlot(24, 12)).toMatchObject({ round: 2, pickInRound: 12, teamIndex: 0 })
    expect(pickSlot(25, 12)).toMatchObject({ round: 3, pickInRound: 1, teamIndex: 0 })
  })

  it('computes future pick sequences for slots 1, 6 and 12', () => {
    expect(picksForSlot(1, 12, 13)).toEqual([1, 24, 25, 48, 49, 72, 73, 96, 97, 120, 121, 144, 145])
    expect(picksForSlot(6, 12, 13)).toEqual([6, 19, 30, 43, 54, 67, 78, 91, 102, 115, 126, 139, 150])
    expect(picksForSlot(12, 12, 13)).toEqual([12, 13, 36, 37, 60, 61, 84, 85, 108, 109, 132, 133, 156])
  })

  it('slot pick sequences agree with the full order', () => {
    for (const slot of [1, 6, 12]) {
      const fromOrder = order.filter((p) => p.teamIndex === slot - 1).map((p) => p.overall)
      expect(fromOrder).toEqual(picksForSlot(slot, 12, 13))
    }
  })

  it('finds the next pick for a team and formats round.pick', () => {
    expect(nextPickForTeam(5, 6, 12, 13)).toBe(19)
    expect(nextPickForTeam(5, 150, 12, 13)).toBeNull()
    expect(formatPick(51, 12)).toBe('5.03')
  })

  it('works for other league sizes', () => {
    expect(picksForSlot(3, 10, 3)).toEqual([3, 18, 23])
    expect(snakeOrder(8, 2).map((p) => p.teamIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 7, 6, 5, 4, 3, 2, 1, 0])
  })
})
