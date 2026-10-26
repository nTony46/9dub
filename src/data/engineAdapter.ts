import type { EnginePlayer, StatLine } from '@/analytics/types'
import type { DatasetRecord, ProfileLine, ProjectionOverride } from './schema'

/**
 * Which stat line the engine values.
 * - profile 'default': each record's own `projection` (Fantasy Edge for its
 *   pool, ESPN for players outside it in the real-data snapshot).
 * - another profile id (e.g. 'espn'): that source's line where the record has
 *   one, falling back to the default line otherwise. Attempts missing from the
 *   chosen profile are borrowed from another profile only as a labelled
 *   cross-source volume proxy.
 * - estimateVolume: when a line has FG%/FT% but no attempts, use the record's
 *   PTS-identity estimate (opt-in, labelled "estimated").
 */
export interface LineOptions {
  profile: string
  estimateVolume: boolean
}

export const DEFAULT_LINE_OPTIONS: LineOptions = { profile: 'default', estimateVolume: false }

export type VolumeOrigin = 'sourced' | 'derived' | 'cross-source' | 'estimated' | 'missing'

export interface EngineLineInfo {
  player: EnginePlayer
  /** Profile actually used for this player. */
  profile: string
  /** True when the requested profile was unavailable for this player. */
  fallback: boolean
  volume: { fg: VolumeOrigin; ft: VolumeOrigin }
}

type Shooting = { made: number | null; att: number | null; origin: VolumeOrigin }

function shootingFrom(pct: number | null, made: number | null, att: number | null, madeDerived: boolean): Shooting {
  if (att == null || made == null) return { made: null, att: null, origin: 'missing' }
  return { made, att, origin: madeDerived || pct == null ? 'derived' : 'sourced' }
}

function applyOverride(base: StatLine, gp: number | null, ov: ProjectionOverride | undefined, pcts: { fg: number | null; ft: number | null }): { line: StatLine; gp: number | null } {
  if (!ov) return { line: base, gp }
  const n = <K extends keyof ProjectionOverride>(k: K, v: number | null): number | null => {
    const o = ov[k]
    return typeof o === 'number' ? o : v
  }
  const fga = n('fieldGoalsAttempted', base.fga)
  const fta = n('freeThrowsAttempted', base.fta)
  let fgm = n('fieldGoalsMade', base.fgm)
  let ftm = n('freeThrowsMade', base.ftm)
  // If attempts were overridden but makes were not, keep the source percentage.
  if (ov.fieldGoalsAttempted != null && ov.fieldGoalsMade == null && pcts.fg != null) fgm = pcts.fg * fga!
  if (ov.freeThrowsAttempted != null && ov.freeThrowsMade == null && pcts.ft != null) ftm = pcts.ft * fta!
  return {
    line: {
      pts: n('points', base.pts)!,
      tpm: n('threesMade', base.tpm)!,
      reb: n('rebounds', base.reb)!,
      ast: n('assists', base.ast)!,
      stl: n('steals', base.stl)!,
      blk: n('blocks', base.blk)!,
      tov: n('turnovers', base.tov)!,
      fgm: fga == null ? null : fgm,
      fga,
      ftm: fta == null ? null : ftm,
      fta,
    },
    gp: n('gamesProjected', gp),
  }
}

/** Final origin after a manual override (a user-entered attempt count counts as sourced). */
const finalOrigin = (o: VolumeOrigin, att: number | null, overridden: number | undefined): VolumeOrigin =>
  overridden != null ? 'sourced' : att == null ? 'missing' : o

const hasCounting = (p: ProfileLine) => [p.pts, p.tpm, p.reb, p.ast, p.stl, p.blk, p.tov].every((v) => v != null)

/** Build the engine line for one record under the chosen options; null when the record has no usable stat line. */
export function toEngineLine(rec: DatasetRecord, ov: ProjectionOverride | undefined, opts: LineOptions = DEFAULT_LINE_OPTIONS): EngineLineInfo | null {
  const id = rec.identity.id
  const est = rec.volumeEstimate

  const alt = opts.profile !== 'default' ? rec.profiles?.[opts.profile] : undefined
  if (alt && hasCounting(alt) && alt.kind === 'projection') {
    let fg = shootingFrom(alt.fgPct, alt.fgm, alt.fga, alt.origin.fgm === 'derived')
    let ft = shootingFrom(alt.ftPct, alt.ftm, alt.fta, alt.origin.ftm === 'derived')
    // Borrow attempts from another profile of the same player (cross-source volume proxy).
    const donor = Object.values(rec.profiles ?? {}).find((p) => p.id !== alt.id && p.kind === 'projection' && p.fga != null && p.fta != null)
    if (fg.origin === 'missing' && donor && alt.fgPct != null) fg = { att: donor.fga, made: alt.fgPct * donor.fga!, origin: 'cross-source' }
    if (ft.origin === 'missing' && donor && alt.ftPct != null) ft = { att: donor.fta, made: alt.ftPct * donor.fta!, origin: 'cross-source' }
    const e = est?.[alt.id]
    if (opts.estimateVolume && e) {
      if (fg.origin === 'missing' && alt.fgPct != null) fg = { att: e.fga, made: alt.fgPct * e.fga, origin: 'estimated' }
      if (ft.origin === 'missing' && alt.ftPct != null) ft = { att: e.fta, made: alt.ftPct * e.fta, origin: 'estimated' }
    }
    const base: StatLine = { pts: alt.pts!, tpm: alt.tpm!, reb: alt.reb!, ast: alt.ast!, stl: alt.stl!, blk: alt.blk!, tov: alt.tov!, fgm: fg.made, fga: fg.att, ftm: ft.made, fta: ft.att }
    const { line, gp } = applyOverride(base, alt.gp, ov, { fg: alt.fgPct, ft: alt.ftPct })
    return {
      player: { id, line, gp },
      profile: alt.id,
      fallback: false,
      volume: { fg: finalOrigin(fg.origin, line.fga, ov?.fieldGoalsAttempted), ft: finalOrigin(ft.origin, line.fta, ov?.freeThrowsAttempted) },
    }
  }

  const p = rec.projection
  if (!p) return null
  let fg = shootingFrom(p.fieldGoalPct, p.fieldGoalsMade, p.fieldGoalsAttempted, p.completenessFlags.includes('derived-fgm'))
  let ft = shootingFrom(p.freeThrowPct, p.freeThrowsMade, p.freeThrowsAttempted, p.completenessFlags.includes('derived-ftm'))
  const e = est?.[p.profile ?? 'default']
  if (opts.estimateVolume && e) {
    if (fg.origin === 'missing' && p.fieldGoalPct != null) fg = { att: e.fga, made: p.fieldGoalPct * e.fga, origin: 'estimated' }
    if (ft.origin === 'missing' && p.freeThrowPct != null) ft = { att: e.fta, made: p.freeThrowPct * e.fta, origin: 'estimated' }
  }
  const base: StatLine = {
    pts: p.points,
    tpm: p.threesMade,
    reb: p.rebounds,
    ast: p.assists,
    stl: p.steals,
    blk: p.blocks,
    tov: p.turnovers,
    fgm: fg.made,
    fga: fg.att,
    ftm: ft.made,
    fta: ft.att,
  }
  const { line, gp } = applyOverride(base, p.gamesProjected, ov, { fg: p.fieldGoalPct, ft: p.freeThrowPct })
  return {
    player: { id, line, gp },
    profile: p.profile ?? 'default',
    fallback: opts.profile !== 'default',
    volume: { fg: finalOrigin(fg.origin, line.fga, ov?.fieldGoalsAttempted), ft: finalOrigin(ft.origin, line.fta, ov?.freeThrowsAttempted) },
  }
}

/** Convert a normalized record (plus optional manual override) into the engine's per-game line. */
export function toEnginePlayer(rec: DatasetRecord, ov?: ProjectionOverride, opts: LineOptions = DEFAULT_LINE_OPTIONS): EnginePlayer | null {
  return toEngineLine(rec, ov, opts)?.player ?? null
}
