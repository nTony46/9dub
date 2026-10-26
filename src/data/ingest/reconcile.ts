/**
 * Reconcile parsed local sources into one provenance-aware dataset snapshot.
 *
 * Policy (see docs/DATA_SOURCES.md):
 * - Identity: one canonical player per normalized name (accents, punctuation
 *   and Jr./III suffixes ignored; verified aliases applied). Team and position
 *   are never identity keys. Same-name rows inside one source are resolved by
 *   team agreement with the other sources, else flagged.
 * - Default projection: Fantasy Edge's complete 9-cat line with FGA/FTA from
 *   its printed page (makes derived as % × attempts). Players outside that
 *   pool use ESPN's 2027 projection — percentages without attempts, so their
 *   FG%/FT% impact stays unknown unless the user opts into an estimate.
 * - ESPN's projection is kept as an alternate profile, never averaged in.
 *   ESPN projected GP/MIN are attached to Fantasy Edge lines as labelled
 *   supplemental fields. "2026 STATISTICS" rows are prior-season actuals.
 * - ESPN ADP: Live Draft Trends AVG PICK first; the FantasyPros-republished
 *   ESPN ordinal only when ESPN has no row. Yahoo / blended ADP stay separate.
 */
import { normalizePositions } from '@/analytics/positions'
import { canonicalKey, finalizeProjection, slugify } from '../normalize'
import { currentSeason, espnProjectionLabel, seasonText } from '../seasonLabel'
import {
  DATASET_SCHEMA_VERSION,
  type CompletenessFlag,
  type DatasetRecord,
  type DatasetSnapshot,
  type Market,
  type PlayerProjection,
  type ProfileLine,
  type Provenance,
  type Rankings,
  type SourceInfo,
  type VolumeEstimate,
} from '../schema'
import { isEmptyBlock } from './espn'
import {
  ROLE_LABEL,
  type EspnProjectionRow,
  type EspnStatBlock,
  type FantasyEdgeCsvRow,
  type FantasyEdgePdfRow,
  type FantasyProsAdpRow,
  type FantasyProsEcrRow,
  type LiveDraftRow,
  type ParseResult,
  type RowIssue,
  type RowLoc,
  type SourceRole,
  type StatusTag,
  statusText,
} from './types'

export interface IngestFile {
  file: string
  sha256: string
  size: number
  /** File modification time (ISO), used only when a source prints no capture time. */
  mtime: string | null
  kind: 'pdf' | 'csv' | 'other'
  result: ParseResult | null
  error?: string
}

export interface IngestOptions {
  season: string
  /** Row label that marks the target-season projection on ESPN's page. */
  projectionLabel: string
  /** ESPN AVG PICK at or above this is ESPN's "rarely drafted" ceiling, not a usable ADP. */
  adpCap: number
  now: string
  snapshotId: string
  sourceDir: string
}

export const DEFAULT_INGEST_OPTIONS: Omit<IngestOptions, 'now' | 'snapshotId' | 'sourceDir'> = {
  season: currentSeason(),
  projectionLabel: espnProjectionLabel(currentSeason()),
  adpCap: 139.5,
}

export type FileStatus = 'used' | 'duplicate' | 'logical-duplicate' | 'cross-check' | 'reference-only' | 'unrecognised' | 'error'

export interface FileAudit {
  file: string
  sha256: string
  size: number
  kind: IngestFile['kind']
  role: SourceRole
  roleLabel: string
  status: FileStatus
  duplicateOf: string | null
  capturedAt: string | null
  mtime: string | null
  printedPages: number | null
  rows: number
  uniquePlayers: number
  /** For paged ESPN lists: what part of the list this file holds. */
  coverage: string | null
  issues: number
  notes: string[]
}

export interface PlayerSourceSet {
  key: string
  id: string
  name: string
  roles: SourceRole[]
}

export interface IngestAudit {
  generatedAt: string
  sourceDir: string
  season: string
  files: FileAudit[]
  espnPages: {
    liveDraft: { file: string; ranks: [number, number]; players: number }[]
    projections: { file: string; order: number; players: number; withProjection: number; firstPlayer: string }[]
  }
  counts: Record<string, number>
  overlap: { roles: SourceRole[]; matrix: number[][] }
  coverageByTier: { tier: number; ordering: string; players: number; complete9: number; anyProjection: number; gp: number; espnLive: number; espnLiveUsable: number; fpFallback: number; expertRank: number }[]
  conflicts: { team: { name: string; values: Record<string, string | null> }[]; positions: { name: string; values: Record<string, string | null> }[] }
  duplicates: { role: SourceRole; name: string; kept: RowLoc; dropped: RowLoc[]; reason: string }[]
  unresolved: { role: SourceRole; name: string; locs: RowLoc[]; reason: string }[]
  singleSource: PlayerSourceSet[]
  incomplete: { name: string; id: string; reason: string; espnAdp: number | null }[]
  issues: RowIssue[]
  crossChecks: {
    fantasyEdgeCsvVsPdf: { compared: number; mismatches: string[]; missing: string[] }
    derivedVsPdf: { compared: number; mismatches: string[] }
    ptsIdentity: { checked: number; maxAbsResidual: number; worst: { name: string; residual: number }[] }
    makesWithinAttempts: { checked: number; violations: string[] }
    assistTurnover: { checked: number; mismatches: string[] }
    espnLabels: { projection: Record<string, number>; prior: Record<string, number> }
    outliers: string[]
  }
  volumeEstimate: { ftRate: Record<string, number>; validation: { n: number; fgaMape: number; fgaP90: number; ftaMae: number; ftaP90: number } }
}

// ───────────────────────── helpers ─────────────────────────

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  if (!s.length) return NaN
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const isoDate = (s: string | null | undefined) => (s ? s.slice(0, 10) : null)

/** Coarse position group for the optional FT-rate assumption. */
export function positionGroup(positions: string | null | undefined): 'C' | 'F' | 'G' {
  const ps = normalizePositions(positions ?? '')
  if (ps.includes('C')) return 'C'
  if (ps.includes('PF') && !ps.includes('PG')) return 'F'
  return 'G'
}

/**
 * Optional shooting-volume estimate from the points identity
 *   PTS = 2·FGM + 3PM + FTM,  FGM = FG%·FGA,  FTM = FT%·FTA,  FTA = r·FGA
 * ⇒ FGA = (PTS − 3PM) / (2·FG% + r·FT%).
 * `r` (FTA per FGA) is the median of the Fantasy Edge pool for the player's
 * position group. This is a labelled proxy, never a sourced projection.
 */
export function estimateVolume(line: { pts: number | null; tpm: number | null; fgPct: number | null; ftPct: number | null }, r: number): { fga: number; fta: number } | null {
  const { pts, tpm, fgPct, ftPct } = line
  if (pts == null || tpm == null || fgPct == null || ftPct == null || fgPct <= 0) return null
  const fga = (pts - tpm) / (2 * fgPct + r * ftPct)
  if (!Number.isFinite(fga) || fga < 0) return null
  return { fga, fta: r * fga }
}

interface Bucket {
  key: string
  ldt?: LiveDraftRow
  proj?: EspnProjectionRow
  fe?: FantasyEdgePdfRow
  feCsv?: FantasyEdgeCsvRow
  ecr?: FantasyProsEcrRow
  adp?: FantasyProsAdpRow
  names: Set<string>
  notes: string[]
}

type RoleRows = {
  'espn-live-draft': LiveDraftRow
  'espn-projections': EspnProjectionRow
  'fantasyedge-pdf': FantasyEdgePdfRow
  'fantasyedge-csv': FantasyEdgeCsvRow
  'fantasypros-ecr': FantasyProsEcrRow
  'fantasypros-adp': FantasyProsAdpRow
}
const BUCKET_FIELD: { [R in keyof RoleRows]: keyof Bucket } = {
  'espn-live-draft': 'ldt',
  'espn-projections': 'proj',
  'fantasyedge-pdf': 'fe',
  'fantasyedge-csv': 'feCsv',
  'fantasypros-ecr': 'ecr',
  'fantasypros-adp': 'adp',
}

function rowTeam(r: { team?: string | null }): string | null {
  return r.team ?? null
}

// ───────────────────────── main ─────────────────────────

export function reconcile(files: readonly IngestFile[], opts: IngestOptions): { snapshot: DatasetSnapshot; audit: IngestAudit } {
  const issues: RowIssue[] = files.flatMap((f) => f.result?.issues ?? [])
  const fileAudits: FileAudit[] = []

  // 1. File inventory: exact duplicates (hash) and logical duplicates (same player set, same role).
  const byHash = new Map<string, string>()
  const usedByRole = new Map<SourceRole, { file: IngestFile; keys: Set<string> }[]>()
  const sortedFiles = [...files].sort((a, b) => a.file.localeCompare(b.file, 'en', { numeric: true }))
  for (const f of sortedFiles) {
    const role: SourceRole = f.result?.parsed.role ?? 'unknown'
    const rows = (f.result?.parsed.rows ?? []) as { name: string }[]
    const keys = new Set(rows.map((r) => canonicalKey(r.name)))
    const audit: FileAudit = {
      file: f.file,
      sha256: f.sha256,
      size: f.size,
      kind: f.kind,
      role,
      roleLabel: ROLE_LABEL[role],
      status: 'used',
      duplicateOf: null,
      capturedAt: f.result?.capturedAt ?? null,
      mtime: f.mtime,
      printedPages: f.result?.printedPages ?? null,
      rows: rows.length,
      uniquePlayers: keys.size,
      coverage: null,
      issues: f.result?.issues.length ?? 0,
      notes: [],
    }
    fileAudits.push(audit)
    if (f.error) {
      audit.status = 'error'
      audit.notes.push(f.error)
      continue
    }
    if (role === 'unknown') {
      audit.status = 'unrecognised'
      continue
    }
    const dupe = byHash.get(f.sha256)
    if (dupe) {
      audit.status = 'duplicate'
      audit.duplicateOf = dupe
      audit.notes.push('Byte-identical to another file; ignored.')
      continue
    }
    byHash.set(f.sha256, f.file)
    if (role === 'derived-9dub') {
      audit.status = 'reference-only'
      audit.notes.push('Derived artifact combining other sources; used only to cross-check parsing, never as data.')
      continue
    }
    const peers = usedByRole.get(role) ?? []
    const logical = peers.find((p) => {
      const inter = [...keys].filter((k) => p.keys.has(k)).length
      return inter / Math.max(1, Math.min(keys.size, p.keys.size)) >= 0.9 && Math.abs(keys.size - p.keys.size) <= Math.max(2, 0.1 * keys.size)
    })
    if (logical) {
      // Keep whichever capture is newer.
      const newer = (f.result?.capturedAt ?? f.mtime ?? '') > (logical.file.result?.capturedAt ?? logical.file.mtime ?? '')
      const loser = newer ? logical.file : f
      const winner = newer ? f : logical.file
      const la = fileAudits.find((a) => a.file === loser.file)!
      la.status = 'logical-duplicate'
      la.duplicateOf = winner.file
      la.notes.push('Lists the same players as another file of this type; the newer capture is used.')
      if (newer) {
        peers.splice(peers.indexOf(logical), 1, { file: f, keys })
      }
      usedByRole.set(role, peers)
      continue
    }
    peers.push({ file: f, keys })
    usedByRole.set(role, peers)
  }
  // The Fantasy Edge CSV repeats the printed page minus attempts: it is a cross-check when the PDF is present.
  if (usedByRole.get('fantasyedge-pdf')?.length) {
    for (const p of usedByRole.get('fantasyedge-csv') ?? []) {
      const a = fileAudits.find((x) => x.file === p.file.file)!
      a.status = 'cross-check'
      a.notes.push('Same rankings as the printed Fantasy Edge page, which also carries FGA/FTA; used to verify the PDF parse.')
    }
  }
  const used = (role: SourceRole) => (usedByRole.get(role) ?? []).map((p) => p.file)

  // 2. Bucket rows by canonical key (resolving same-name rows inside one source).
  const buckets = new Map<string, Bucket>()
  const bucket = (key: string) => {
    let b = buckets.get(key)
    if (!b) buckets.set(key, (b = { key, names: new Set(), notes: [] }))
    return b
  }
  const duplicates: IngestAudit['duplicates'] = []
  const unresolved: IngestAudit['unresolved'] = []
  const pendingDupes: { role: keyof RoleRows; rows: RoleRows[keyof RoleRows][] }[] = []

  const roleOrder: (keyof RoleRows)[] = ['espn-live-draft', 'espn-projections', 'fantasyedge-pdf', 'fantasyedge-csv', 'fantasypros-adp', 'fantasypros-ecr']
  for (const role of roleOrder) {
    const rows = used(role).flatMap((f) => f.result!.parsed.rows as RoleRows[typeof role][])
    const groups = new Map<string, RoleRows[typeof role][]>()
    for (const r of rows) {
      const k = canonicalKey(r.name)
      groups.set(k, [...(groups.get(k) ?? []), r])
    }
    for (const [k, g] of groups) {
      if (g.length === 1) {
        const b = bucket(k)
        ;(b as unknown as Record<string, unknown>)[BUCKET_FIELD[role]] = g[0]
        b.names.add(g[0].name)
      } else pendingDupes.push({ role, rows: g })
    }
  }
  // Same-name rows within one source: keep the row whose team agrees with the other sources.
  for (const { role, rows } of pendingDupes) {
    const k = canonicalKey(rows[0].name)
    const b = buckets.get(k)
    const consensus = b ? [b.ldt?.team, b.proj?.team, b.fe?.team, b.adp?.team].filter((t): t is string => !!t && t !== 'FA') : []
    let agreeing = rows.filter((r) => rowTeam(r as { team?: string | null }) && consensus.includes(rowTeam(r as { team?: string | null })!))
    let basis = 'matches other sources'
    // No other source names a team: a lone non-free-agent entry beside free-agent copies is the live record.
    if (!consensus.length) {
      const rostered = rows.filter((r) => { const t = rowTeam(r as { team?: string | null }); return !!t && t !== 'FA' })
      if (rostered.length === 1) {
        agreeing = rostered
        basis = 'only rostered entry; the others are free-agent copies'
      }
    }
    if (agreeing.length === 1) {
      const keep = agreeing[0]
      const target = bucket(k)
      ;(target as unknown as Record<string, unknown>)[BUCKET_FIELD[role]] = keep
      target.names.add(keep.name)
      const dropped = rows.filter((r) => r !== keep)
      duplicates.push({
        role,
        name: keep.name,
        kept: keep.loc,
        dropped: dropped.map((r) => r.loc),
        reason: `Listed ${rows.length}× in one ${ROLE_LABEL[role]} file; kept the ${rowTeam(keep as { team?: string | null })} entry (${basis}), ignored ${dropped.map((r) => rowTeam(r as { team?: string | null }) ?? 'no team').join(', ')}.`,
      })
      target.notes.push(`${ROLE_LABEL[role]}: duplicate entry (${dropped.map((r) => rowTeam(r as { team?: string | null }) ?? 'no team').join(', ')}) ignored`)
    } else {
      unresolved.push({ role, name: rows[0].name, locs: rows.map((r) => r.loc), reason: 'Same name listed more than once with no team agreement; rows not used.' })
    }
  }

  // 3. ESPN results-page structure.
  const ldtFiles = used('espn-live-draft')
  const liveDraftPages = ldtFiles
    .map((f) => {
      const rows = f.result!.parsed.rows as LiveDraftRow[]
      const ranks = rows.map((r) => r.rank)
      return { file: f.file, ranks: [Math.min(...ranks), Math.max(...ranks)] as [number, number], players: rows.length }
    })
    .sort((a, b) => a.ranks[0] - b.ranks[0])
  for (const p of liveDraftPages) {
    const a = fileAudits.find((x) => x.file === p.file)!
    a.coverage = `ESPN results page ${Math.ceil(p.ranks[1] / 50)} — ranks ${p.ranks[0]}–${p.ranks[1]}`
  }
  const projFiles = used('espn-projections')
  // Order projection pages by where their players sit in ESPN's own draft market (robust to file naming).
  const ldtRank = (name: string) => buckets.get(canonicalKey(name))?.ldt?.rank
  const projPages = projFiles
    .map((f) => {
      const rows = f.result!.parsed.rows as EspnProjectionRow[]
      const ranks = rows.map((r) => ldtRank(r.name)).filter((x): x is number => x != null)
      return { f, rows, med: ranks.length ? median(ranks) : Infinity }
    })
    .sort((a, b) => a.med - b.med || a.f.file.localeCompare(b.f.file, 'en', { numeric: true }))
  const projections = projPages.map((p, i) => ({
    file: p.f.file,
    order: i + 1,
    players: p.rows.length,
    withProjection: p.rows.filter((r) => !isEmptyBlock(r.projection)).length,
    firstPlayer: p.rows[0]?.name ?? '',
  }))
  const projOrder = new Map<string, number>()
  projPages.forEach((p, i) => p.rows.forEach((r) => projOrder.set(canonicalKey(r.name), i * 50 + r.index + 1)))
  for (const p of projections) {
    const a = fileAudits.find((x) => x.file === p.file)!
    a.coverage = `ESPN projections list page ${p.order} (positions ${(p.order - 1) * 50 + 1}–${(p.order - 1) * 50 + p.players}); ${p.withProjection} with a ${seasonText(opts.season)} projection`
  }

  // 4. Fantasy Edge pool FT-rate model (for the optional estimate) and its validation on the pool itself.
  const feRows = [...buckets.values()].map((b) => b.fe).filter((r): r is FantasyEdgePdfRow => !!r && r.fga != null && r.fta != null && r.fga > 0)
  const groupRates: Record<string, number[]> = { C: [], F: [], G: [] }
  for (const r of feRows) groupRates[positionGroup(r.positions)].push(r.fta! / r.fga!)
  const ftRate: Record<string, number> = Object.fromEntries(Object.entries(groupRates).map(([g, xs]) => [g, xs.length ? median(xs) : median(feRows.map((r) => r.fta! / r.fga!))]))
  const fgaErr: number[] = []
  const ftaErr: number[] = []
  for (const r of feRows) {
    const est = estimateVolume(r, ftRate[positionGroup(r.positions)])
    if (!est) continue
    fgaErr.push(Math.abs(est.fga - r.fga!) / r.fga!)
    ftaErr.push(Math.abs(est.fta - r.fta!))
  }
  const p90 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)] ?? NaN
  const volumeValidation = {
    n: fgaErr.length,
    fgaMape: fgaErr.reduce((s, x) => s + x, 0) / Math.max(1, fgaErr.length),
    fgaP90: p90(fgaErr),
    ftaMae: ftaErr.reduce((s, x) => s + x, 0) / Math.max(1, ftaErr.length),
    ftaP90: p90(ftaErr),
  }

  // 5. Build records.
  const feFile = used('fantasyedge-pdf')[0]
  const feCaptured = feFile?.result?.capturedAt ?? feFile?.mtime ?? null
  const ldtCaptured = ldtFiles.map((f) => f.result?.capturedAt).filter(Boolean).sort().pop() ?? null
  const projCaptured = projFiles.map((f) => f.result?.capturedAt).filter(Boolean).sort().pop() ?? null
  const projLeague = (projFiles[0]?.result?.parsed as { league?: string | null } | undefined)?.league ?? null
  const FE_LABEL = `Fantasy Edge ${seasonText(opts.season)} 9-cat`
  const ESPN_LABEL = `ESPN ${seasonText(opts.season)} projection${projLeague ? ` (${projLeague})` : ''}`

  const records: DatasetRecord[] = []
  const takenIds = new Set<string>()
  const teamConflicts: IngestAudit['conflicts']['team'] = []
  const posConflicts: IngestAudit['conflicts']['positions'] = []
  const incomplete: IngestAudit['incomplete'] = []
  const outliers: string[] = []

  for (const b of [...buckets.values()].sort((x, y) => x.key.localeCompare(y.key))) {
    const espnName = b.ldt?.name ?? b.proj?.name ?? null
    const feName = b.fe?.name ?? b.feCsv?.name ?? null
    const anyName = espnName ?? feName ?? b.adp?.name ?? b.ecr?.name ?? b.key
    // Prefer ESPN's spelling (what the draft room shows) but keep Fantasy Edge's diacritics when the names fold together.
    const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    const displayName = espnName && feName && fold(espnName) === fold(feName) ? feName : anyName
    let id = slugify(displayName) || slugify(b.key) || 'player'
    if (takenIds.has(id)) id = `${id}-${(b.ldt?.team ?? b.proj?.team ?? b.fe?.team ?? 'x').toLowerCase()}`
    takenIds.add(id)
    const aliases = [...b.names].filter((n) => n !== displayName)

    const teamBySource: Record<string, string | null> = {}
    if (b.ldt) teamBySource['espn-live-draft'] = b.ldt.team
    if (b.proj) teamBySource['espn-projections'] = b.proj.team
    if (b.fe) teamBySource['fantasyedge-pdf'] = b.fe.team
    if (b.adp) teamBySource['fantasypros-adp'] = b.adp.team
    if (b.ecr) teamBySource['fantasypros-ecr'] = b.ecr.team
    const team = b.ldt?.team ?? b.proj?.team ?? b.fe?.team ?? b.adp?.team ?? b.ecr?.team ?? null
    const distinctTeams = new Set(Object.values(teamBySource).filter(Boolean))
    if (distinctTeams.size > 1) teamConflicts.push({ name: displayName, values: teamBySource })

    const positionsBySource: Record<string, string | null> = {}
    if (b.ldt) positionsBySource['espn-live-draft'] = b.ldt.positions
    if (b.proj) positionsBySource['espn-projections'] = b.proj.positions
    if (b.fe) positionsBySource['fantasyedge-pdf'] = b.fe.positions
    if (b.adp) positionsBySource['fantasypros-adp'] = b.adp.positions
    if (b.ecr) positionsBySource['fantasypros-ecr'] = b.ecr.positions
    const espnPos = normalizePositions(b.ldt?.positions ?? b.proj?.positions ?? '')
    const positions = espnPos.length ? espnPos : normalizePositions(b.fe?.positions ?? b.adp?.positions ?? b.ecr?.positions ?? '')
    if (b.ldt && b.proj && normalizePositions(b.ldt.positions).join() !== normalizePositions(b.proj.positions).join())
      posConflicts.push({ name: displayName, values: positionsBySource })

    const statusPairs: [StatusTag | null, string][] = [
      [b.ldt?.status ?? null, 'ESPN Live Draft Trends'],
      [b.proj?.status ?? null, 'ESPN projections'],
      [b.fe?.status ?? null, 'Fantasy Edge'],
      [b.adp?.status ?? null, 'FantasyPros ADP'],
    ]
    const st = statusPairs.find(([t]) => t != null)
    const status = st ? { tag: st[0]!, source: st[1] } : null

    // Profiles
    const profiles: Record<string, ProfileLine> = {}
    const warnings: string[] = []
    if (b.fe) {
      const r = b.fe
      const fgm = r.fgPct != null && r.fga != null ? r.fgPct * r.fga : null
      const ftm = r.ftPct != null && r.fta != null ? r.ftPct * r.fta : null
      profiles.fantasyedge = {
        id: 'fantasyedge',
        label: FE_LABEL,
        kind: 'projection',
        season: opts.season,
        sourceFile: r.loc.file,
        sourcePage: r.loc.page ?? null,
        capturedAt: feCaptured,
        gp: null,
        min: null,
        pts: r.pts,
        tpm: r.tpm,
        reb: r.reb,
        ast: r.ast,
        stl: r.stl,
        blk: r.blk,
        tov: r.tov,
        fgPct: r.fgPct,
        ftPct: r.ftPct,
        fga: r.fga,
        fta: r.fta,
        fgm,
        ftm,
        origin: { fgm: 'derived', ftm: 'derived', gp: 'missing', min: 'missing' },
      }
      if (fgm != null && r.fga != null && fgm > r.fga + 1e-9) warnings.push('Derived FGM exceeds FGA')
      if (ftm != null && r.fta != null && ftm > r.fta + 1e-9) warnings.push('Derived FTM exceeds FTA')
    } else if (b.feCsv) {
      const r = b.feCsv
      profiles.fantasyedge = {
        id: 'fantasyedge', label: FE_LABEL, kind: 'projection', season: opts.season, sourceFile: r.loc.file, sourcePage: null, capturedAt: null,
        gp: null, min: null, pts: r.pts, tpm: r.tpm, reb: r.reb, ast: r.ast, stl: r.stl, blk: r.blk, tov: r.tov, fgPct: r.fgPct, ftPct: r.ftPct,
        fga: null, fta: null, fgm: null, ftm: null, origin: { fga: 'missing', fta: 'missing', gp: 'missing', min: 'missing' },
      }
      warnings.push('Fantasy Edge line from CSV only (no attempts)')
    }
    const espnProj = b.proj && !isEmptyBlock(b.proj.projection) ? b.proj.projection! : null
    if (b.proj && b.proj.projectionLabel && b.proj.projectionLabel !== opts.projectionLabel)
      warnings.push(`ESPN row labelled "${b.proj.projectionLabel}" (expected ${opts.projectionLabel}); not used`)
    const espnUsable = espnProj && b.proj!.projectionLabel === opts.projectionLabel
    if (espnUsable) {
      const e = espnProj!
      profiles.espn = {
        id: 'espn',
        label: ESPN_LABEL,
        kind: 'projection',
        season: opts.season,
        sourceFile: b.proj!.loc.file,
        sourcePage: b.proj!.loc.page ?? null,
        capturedAt: projCaptured,
        gp: e.gp,
        min: e.min,
        pts: e.pts,
        tpm: e.tpm,
        reb: e.reb,
        ast: e.ast,
        stl: e.stl,
        blk: e.blk,
        tov: e.tov,
        fgPct: e.fgPct,
        ftPct: e.ftPct,
        fga: null,
        fta: null,
        fgm: null,
        ftm: null,
        origin: { fga: 'missing', fta: 'missing', fgm: 'missing', ftm: 'missing' },
      }
    } else if (b.proj && isEmptyBlock(b.proj.projection)) warnings.push(`ESPN lists this player without a ${seasonText(opts.season)} projection`)
    const priorSeason: ProfileLine | null =
      b.proj && !isEmptyBlock(b.proj.prior)
        ? {
            id: 'espn-prior',
            label: `ESPN ${b.proj.priorLabel ?? 'prior season'} (actuals)`,
            kind: 'actual',
            season: '2025-26',
            sourceFile: b.proj.loc.file,
            sourcePage: b.proj.loc.page ?? null,
            capturedAt: projCaptured,
            ...blockToLine(b.proj.prior!),
            fga: null,
            fta: null,
            fgm: null,
            ftm: null,
            origin: {},
          }
        : null

    // Optional volume estimates for profiles without attempts.
    const volumeEstimate: Record<string, VolumeEstimate> = {}
    const posForRate = b.ldt?.positions ?? b.proj?.positions ?? b.fe?.positions ?? null
    const r = ftRate[positionGroup(posForRate)]
    for (const p of Object.values(profiles)) {
      if (p.fga != null && p.fta != null) continue
      const est = estimateVolume(p, r)
      if (est) volumeEstimate[p.id] = { ...est, method: 'pts-identity', ftRate: r, basis: `PTS identity with FTA/FGA = ${r.toFixed(3)} (Fantasy Edge pool median, ${positionGroup(posForRate)} group)` }
    }

    // Market and rankings
    const espnLive = b.ldt && b.ldt.avgPick != null
      ? {
          avgPick: b.ldt.avgPick,
          rank: b.ldt.rank,
          avgPickTrend7d: b.ldt.avgPickTrend7d,
          avgSalary: b.ldt.avgSalary,
          salaryTrend7d: b.ldt.salaryTrend7d,
          pctRostered: b.ldt.pctRostered,
          capped: b.ldt.avgPick >= opts.adpCap,
          capturedAt: ldtCaptured,
          sourceFile: b.ldt.loc.file,
        }
      : null
    const market: Market = {
      espnLive,
      fantasyPros: b.adp ? { espn: b.adp.espn, yahoo: b.adp.yahoo, avg: b.adp.avg, rank: b.adp.rank } : null,
      fantasyEdgeAdp: b.fe?.adp ?? null,
    }
    const rankings: Rankings = {
      fantasyEdge: b.fe ? { rank: b.fe.rank, value: b.fe.value } : b.feCsv ? { rank: b.feCsv.rank, value: b.feCsv.value } : null,
      fantasyProsEcr: b.ecr ? { rank: b.ecr.rank, best: b.ecr.best, worst: b.ecr.worst, avg: b.ecr.avg, sd: b.ecr.sd, ecrVsAdp: b.ecr.ecrVsAdp } : null,
      espnProjectionOrder: projOrder.get(b.key) ?? null,
    }
    let espnAdp: number | null = null
    let espnAdpSource: PlayerProjection['espnAdpSource'] = null
    const adpFlags: CompletenessFlag[] = []
    if (espnLive) {
      if (!espnLive.capped) {
        espnAdp = espnLive.avgPick
        espnAdpSource = 'espn-live-draft'
      } else adpFlags.push('adp-capped')
    } else if (b.adp?.espn != null) {
      espnAdp = b.adp.espn
      espnAdpSource = 'fantasypros-espn'
      adpFlags.push('adp-fallback')
    }

    // Default projection line.
    const defaultProfile = profiles.fantasyedge && hasCounting(profiles.fantasyedge) ? profiles.fantasyedge : profiles.espn && hasCounting(profiles.espn) ? profiles.espn : null
    let projection: PlayerProjection | null = null
    if (defaultProfile) {
      const supplementalGp = defaultProfile.id === 'fantasyedge' && profiles.espn?.gp != null
      const flags: CompletenessFlag[] = [...adpFlags]
      if (supplementalGp) flags.push('gp-supplemental')
      projection = finalizeProjection({
        playerId: id,
        season: opts.season,
        source: defaultProfile.label,
        sourceUpdatedAt: isoDate(defaultProfile.capturedAt),
        gamesProjected: defaultProfile.id === 'fantasyedge' ? (profiles.espn?.gp ?? null) : defaultProfile.gp,
        minutesPerGame: defaultProfile.id === 'fantasyedge' ? (profiles.espn?.min ?? null) : defaultProfile.min,
        points: defaultProfile.pts!,
        threesMade: defaultProfile.tpm!,
        rebounds: defaultProfile.reb!,
        assists: defaultProfile.ast!,
        steals: defaultProfile.stl!,
        blocks: defaultProfile.blk!,
        turnovers: defaultProfile.tov!,
        fieldGoalsMade: defaultProfile.fgm,
        fieldGoalsAttempted: defaultProfile.fga,
        freeThrowsMade: defaultProfile.ftm,
        freeThrowsAttempted: defaultProfile.fta,
        fieldGoalPct: defaultProfile.fgPct,
        freeThrowPct: defaultProfile.ftPct,
        injuryOrRoleNote: status ? `${statusText(status.tag)} (${status.source}, as captured)` : null,
        riskFlag: status ? (status.tag === 'suspended' ? 'suspension' : status.tag === 'g-league' || status.tag === 'free-agent' ? 'role' : 'injury') : null,
        espnAdp,
        espnRank: rankings.espnProjectionOrder,
        sourceNineCatRank: rankings.fantasyEdge?.rank ?? null,
        otherAdp: null,
        otherAdpLabel: null,
        espnAdpSource,
        profile: defaultProfile.id,
        gpSource: supplementalGp ? `${ESPN_LABEL} — projected GP/MIN (supplemental)` : defaultProfile.gp != null ? defaultProfile.label : null,
        completenessFlags: flags,
      })
      if (defaultProfile.fgm != null) projection.completenessFlags = [...new Set([...projection.completenessFlags, 'derived-fgm' as const, 'derived-ftm' as const])]
      if (!positions.length) projection.completenessFlags = [...projection.completenessFlags, 'missing-positions']
      if (defaultProfile.fga == null || defaultProfile.fta == null)
        incomplete.push({ name: displayName, id, reason: `${defaultProfile.label}: FG%/FT% without attempts`, espnAdp })
      for (const [k, v, hi] of [['PTS', projection.points, 40], ['REB', projection.rebounds, 16], ['AST', projection.assists, 13], ['TO', projection.turnovers, 5.5], ['BLK', projection.blocks, 4.5], ['STL', projection.steals, 3]] as const)
        if (v > hi) outliers.push(`${displayName}: ${k} ${v} per game`)
    } else {
      incomplete.push({ name: displayName, id, reason: b.proj ? `ESPN shows no ${seasonText(opts.season)} projection` : 'Ranked/ADP only — no projection in any source', espnAdp })
    }

    const provenance: Provenance = {
      sources: (Object.keys(BUCKET_FIELD) as (keyof RoleRows)[]).filter((role) => b[BUCKET_FIELD[role]] != null),
      files: [...new Set((Object.keys(BUCKET_FIELD) as (keyof RoleRows)[]).map((role) => (b[BUCKET_FIELD[role]] as { loc?: RowLoc } | undefined)?.loc?.file).filter((x): x is string => !!x))],
      teamBySource,
      positionsBySource,
      status,
      notes: b.notes,
      warnings,
    }

    records.push({
      identity: { id, fullName: displayName, aliases, nbaTeam: team, espnId: null, positions },
      projection,
      profiles,
      priorSeason,
      market,
      rankings,
      provenance,
      volumeEstimate: Object.keys(volumeEstimate).length ? volumeEstimate : undefined,
    })
  }

  // 6. Cross-checks.
  const feCsvRows = used('fantasyedge-csv').flatMap((f) => f.result!.parsed.rows as FantasyEdgeCsvRow[])
  const csvMismatch: string[] = []
  const csvMissing: string[] = []
  let csvCompared = 0
  const feByKey = new Map([...buckets.values()].filter((b) => b.fe).map((b) => [b.key, b.fe!]))
  for (const c of feCsvRows) {
    const p = feByKey.get(canonicalKey(c.name))
    if (!p) {
      csvMissing.push(c.name)
      continue
    }
    csvCompared++
    for (const k of ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'fgPct', 'ftPct', 'tov', 'value'] as const)
      if (c[k] !== p[k]) csvMismatch.push(`${c.name}: ${k} CSV ${c[k]} vs PDF ${p[k]}`)
    if (c.rank !== p.rank) csvMismatch.push(`${c.name}: rank CSV ${c.rank} vs PDF ${p.rank}`)
  }
  const derivedRows = files.filter((f) => f.result?.parsed.role === 'derived-9dub').flatMap((f) => f.result!.parsed.rows as { name: string; fga: number | null; fta: number | null }[])
  const derivedMismatch: string[] = []
  let derivedCompared = 0
  for (const d of derivedRows) {
    const p = feByKey.get(canonicalKey(d.name))
    if (!p) continue
    derivedCompared++
    if (d.fga !== p.fga || d.fta !== p.fta) derivedMismatch.push(`${d.name}: derived FGA/FTA ${d.fga}/${d.fta} vs PDF ${p.fga}/${p.fta}`)
  }
  const residuals = [...feByKey.values()]
    .filter((r) => r.pts != null && r.fgPct != null && r.fga != null && r.ftPct != null && r.fta != null && r.tpm != null)
    .map((r) => ({ name: r.name, residual: r.pts! - (2 * r.fgPct! * r.fga! + r.tpm! + r.ftPct! * r.fta!) }))
  const makesViolations = records.flatMap((r) => r.provenance!.warnings.filter((w) => w.includes('exceeds')).map((w) => `${r.identity.fullName}: ${w}`))
  const atoMismatch: string[] = []
  let atoChecked = 0
  const projLabels: Record<string, number> = {}
  const priorLabels: Record<string, number> = {}
  for (const b of buckets.values()) {
    const p = b.proj
    if (!p) continue
    if (p.projectionLabel) projLabels[p.projectionLabel] = (projLabels[p.projectionLabel] ?? 0) + 1
    if (p.priorLabel) priorLabels[p.priorLabel] = (priorLabels[p.priorLabel] ?? 0) + 1
    for (const blk of [p.projection, p.prior]) {
      if (!blk || blk.ast == null || blk.tov == null || blk.ato == null || blk.tov === 0) continue
      atoChecked++
      // Displayed values are rounded to 0.1; accept any ratio reachable within that rounding.
      const lo = Math.max(0, blk.ast - 0.05) / (blk.tov + 0.05)
      const hi = (blk.ast + 0.05) / Math.max(0.001, blk.tov - 0.05)
      if (blk.ato < lo - 0.01 || blk.ato > hi + 0.01) atoMismatch.push(`${p.name}: AST ${blk.ast} / TO ${blk.tov} vs A/TO ${blk.ato}`)
    }
  }

  // 7. Counts, overlap, tiers.
  const roles: SourceRole[] = ['fantasyedge-pdf', 'espn-projections', 'espn-live-draft', 'fantasypros-ecr', 'fantasypros-adp']
  const presence = (b: Bucket, role: SourceRole) =>
    role === 'espn-projections' ? !!b.proj : role === 'espn-live-draft' ? !!b.ldt : role === 'fantasyedge-pdf' ? !!b.fe : role === 'fantasypros-ecr' ? !!b.ecr : role === 'fantasypros-adp' ? !!b.adp : false
  const all = [...buckets.values()]
  const matrix = roles.map((r1) => roles.map((r2) => all.filter((b) => presence(b, r1) && presence(b, r2)).length))
  const isComplete = (r: DatasetRecord) => !!r.projection && r.projection.fieldGoalsAttempted != null && r.projection.freeThrowsAttempted != null
  const counts: Record<string, number> = {
    canonicalPlayers: records.length,
    withProjection: records.filter((r) => r.projection).length,
    completeNineCat: records.filter(isComplete).length,
    fantasyEdgeLines: records.filter((r) => r.profiles?.fantasyedge).length,
    espnProjectionLines: records.filter((r) => r.profiles?.espn).length,
    espnOnlyProjection: records.filter((r) => r.projection?.profile === 'espn').length,
    directoryOnly: records.filter((r) => !r.projection).length,
    withProjectedGp: records.filter((r) => r.projection?.gamesProjected != null).length,
    espnLiveRows: records.filter((r) => r.market?.espnLive).length,
    espnLiveUsable: records.filter((r) => r.projection?.espnAdpSource === 'espn-live-draft' || (r.market?.espnLive && !r.market.espnLive.capped)).length,
    espnLiveCapped: records.filter((r) => r.market?.espnLive?.capped).length,
    fantasyProsEspnFallback: records.filter((r) => !r.market?.espnLive && r.market?.fantasyPros?.espn != null).length,
    fantasyProsEcr: records.filter((r) => r.rankings?.fantasyProsEcr).length,
    fantasyEdgeRank: records.filter((r) => r.rankings?.fantasyEdge).length,
    withVolumeEstimate: records.filter((r) => r.volumeEstimate).length,
  }
  const ecrOrdered = [...records].filter((r) => r.rankings?.fantasyProsEcr).sort((a, b) => a.rankings!.fantasyProsEcr!.rank - b.rankings!.fantasyProsEcr!.rank)
  const coverageByTier = [156, 200, 250, 300]
    .filter((t) => t <= ecrOrdered.length)
    .map((tier) => {
      const xs = ecrOrdered.slice(0, tier)
      return {
        tier,
        ordering: 'FantasyPros expert consensus rank',
        players: xs.length,
        complete9: xs.filter(isComplete).length,
        anyProjection: xs.filter((r) => r.projection).length,
        gp: xs.filter((r) => r.projection?.gamesProjected != null).length,
        espnLive: xs.filter((r) => r.market?.espnLive).length,
        espnLiveUsable: xs.filter((r) => r.market?.espnLive && !r.market.espnLive.capped).length,
        fpFallback: xs.filter((r) => !r.market?.espnLive && r.market?.fantasyPros?.espn != null).length,
        expertRank: xs.filter((r) => r.rankings?.fantasyProsEcr).length,
      }
    })

  const singleSource: PlayerSourceSet[] = records
    .filter((r) => (r.provenance?.sources.length ?? 0) === 1)
    .map((r) => ({ key: canonicalKey(r.identity.fullName), id: r.identity.id, name: r.identity.fullName, roles: r.provenance!.sources as SourceRole[] }))

  // 8. Snapshot.
  const sources: SourceInfo[] = []
  const pushSource = (role: SourceRole, url: string | null, retrievedAt: string | null, fields: string[], notes: string) => {
    const fs = used(role)
    if (!fs.length) return
    sources.push({ name: `${ROLE_LABEL[role]} — ${fs.length} file${fs.length === 1 ? '' : 's'}`, url, retrievedAt: isoDate(retrievedAt), fields, notes })
  }
  pushSource('fantasyedge-pdf', 'https://nbafantasyedge.com/rankings/', feCaptured, ['pts', 'tpm', 'reb', 'ast', 'stl', 'blk', 'tov', 'fgPct', 'fga', 'ftPct', 'fta', 'rank', 'value', 'adp'], 'Default projection. FGM/FTM derived as FG% × FGA and FT% × FTA.')
  pushSource('espn-projections', null, projCaptured, ['gp', 'min', 'pts', 'tpm', 'reb', 'ast', 'stl', 'blk', 'tov', 'fgPct', 'ftPct'], 'Alternate profile; GP/MIN attached to Fantasy Edge lines as supplemental. No attempts.')
  pushSource('espn-live-draft', 'https://fantasy.espn.com/basketball/livedraftresults', ldtCaptured, ['avgPick', 'rank', 'trend', 'avgSalary', 'pctRostered'], `AVG PICK ≥ ${opts.adpCap} treated as ESPN's ceiling (rarely drafted).`)
  pushSource('fantasypros-ecr', 'https://www.fantasypros.com/nba/rankings/overall.php', null, ['ecrRank', 'best', 'worst', 'avg', 'sd'], 'Expert consensus ranks; AVG. is an expert-rank mean, not ADP.')
  pushSource('fantasypros-adp', 'https://www.fantasypros.com/nba/adp/overall.php', null, ['espn', 'yahoo', 'avg'], 'ESPN column is an integer ordinal; used only when ESPN Live Draft Trends has no row.')
  const latest = [feCaptured, projCaptured, ldtCaptured].filter(Boolean).sort().pop() ?? null

  const snapshot: DatasetSnapshot = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    id: opts.snapshotId,
    name: `Real ${opts.season} — Fantasy Edge + ESPN (local)`,
    season: opts.season,
    kind: 'local',
    createdAt: opts.now,
    sourceUpdatedAt: isoDate(latest),
    sources,
    notes: `Built by npm run data:ingest from ${files.length} local files in "${opts.sourceDir}". Private, for personal use; not for redistribution.`,
    parentId: null,
    profiles: [
      { id: 'fantasyedge', label: FE_LABEL, description: 'Default. Complete 9-cat lines with attempts for the Fantasy Edge pool; ESPN lines (no attempts) for everyone else.' },
      { id: 'espn', label: ESPN_LABEL, description: 'ESPN counting stats and percentages. Attempts borrowed from Fantasy Edge are a cross-source volume proxy.' },
    ],
    players: records,
  }

  const audit: IngestAudit = {
    generatedAt: opts.now,
    sourceDir: opts.sourceDir,
    season: opts.season,
    files: fileAudits,
    espnPages: { liveDraft: liveDraftPages, projections },
    counts,
    overlap: { roles, matrix },
    coverageByTier,
    conflicts: { team: teamConflicts, positions: posConflicts },
    duplicates,
    unresolved,
    singleSource,
    incomplete,
    issues,
    crossChecks: {
      fantasyEdgeCsvVsPdf: { compared: csvCompared, mismatches: csvMismatch, missing: csvMissing },
      derivedVsPdf: { compared: derivedCompared, mismatches: derivedMismatch },
      ptsIdentity: {
        checked: residuals.length,
        maxAbsResidual: Math.max(0, ...residuals.map((r) => Math.abs(r.residual))),
        worst: [...residuals].sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual)).slice(0, 5),
      },
      makesWithinAttempts: { checked: feByKey.size, violations: makesViolations },
      assistTurnover: { checked: atoChecked, mismatches: atoMismatch },
      espnLabels: { projection: projLabels, prior: priorLabels },
      outliers,
    },
    volumeEstimate: { ftRate, validation: volumeValidation },
  }
  return { snapshot, audit }
}

function hasCounting(p: ProfileLine): boolean {
  return [p.pts, p.tpm, p.reb, p.ast, p.stl, p.blk, p.tov].every((v) => v != null && Number.isFinite(v) && v >= 0)
}

function blockToLine(b: EspnStatBlock): Pick<ProfileLine, 'gp' | 'min' | 'pts' | 'tpm' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov' | 'fgPct' | 'ftPct'> {
  return { gp: b.gp, min: b.min, pts: b.pts, tpm: b.tpm, reb: b.reb, ast: b.ast, stl: b.stl, blk: b.blk, tov: b.tov, fgPct: b.fgPct, ftPct: b.ftPct }
}

