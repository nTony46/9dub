import { normalizePositions, type Position } from '@/analytics/positions'
import { finalizeProjection, normalizeName, normalizeTeam, slugify } from '../normalize'
import { currentSeason, previousSeason } from '../seasonLabel'
import {
  DATASET_SCHEMA_VERSION,
  DatasetRecordSchema,
  type CompletenessFlag,
  type DatasetRecord,
  type DatasetSnapshot,
  type PlayerProjection,
  type SourceInfo,
} from '../schema'
import { parseNumber, parsePctCombo, parsePercent, parsePlayerCell } from './cells'
import { COUNTING_REQUIRED, FIELD_LABEL, autoMap, normHeader, type FieldKey } from './fields'
import type { ParsedTable, PresetId } from './parseTable'

export type Unit = 'perGame' | 'totals'
export type ImportMode = 'replace' | 'merge'

export interface ImportOptions {
  unit: Unit
  season: string
  sourceName: string
  sourceUrl: string | null
  /** ISO date the user retrieved/copied the data. */
  retrievedAt: string
  otherAdpLabel: string | null
}

export interface RowResult {
  index: number
  name: string
  team: string | null
  positions: Position[]
  espnId: string | null
  fields: Partial<PlayerProjection>
  hasFullStats: boolean
  errors: string[]
  warnings: string[]
  raw: Record<string, string>
}

/** Initial mapping for a parsed table: sample-aware auto-map plus preset-specific fixes. */
export function initialMapping(table: ParsedTable): FieldKey[] {
  const sample = table.rows.slice(0, 25)
  const map = autoMap(table.headers, sample)
  const nh = table.headers.map(normHeader)
  const set = (h: string, f: FieldKey) => {
    const i = nh.indexOf(h)
    if (i >= 0) {
      for (let j = 0; j < map.length; j++) if (map[j] === f) map[j] = 'ignore'
      map[i] = f
    }
  }
  if (table.preset === 'hashtag-adp') {
    map.fill('ignore')
    set('name', 'name')
    set('team', 'team')
    set('espnpos', 'positions')
    set('espnadp', 'espnAdp')
    set('blendadp', 'otherAdp')
  }
  if (table.preset === 'hashtag-projections') {
    set('r#', 'sourceRank')
    set('adp', 'otherAdp')
    const t = nh.indexOf('total')
    if (t >= 0) map[t] = 'ignore'
  }
  return map
}

export function defaultOptionsFor(preset: PresetId, today: string): ImportOptions {
  const base: ImportOptions = { unit: 'perGame', season: currentSeason(), sourceName: 'Manual import', sourceUrl: null, retrievedAt: today, otherAdpLabel: null }
  switch (preset) {
    case 'hashtag-projections':
      return { ...base, sourceName: 'Hashtag Basketball projections (user paste)', sourceUrl: 'https://hashtagbasketball.com/fantasy-basketball-projections', otherAdpLabel: 'Hashtag ADP' }
    case 'hashtag-adp':
      return { ...base, sourceName: 'Hashtag Basketball ADP (user paste)', sourceUrl: 'https://hashtagbasketball.com/fantasy-basketball-adp', otherAdpLabel: 'HB blended ADP' }
    case 'fantasypros':
      return { ...base, unit: 'totals', sourceName: 'FantasyPros projections (user export)', sourceUrl: 'https://www.fantasypros.com/nba/projections/', otherAdpLabel: 'FantasyPros ADP' }
    case 'bbref':
      return { ...base, season: `${previousSeason(base.season)} actuals`, sourceName: 'Basketball-Reference per-game (user export)', sourceUrl: 'https://www.basketball-reference.com/' }
    default:
      return base
  }
}

/** Heuristic unit detection: big point totals next to a GP column suggest season totals. */
export function detectUnit(table: ParsedTable, mapping: readonly FieldKey[]): Unit {
  const pi = mapping.indexOf('pts')
  if (pi < 0) return 'perGame'
  const vals = table.rows.slice(0, 30).map((r) => parseNumber(r[pi])).filter((v): v is number => v != null)
  const sorted = [...vals].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  return median > 80 ? 'totals' : 'perGame'
}

const STAT_FIELD: Partial<Record<FieldKey, keyof PlayerProjection>> = {
  pts: 'points',
  tpm: 'threesMade',
  reb: 'rebounds',
  ast: 'assists',
  stl: 'steals',
  blk: 'blocks',
  tov: 'turnovers',
  fgm: 'fieldGoalsMade',
  fga: 'fieldGoalsAttempted',
  ftm: 'freeThrowsMade',
  fta: 'freeThrowsAttempted',
  gp: 'gamesProjected',
  min: 'minutesPerGame',
  espnAdp: 'espnAdp',
  espnRank: 'espnRank',
  sourceRank: 'sourceNineCatRank',
  otherAdp: 'otherAdp',
}

const PER_GAME_SCALED: (keyof PlayerProjection)[] = [
  'points', 'threesMade', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers',
  'fieldGoalsMade', 'fieldGoalsAttempted', 'freeThrowsMade', 'freeThrowsAttempted', 'minutesPerGame',
]

export function mapRows(table: ParsedTable, mapping: readonly FieldKey[], opts: ImportOptions): RowResult[] {
  const col = (f: FieldKey) => mapping.indexOf(f)
  const out: RowResult[] = []
  table.rows.forEach((row, index) => {
    const errors: string[] = []
    const warnings: string[] = []
    const raw: Record<string, string> = {}
    table.headers.forEach((h, i) => {
      if (row[i] != null && row[i] !== '') raw[h || `col${i + 1}`] = row[i]
    })
    const ni = col('name')
    const cell = ni >= 0 ? parsePlayerCell(row[ni] ?? '') : { name: '', team: null, positions: null }
    const name = cell.name
    if (!name) errors.push('Missing player name')
    const ti = col('team')
    const team = normalizeTeam(ti >= 0 ? row[ti] : null) ?? cell.team
    const pi = col('positions')
    const positions = normalizePositions(pi >= 0 ? row[pi] : cell.positions)
    const ei = col('espnId')
    const espnId = ei >= 0 && row[ei] ? String(row[ei]).trim() : null

    const fields: Partial<PlayerProjection> = {}
    const flags = new Set<CompletenessFlag>()
    mapping.forEach((f, i) => {
      const target = STAT_FIELD[f]
      if (!target) return
      const v = row[i]
      const n = parseNumber(v)
      if (n == null) {
        if (v != null && String(v).trim() !== '' && !/^[-—–]+$/.test(String(v).trim()))
          errors.push(`${FIELD_LABEL[f]}: "${v}" is not a number`)
        return
      }
      if (n < 0 && f !== 'note') {
        errors.push(`${FIELD_LABEL[f]}: negative value ${n}`)
        return
      }
      ;(fields as Record<string, number>)[target] = n
    })
    const pctOf = (f: 'fgPct' | 'ftPct') => {
      const i = col(f)
      return i >= 0 ? parsePercent(row[i]) : null
    }
    const fgPct = pctOf('fgPct')
    const ftPct = pctOf('ftPct')
    if (fgPct != null) fields.fieldGoalPct = fgPct
    if (ftPct != null) fields.freeThrowPct = ftPct
    const comboOf = (f: 'fgCombo' | 'ftCombo') => {
      const i = col(f)
      return i >= 0 ? parsePctCombo(row[i]) : null
    }
    const fgc = comboOf('fgCombo')
    if (fgc) {
      if (fgc.pct != null) fields.fieldGoalPct = fgc.pct
      if (fgc.made != null) fields.fieldGoalsMade = fgc.made
      if (fgc.att != null) fields.fieldGoalsAttempted = fgc.att
    }
    const ftc = comboOf('ftCombo')
    if (ftc) {
      if (ftc.pct != null) fields.freeThrowPct = ftc.pct
      if (ftc.made != null) fields.freeThrowsMade = ftc.made
      if (ftc.att != null) fields.freeThrowsAttempted = ftc.att
    }
    for (const [k, v] of [['fieldGoalPct', fields.fieldGoalPct], ['freeThrowPct', fields.freeThrowPct]] as const)
      if (v != null && (v < 0 || v > 1)) errors.push(`${k === 'fieldGoalPct' ? 'FG%' : 'FT%'} out of range: ${v}`)
    if (fields.fieldGoalsMade != null && fields.fieldGoalsAttempted != null && fields.fieldGoalsMade > fields.fieldGoalsAttempted + 1e-9)
      errors.push('FGM exceeds FGA')
    if (fields.freeThrowsMade != null && fields.freeThrowsAttempted != null && fields.freeThrowsMade > fields.freeThrowsAttempted + 1e-9)
      errors.push('FTM exceeds FTA')

    if (opts.unit === 'totals') {
      const gp = fields.gamesProjected
      const hasScaled = PER_GAME_SCALED.some((k) => fields[k] != null)
      if (hasScaled) {
        if (!gp || gp <= 0) errors.push('Season totals need games played to convert to per game')
        else {
          for (const k of PER_GAME_SCALED) if (fields[k] != null) (fields as Record<string, number>)[k] = (fields[k] as number) / gp
          flags.add('unit-converted-from-totals')
        }
      }
    }
    const ni2 = col('note')
    if (ni2 >= 0 && row[ni2]) fields.injuryOrRoleNote = String(row[ni2]).trim()
    if (fields.otherAdp != null) fields.otherAdpLabel = opts.otherAdpLabel
    if (fields.gamesProjected != null && fields.gamesProjected > 82) warnings.push(`GP ${fields.gamesProjected} exceeds 82`)
    if (fields.fieldGoalPct != null && fields.fieldGoalsAttempted == null) warnings.push('FG% without attempts — FG impact will be unknown')
    if (fields.freeThrowPct != null && fields.freeThrowsAttempted == null) warnings.push('FT% without attempts — FT impact will be unknown')
    if (flags.size) fields.completenessFlags = [...flags]

    const hasFullStats = COUNTING_REQUIRED.every((f) => fields[STAT_FIELD[f]!] != null)
    out.push({ index, name, team, positions, espnId, fields, hasFullStats, errors, warnings, raw })
  })

  // Duplicate rows inside the import itself.
  const seen = new Map<string, number>()
  for (const r of out) {
    if (!r.name) continue
    const key = `${normalizeName(r.name)}|${r.team ?? ''}`
    if (seen.has(key)) r.errors.push(`Duplicate of row ${seen.get(key)! + 1}`)
    else seen.set(key, r.index)
  }
  return out
}

// ───────────────────────── identity matching ─────────────────────────

export interface Candidate {
  id: string
  name: string
  team: string | null
}

export interface MatchInfo {
  row: RowResult
  status: 'new' | 'matched' | 'ambiguous' | 'invalid' | 'skipped'
  targetId?: string
  candidates?: Candidate[]
  message?: string
}

function indexRecords(players: readonly DatasetRecord[]) {
  const byName = new Map<string, DatasetRecord[]>()
  const byEspn = new Map<string, DatasetRecord>()
  const byInitialLast = new Map<string, DatasetRecord[]>()
  const add = (m: Map<string, DatasetRecord[]>, k: string, r: DatasetRecord) => {
    const l = m.get(k)
    if (l) {
      if (!l.includes(r)) l.push(r)
    } else m.set(k, [r])
  }
  for (const r of players) {
    for (const n of [r.identity.fullName, ...r.identity.aliases]) {
      const k = normalizeName(n)
      add(byName, k, r)
      const parts = k.split(' ')
      if (parts.length >= 2) add(byInitialLast, `${parts[0][0]} ${parts[parts.length - 1]}`, r)
    }
    if (r.identity.espnId) byEspn.set(r.identity.espnId, r)
  }
  return { byName, byEspn, byInitialLast }
}

const cand = (r: DatasetRecord): Candidate => ({ id: r.identity.id, name: r.identity.fullName, team: r.identity.nbaTeam })

export function matchRows(rows: readonly RowResult[], existing: readonly DatasetRecord[]): MatchInfo[] {
  const idx = indexRecords(existing)
  const claimed = new Map<string, number>()
  return rows.map((row) => {
    if (row.errors.length) return { row, status: 'invalid' as const, message: row.errors.join('; ') }
    if (row.espnId && idx.byEspn.has(row.espnId)) return { row, status: 'matched' as const, targetId: idx.byEspn.get(row.espnId)!.identity.id }
    const key = normalizeName(row.name)
    const hits = idx.byName.get(key) ?? []
    let info: MatchInfo
    if (hits.length === 1) {
      const t = hits[0]
      info = { row, status: 'matched', targetId: t.identity.id }
      if (row.team && t.identity.nbaTeam && row.team !== t.identity.nbaTeam)
        info.message = `Team differs (${t.identity.nbaTeam} → ${row.team}); treated as a team change`
    } else if (hits.length > 1) {
      const byTeam = hits.filter((h) => row.team && h.identity.nbaTeam === row.team)
      info =
        byTeam.length === 1
          ? { row, status: 'matched', targetId: byTeam[0].identity.id }
          : { row, status: 'ambiguous', candidates: hits.map(cand), message: 'Several players share this name' }
    } else {
      const parts = key.split(' ')
      const loose = parts.length >= 2 ? (idx.byInitialLast.get(`${parts[0][0]} ${parts[parts.length - 1]}`) ?? []) : []
      info = loose.length
        ? { row, status: 'ambiguous', candidates: loose.map(cand), message: `No exact match; possible: ${loose.map((l) => l.identity.fullName).join(', ')}` }
        : { row, status: 'new' }
    }
    if (info.status === 'matched') {
      const prev = claimed.get(info.targetId!)
      if (prev != null) return { row, status: 'ambiguous', candidates: hits.map(cand), message: `Row ${prev + 1} already matched this player` }
      claimed.set(info.targetId!, row.index)
    }
    return info
  })
}

// ───────────────────────── snapshot building ─────────────────────────

export type Resolution = { action: 'match'; targetId: string } | { action: 'new' } | { action: 'skip' }

export interface ImportPlan {
  matches: MatchInfo[]
  counts: { total: number; added: number; updated: number; ambiguous: number; invalid: number; skipped: number }
  snapshot: DatasetSnapshot | null
  error: string | null
}

function emptyProjection(id: string, opts: ImportOptions): PlayerProjection {
  return {
    playerId: id,
    season: opts.season,
    source: opts.sourceName,
    sourceUpdatedAt: opts.retrievedAt,
    gamesProjected: null,
    minutesPerGame: null,
    points: 0,
    threesMade: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fieldGoalsMade: null,
    fieldGoalsAttempted: null,
    freeThrowsMade: null,
    freeThrowsAttempted: null,
    fieldGoalPct: null,
    freeThrowPct: null,
    injuryOrRoleNote: null,
    riskFlag: null,
    espnAdp: null,
    espnRank: null,
    sourceNineCatRank: null,
    otherAdp: null,
    otherAdpLabel: null,
    espnAdpSource: null,
    profile: null,
    gpSource: null,
    completenessFlags: [],
  }
}

function uniqueId(name: string, team: string | null, taken: Set<string>): string {
  let id = slugify(name) || 'player'
  if (taken.has(id)) id = `${id}-${(team ?? 'x').toLowerCase()}`
  let n = 2
  const base = id
  while (taken.has(id)) id = `${base}-${n++}`
  taken.add(id)
  return id
}

export function planImport(
  rows: readonly RowResult[],
  mode: ImportMode,
  existing: DatasetSnapshot | null,
  opts: ImportOptions,
  resolutions: Record<number, Resolution> = {},
  now = new Date().toISOString(),
): ImportPlan {
  const base = mode === 'merge' && existing ? existing.players : []
  const matches =
    mode === 'merge'
      ? matchRows(rows, base)
      : rows.map((row) => (row.errors.length ? { row, status: 'invalid', message: row.errors.join('; ') } : { row, status: 'new' }) as MatchInfo)
  for (const m of matches) {
    const r = resolutions[m.row.index]
    if (!r || m.status === 'invalid') continue
    if (r.action === 'skip') m.status = 'skipped'
    else if (r.action === 'new') m.status = 'new'
    else {
      m.status = 'matched'
      m.targetId = r.targetId
    }
  }

  const records = new Map(base.map((r) => [r.identity.id, structuredClone(r)]))
  const taken = new Set(records.keys())
  let added = 0
  let updated = 0
  const fieldsSeen = new Set<string>()
  for (const m of matches) {
    const { row } = m
    Object.keys(row.fields).forEach((k) => fieldsSeen.add(k))
    if (m.status === 'matched') {
      const rec = records.get(m.targetId!)!
      if (!rec.projection && !row.hasFullStats) {
        // A directory-only player (no projection anywhere) cannot take a partial update such as ADP alone.
        m.status = 'skipped'
        m.message = 'Player has no projection in the current dataset and this row has no full stat line — skipped'
        continue
      }
      const prior: PlayerProjection = rec.projection ?? emptyProjection(rec.identity.id, opts)
      const merged: PlayerProjection = { ...prior }
      for (const [k, v] of Object.entries(row.fields)) if (v != null && k !== 'completenessFlags') (merged as Record<string, unknown>)[k] = v
      merged.completenessFlags = [...new Set([...(prior.completenessFlags ?? []), ...(row.fields.completenessFlags ?? [])])]
      if (row.fields.espnAdp != null) merged.espnAdpSource = 'import'
      if (row.hasFullStats) {
        merged.source = opts.sourceName
        merged.season = opts.season
      } else if (!merged.source.includes(opts.sourceName)) merged.source = `${merged.source}; ${opts.sourceName}`
      merged.sourceUpdatedAt = opts.retrievedAt
      rec.projection = finalizeProjection(merged)
      if (row.team) rec.identity.nbaTeam = row.team
      if (row.positions.length) rec.identity.positions = row.positions
      if (row.espnId) rec.identity.espnId = row.espnId
      if (row.name !== rec.identity.fullName && !rec.identity.aliases.includes(row.name)) rec.identity.aliases.push(row.name)
      updated++
    } else if (m.status === 'new') {
      if (!row.hasFullStats) {
        m.status = 'skipped'
        m.message = mode === 'merge' ? 'Not in the current dataset and has no full stat line — skipped' : 'Missing required counting stats (PTS, 3PM, REB, AST, STL, BLK, TO)'
        if (mode === 'replace') m.status = 'invalid'
        continue
      }
      const id = uniqueId(row.name, row.team, taken)
      const projection = finalizeProjection({ ...emptyProjection(id, opts), ...row.fields, playerId: id, season: opts.season, source: opts.sourceName, sourceUpdatedAt: opts.retrievedAt, espnAdpSource: row.fields.espnAdp != null ? 'import' : null, raw: row.raw })
      const rec: DatasetRecord = {
        identity: { id, fullName: row.name, aliases: [], nbaTeam: row.team, espnId: row.espnId, positions: row.positions },
        projection,
      }
      if (!row.positions.length) projection.completenessFlags = [...projection.completenessFlags, 'missing-positions']
      records.set(id, rec)
      added++
    }
  }

  const counts = {
    total: rows.length,
    added,
    updated,
    ambiguous: matches.filter((m) => m.status === 'ambiguous').length,
    invalid: matches.filter((m) => m.status === 'invalid').length,
    skipped: matches.filter((m) => m.status === 'skipped').length,
  }
  const players = [...records.values()]
  for (const p of players) {
    const ok = DatasetRecordSchema.safeParse(p)
    if (!ok.success) return { matches, counts, snapshot: null, error: `Record ${p.identity.fullName} failed validation: ${ok.error.issues[0]?.message}` }
  }
  if (players.length < 2) return { matches, counts, snapshot: null, error: 'Import would leave fewer than 2 valid players.' }
  const source: SourceInfo = { name: opts.sourceName, url: opts.sourceUrl, retrievedAt: opts.retrievedAt, fields: [...fieldsSeen].sort(), notes: opts.unit === 'totals' ? 'Converted from season totals to per game.' : null }
  const sources = mode === 'merge' && existing ? [...existing.sources, source] : [source]
  const snapshot: DatasetSnapshot = {
    schemaVersion: DATASET_SCHEMA_VERSION,
    id: `import-${now.replace(/[^0-9]/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 6)}`,
    name: mode === 'merge' && existing ? `${existing.name} + ${opts.sourceName}` : opts.sourceName,
    season: mode === 'merge' && existing ? existing.season : opts.season,
    // Merging into the fictional demo pool keeps it labelled as demo; into a private local snapshot keeps it local.
    kind: mode === 'merge' && (existing?.kind === 'demo' || existing?.kind === 'local') ? existing.kind : 'import',
    createdAt: now,
    sourceUpdatedAt: [opts.retrievedAt, existing && mode === 'merge' ? existing.sourceUpdatedAt : null].filter(Boolean).sort().pop() ?? null,
    sources,
    notes: mode === 'merge' && existing?.kind === 'demo' ? 'Merged into the FICTIONAL demo pool — demo players remain fictional.' : null,
    parentId: mode === 'merge' && existing ? existing.id : null,
    profiles: mode === 'merge' && existing ? existing.profiles : [],
    players,
  }
  return { matches, counts, snapshot, error: null }
}
