import type { Position } from '@/analytics/positions'
import type { EspnDraftPick, EspnSnapshot } from '@/data/espn'
import { normalizeName } from '@/data/normalize'
import type { DatasetRecord } from '@/data/schema'
import { teamForPick } from './draftLogic'
import type { DraftPick, EspnSync, Injury, MatchupWeek, RosterMove } from './schema'
import { activeInjuries, currentRosters } from './season'

/** The note on injuries the sync manages (players ESPN has in an IR slot); injuries you mark yourself are never touched. */
export const ESPN_IR_NOTE = 'ESPN IR'
export const ESPN_MOVE_NOTE = 'ESPN'

export interface EspnPlayerInfo {
  /** Current NBA team per ESPN (null = free agent). */
  team: string | null
  positions: Position[]
  /** ESPN injury designation (OUT, DAY_TO_DAY, …); null when healthy. */
  status: string | null
}

type NameRecord = { id: string; fullName: string; aliases: readonly string[]; nbaTeam: string | null }

/** Match ESPN names to 9dub's records: by normalized name, the NBA team breaking ties, each record used once. */
export function nameMatcher(records: readonly NameRecord[]): (name: string, team: string | null) => string | null {
  const byName = new Map<string, NameRecord[]>()
  for (const r of records) for (const n of new Set([r.fullName, ...r.aliases].map(normalizeName))) byName.set(n, [...(byName.get(n) ?? []), r])
  const taken = new Set<string>()
  return (name, team) => {
    const found = (byName.get(normalizeName(name)) ?? []).filter((r) => !taken.has(r.id))
    const pick = found.find((r) => team != null && r.nbaTeam === team) ?? found[0]
    if (!pick) return null
    taken.add(pick.id)
    return pick.id
  }
}

export interface EspnPlan {
  moves: { playerId: string; from: number | null; to: number | null }[]
  irAdd: string[]
  irClear: string[]
  teamNames: string[] | null
  /** Matchup weeks with ESPN's opponents (null = unchanged). */
  weeks: MatchupWeek[] | null
  players: Record<string, EspnPlayerInfo>
  /** Plain-language list of what changed. */
  changes: string[]
  /** ESPN players 9dub has no record of (not placed on rosters). */
  unmatched: string[]
  /** ESPN's lineup when it differs from 9dub's (null = unchanged). */
  lineup: { slots: string[]; ir: number } | null
  /** Actual stats of the players in `needsStats` that ESPN returned. */
  stats: EspnSync['stats']
}

export interface EspnPlanInput {
  records: readonly { id: string; fullName: string; aliases: readonly string[]; nbaTeam: string | null }[]
  draftRosters: readonly (readonly string[])[]
  moves: readonly RosterMove[]
  injuries: readonly Injury[]
  teamNames: readonly string[]
  teams: number
  userSlot: number | null
  weeks: readonly MatchupWeek[]
  today: string
  /** ESPN's team names at the previous sync; a slot is renamed only when ESPN's name changed since (or on the first sync). */
  lastEspnNames?: readonly string[]
  lineupSlots?: readonly string[]
  irSlots?: number
  /** Players whose stats to keep (those without a projection); all matched players when omitted. */
  needsStats?: ReadonlySet<string>
}

/**
 * Compare an ESPN snapshot with 9dub's rosters and say what to change:
 * roster moves (adds, drops, trades), IR placements, team names and matchup
 * opponents. ESPN is the source of truth; players are matched by name (NBA
 * team breaks ties). Pure — the store applies the plan.
 */
export function planEspnSync(snap: EspnSnapshot, input: EspnPlanInput): EspnPlan | { error: string } {
  if (snap.teams.length !== input.teams) return { error: `ESPN has ${snap.teams.length} teams; 9dub is set up for ${input.teams}. Fix the team count in Settings → League.` }
  if (!snap.teams.some((t) => t.roster.length)) return { error: 'ESPN rosters are empty (has the draft happened?).' }

  const match = nameMatcher(input.records)

  const names = Array.from({ length: input.teams }, (_, i) => input.teamNames[i] ?? `Team ${i + 1}`)
  const nextNames = [...names]
  const changes: string[] = []
  for (const t of snap.teams) {
    const i = t.slot - 1
    const espnChanged = input.lastEspnNames?.[i] !== t.name
    if (nextNames[i] !== t.name && espnChanged) {
      if (!/^Team \d+$/.test(nextNames[i])) changes.push(`${nextNames[i]} is now ${t.name}`)
      nextNames[i] = t.name
    }
  }
  const label = (slot: number | null) => (slot == null ? 'free agency' : nextNames[slot])

  const target = new Map<string, number>()
  const onIr = new Set<string>()
  const players: Record<string, EspnPlayerInfo> = {}
  const unmatched: string[] = []
  for (const t of snap.teams) {
    for (const e of t.roster) {
      const id = match(e.name, e.nbaTeam)
      if (!id) {
        unmatched.push(`${e.name} (${t.name})`)
        continue
      }
      target.set(id, t.slot - 1)
      if (e.lineupSlot === 'IR') onIr.add(id)
      players[id] = { team: e.nbaTeam, positions: e.positions, status: e.injuryStatus && e.injuryStatus !== 'ACTIVE' ? e.injuryStatus : null }
    }
  }

  const { teamOf } = currentRosters(input.draftRosters, input.moves)
  const nameOf = new Map(input.records.map((r) => [r.id, r.fullName]))
  const moves: EspnPlan['moves'] = []
  for (const id of new Set([...teamOf.keys(), ...target.keys()])) {
    const from = teamOf.get(id) ?? null
    const to = target.get(id) ?? null
    if (from !== to) moves.push({ playerId: id, from, to })
  }
  // Drops first, so a team never looks over the limit mid-way.
  moves.sort((a, b) => (a.to == null ? 0 : 1) - (b.to == null ? 0 : 1))
  for (const m of moves) {
    const who = nameOf.get(m.playerId) ?? m.playerId
    changes.push(m.to == null ? `${label(m.from)} dropped ${who}` : m.from == null ? `${label(m.to)} added ${who}` : `${who}: ${label(m.from)} → ${label(m.to)}`)
  }

  const hurt = activeInjuries(input.injuries, input.today)
  const irAdd = [...onIr].filter((id) => !hurt.has(id))
  const irClear = input.injuries.filter((i) => i.note === ESPN_IR_NOTE && !onIr.has(i.playerId)).map((i) => i.playerId)
  for (const id of irAdd) changes.push(`${label(target.get(id) ?? null)} put ${nameOf.get(id)} on IR`)
  for (const id of irClear) changes.push(`${nameOf.get(id)} is off IR`)

  let weeks: MatchupWeek[] | null = null
  if (input.userSlot != null && !input.weeks.length && snap.weeks.length) {
    // No schedule yet: ESPN's weeks and opponents.
    const me = input.userSlot
    weeks = snap.weeks.map((w) => {
      const m = snap.schedule.find((s) => s.period === w.period && (s.home === me || s.away === me))
      const opp = m ? ((m.home === me ? m.away : m.home) ?? null) : null
      return { id: `espn-wk-${w.period}`, start: w.start, end: w.end, opponent: opp == null ? null : opp - 1, label: opp == null ? '' : nextNames[opp - 1], owner: '', away: !!m && m.home !== me }
    })
    changes.push(`Schedule: ${weeks.length} weeks from ESPN`)
  } else if (input.userSlot != null && input.weeks.length) {
    const me = input.userSlot
    const sorted = [...input.weeks].sort((a, b) => a.start.localeCompare(b.start))
    let changed = false
    const next = sorted.map((w, k) => {
      const m = snap.schedule.find((s) => s.period === k + 1 && (s.home === me || s.away === me))
      if (!m) return w
      const opp = (m.home === me ? m.away : m.home) ?? null
      if (opp == null) return w
      const patch = { opponent: opp - 1, label: nextNames[opp - 1], away: m.home !== me }
      if (w.opponent !== patch.opponent) changes.push(`Week ${k + 1}: you play ${patch.label}`)
      if (w.opponent === patch.opponent && w.label === patch.label && w.away === patch.away) return w
      changed = true
      return { ...w, ...patch }
    })
    weeks = changed ? next : null
  }

  const lineup =
    snap.lineup && input.lineupSlots && (snap.lineup.ir !== input.irSlots || snap.lineup.slots.join(' ') !== input.lineupSlots.join(' ')) ? snap.lineup : null
  if (lineup) changes.push(`Lineup: ${lineup.slots.join(' ')}${lineup.ir ? ` + ${lineup.ir} IR` : ''}`)

  // Stats are matched on their own (rostered players and free agents alike), so roster matching is unaffected.
  const matchStats = nameMatcher(input.records)
  const stats: EspnSync['stats'] = {}
  for (const p of snap.playerStats) {
    const id = matchStats(p.name, p.nbaTeam)
    if (!id || (input.needsStats && !input.needsStats.has(id))) continue
    stats[id] = { team: p.nbaTeam, positions: p.positions, season: p.season, recent: p.recent, prior: p.prior }
  }

  return {
    moves,
    irAdd,
    irClear,
    teamNames: nextNames.some((n, i) => n !== names[i]) ? nextNames : null,
    weeks,
    players,
    changes,
    unmatched,
    lineup,
    stats,
  }
}

export interface EspnDraftPlan {
  picks: Omit<DraftPick, 'at'>[]
  /** Drafted players 9dub has no record of: added as player-list entries without a projection. */
  stubs: DatasetRecord[]
}

/**
 * ESPN's draft as 9dub picks, for a draft not recorded in 9dub (first-time setup).
 * A pick by a team other than the snake order's (a traded pick) keeps ESPN's team.
 */
export function planEspnDraft(picks: readonly EspnDraftPick[], records: readonly NameRecord[], teams: number): EspnDraftPlan {
  const match = nameMatcher(records)
  const stubs: DatasetRecord[] = []
  const out = picks.map((p) => {
    let id = p.name ? match(p.name, p.nbaTeam) : null
    if (!id) {
      id = `espn-${p.espnId}`
      stubs.push({ identity: { id, fullName: p.name ?? `ESPN player ${p.espnId}`, aliases: [], nbaTeam: p.nbaTeam, espnId: String(p.espnId), positions: [] }, projection: null })
    }
    const teamIndex = p.slot - 1
    return { overall: p.overall, playerId: id, teamIndex, manualTeam: teamIndex !== teamForPick(p.overall, { teams }) }
  })
  return { picks: out, stubs }
}
