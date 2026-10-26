/**
 * Real-data test fixture. Loads the private snapshot produced by
 * `npm run data:ingest` (.local-data/real-2026-27.json, git-ignored). When the
 * file is absent — a fresh clone, CI — `hasRealData` is false and the real-data
 * suites skip; nothing proprietary is ever committed as a fixture.
 *
 * The environment mirrors src/store/derived.ts (computeEngine / computeLive)
 * without React or IndexedDB.
 */
import {
  candidateBuilds,
  categoryCorrelations,
  evaluateBuilds,
  leagueScale,
  picksForSlot,
  recommend,
  snakeOrder,
  teamProfile,
  valuePlayers,
  type BuildEvaluation,
  type BuildLock,
  type EngineContext,
  type EnginePlayer,
  type RecMode,
  type RecommendResult,
  type ValuationBasis,
} from '@/analytics'
import type { Position } from '@/analytics/positions'
import { toEngineLine } from '@/data/engineAdapter'
import { canonicalKey } from '@/data/normalize'
import { DatasetSnapshotSchema, type DatasetSnapshot } from '@/data/schema'

const files = import.meta.glob('/.local-data/real-2026-27.json', { eager: true, import: 'default' })
const raw = Object.values(files)[0]

export const realSnapshot: DatasetSnapshot | null = raw ? DatasetSnapshotSchema.parse(raw) : null
export const hasRealData = !!realSnapshot

export interface RealEnv {
  ds: DatasetSnapshot
  players: EnginePlayer[]
  valuation: ReturnType<typeof valuePlayers>
  ctx: EngineContext
  scale: ReturnType<typeof leagueScale>
  teams: number
  rounds: number
  complete: Set<string>
  /** id by any name the sources use (accent/suffix-insensitive). */
  id: (name: string) => string
  name: (id: string) => string
  adp: (id: string) => number | null
  positions: (id: string) => string[]
  /** All valued ids in expected draft order (ESPN ADP, then 9dub value). */
  adpOrder: string[]
}

export function realEnv(opts: { profile?: string; estimateVolume?: boolean; poolSize?: number; basis?: ValuationBasis; teams?: number; rounds?: number } = {}): RealEnv {
  const ds = realSnapshot!
  const teams = opts.teams ?? 12
  const rounds = opts.rounds ?? 13
  const lines = ds.players.map((r) => toEngineLine(r, undefined, { profile: opts.profile ?? 'default', estimateVolume: opts.estimateVolume ?? false })).filter((l) => l != null)
  const players = lines.map((l) => l.player)
  const valuation = valuePlayers(players, { poolSize: opts.poolSize ?? 200, teams, rounds, fullSeasonGames: 82 })
  const ctx: EngineContext = { valuation, lines: new Map(players.map((p) => [p.id, { line: p.line, gp: p.gp }])), basis: opts.basis ?? 'perGame', rosterSize: rounds }
  const scale = leagueScale(ctx, teams)
  const byKey = new Map<string, string>()
  for (const r of ds.players) for (const n of [r.identity.fullName, ...r.identity.aliases]) byKey.set(canonicalKey(n), r.identity.id)
  const recById = new Map(ds.players.map((r) => [r.identity.id, r]))
  const adp = (id: string) => recById.get(id)?.projection?.espnAdp ?? null
  const rank = (id: string) => valuation.values.get(id)?.rank ?? 9999
  const adpOrder = [...valuation.values.keys()].sort((a, b) => (adp(a) ?? 1000 + rank(a)) - (adp(b) ?? 1000 + rank(b)))
  return {
    ds,
    players,
    valuation,
    ctx,
    scale,
    teams,
    rounds,
    complete: new Set([...valuation.values.values()].filter((v) => v.complete).map((v) => v.id)),
    id: (name) => {
      const id = byKey.get(canonicalKey(name))
      if (!id) throw new Error(`Player not in the real snapshot: ${name}`)
      return id
    },
    name: (id) => recById.get(id)?.identity.fullName ?? id,
    adp,
    positions: (id) => recById.get(id)?.identity.positions ?? [],
    adpOrder,
  }
}

/** Recommendation call shaped like the live draft (only complete players are candidates). */
export function recFor(
  env: RealEnv,
  o: { myRoster: string[]; opponents?: string[][] | null; taken?: Iterable<string>; round?: number; mode?: RecMode; lock?: BuildLock | null; currentPick?: number; myPicks?: number[] },
): RecommendResult {
  const taken = new Set([...(o.taken ?? []), ...o.myRoster, ...(o.opponents ?? []).flat()])
  const available = env.valuation.orderPerGame.filter((id) => !taken.has(id) && env.complete.has(id))
  const next = o.myPicks?.find((p) => p >= (o.currentPick ?? 0)) ?? null
  const following = o.myPicks?.find((p) => next != null && p > next) ?? null
  return recommend({
    ctx: env.ctx,
    scale: env.scale,
    teams: env.teams,
    available,
    myRoster: o.myRoster,
    opponentRosters: o.opponents ?? null,
    adp: env.adp,
    timing: o.currentPick != null ? { currentPick: o.currentPick, decisionPick: next, followingPick: following } : null,
    mode: o.mode ?? 'adaptive',
    lock: o.lock ?? null,
    round: o.round ?? Math.min(env.rounds, o.myRoster.length + 1),
    positions: (id) => env.positions(id) as Position[],
  })
}

export function buildsFor(env: RealEnv, myRoster: string[], taken: Set<string>, slot: number, currentPick: number): BuildEvaluation[] {
  const pairs = categoryCorrelations(env.valuation, env.ctx.basis)
  const available = env.valuation.orderPerGame.filter((id) => !taken.has(id) && env.complete.has(id))
  const future = picksForSlot(slot, env.teams, env.rounds).filter((p) => p >= currentPick)
  return evaluateBuilds(
    { ctx: env.ctx, scale: env.scale, myRoster, available, adpOrder: env.adpOrder.filter((id) => !taken.has(id)), myFuturePicks: future, currentPick },
    candidateBuilds(pairs),
  )
}

/**
 * Simulate a full snake draft: every team except mine takes the best
 * remaining player by ESPN ADP (with value as tie-break); I take the top
 * Best Draft Decision. Returns the rosters in pick order.
 */
export function simulateDraft(env: RealEnv, mySlot: number, pickFor?: (rec: RecommendResult, pick: number, roster: string[]) => string): { rosters: string[][]; order: ReturnType<typeof snakeOrder> } {
  const order = snakeOrder(env.teams, env.rounds)
  const rosters: string[][] = Array.from({ length: env.teams }, () => [])
  const taken = new Set<string>()
  const myPicks = picksForSlot(mySlot, env.teams, env.rounds)
  order.forEach(({ teamIndex: team, overall: pick }) => {
    let id: string
    if (team === mySlot - 1) {
      const rec = recFor(env, { myRoster: rosters[team], opponents: rosters.filter((_, t) => t !== team), taken, currentPick: pick, myPicks, round: Math.ceil(pick / env.teams) })
      id = pickFor ? pickFor(rec, pick, rosters[team]) : rec.bestDecision[0].id
    } else id = env.adpOrder.find((x) => !taken.has(x))!
    taken.add(id)
    rosters[team].push(id)
  })
  return { rosters, order }
}

export function profileOf(env: RealEnv, ids: string[]) {
  return teamProfile(ids, env.ctx)
}
