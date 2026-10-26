import { pickSlot, picksForSlot } from '@/analytics/draftOrder'
import type { DraftPick, DraftSession, LeagueSettings } from './schema'

/**
 * Pure draft mechanics. The pick list is the single source of truth: rosters,
 * availability and the clock are all derived from it, so editing any
 * historical pick re-derives everything downstream consistently.
 */
export interface DraftDerived {
  totalPicks: number
  picksByOverall: Map<number, DraftPick>
  draftedBy: Map<string, DraftPick>
  rosters: string[][]
  maxRecorded: number
  /** Next pick to be entered (explicit target or max recorded + 1); null when complete. */
  currentPick: number | null
  onClockTeam: number | null
  /** Unrecorded pick numbers before the latest recorded pick (partial-log mode). */
  gaps: number[]
  isPartial: boolean
  complete: boolean
  round: number
  userTeam: number | null
  userPicks: number[]
  /** My next pick at or after the current pick. */
  nextUserPick: number | null
  /** My pick after `nextUserPick`. */
  followingUserPick: number | null
  picksUntilUser: number | null
  isUserOnClock: boolean
}

export function teamForPick(overall: number, settings: Pick<LeagueSettings, 'teams'>): number {
  return pickSlot(overall, settings.teams).teamIndex
}

export function deriveDraft(session: DraftSession, settings: LeagueSettings): DraftDerived {
  const totalPicks = settings.teams * settings.rounds
  const picksByOverall = new Map<number, DraftPick>()
  const draftedBy = new Map<string, DraftPick>()
  const rosters: string[][] = Array.from({ length: settings.teams }, () => [])
  const sorted = [...session.picks].sort((a, b) => a.overall - b.overall)
  let maxRecorded = 0
  for (const p of sorted) {
    picksByOverall.set(p.overall, p)
    draftedBy.set(p.playerId, p)
    if (p.teamIndex < settings.teams) rosters[p.teamIndex].push(p.playerId)
    maxRecorded = Math.max(maxRecorded, p.overall)
  }
  const gaps: number[] = []
  for (let o = 1; o < maxRecorded; o++) if (!picksByOverall.has(o)) gaps.push(o)

  let currentPick: number | null = null
  if (session.targetPick != null && !picksByOverall.has(session.targetPick) && session.targetPick <= totalPicks)
    currentPick = session.targetPick
  else if (maxRecorded < totalPicks) currentPick = maxRecorded + 1
  else if (gaps.length) currentPick = gaps[0]
  const complete = currentPick == null

  const userTeam = settings.userSlot != null && settings.userSlot <= settings.teams ? settings.userSlot - 1 : null
  const userPicks = userTeam == null ? [] : picksForSlot(userTeam + 1, settings.teams, settings.rounds)
  const from = currentPick ?? totalPicks + 1
  const remainingMine = userPicks.filter((p) => p >= from && !picksByOverall.has(p))
  const nextUserPick = remainingMine[0] ?? null
  const followingUserPick = remainingMine[1] ?? null
  const onClockTeam = currentPick == null ? null : teamForPick(currentPick, settings)
  return {
    totalPicks,
    picksByOverall,
    draftedBy,
    rosters,
    maxRecorded,
    currentPick,
    onClockTeam,
    gaps,
    isPartial: gaps.length > 0,
    complete,
    round: currentPick == null ? settings.rounds : pickSlot(currentPick, settings.teams).round,
    userTeam,
    userPicks,
    nextUserPick,
    followingUserPick,
    picksUntilUser: nextUserPick == null || currentPick == null ? null : nextUserPick - currentPick,
    isUserOnClock: nextUserPick != null && nextUserPick === currentPick,
  }
}

export type DraftResult = { ok: true; session: DraftSession; message: string } | { ok: false; error: string }

type Names = (id: string) => string

function teamName(settings: LeagueSettings, i: number): string {
  return settings.teamNames[i]?.trim() || `Team ${i + 1}`
}

function stamp(session: DraftSession, picks: DraftPick[], kind: DraftSession['log'][number]['kind'], text: string, now: number, targetPick = session.targetPick): DraftSession {
  return {
    ...session,
    picks: [...picks].sort((a, b) => a.overall - b.overall),
    updatedAt: now,
    targetPick,
    log: [...session.log, { at: now, kind, text }].slice(-500),
  }
}

export function addPick(
  session: DraftSession,
  settings: LeagueSettings,
  playerId: string,
  opts: { overall?: number; teamIndex?: number } = {},
  names: Names = (id) => id,
  now = Date.now(),
): DraftResult {
  const d = deriveDraft(session, settings)
  const existing = d.draftedBy.get(playerId)
  if (existing)
    return { ok: false, error: `${names(playerId)} was already drafted by ${teamName(settings, existing.teamIndex)} at pick ${existing.overall}.` }
  const overall = opts.overall ?? d.currentPick
  if (overall == null) return { ok: false, error: 'The draft is complete.' }
  if (overall < 1 || overall > d.totalPicks) return { ok: false, error: `Pick ${overall} is outside this draft (1–${d.totalPicks}).` }
  if (d.picksByOverall.has(overall)) return { ok: false, error: `Pick ${overall} is already recorded — edit it instead.` }
  const defaultTeam = teamForPick(overall, settings)
  const teamIndex = opts.teamIndex ?? defaultTeam
  if (teamIndex < 0 || teamIndex >= settings.teams) return { ok: false, error: 'Invalid team.' }
  if (settings.enforceRoster && d.rosters[teamIndex].length >= settings.rounds)
    return { ok: false, error: `${teamName(settings, teamIndex)} already has a full roster (${settings.rounds}).` }
  const pick: DraftPick = { overall, playerId, teamIndex, at: now, manualTeam: teamIndex !== defaultTeam }
  const text = `#${overall} ${teamName(settings, teamIndex)}: ${names(playerId)}`
  const target = session.targetPick === overall ? null : session.targetPick
  return { ok: true, session: stamp(session, [...session.picks, pick], 'pick', text, now, target), message: text }
}

export function removePick(session: DraftSession, settings: LeagueSettings, overall: number, names: Names = (id) => id, now = Date.now()): DraftResult {
  const p = session.picks.find((x) => x.overall === overall)
  if (!p) return { ok: false, error: `No pick recorded at #${overall}.` }
  const text = `Removed #${overall} ${teamName(settings, p.teamIndex)}: ${names(p.playerId)}`
  return { ok: true, session: stamp(session, session.picks.filter((x) => x.overall !== overall), 'remove', text, now), message: text }
}

export function editPick(
  session: DraftSession,
  settings: LeagueSettings,
  overall: number,
  changes: { playerId?: string; teamIndex?: number },
  names: Names = (id) => id,
  now = Date.now(),
): DraftResult {
  const p = session.picks.find((x) => x.overall === overall)
  if (!p) return { ok: false, error: `No pick recorded at #${overall}.` }
  if (changes.playerId && changes.playerId !== p.playerId) {
    const dup = session.picks.find((x) => x.playerId === changes.playerId)
    if (dup) return { ok: false, error: `${names(changes.playerId)} is already recorded at pick ${dup.overall}.` }
  }
  const teamIndex = changes.teamIndex ?? p.teamIndex
  if (teamIndex < 0 || teamIndex >= settings.teams) return { ok: false, error: 'Invalid team.' }
  const next: DraftPick = {
    ...p,
    playerId: changes.playerId ?? p.playerId,
    teamIndex,
    manualTeam: teamIndex !== teamForPick(overall, settings),
    at: now,
  }
  const parts: string[] = []
  if (next.playerId !== p.playerId) parts.push(`${names(p.playerId)} → ${names(next.playerId)}`)
  if (next.teamIndex !== p.teamIndex) parts.push(`${teamName(settings, p.teamIndex)} → ${teamName(settings, next.teamIndex)}`)
  const text = `Edited #${overall}: ${parts.join(', ') || 'no change'}`
  return { ok: true, session: stamp(session, session.picks.map((x) => (x.overall === overall ? next : x)), 'edit', text, now), message: text }
}

/** Validate a settings change against recorded picks. */
export function settingsChangeError(session: DraftSession, prev: LeagueSettings, next: LeagueSettings): string | null {
  if (!session.picks.length) return null
  if (next.teams !== prev.teams) return 'Team count cannot change while picks are recorded. Save and reset the draft first.'
  const maxOverall = Math.max(...session.picks.map((p) => p.overall))
  if (next.teams * next.rounds < maxOverall) return `Rounds cannot drop below the latest recorded pick (#${maxOverall}).`
  return null
}

export function newSession(name = 'Live draft', now = Date.now()): DraftSession {
  return { id: `draft-${now.toString(36)}`, name, createdAt: now, updatedAt: now, picks: [], log: [], targetPick: null }
}

/**
 * Players whose availability is uncertain because some earlier picks were not
 * recorded: the undrafted players most likely (by ADP order) to have gone in
 * those unrecorded picks. Returned as a set of ids; the UI labels them
 * "possibly taken" rather than pretending they are available.
 */
export function uncertainAvailability(
  gaps: number,
  undraftedByAdp: readonly string[],
): Set<string> {
  if (gaps <= 0) return new Set()
  return new Set(undraftedByAdp.slice(0, Math.ceil(gaps * 1.5)))
}
