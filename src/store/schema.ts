import { z } from 'zod'
import { CATEGORIES } from '@/analytics/categories'
import { DEFAULT_LINEUP } from '@/analytics/positions'
import { EspnLiveSchema, EspnResultSchema, EspnStandingSchema, EspnStatLineSchema } from '@/data/espn'
import { DatasetSnapshotSchema, OverrideSchema, PositionSchema } from '@/data/schema'

/**
 * Persisted app state (IndexedDB + session export). Versioned so future
 * shape changes can be migrated in `migrateState`.
 */
export const STATE_SCHEMA_VERSION = 1

const CategorySchema = z.enum(CATEGORIES)

export const BuildLockSchema = z.object({
  punts: z.array(CategorySchema).max(2),
  mode: z.enum(['soft', 'hard']),
})

export const LeagueSettingsSchema = z.object({
  leagueName: z.string().default('My league'),
  teams: z.number().int().min(4).max(20).default(12),
  rounds: z.number().int().min(1).max(30).default(13),
  /** 1-based draft slot; null until the user learns it. */
  userSlot: z.number().int().min(1).max(20).nullable().default(null),
  teamNames: z.array(z.string()).default([]),
  valuationBasis: z.enum(['perGame', 'gpAware']).default('perGame'),
  /** 'default' = each record's default line; otherwise a dataset profile id (e.g. 'espn'). */
  projectionProfile: z.string().default('default'),
  /** Opt-in: estimate FGA/FTA from the points identity for lines that have FG%/FT% but no attempts. */
  estimateMissingVolume: z.boolean().default(false),
  poolSize: z.number().int().min(20).max(400).default(200),
  /** IR slots per team (injured players there don't count toward the roster size). */
  irSlots: z.number().int().min(0).max(5).default(2),
  /** Starting slots then bench, by ESPN's slot names (PG, SG, SF, PF, C, G, F, SG/SF, G/F, PF/C, F/C, UTIL, BE); IR is `irSlots`. */
  lineupSlots: z.array(z.string()).min(1).default([...DEFAULT_LINEUP]),
  fullSeasonGames: z.number().int().min(40).max(82).default(82),
  softPuntWeight: z.number().min(0).max(1).default(0.35),
  enforceRoster: z.boolean().default(false),
  confirmOnEnter: z.boolean().default(false),
})
export type LeagueSettings = z.infer<typeof LeagueSettingsSchema>

export const DraftPickSchema = z.object({
  overall: z.number().int().min(1),
  playerId: z.string(),
  teamIndex: z.number().int().min(0),
  at: z.number(),
  /** True when the team was set manually (trade / correction) rather than from snake order. */
  manualTeam: z.boolean().default(false),
})
export type DraftPick = z.infer<typeof DraftPickSchema>

export const DraftLogEntrySchema = z.object({
  at: z.number(),
  kind: z.enum(['pick', 'undo', 'edit', 'remove', 'reset', 'restore', 'settings']),
  text: z.string(),
})
export type DraftLogEntry = z.infer<typeof DraftLogEntrySchema>

export const DraftSessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  picks: z.array(DraftPickSchema).default([]),
  log: z.array(DraftLogEntrySchema).default([]),
  /** Explicit pick number to fill next (repairs / own-picks-only logging). */
  targetPick: z.number().int().nullable().default(null),
})
export type DraftSession = z.infer<typeof DraftSessionSchema>

export const SavedDraftSchema = z.object({
  id: z.string(),
  name: z.string(),
  savedAt: z.number(),
  session: DraftSessionSchema,
  league: z.object({ teams: z.number(), rounds: z.number(), userSlot: z.number().nullable(), teamNames: z.array(z.string()) }),
})
export type SavedDraft = z.infer<typeof SavedDraftSchema>

export const PrefsSchema = z.object({
  theme: z.enum(['dark', 'light']).default('dark'),
  tableMode: z.enum(['compact', 'advanced']).default('compact'),
  leagueView: z.enum(['simple', 'advanced']).default('simple'),
  leagueValue: z.enum(['raw', 'score', 'rank']).default('score'),
  leagueBasis: z.enum(['pickAdjusted', 'current', 'perPlayer', 'slotAdjusted']).default('pickAdjusted'),
  recMode: z.enum(['adaptive', 'bpa', 'fit', 'build']).default('adaptive'),
  showDiagnostics: z.boolean().default(false),
  availableOnly: z.boolean().default(true),
  /** The first-run ESPN setup was finished or skipped. */
  setupDone: z.boolean().default(false),
})
export type Prefs = z.infer<typeof PrefsSchema>

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** One head-to-head matchup period of the user's season. */
export const MatchupWeekSchema = z.object({
  id: z.string(),
  start: IsoDate,
  end: IsoDate,
  /** Opponent's 0-based draft slot; null until the user matches the league name to a slot. */
  opponent: z.number().int().min(0).nullable().default(null),
  /** Opponent team name as the league shows it. */
  label: z.string().default(''),
  owner: z.string().default(''),
  away: z.boolean().default(false),
})
export type MatchupWeek = z.infer<typeof MatchupWeekSchema>

/** A post-draft roster change: `playerId` moves from team `from` to team `to` (null = free agents). */
export const RosterMoveSchema = z.object({
  id: z.string(),
  at: z.number(),
  playerId: z.string(),
  from: z.number().int().min(0).nullable(),
  to: z.number().int().min(0).nullable(),
  note: z.string().default(''),
})
export type RosterMove = z.infer<typeof RosterMoveSchema>

/** A player marked out: no games count through `until` (inclusive); null = until further notice. */
export const InjurySchema = z.object({
  playerId: z.string(),
  until: IsoDate.nullable().default(null),
  at: z.number(),
  note: z.string().default(''),
})
export type Injury = z.infer<typeof InjurySchema>

/** The last read-only sync from the user's ESPN league. */
export const EspnSyncSchema = z.object({
  syncedAt: z.number(),
  leagueId: z.number(),
  leagueName: z.string(),
  /** What the last sync changed, in plain language. */
  changes: z.array(z.string()).default([]),
  /** ESPN players 9dub could not match. */
  unmatched: z.array(z.string()).default([]),
  /** Rostered players' current NBA team, ESPN position eligibility and injury designation. */
  players: z.record(z.string(), z.object({ team: z.string().nullable(), positions: z.array(PositionSchema), status: z.string().nullable() })).default({}),
  /** Category totals so far in the matchup in progress. */
  live: EspnLiveSchema.nullable().default(null),
  /** Team names as ESPN had them at this sync (a name you edit in 9dub sticks until ESPN's changes). */
  teamNames: z.array(z.string()).default([]),
  /** Final scores of finished regular-season matchups (every team's). */
  results: z.array(EspnResultSchema).default([]),
  /** Season records in categories and places, as ESPN's standings have them. */
  standings: z.array(EspnStandingSchema).default([]),
  /** Actual stats of players your data has no projection for (rostered, or near the top of free agency): their stand-in lines. */
  stats: z
    .record(
      z.string(),
      z.object({
        team: z.string().nullable(),
        positions: z.array(PositionSchema),
        season: EspnStatLineSchema.nullable(),
        recent: EspnStatLineSchema.nullable(),
        prior: EspnStatLineSchema.nullable(),
      }),
    )
    .default({}),
})
export type EspnSync = z.infer<typeof EspnSyncSchema>

export const SeasonSchema = z.object({
  matchups: z.array(MatchupWeekSchema).default([]),
  rosterMoves: z.array(RosterMoveSchema).default([]),
  injuries: z.array(InjurySchema).default([]),
  espn: EspnSyncSchema.nullable().default(null),
})
export type SeasonState = z.infer<typeof SeasonSchema>

/** League schedule seed (e.g. .local-data/league-<season>.json). Opponents are names; the user maps them to draft slots. */
export const LeagueSeedSchema = z.object({
  kind: z.literal('league-schedule'),
  season: z.string().optional(),
  myTeamName: z.string().optional(),
  matchups: z
    .array(z.object({ start: IsoDate, end: IsoDate, opponent: z.string(), owner: z.string().default(''), away: z.boolean().default(false) }))
    .min(1),
})
export type LeagueSeed = z.infer<typeof LeagueSeedSchema>

export const PersistedStateSchema = z.object({
  schemaVersion: z.literal(STATE_SCHEMA_VERSION),
  settings: LeagueSettingsSchema,
  draft: DraftSessionSchema,
  savedDrafts: z.array(SavedDraftSchema).default([]),
  shortlist: z.array(z.string()).default([]),
  overrides: z.record(z.string(), OverrideSchema).default({}),
  buildLock: BuildLockSchema.nullable().default(null),
  prefs: PrefsSchema.default(PrefsSchema.parse({})),
  activeDatasetId: z.string().nullable().default(null),
  /** Recent prior draft states so "Undo" still works after a refresh (bounded). */
  undoStack: z.array(DraftSessionSchema).default([]),
  /** In-season: matchup schedule and post-draft roster changes. Optional for states saved before it existed. */
  season: SeasonSchema.default({ matchups: [], rosterMoves: [], injuries: [], espn: null }),
})
export type PersistedState = z.infer<typeof PersistedStateSchema>

export const SessionExportSchema = z.object({
  app: z.literal('9dub'),
  kind: z.literal('session'),
  schemaVersion: z.number().int(),
  exportedAt: z.string(),
  state: z.unknown(),
  dataset: DatasetSnapshotSchema.nullable().optional(),
})

/** Bring older/partial persisted objects up to the current schema. */
export function migrateState(input: unknown): { ok: true; state: PersistedState } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Not an object' }
  const obj = { ...(input as Record<string, unknown>) }
  const v = obj.schemaVersion
  if (v == null) obj.schemaVersion = STATE_SCHEMA_VERSION // pre-versioned drafts of this app
  else if (typeof v === 'number' && v > STATE_SCHEMA_VERSION)
    return { ok: false, error: `File was written by a newer 9dub (schema ${v}); this build understands ${STATE_SCHEMA_VERSION}.` }
  const parsed = PersistedStateSchema.safeParse(obj)
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return { ok: false, error: `${i?.path.join('.') || 'state'}: ${i?.message}` }
  }
  return { ok: true, state: parsed.data }
}
