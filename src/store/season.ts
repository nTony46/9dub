import { addDays } from '@/data/schedule'
import type { EspnSync, Injury, LeagueSeed, MatchupWeek, RosterMove } from './schema'

/**
 * In-season roster state. The draft pick list stays the record of the draft;
 * post-draft adds, drops and trades are an ordered list of moves applied on
 * top of it, so any change can be undone and the draft itself is never edited.
 */
export interface CurrentRosters {
  rosters: string[][]
  /** Player id → 0-based team (absent = free agent). */
  teamOf: Map<string, number>
}

export function currentRosters(draftRosters: readonly (readonly string[])[], moves: readonly RosterMove[]): CurrentRosters {
  const teams = draftRosters.length
  const teamOf = new Map<string, number>()
  draftRosters.forEach((r, i) => r.forEach((id) => teamOf.set(id, i)))
  // Players never moved keep draft order; moved players follow, in the order of their latest move.
  const lastMove = new Map<string, number>()
  moves.forEach((m, k) => {
    if (m.to == null) teamOf.delete(m.playerId)
    else if (m.to < teams) teamOf.set(m.playerId, m.to)
    lastMove.set(m.playerId, k)
  })
  const rosters: string[][] = draftRosters.map((r) => r.filter((id) => !lastMove.has(id)))
  for (const [id] of [...lastMove.entries()].sort((a, b) => a[1] - b[1])) {
    const t = teamOf.get(id)
    if (t != null) rosters[t].push(id)
  }
  return { rosters, teamOf }
}

const uid = () => `wk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

/** Turn a league schedule seed into matchup weeks; opponents start unmapped unless a team name matches exactly. */
export function matchupsFromSeed(seed: LeagueSeed, teamNames: readonly string[], userTeam: number | null): MatchupWeek[] {
  const slotByName = new Map<string, number>()
  teamNames.forEach((n, i) => {
    if (i !== userTeam && n.trim() && !/^Team \d+$/.test(n.trim())) slotByName.set(n.trim().toLowerCase(), i)
  })
  return [...seed.matchups]
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((m) => ({
      id: uid(),
      start: m.start,
      end: m.end < m.start ? m.start : m.end,
      opponent: slotByName.get(m.opponent.trim().toLowerCase()) ?? null,
      label: m.opponent,
      owner: m.owner,
      away: m.away,
    }))
}

/** The matchup in progress on `today`, else the next one, else the last. */
export function currentWeek(weeks: readonly MatchupWeek[], today: string): MatchupWeek | null {
  const sorted = [...weeks].sort((a, b) => a.start.localeCompare(b.start))
  return sorted.find((w) => w.end >= today) ?? sorted[sorted.length - 1] ?? null
}

export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** A trade or pickup to test: players I give and players I get (from any team or free agency). */
export interface TradeDraft {
  give: string[]
  get: string[]
}

export interface TradeApplied {
  rosters: string[][]
  /** The single team the incoming players come from (gives go there); null = free agents / none. */
  partner: number | null
  /** More than one team supplies players — the gives can't be routed, so they are dropped. */
  multiTeam: boolean
}

/**
 * Rosters after a trade: my gives leave, my gets arrive. When every incoming
 * player comes from one team, my gives go to that team; otherwise (free-agent
 * pickups) they are dropped. Pure — nothing is recorded.
 */
export function applyTrade(rosters: readonly (readonly string[])[], teamOf: ReadonlyMap<string, number>, me: number, t: TradeDraft): TradeApplied {
  const owners = [...new Set(t.get.map((id) => teamOf.get(id)).filter((x): x is number => x != null && x !== me))]
  const partner = owners.length === 1 ? owners[0] : null
  const give = new Set(t.give)
  const get = new Set(t.get)
  const next = rosters.map((r, i) => {
    if (i === me) return [...r.filter((id) => !give.has(id)), ...t.get.filter((id) => !r.includes(id))]
    const kept = r.filter((id) => !get.has(id))
    return i === partner ? [...kept, ...t.give] : kept
  })
  return { rosters: next, partner, multiTeam: owners.length > 1 }
}

/** Injuries still in effect on `today` → player id → out through (null = until further notice). */
export function activeInjuries(injuries: readonly Injury[], today: string): Map<string, string | null> {
  return new Map(injuries.filter((i) => i.until == null || i.until >= today).map((i) => [i.playerId, i.until]))
}

/** The note on injuries the sync manages (players ESPN has in an IR slot); injuries you mark yourself are never touched. */
export const ESPN_IR_NOTE = 'ESPN IR'
/** A date you set for a player ESPN lists OUT who isn't marked out: it dates his absence without putting him on IR. */
export const RETURN_DATE_NOTE = 'Return date'
/** Stands in for ESPN's OUT on a player with no mark or date of yours (computed, never stored). */
export const ESPN_OUT_NOTE = 'ESPN OUT'
/** A player ESPN lists OUT, with no date of yours, is assumed to miss this many more days… */
export const DEFAULT_OUT_DAYS = 14
/** …or this many if he has missed most of his team's games so far, which points to a longer absence. */
export const LONG_OUT_DAYS = 28

const NOT_ON_IR = new Set([RETURN_DATE_NOTE, ESPN_OUT_NOTE])

/** Whether ESPN's designation means he won't play. Day-to-day players are expected to. */
export const isEspnOut = (status: string | null | undefined): boolean => status === 'OUT' || status === 'SUSPENSION'

/** Everyone's ESPN designation from the last sync (null = healthy), free agents included. */
export function espnStatuses(stats: EspnSync['stats'] | undefined, players: EspnSync['players'] | undefined): Map<string, string | null> {
  const out = new Map<string, string | null>()
  const healthy = (s: string | null | undefined) => (s && s !== 'ACTIVE' ? s : null)
  for (const [id, s] of Object.entries(stats ?? {})) out.set(id, healthy(s.injuryStatus))
  for (const [id, p] of Object.entries(players ?? {})) out.set(id, healthy(p.status))
  return out
}

/**
 * One rule for who sits, by ESPN's status rather than the roster slot he's in
 * (ESPN gives no return dates):
 * - a date you set, or a mark of your own, always wins;
 * - OUT or suspended: out for `DEFAULT_OUT_DAYS` more days, `LONG_OUT_DAYS` if `missedMost`, re-counted from today at every look, bench or IR alike;
 * - healthy but in an IR slot: he doesn't score there, so he's out through `weekEnd`, then expected back.
 */
export function effectiveInjuries(injuries: readonly Injury[], statuses: ReadonlyMap<string, string | null>, today: string, weekEnd: string, missedMost: (id: string) => boolean = () => false): Injury[] {
  const assumedBack = (id: string) => addDays(today, missedMost(id) ? LONG_OUT_DAYS : DEFAULT_OUT_DAYS)
  const live = activeInjuries(injuries, today)
  const out: Injury[] = injuries.map((i) => {
    if (i.note !== ESPN_IR_NOTE || i.until != null || !statuses.has(i.playerId)) return i
    return { ...i, until: isEspnOut(statuses.get(i.playerId)) ? assumedBack(i.playerId) : weekEnd }
  })
  for (const [playerId, status] of statuses) if (isEspnOut(status) && !live.has(playerId)) out.push({ playerId, until: assumedBack(playerId), at: 0, note: ESPN_OUT_NOTE })
  return out
}

/** Who sits right now, from the season's marks, the last ESPN sync and the NBA schedule: `effectiveInjuries` with what it needs worked out. */
export function whoSits(
  injuries: readonly Injury[],
  espn: Pick<EspnSync, 'stats' | 'players'> | null | undefined,
  games: readonly { date: string; home: string; away: string }[] | undefined,
  weeks: readonly MatchupWeek[],
  today: string,
): Injury[] {
  const played = new Map<string, number>()
  for (const g of games ?? []) if (g.date < today) for (const t of [g.home, g.away]) played.set(t, (played.get(t) ?? 0) + 1)
  const missedMost = (id: string) => {
    const team = espn?.players?.[id]?.team ?? espn?.stats?.[id]?.team
    const teamGames = team ? (played.get(team) ?? 0) : 0
    return teamGames > 0 && (espn?.stats?.[id]?.season?.gp ?? 0) < teamGames / 2
  }
  return effectiveInjuries(injuries, espnStatuses(espn?.stats, espn?.players), today, currentWeek(weeks, today)?.end ?? today, missedMost)
}

/** Which of a roster's injured players occupy IR slots (earliest marked first); the rest stay on the active roster. A return date alone doesn't put anyone on IR. */
export function irPlacement(roster: readonly string[], injuries: readonly Injury[], irSlots: number, today: string): { ir: string[]; outActive: string[]; active: string[] } {
  const live = activeInjuries(injuries, today)
  const hurt = injuries.filter((i) => !NOT_ON_IR.has(i.note) && live.has(i.playerId) && roster.includes(i.playerId)).sort((a, b) => a.at - b.at)
  const ir = hurt.slice(0, irSlots).map((i) => i.playerId)
  const onIr = new Set(ir)
  return { ir, outActive: hurt.slice(irSlots).map((i) => i.playerId), active: roster.filter((id) => !onIr.has(id)) }
}

/**
 * Who was on each team at the end of `date`, rebuilt from when each move and
 * injury mark was recorded (a sync stamps what it finds, so it can trail the
 * real move by the time since the last sync).
 */
export function rostersOn(draftRosters: readonly (readonly string[])[], moves: readonly RosterMove[], injuries: readonly Injury[], irSlots: number, date: string): { active: string[][]; out: Map<string, string | null> } {
  const end = Date.parse(`${date}T23:59:59`)
  const { rosters } = currentRosters(draftRosters, moves.filter((m) => m.at <= end))
  const marks = injuries.filter((i) => i.at <= end && !NOT_ON_IR.has(i.note))
  return { active: rosters.map((r) => irPlacement(r, marks, irSlots, date).active), out: activeInjuries(marks, date) }
}

const isDefaultName = (name: string | undefined, i: number) => !name?.trim() || name.trim() === `Team ${i + 1}`

/**
 * Team names that follow the opponent mapping: a slot takes its league name
 * when its current name is a placeholder or another league name (one that was
 * auto-assigned and has since moved); a slot whose name moved elsewhere goes
 * back to "Team N". Names the user typed themselves are never touched.
 * Returns null when nothing needs to change.
 */
export function syncedTeamNames(teamNames: readonly string[], weeks: readonly MatchupWeek[], me: number | null): string[] | null {
  const labels = new Set(weeks.map((w) => w.label.trim()).filter(Boolean))
  const bySlot = new Map<number, Set<string>>()
  for (const w of weeks) if (w.opponent != null && w.label.trim()) bySlot.set(w.opponent, (bySlot.get(w.opponent) ?? new Set()).add(w.label.trim()))
  const slotOf = new Map<string, number>()
  for (const [slot, ls] of bySlot) if (ls.size === 1) slotOf.set([...ls][0], slot)
  const next = [...teamNames]
  let changed = false
  next.forEach((cur, i) => {
    if (i === me) return
    const mine = bySlot.get(i)
    const want = mine?.size === 1 ? [...mine][0] : null
    const auto = isDefaultName(cur, i) || labels.has(cur.trim())
    if (want && cur.trim() !== want && auto) {
      next[i] = want
      changed = true
    } else if (!want && labels.has(cur.trim()) && slotOf.has(cur.trim()) && slotOf.get(cur.trim()) !== i) {
      next[i] = `Team ${i + 1}`
      changed = true
    }
  })
  return changed ? next : null
}
