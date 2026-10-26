import { canonicalKey } from '@/data/normalize'
import type { DatasetSnapshot } from '@/data/schema'
import type { PersistedState } from './schema'

/**
 * Keep picks and notes attached to the right players when the
 * active dataset changes. Ids are name-derived and stable across refreshes,
 * so most references already match; for the rest (a renamed player, an
 * alias, an older snapshot) we look the old id up in any snapshot that knows
 * it and match by canonical name, using team only to break ties. Anything we
 * cannot match uniquely is left untouched and reported — never guessed.
 *
 * Fictional demo players are never mapped onto real players (or back).
 */

export interface RemapPlan {
  map: Map<string, string>
  unmatched: { id: string; name: string | null; reason: string }[]
  /** References already valid in the new dataset. */
  kept: number
}

/** Every player id the persisted state refers to. */
export function referencedIds(s: Pick<PersistedState, 'draft' | 'undoStack' | 'savedDrafts' | 'shortlist' | 'overrides'> & Partial<Pick<PersistedState, 'season'>>, extra: readonly string[] = []): Set<string> {
  const ids = new Set<string>(extra)
  const fromSession = (picks: { playerId: string }[]) => picks.forEach((p) => ids.add(p.playerId))
  fromSession(s.draft.picks)
  s.undoStack.forEach((d) => fromSession(d.picks))
  s.savedDrafts.forEach((d) => fromSession(d.session.picks))
  s.shortlist.forEach((id) => ids.add(id))
  Object.keys(s.overrides).forEach((id) => ids.add(id))
  s.season?.rosterMoves.forEach((m) => ids.add(m.playerId))
  s.season?.injuries.forEach((i) => ids.add(i.playerId))
  return ids
}

export function planIdRemap(refs: Iterable<string>, next: DatasetSnapshot, known: readonly DatasetSnapshot[]): RemapPlan {
  const nextIds = new Set(next.players.map((p) => p.identity.id))
  const byKey = new Map<string, DatasetSnapshot['players']>()
  for (const r of next.players)
    for (const n of new Set([r.identity.fullName, ...r.identity.aliases].map(canonicalKey))) byKey.set(n, [...(byKey.get(n) ?? []), r])

  const map = new Map<string, string>()
  const unmatched: RemapPlan['unmatched'] = []
  let kept = 0
  for (const id of refs) {
    if (nextIds.has(id)) {
      kept++
      continue
    }
    const source = known.find((d) => d.players.some((p) => p.identity.id === id))
    const old = source?.players.find((p) => p.identity.id === id)
    if (!source || !old) {
      unmatched.push({ id, name: null, reason: 'not found in any stored snapshot' })
      continue
    }
    if ((source.kind === 'demo') !== (next.kind === 'demo')) {
      unmatched.push({ id, name: old.identity.fullName, reason: source.kind === 'demo' ? 'fictional demo player' : 'real player has no counterpart in the demo pool' })
      continue
    }
    const keys = new Set([old.identity.fullName, ...old.identity.aliases].map(canonicalKey))
    const cands = [...new Set([...keys].flatMap((k) => byKey.get(k) ?? []))]
    let pick = cands.length === 1 ? cands[0] : null
    if (cands.length > 1) {
      const sameTeam = cands.filter((c) => old.identity.nbaTeam && c.identity.nbaTeam === old.identity.nbaTeam)
      pick = sameTeam.length === 1 ? sameTeam[0] : null
    }
    if (pick) map.set(id, pick.identity.id)
    else unmatched.push({ id, name: old.identity.fullName, reason: cands.length ? 'several players share this name' : 'no player with this name in the new snapshot' })
  }
  return { map, unmatched, kept }
}

type RemappableState = Pick<PersistedState, 'draft' | 'undoStack' | 'savedDrafts' | 'shortlist' | 'overrides'> & Partial<Pick<PersistedState, 'season'>>

/** Rewrite player ids throughout the persisted state. Pure; returns new objects only where something changed. */
export function applyIdRemap<S extends RemappableState>(s: S, map: ReadonlyMap<string, string>): S {
  if (!map.size) return s
  const m = (id: string) => map.get(id) ?? id
  const session = <T extends { picks: { playerId: string }[] }>(d: T): T =>
    d.picks.some((p) => map.has(p.playerId)) ? { ...d, picks: d.picks.map((p) => (map.has(p.playerId) ? { ...p, playerId: m(p.playerId) } : p)) } : d
  const overrides: PersistedState['overrides'] = {}
  for (const [id, ov] of Object.entries(s.overrides)) overrides[m(id)] = ov
  return {
    ...s,
    draft: session(s.draft),
    undoStack: s.undoStack.map(session),
    savedDrafts: s.savedDrafts.map((d) => {
      const next = session(d.session)
      return next === d.session ? d : { ...d, session: next }
    }),
    shortlist: [...new Set(s.shortlist.map(m))],
    overrides,
    ...(s.season
      ? {
          season:
            s.season.rosterMoves.some((mv) => map.has(mv.playerId)) || s.season.injuries.some((i) => map.has(i.playerId))
              ? { ...s.season, rosterMoves: s.season.rosterMoves.map((mv) => ({ ...mv, playerId: m(mv.playerId) })), injuries: s.season.injuries.map((i) => ({ ...i, playerId: m(i.playerId) })) }
              : s.season,
        }
      : {}),
  }
}
