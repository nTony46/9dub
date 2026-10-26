import { z } from 'zod'
import { POSITIONS } from '@/analytics/positions'

/**
 * Normalized dataset schema. All projection values are PER GAME. Imports that
 * supply season totals are converted at import time and flagged
 * `unit-converted-from-totals`; the raw source cells are kept in `raw`.
 *
 * v2 (real-data integration) adds, per record: alternative projection
 * profiles, a draft-market block, third-party rankings and provenance, and
 * allows a record without any projection (a "directory" player that can be
 * searched and drafted but not valued). v1 snapshots are valid v2 snapshots.
 */
export const DATASET_SCHEMA_VERSION = 2

const num = z.number().finite()
const nnum = num.nullable()

export const PositionSchema = z.enum(POSITIONS)

export const PlayerIdentitySchema = z.object({
  id: z.string().min(1),
  fullName: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  nbaTeam: z.string().nullable().default(null),
  espnId: z.string().nullable().default(null),
  positions: z.array(PositionSchema).default([]),
})
export type PlayerIdentity = z.infer<typeof PlayerIdentitySchema>

export const COMPLETENESS_FLAGS = [
  'missing-fga',
  'missing-fta',
  'missing-gp',
  'missing-minutes',
  'missing-adp',
  'missing-positions',
  'derived-fgm',
  'derived-ftm',
  'derived-fg-pct',
  'derived-ft-pct',
  'unit-converted-from-totals',
  'pct-without-volume',
  /** GP / minutes come from a different source than the stat line (labelled). */
  'gp-supplemental',
  /** ESPN ADP is the FantasyPros-republished ESPN ordinal, not ESPN Live Draft Trends. */
  'adp-fallback',
  /** ESPN Live Draft Trends AVG PICK sits at ESPN's ~140 ceiling: rarely drafted, not a usable ADP. */
  'adp-capped',
] as const
export type CompletenessFlag = (typeof COMPLETENESS_FLAGS)[number]

export const RiskFlagSchema = z.enum(['none', 'injury', 'role', 'suspension', 'unknown'])
export type RiskFlag = z.infer<typeof RiskFlagSchema>

export const PlayerProjectionSchema = z.object({
  playerId: z.string().min(1),
  season: z.string().min(1),
  source: z.string().min(1),
  sourceUpdatedAt: z.string().nullable().default(null),
  gamesProjected: nnum.default(null),
  minutesPerGame: nnum.default(null),
  points: num.min(0),
  threesMade: num.min(0),
  rebounds: num.min(0),
  assists: num.min(0),
  steals: num.min(0),
  blocks: num.min(0),
  turnovers: num.min(0),
  fieldGoalsMade: nnum.default(null),
  fieldGoalsAttempted: nnum.default(null),
  freeThrowsMade: nnum.default(null),
  freeThrowsAttempted: nnum.default(null),
  fieldGoalPct: nnum.default(null),
  freeThrowPct: nnum.default(null),
  injuryOrRoleNote: z.string().nullable().default(null),
  riskFlag: RiskFlagSchema.nullable().default(null),
  espnAdp: nnum.default(null),
  espnRank: nnum.default(null),
  /** Third-party source's own 9-cat rank (never our computed rank). */
  sourceNineCatRank: nnum.default(null),
  /** Other ADP (e.g. a blended ADP) kept separate from ESPN ADP. */
  otherAdp: nnum.default(null),
  otherAdpLabel: z.string().nullable().default(null),
  /** Where `espnAdp` came from. Null for older snapshots / manual imports. */
  espnAdpSource: z.enum(['espn-live-draft', 'fantasypros-espn', 'import']).nullable().default(null),
  /** Projection profile that produced this line (e.g. "fantasyedge", "espn"). */
  profile: z.string().nullable().default(null),
  /** Source of gamesProjected / minutesPerGame when it differs from the stat line's source. */
  gpSource: z.string().nullable().default(null),
  completenessFlags: z.array(z.enum(COMPLETENESS_FLAGS)).default([]),
  raw: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
})
export type PlayerProjection = z.infer<typeof PlayerProjectionSchema>

/** How a single number was obtained. */
export const FieldOriginSchema = z.enum(['sourced', 'derived', 'cross-source', 'estimated', 'supplemental', 'missing'])
export type FieldOrigin = z.infer<typeof FieldOriginSchema>

/** One source's own stat line for a player, kept intact so profiles are never silently blended. */
export const ProfileLineSchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(['projection', 'actual']),
  season: z.string(),
  sourceFile: z.string().nullable().default(null),
  sourcePage: z.number().int().nullable().default(null),
  capturedAt: z.string().nullable().default(null),
  gp: nnum.default(null),
  min: nnum.default(null),
  pts: nnum.default(null),
  tpm: nnum.default(null),
  reb: nnum.default(null),
  ast: nnum.default(null),
  stl: nnum.default(null),
  blk: nnum.default(null),
  tov: nnum.default(null),
  fgPct: nnum.default(null),
  ftPct: nnum.default(null),
  fga: nnum.default(null),
  fta: nnum.default(null),
  fgm: nnum.default(null),
  ftm: nnum.default(null),
  /** Per-field origin, e.g. { fgm: 'derived' }. Missing keys mean 'sourced' when the value is non-null. */
  origin: z.record(z.string(), FieldOriginSchema).default({}),
})
export type ProfileLine = z.infer<typeof ProfileLineSchema>

export const MarketSchema = z.object({
  /** ESPN Live Draft Trends: SNAKE DRAFT STATS → AVG PICK plus the page's separate fields. */
  espnLive: z
    .object({
      avgPick: num,
      rank: z.number().int(),
      avgPickTrend7d: nnum,
      avgSalary: nnum,
      salaryTrend7d: nnum,
      pctRostered: nnum,
      capped: z.boolean(),
      capturedAt: z.string().nullable(),
      sourceFile: z.string().nullable(),
    })
    .nullable()
    .default(null),
  /** FantasyPros overall ADP export: platform columns kept apart. `espn` is an integer ordinal. */
  fantasyPros: z.object({ espn: nnum, yahoo: nnum, avg: nnum, rank: nnum }).nullable().default(null),
  /** "ADP n" printed by Fantasy Edge; the page does not say which platform. */
  fantasyEdgeAdp: nnum.default(null),
})
export type Market = z.infer<typeof MarketSchema>

export const RankingsSchema = z.object({
  fantasyEdge: z.object({ rank: num, value: nnum }).nullable().default(null),
  /** FantasyPros expert consensus: rank and the spread of expert ranks (AVG. is an expert-rank mean, not ADP). */
  fantasyProsEcr: z.object({ rank: num, best: nnum, worst: nnum, avg: nnum, sd: nnum, ecrVsAdp: nnum }).nullable().default(null),
  /** Position in ESPN's projections list (its default sort). Not a 9-cat rank. */
  espnProjectionOrder: nnum.default(null),
})
export type Rankings = z.infer<typeof RankingsSchema>

export const ProvenanceSchema = z.object({
  sources: z.array(z.string()).default([]),
  files: z.array(z.string()).default([]),
  teamBySource: z.record(z.string(), z.string().nullable()).default({}),
  positionsBySource: z.record(z.string(), z.string().nullable()).default({}),
  status: z.object({ tag: z.string(), source: z.string() }).nullable().default(null),
  notes: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
})
export type Provenance = z.infer<typeof ProvenanceSchema>

/** Optional, clearly labelled shooting-volume estimate for a profile that lacks attempts. Used only when the user opts in. */
export const VolumeEstimateSchema = z.object({
  fga: num.min(0),
  fta: num.min(0),
  method: z.literal('pts-identity'),
  /** FTA per FGA assumed by the estimate. */
  ftRate: num,
  basis: z.string(),
})
export type VolumeEstimate = z.infer<typeof VolumeEstimateSchema>

export const DatasetRecordSchema = z.object({
  identity: PlayerIdentitySchema,
  /** The default stat line used by the engine; null for directory-only players (no projection anywhere). */
  projection: PlayerProjectionSchema.nullable(),
  profiles: z.record(z.string(), ProfileLineSchema).optional(),
  /** Prior-season actuals for reference only — never used as a projection. */
  priorSeason: ProfileLineSchema.nullable().optional(),
  market: MarketSchema.optional(),
  rankings: RankingsSchema.optional(),
  provenance: ProvenanceSchema.optional(),
  /** Keyed by profile id. */
  volumeEstimate: z.record(z.string(), VolumeEstimateSchema).optional(),
})
export type DatasetRecord = z.infer<typeof DatasetRecordSchema>
/** A record that carries a projection. */
export type ProjectedRecord = DatasetRecord & { projection: PlayerProjection }
export const hasProjection = (r: DatasetRecord): r is ProjectedRecord => r.projection != null

export const SourceInfoSchema = z.object({
  name: z.string(),
  url: z.string().nullable().default(null),
  retrievedAt: z.string().nullable().default(null),
  fields: z.array(z.string()).default([]),
  notes: z.string().nullable().default(null),
})
export type SourceInfo = z.infer<typeof SourceInfoSchema>

/** 'local' = a private real-data snapshot built by `npm run data:ingest` from files on this machine. */
export const DatasetKindSchema = z.enum(['demo', 'import', 'bundled', 'local'])
export type DatasetKind = z.infer<typeof DatasetKindSchema>

export const ProfileInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
})
export type ProfileInfo = z.infer<typeof ProfileInfoSchema>

export const DatasetSnapshotSchema = z.object({
  // v1 snapshots are structurally valid v2 snapshots; they are upgraded on read.
  schemaVersion: z.union([z.literal(1), z.literal(DATASET_SCHEMA_VERSION)]).transform(() => DATASET_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().min(1),
  season: z.string().min(1),
  kind: DatasetKindSchema,
  createdAt: z.string(),
  /** Latest source update time across sources, if known. */
  sourceUpdatedAt: z.string().nullable().default(null),
  sources: z.array(SourceInfoSchema).default([]),
  notes: z.string().nullable().default(null),
  /** Id of the snapshot this one was derived from (merge/rollback lineage). */
  parentId: z.string().nullable().default(null),
  /** Alternative projection profiles carried by records (beyond the default `projection`). */
  profiles: z.array(ProfileInfoSchema).default([]),
  players: z.array(DatasetRecordSchema),
})
export type DatasetSnapshot = z.infer<typeof DatasetSnapshotSchema>

export interface DatasetMeta {
  id: string
  name: string
  season: string
  kind: DatasetKind
  createdAt: string
  sourceUpdatedAt: string | null
  playerCount: number
  sources: SourceInfo[]
  parentId: string | null
  notes: string | null
}

export function datasetMeta(d: DatasetSnapshot): DatasetMeta {
  return {
    id: d.id,
    name: d.name,
    season: d.season,
    kind: d.kind,
    createdAt: d.createdAt,
    sourceUpdatedAt: d.sourceUpdatedAt,
    playerCount: d.players.length,
    sources: d.sources,
    parentId: d.parentId,
    notes: d.notes,
  }
}

/** Manual per-player projection overrides (per game), applied on top of the active dataset. */
export const OverrideSchema = z.object({
  points: num.optional(),
  threesMade: num.optional(),
  rebounds: num.optional(),
  assists: num.optional(),
  steals: num.optional(),
  blocks: num.optional(),
  turnovers: num.optional(),
  fieldGoalsMade: num.optional(),
  fieldGoalsAttempted: num.optional(),
  freeThrowsMade: num.optional(),
  freeThrowsAttempted: num.optional(),
  gamesProjected: num.optional(),
  note: z.string().optional(),
})
export type ProjectionOverride = z.infer<typeof OverrideSchema>
