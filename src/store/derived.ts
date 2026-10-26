import { useApp } from './appStore'
import { deriveDraft, uncertainAvailability, type DraftDerived } from './draftLogic'
import type { EspnSync, Injury, LeagueSettings, RosterMove } from './schema'
import { currentRosters, irPlacement, todayIso } from './season'
import {
  CATEGORIES,
  candidateBuilds,
  categoryCorrelations,
  evaluateBuilds,
  leagueScale,
  picksForSlot,
  recommend,
  teamProfile,
  typicalAtStage,
  valuePlayers,
  type BuildDef,
  type BuildEvaluation,
  type BuildLock,
  type CatRecord,
  type Category,
  type CategoryPair,
  type EngineContext,
  type EnginePlayer,
  type LeagueScale,
  type RecMode,
  type RecommendResult,
  type StatLine,
  type TeamProfile,
  type TimingContext,
  type UtilityContext,
  type ValuationResult,
} from '@/analytics'
import { DEFAULT_LINEUP, slotDefs, type Position, type SlotDef } from '@/analytics/positions'
import { toEngineLine, type VolumeOrigin } from '@/data/engineAdapter'
import { normalizeName, qualityLevel } from '@/data/normalize'
import type { DatasetRecord, DatasetSnapshot, PlayerProjection, ProjectionOverride } from '@/data/schema'

/** Single-entry memo keyed on argument identity — shared by every component. */
function memoOne<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | null = null
  let last: R
  return (...args: A) => {
    if (lastArgs && lastArgs.length === args.length && lastArgs.every((a, i) => Object.is(a, args[i]))) return last
    lastArgs = args
    last = fn(...args)
    return last
  }
}

export interface PlayerInfo {
  id: string
  name: string
  team: string | null
  positions: Position[]
  rec: DatasetRecord
  /** The record's default projection; null for directory-only players. */
  proj: PlayerProjection | null
  /** Has an engine line under the current projection options (directory-only players do not). */
  valued: boolean
  /** All nine categories computable under the current options. */
  complete: boolean
  /** Projection profile actually used for this player's engine line. */
  profileUsed: string | null
  volume: { fg: VolumeOrigin; ft: VolumeOrigin } | null
  /** The per-game line the engine values (after profile choice and overrides); null when unvalued. */
  line: StatLine | null
  gp: number | null
  /** Displayed percentages for the line in use (from makes/attempts when known, else the source's percentage). */
  fgPct: number | null
  ftPct: number | null
  /** ESPN ADP if present, else the other ADP (labelled). Used for timing heuristics. */
  adp: number | null
  adpSource: string | null
  /** Why there is no usable ADP although a market row exists (e.g. ESPN's ~140 ceiling). */
  adpNote: string | null
  quality: 'complete' | 'partial' | 'limited' | 'none'
  overridden: boolean
  searchKey: string
}

export interface EngineData {
  dataset: DatasetSnapshot
  players: PlayerInfo[]
  byId: Map<string, PlayerInfo>
  enginePlayers: EnginePlayer[]
  valuation: ValuationResult
  ctx: EngineContext
  scale: LeagueScale
  pairs: CategoryPair[]
  baseBuilds: BuildDef[]
  /** All player ids in expected draft order (ADP, then value rank for players without ADP). */
  adpOrder: string[]
  /** Valued players whose nine categories are all computable. */
  completeIds: Set<string>
}

export interface ProjectionChoice {
  profile: string
  estimateVolume: boolean
}

function adpLabel(p: PlayerProjection | null, rec: DatasetRecord): { adp: number | null; source: string | null; note: string | null } {
  // Real-data snapshots carry a market block: ESPN Live Draft Trends first, then the FantasyPros ESPN ordinal.
  // It applies to unprojected players too, so the board's expected order and "possibly taken" stay right.
  const m = rec.market
  // An ESPN ADP the user merged in later (Settings → Import) is newer than the snapshot's capture.
  if (p?.espnAdpSource === 'import' && p.espnAdp != null) return { adp: p.espnAdp, source: 'ESPN', note: null }
  if (m?.espnLive) {
    if (!m.espnLive.capped) return { adp: m.espnLive.avgPick, source: 'ESPN live', note: null }
    return { adp: null, source: null, note: `ESPN AVG PICK ${m.espnLive.avgPick.toFixed(1)} — at ESPN's ~140 ceiling (rarely drafted)` }
  }
  if (m?.fantasyPros?.espn != null) return { adp: m.fantasyPros.espn, source: 'ESPN via FantasyPros', note: null }
  if (p?.espnAdp != null) return { adp: p.espnAdp, source: p.espnAdpSource === 'fantasypros-espn' ? 'ESPN via FantasyPros' : 'ESPN', note: null }
  if (p?.otherAdp != null) return { adp: p.otherAdp, source: p.otherAdpLabel ?? 'Other', note: null }
  return { adp: null, source: null, note: null }
}

const computeEngine = memoOne(
  (
    dataset: DatasetSnapshot,
    overrides: Record<string, ProjectionOverride>,
    poolSize: number,
    teams: number,
    rounds: number,
    fullSeasonGames: number,
    basis: 'perGame' | 'gpAware',
    profile: string,
    estimateVolume: boolean,
  ): EngineData => {
    const lineInfo = new Map(dataset.players.map((r) => [r.identity.id, toEngineLine(r, overrides[r.identity.id], { profile, estimateVolume })]))
    const enginePlayers = [...lineInfo.values()].filter((l) => l != null).map((l) => l.player)
    const valuation = valuePlayers(enginePlayers, { poolSize, teams, rounds, fullSeasonGames })
    const ctx: EngineContext = {
      valuation,
      lines: new Map(enginePlayers.map((p) => [p.id, { line: p.line, gp: p.gp }])),
      basis,
      rosterSize: rounds,
    }
    const scale = leagueScale(ctx, teams)
    const pairs = categoryCorrelations(valuation, basis)
    const players: PlayerInfo[] = dataset.players.map((r) => {
      const p = r.projection
      const li = lineInfo.get(r.identity.id) ?? null
      const v = valuation.values.get(r.identity.id)
      const adp = adpLabel(p, r)
      const line = li?.player.line ?? null
      const prof = li && li.profile !== (p?.profile ?? 'default') ? r.profiles?.[li.profile] : null
      const fgPct = line?.fga ? line.fgm! / line.fga : (prof?.fgPct ?? p?.fieldGoalPct ?? null)
      const ftPct = line?.fta ? line.ftm! / line.fta : (prof?.ftPct ?? p?.freeThrowPct ?? null)
      return {
        id: r.identity.id,
        name: r.identity.fullName,
        team: r.identity.nbaTeam,
        positions: r.identity.positions,
        rec: r,
        proj: p,
        valued: !!v,
        complete: !!v?.complete,
        profileUsed: li?.profile ?? null,
        volume: li?.volume ?? null,
        line,
        gp: li?.player.gp ?? null,
        fgPct,
        ftPct,
        adp: adp.adp,
        adpSource: adp.source,
        adpNote: adp.note,
        quality: !li ? 'none' : v?.complete ? (p ? qualityLevel(p.completenessFlags.filter((f) => f !== 'missing-fga' && f !== 'missing-fta' && f !== 'pct-without-volume')) : 'complete') : 'limited',
        overridden: !!overrides[r.identity.id],
        searchKey: [r.identity.fullName, ...r.identity.aliases].map(normalizeName).join(' | '),
      }
    })
    const byId = new Map(players.map((p) => [p.id, p]))
    // Expected draft order: market ADP first, then valued players by value, then unvalued players by expert rank.
    const rankOf = (id: string) => {
      const v = valuation.values.get(id)
      if (v) return basis === 'gpAware' ? v.rankGp : v.rank
      return 2000 + (byId.get(id)!.rec.rankings?.fantasyProsEcr?.rank ?? 1000)
    }
    const adpOrder = players
      .map((p) => ({ id: p.id, k: p.adp ?? 1000 + rankOf(p.id) }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.id)
    const completeIds = new Set(players.filter((p) => p.complete).map((p) => p.id))
    return { dataset, players, byId, enginePlayers, valuation, ctx, scale, pairs, baseBuilds: candidateBuilds(pairs), adpOrder, completeIds }
  },
)

const projectedCount = (d: DatasetSnapshot) => d.players.reduce((n, r) => n + (r.projection ? 1 : 0), 0)

/**
 * After an ESPN sync, rostered players take ESPN's current NBA team and
 * position eligibility (what the schedule and lineups should use). Values are
 * unchanged: only the identity fields shown and scheduled are swapped.
 */
const withEspn = memoOne((engine: EngineData, espn: EspnSync['players'] | undefined): EngineData => {
  if (!espn || !Object.keys(espn).length) return engine
  const players = engine.players.map((p) => {
    const e = espn[p.id]
    if (!e) return p
    return { ...p, team: e.team ?? p.team, positions: e.positions.length ? e.positions : p.positions }
  })
  return { ...engine, players, byId: new Map(players.map((p) => [p.id, p])) }
})

export function getEngine(s: ReturnType<typeof useApp.getState>): EngineData | null {
  if (!s.dataset || projectedCount(s.dataset) < 2) return null
  const st = s.settings
  return withEspn(
    computeEngine(s.dataset, s.overrides, st.poolSize, st.teams, st.rounds, st.fullSeasonGames, st.valuationBasis, st.projectionProfile, st.estimateMissingVolume),
    s.season.espn?.players,
  )
}

export function useEngine(): EngineData | null {
  const dataset = useApp((s) => s.dataset)
  const overrides = useApp((s) => s.overrides)
  const st = useApp((s) => s.settings)
  const espn = useApp((s) => s.season.espn?.players)
  if (!dataset || projectedCount(dataset) < 2) return null
  return withEspn(
    computeEngine(dataset, overrides, st.poolSize, st.teams, st.rounds, st.fullSeasonGames, st.valuationBasis, st.projectionProfile, st.estimateMissingVolume),
    espn,
  )
}

// A tab opened before lineups were saved has none in memory until it reloads: ESPN's standard lineup.
const lineupOf = memoOne((labels: readonly string[] | undefined): SlotDef[] => slotDefs(labels ?? DEFAULT_LINEUP))

/** The league's lineup slots (from ESPN, or ESPN's standard lineup). */
export function useLineupSlots(): SlotDef[] {
  return lineupOf(useApp((s) => s.settings.lineupSlots))
}

const computeDraft = memoOne((draft: Parameters<typeof deriveDraft>[0], settings: LeagueSettings) => deriveDraft(draft, settings))

export function useDraft(): DraftDerived {
  const draft = useApp((s) => s.draft)
  const settings = useApp((s) => s.settings)
  return computeDraft(draft, settings)
}

export function teamLabel(settings: LeagueSettings, i: number): string {
  return settings.teamNames[i]?.trim() || `Team ${i + 1}`
}

// ───────────────────────── live draft analysis ─────────────────────────

export interface LiveAnalysis {
  available: string[]
  /** Per team: drafted players without a projection (shown on rosters, not valued). */
  unvalued: string[][]
  uncertain: Set<string>
  profiles: TeamProfile[]
  myTeam: number | null
  my: TeamProfile
  opponents: CatRecord<number>[]
  utility: UtilityContext
  rec: RecommendResult
  timing: TimingContext | null
  builds: BuildEvaluation[]
  buildsAssumedSlot: number | null
  round: number
  typicalNow: CatRecord<number>
  /** The draft is over: rosters are the current ones (draft + recorded moves) with injured players set aside on IR. */
  postDraft: boolean
  /** Per team: players on IR (post-draft only). */
  ir: string[][]
}

/** Post-draft rosters: draft + recorded moves, with each team's injured players placed on IR. */
export interface RostersNow {
  active: string[][]
  ir: string[][]
  /** Everyone on a roster, IR included. */
  taken: Set<string>
}

const computeRostersNow = memoOne((d: DraftDerived, moves: readonly RosterMove[], injuries: readonly Injury[], irSlots: number, today: string): RostersNow => {
  const { rosters } = currentRosters(d.rosters, moves)
  const placed = rosters.map((r) => irPlacement(r, injuries, irSlots, today))
  return { active: placed.map((p) => p.active), ir: placed.map((p) => p.ir), taken: new Set(rosters.flat()) }
})

const computeLive = memoOne(
  (engine: EngineData, d: DraftDerived, settings: LeagueSettings, mode: RecMode, lock: BuildLock | null, now: RostersNow | null): LiveAnalysis => {
    const { valuation, ctx, scale } = engine
    const basis = ctx.basis
    const order = basis === 'gpAware' ? valuation.orderGp : valuation.orderPerGame
    const taken: { has: (id: string) => boolean } = now ? now.taken : d.draftedBy
    const teamRosters = now ? now.active : d.rosters
    const available = order.filter((id) => !taken.has(id))
    // Recommendations and build simulations only consider players whose nine categories are all known.
    const recAvailable = engine.completeIds.size ? available.filter((id) => engine.completeIds.has(id)) : available
    const currentPick = d.currentPick ?? d.totalPicks + 1
    const undraftedByAdp = engine.adpOrder.filter((id) => !taken.has(id) && (engine.byId.get(id)!.adp ?? Infinity) < currentPick + 6)
    const uncertain = uncertainAvailability(d.gaps.length, undraftedByAdp)
    const profiles = teamRosters.map((r) => teamProfile(r, ctx))
    const myTeam = d.userTeam
    const myRoster = myTeam != null ? teamRosters[myTeam] : []
    const opponentRosters = teamRosters.filter((_, i) => i !== myTeam)
    const timing: TimingContext | null =
      myTeam != null && d.currentPick != null
        ? { currentPick: d.currentPick, decisionPick: d.nextUserPick, followingPick: d.followingUserPick }
        : null
    const round = d.nextUserPick != null ? Math.ceil(d.nextUserPick / settings.teams) : d.round
    const rec = recommend({
      ctx,
      scale,
      teams: settings.teams,
      available: recAvailable,
      myRoster,
      opponentRosters,
      adp: (id) => engine.byId.get(id)?.adp ?? null,
      timing,
      mode,
      lock: mode === 'build' || lock ? lock : null,
      softWeight: settings.softPuntWeight,
      slots: lineupOf(settings.lineupSlots),
      round,
      positions: (id) => engine.byId.get(id)?.positions ?? [],
    })
    const my = rec.my
    const opponents = opponentRosters.map((r) => teamProfile(r, ctx).zSlot)
    const utility: UtilityContext = { sigma: scale.sigma, opponents, weights: rec.catWeights }

    // Builds: use my real future picks, or an assumed middle slot before the slot is known.
    const assumedSlot = myTeam == null ? Math.ceil(settings.teams / 2) : null
    const slot = myTeam != null ? myTeam + 1 : assumedSlot!
    const future = picksForSlot(slot, settings.teams, settings.rounds).filter((p) => p >= (d.currentPick ?? Infinity) && !d.picksByOverall.has(p))
    const weakest = myRoster.length >= 4 ? weakestCategories(my) : undefined
    // After the draft there are no picks left to simulate a build with.
    const builds = now
      ? []
      : evaluateBuilds(
          {
            ctx,
            scale,
            myRoster,
            available: recAvailable,
            adpOrder: engine.adpOrder.filter((id) => !d.draftedBy.has(id)),
            myFuturePicks: future,
            currentPick: d.currentPick ?? d.totalPicks + 1,
          },
          weakest ? candidateBuilds(engine.pairs, { rosterWeakest: weakest }) : engine.baseBuilds,
        )
    return {
      available,
      unvalued: teamRosters.map((r) => r.filter((id) => !valuation.values.has(id))),
      uncertain,
      profiles,
      myTeam,
      my,
      opponents,
      utility,
      rec,
      timing,
      builds,
      buildsAssumedSlot: assumedSlot,
      round,
      typicalNow: typicalAtStage(scale, valuation, my.count),
      postDraft: now != null,
      ir: now ? now.ir : d.rosters.map(() => []),
    }
  },
)

export function weakestCategories(p: TeamProfile): Category[] {
  return [...CATEGORIES].sort((a, b) => p.zPer[a] - p.zPer[b]).slice(0, 2)
}

export function useLive(): LiveAnalysis | null {
  const engine = useEngine()
  const d = useDraft()
  const settings = useApp((s) => s.settings)
  const mode = useApp((s) => s.prefs.recMode)
  const lock = useApp((s) => s.buildLock)
  const moves = useApp((s) => s.season.rosterMoves)
  const injuries = useApp((s) => s.season.injuries)
  if (!engine) return null
  const now = d.complete ? computeRostersNow(d, moves, injuries, settings.irSlots, todayIso()) : null
  return computeLive(engine, d, settings, mode, lock, now)
}

// ───────────────────────── search ─────────────────────────

/** Fast, accent/suffix-insensitive name search with team-code matching. */
export function searchPlayers(engine: EngineData, query: string, opts: { exclude?: Set<string>; limit?: number; basis?: 'perGame' | 'gpAware' } = {}): PlayerInfo[] {
  const q = normalizeName(query)
  if (!q) return []
  const tokens = q.split(' ')
  const limit = opts.limit ?? 12
  const v = engine.valuation.values
  const scored: { p: PlayerInfo; s: number }[] = []
  for (const p of engine.players) {
    if (opts.exclude?.has(p.id)) continue
    const key = p.searchKey
    const words = key.split(/[\s|]+/)
    let s = 0
    let all = true
    for (const t of tokens) {
      if (words.some((w) => w === t)) s += 3
      else if (words.some((w) => w.startsWith(t))) s += 2
      else if (key.includes(t)) s += 1
      else if (p.team && p.team.toLowerCase() === t) s += 1
      else {
        all = false
        break
      }
    }
    if (!all) continue
    if (key.startsWith(q)) s += 2
    const val = v.get(p.id)
    // Unvalued (directory-only) players sort after valued ones with the same name score.
    const rank = val ? (opts.basis === 'gpAware' ? val.rankGp : val.rank) : 900 + (p.rec.rankings?.fantasyProsEcr?.rank ?? 99)
    scored.push({ p, s: s * 1000 - rank })
  }
  return scored
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.p)
}

/** Mean of opponents' slot-adjusted strengths (fallback: a typical team at the same stage). */
export function benchmarkOf(opponents: readonly CatRecord<number>[], fallback: CatRecord<number>): CatRecord<number> {
  if (!opponents.length) return fallback
  const out = {} as CatRecord<number>
  for (const c of CATEGORIES) out[c] = opponents.reduce((s, o) => s + o[c], 0) / opponents.length
  return out
}
