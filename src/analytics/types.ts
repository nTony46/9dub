import type { CatRecord, Category } from './categories'

/**
 * Per-game projected production. Counting stats are required; shooting
 * makes/attempts are optional because many public sources omit volume.
 * `null` always means "not supplied" — it is never coerced to zero.
 */
export interface StatLine {
  pts: number
  tpm: number
  reb: number
  ast: number
  stl: number
  blk: number
  tov: number
  fgm: number | null
  fga: number | null
  ftm: number | null
  fta: number | null
}

/** The minimal player shape the engine needs. Decoupled from import schemas. */
export interface EnginePlayer {
  id: string
  line: StatLine
  /** Projected games played; null when the source does not provide it. */
  gp: number | null
}

/** 'perGame' = healthy per-game value; 'gpAware' = availability-adjusted (see SCORING_METHOD.md). */
export type ValuationBasis = 'perGame' | 'gpAware'

export interface ValuationSettings {
  /** Size of the draft-relevant reference pool used for means/SDs. */
  poolSize: number
  teams: number
  rounds: number
  /** Denominator for availability: a = min(GP, fullSeasonGames) / fullSeasonGames. */
  fullSeasonGames: number
}

export interface ReferenceParams {
  poolSize: number
  /** Player ids in the frozen reference pool. */
  poolIds: string[]
  iterations: number
  converged: boolean
  /** Attempt-weighted pool FG rate: sum(FGM)/sum(FGA). Null if no volume data. */
  fgBaseline: number | null
  ftBaseline: number | null
  /** Mean / SD of the raw category value across the pool (FG/FT use impact). */
  mean: CatRecord<number>
  sd: CatRecord<number>
  /** Number of pool players contributing to each category's parameters. */
  n: CatRecord<number>
  /** Number of players valued (whole dataset). */
  playerCount: number
}

export interface ReplacementLevel {
  /** 1-based inclusive rank band (per-game value) defining replacement level. */
  rankStart: number
  rankEnd: number
  ids: string[]
  z: CatRecord<number>
  total: number
  /** Mean per-game stat line of the band (shooting from players with volume). */
  line: StatLine
}

export interface PlayerValue {
  id: string
  /** Raw per-game category value. FG/FT are impacts (makes above baseline), TO is raw turnovers. */
  raw: CatRecord<number | null>
  /** Direction-corrected z-scores (higher is always better, including TO). */
  z: CatRecord<number | null>
  total: number
  /** How many of the 9 categories have a computable z-score. */
  coveredCats: number
  /** All nine categories computable. Incomplete players rank after complete ones. */
  complete: boolean
  missing: Category[]
  /** Availability-adjusted view. availability is null when GP is unknown. */
  gp: { availability: number | null; z: CatRecord<number | null>; total: number }
  /** 1-based rank by per-game total. */
  rank: number
  /** 1-based rank by GP-aware total. */
  rankGp: number
}

export interface ValuationResult {
  settings: ValuationSettings
  params: ReferenceParams
  replacement: ReplacementLevel
  values: Map<string, PlayerValue>
  orderPerGame: string[]
  orderGp: string[]
}
