/**
 * Position eligibility and lineup-slot checks. V1 warns about imbalance; it
 * only blocks drafting when the user explicitly enables roster constraints.
 */
export const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'] as const
export type Position = (typeof POSITIONS)[number]

export interface SlotDef {
  id: string
  label: string
  /** Eligible positions; empty array = any player (UTIL / bench). */
  accepts: Position[]
  starter: boolean
}

/** Positions each lineup-slot label accepts (ESPN's slot names); UTIL and BE take anyone. */
const SLOT_ACCEPTS: Readonly<Record<string, Position[]>> = {
  PG: ['PG'],
  SG: ['SG'],
  SF: ['SF'],
  PF: ['PF'],
  C: ['C'],
  G: ['PG', 'SG'],
  F: ['SF', 'PF'],
  'SG/SF': ['SG', 'SF'],
  'G/F': ['PG', 'SG', 'SF', 'PF'],
  'PF/C': ['PF', 'C'],
  'F/C': ['SF', 'PF', 'C'],
  UTIL: [],
  BE: [],
}

export const SLOT_LABELS = Object.keys(SLOT_ACCEPTS)

/** ESPN's default H2H basketball lineup: PG SG SF PF C G F UTIL×3 + 3 bench = 13. */
export const DEFAULT_LINEUP: readonly string[] = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'UTIL', 'UTIL', 'BE', 'BE', 'BE']

/** Lineup labels (starters then BE, no IR) → slot definitions. A label used more than once is numbered (UTIL1, UTIL2…). */
export function slotDefs(labels: readonly string[]): SlotDef[] {
  const known = labels.filter((l) => l in SLOT_ACCEPTS)
  const seen = new Map<string, number>()
  return known.map((label) => {
    const n = (seen.get(label) ?? 0) + 1
    seen.set(label, n)
    const repeated = known.filter((l) => l === label).length > 1
    return { id: repeated ? `${label}${n}` : label, label, accepts: [...SLOT_ACCEPTS[label]], starter: label !== 'BE' }
  })
}

export const ESPN_DEFAULT_SLOTS: SlotDef[] = slotDefs(DEFAULT_LINEUP)

export function normalizePositions(raw: string | readonly string[] | null | undefined): Position[] {
  if (!raw) return []
  const parts = (Array.isArray(raw) ? raw.join('/') : (raw as string))
    .toUpperCase()
    .split(/[\s/,;|-]+/)
    .filter(Boolean)
  const out = new Set<Position>()
  for (const p of parts) {
    if ((POSITIONS as readonly string[]).includes(p)) out.add(p as Position)
    else if (p === 'G') {
      out.add('PG')
      out.add('SG')
    } else if (p === 'F') {
      out.add('SF')
      out.add('PF')
    } else if (p === 'GF') {
      out.add('SG')
      out.add('SF')
    } else if (p === 'FC') {
      out.add('PF')
      out.add('C')
    } else {
      // Concatenated badges, e.g. "PGSG" from some table copies.
      const m = p.match(/PG|SG|SF|PF|C/g)
      if (m && m.join('') === p) m.forEach((x) => out.add(x as Position))
    }
  }
  return POSITIONS.filter((p) => out.has(p))
}

function accepts(slot: SlotDef, positions: readonly Position[]): boolean {
  return slot.accepts.length === 0 || slot.accepts.some((p) => positions.includes(p))
}

export interface LineupFill {
  /** slot index → player id */
  assignment: (string | null)[]
  unfilledStarters: SlotDef[]
  /** Players who fit no slot at all (roster over capacity). */
  overflow: string[]
}

/**
 * Maximum bipartite matching of players to slots (Kuhn's algorithm). Starter
 * slots are matched first so bench slots absorb whatever is left. `prefer`
 * names a slot index each player tries first (his usual slot), so lineups stay
 * stable and only change where they must; it never changes who gets matched.
 */
export function fillLineup(
  players: readonly { id: string; positions: readonly Position[] }[],
  slots: readonly SlotDef[] = ESPN_DEFAULT_SLOTS,
  prefer?: (id: string) => number | undefined,
): LineupFill {
  const order = [...slots.keys()].sort((a, b) => {
    const sa = slots[a]
    const sb = slots[b]
    if (sa.starter !== sb.starter) return sa.starter ? -1 : 1
    return (sa.accepts.length || 99) - (sb.accepts.length || 99)
  })
  const slotOf = new Map<string, number>()
  const owner: (string | null)[] = slots.map(() => null)
  const pos = new Map(players.map((p) => [p.id, p.positions]))

  const tryAssign = (pid: string, seen: Set<number>): boolean => {
    const own = prefer?.(pid)
    const seq = own != null && own >= 0 && own < slots.length ? [own, ...order.filter((i) => i !== own)] : order
    // With preferences (a displayed lineup), take an empty slot before moving anyone, so a player
    // coming off the bench drops into the open seat instead of reshuffling everyone. The set of
    // matched players is the same either way; only which slots they end up in differs.
    if (prefer) {
      for (const si of seq) {
        if (seen.has(si) || owner[si] != null || !accepts(slots[si], pos.get(pid) ?? [])) continue
        seen.add(si)
        owner[si] = pid
        slotOf.set(pid, si)
        return true
      }
    }
    for (const si of seq) {
      if (seen.has(si) || !accepts(slots[si], pos.get(pid) ?? [])) continue
      seen.add(si)
      const cur = owner[si]
      if (cur == null || tryAssign(cur, seen)) {
        owner[si] = pid
        slotOf.set(pid, si)
        return true
      }
    }
    return false
  }

  const overflow: string[] = []
  for (const p of players) if (!tryAssign(p.id, new Set())) overflow.push(p.id)
  return {
    assignment: owner,
    unfilledStarters: slots.filter((s, i) => s.starter && owner[i] == null && s.accepts.length > 0),
    overflow,
  }
}

export function positionCounts(players: readonly { positions: readonly Position[] }[]): Record<Position, number> {
  const out = { PG: 0, SG: 0, SF: 0, PF: 0, C: 0 } as Record<Position, number>
  for (const p of players) for (const x of p.positions) out[x]++
  return out
}

export interface RosterWarning {
  level: 'info' | 'warn'
  text: string
}

export function rosterWarnings(
  players: readonly { id: string; positions: readonly Position[] }[],
  rosterSize: number,
  slots: readonly SlotDef[] = ESPN_DEFAULT_SLOTS,
): RosterWarning[] {
  const out: RosterWarning[] = []
  const fill = fillLineup(players, slots)
  const remaining = rosterSize - players.length
  const missing = [...new Set(fill.unfilledStarters.map((s) => s.label))]
  if (fill.overflow.length) out.push({ level: 'warn', text: `Roster over capacity by ${fill.overflow.length}.` })
  if (missing.length && players.length >= 4) {
    const tight = missing.length >= remaining - 1
    out.push({
      level: tight ? 'warn' : 'info',
      text: `No eligible starter yet for ${missing.join(', ')}${tight ? ` — only ${remaining} pick${remaining === 1 ? '' : 's'} left` : ''}.`,
    })
  }
  const counts = positionCounts(players)
  const guards = players.filter((p) => p.positions.every((x) => x === 'PG' || x === 'SG')).length
  const bigs = players.filter((p) => p.positions.every((x) => x === 'PF' || x === 'C')).length
  if (players.length >= 5 && guards / players.length >= 0.7) out.push({ level: 'info', text: `${guards} of ${players.length} players are guard-only.` })
  if (players.length >= 5 && bigs / players.length >= 0.7) out.push({ level: 'info', text: `${bigs} of ${players.length} players are big-only.` })
  if (players.length >= 8 && counts.C === 0) out.push({ level: 'warn', text: 'No center-eligible players.' })
  return out
}
