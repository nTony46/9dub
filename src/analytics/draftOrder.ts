/** Snake-draft ordering. Team identity is the 0-based draft slot index. */

export interface PickSlot {
  /** 1-based overall pick number. */
  overall: number
  /** 1-based round. */
  round: number
  /** 1-based pick within the round. */
  pickInRound: number
  /** 0-based team index (slot − 1) making this pick under a pure snake. */
  teamIndex: number
}

export function pickSlot(overall: number, teams: number): PickSlot {
  if (!Number.isInteger(overall) || overall < 1) throw new RangeError(`invalid pick ${overall}`)
  const round = Math.ceil(overall / teams)
  const idx = (overall - 1) % teams
  const teamIndex = round % 2 === 1 ? idx : teams - 1 - idx
  return { overall, round, pickInRound: idx + 1, teamIndex }
}

export function snakeOrder(teams: number, rounds: number): PickSlot[] {
  const out: PickSlot[] = []
  for (let o = 1; o <= teams * rounds; o++) out.push(pickSlot(o, teams))
  return out
}

/** All overall pick numbers for a 1-based draft slot. */
export function picksForSlot(slot: number, teams: number, rounds: number): number[] {
  const out: number[] = []
  for (let r = 1; r <= rounds; r++) {
    out.push(r % 2 === 1 ? (r - 1) * teams + slot : r * teams - slot + 1)
  }
  return out
}

/** Next pick number for `teamIndex` strictly after `afterOverall`, or null if none remain. */
export function nextPickForTeam(teamIndex: number, afterOverall: number, teams: number, rounds: number): number | null {
  for (const p of picksForSlot(teamIndex + 1, teams, rounds)) if (p > afterOverall) return p
  return null
}

export function formatPick(overall: number, teams: number): string {
  const s = pickSlot(overall, teams)
  return `${s.round}.${String(s.pickInRound).padStart(2, '0')}`
}
