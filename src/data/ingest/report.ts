import { CATEGORIES } from '@/analytics/categories'
import { valuePlayers } from '@/analytics/valuation'
import type { EnginePlayer, ValuationResult } from '@/analytics/types'
import { toEnginePlayer } from '../engineAdapter'
import { canonicalKey } from '../normalize'
import type { DatasetRecord, DatasetSnapshot, ProfileLine } from '../schema'
import type { IngestAudit } from './reconcile'
import { ROLE_LABEL } from './types'

export interface SpotCheck {
  query: string
  found: boolean
  name?: string
  team?: string | null
  complete?: boolean
  fe?: string | null
  espn?: string | null
  prior?: string | null
  espnAdp?: string
  feRank?: number | null
  ecr?: number | null
  rank9dub?: number | null
  rankGp9dub?: number | null
}

export interface ValueComparison {
  poolSize: number
  teams: number
  rounds: number
  valued: number
  complete: number
  spearmanVsFantasyEdge: number
  spearmanVsFantasyEdgePool156: number
  spearmanPool156vs200: number
  top: { rank: number; name: string; team: string | null; total: number; feRank: number | null; feValue: number | null; espnAdp: string; ecr: number | null }[]
  disagreements: { name: string; rank: number; feRank: number; delta: number; note: string }[]
  spotChecks: SpotCheck[]
}

export const SPOT_CHECK_NAMES = [
  'Nikola Jokic', 'Victor Wembanyama', 'Shai Gilgeous-Alexander', 'Luka Doncic', 'Giannis Antetokounmpo', 'Cade Cunningham',
  'Scottie Barnes', 'Trey Murphy III', 'Jalen Suggs', 'Cason Wallace',
  // Late-round specialists and rookies
  'Walker Kessler', 'Mitchell Robinson', 'Daniel Gafford', 'Draymond Green', 'AJ Dybantsa', 'Darius Acuff', 'Cooper Flagg', 'Kon Knueppel',
]

function rankVector(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  const r = new Array<number>(xs.length)
  idx.forEach(([, i], k) => (r[i] = k + 1))
  return r
}

export function spearman(a: number[], b: number[]): number {
  if (a.length < 3) return NaN
  const ra = rankVector(a)
  const rb = rankVector(b)
  const n = a.length
  const d2 = ra.reduce((s, x, i) => s + (x - rb[i]) ** 2, 0)
  return 1 - (6 * d2) / (n * (n * n - 1))
}

const f1 = (v: number | null | undefined, d = 1) => (v == null ? '—' : v.toFixed(d))
const pct = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(3).replace(/^0/, ''))

export function lineText(p: ProfileLine | null | undefined): string | null {
  if (!p) return null
  const fg = `${pct(p.fgPct)}${p.fga != null ? ` on ${f1(p.fga)} FGA` : ' (no FGA)'}`
  const ft = `${pct(p.ftPct)}${p.fta != null ? ` on ${f1(p.fta)} FTA` : ' (no FTA)'}`
  const gp = p.gp != null ? `${p.gp} GP, ` : ''
  return `${gp}${f1(p.pts)} pts, ${f1(p.reb)} reb, ${f1(p.ast)} ast, ${f1(p.stl)} stl, ${f1(p.blk)} blk, ${f1(p.tpm)} 3pm, ${f1(p.tov)} to; FG ${fg}; FT ${ft}`
}

export function adpText(r: DatasetRecord): string {
  const live = r.market?.espnLive
  if (live) return live.capped ? `${f1(live.avgPick)} (ESPN live, at ~140 ceiling)` : `${f1(live.avgPick)} (ESPN live)`
  const fp = r.market?.fantasyPros?.espn
  return fp != null ? `${fp} (FantasyPros ESPN ordinal — fallback)` : '—'
}

function valued(snapshot: DatasetSnapshot, poolSize: number): { players: EnginePlayer[]; v: ValuationResult } {
  const players = snapshot.players.map((r) => toEnginePlayer(r)).filter((p): p is EnginePlayer => !!p)
  return { players, v: valuePlayers(players, { poolSize, teams: 12, rounds: 13, fullSeasonGames: 82 }) }
}

/** 9dub's own valuation of the snapshot, compared with Fantasy Edge's published 9-cat order. */
export function compareValues(snapshot: DatasetSnapshot, poolSize = 200): ValueComparison {
  const { players, v } = valued(snapshot, poolSize)
  const { v: v156 } = valued(snapshot, 156)
  const byId = new Map(snapshot.players.map((r) => [r.identity.id, r]))
  const withFe = players.filter((p) => byId.get(p.id)?.rankings?.fantasyEdge)
  const ours = withFe.map((p) => v.values.get(p.id)!.rank)
  const ours156 = withFe.map((p) => v156.values.get(p.id)!.rank)
  const theirs = withFe.map((p) => byId.get(p.id)!.rankings!.fantasyEdge!.rank)
  const top200 = v.orderPerGame.slice(0, 200)

  const top = v.orderPerGame.slice(0, 30).map((id, i) => {
    const r = byId.get(id)!
    return {
      rank: i + 1,
      name: r.identity.fullName,
      team: r.identity.nbaTeam,
      total: v.values.get(id)!.total,
      feRank: r.rankings?.fantasyEdge?.rank ?? null,
      feValue: r.rankings?.fantasyEdge?.value ?? null,
      espnAdp: adpText(r),
      ecr: r.rankings?.fantasyProsEcr?.rank ?? null,
    }
  })
  const disagreements = withFe
    .map((p) => {
      const r = byId.get(p.id)!
      const val = v.values.get(p.id)!
      const fe = r.rankings!.fantasyEdge!.rank
      const strongest = [...CATEGORIES].filter((c) => val.z[c] != null).sort((a, b) => Math.abs(val.z[b]!) - Math.abs(val.z[a]!)).slice(0, 3)
      return { name: r.identity.fullName, rank: val.rank, feRank: fe, delta: val.rank - fe, note: strongest.map((c) => `${c} ${val.z[c]! >= 0 ? '+' : ''}${val.z[c]!.toFixed(1)}`).join(', ') }
    })
    .filter((d) => d.feRank <= 150)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 12)

  const byKey = new Map(snapshot.players.flatMap((r) => [r.identity.fullName, ...r.identity.aliases].map((n) => [canonicalKey(n), r] as const)))
  const spotChecks: SpotCheck[] = SPOT_CHECK_NAMES.map((q) => {
    const r = byKey.get(canonicalKey(q))
    if (!r) return { query: q, found: false }
    const val = v.values.get(r.identity.id)
    return {
      query: q,
      found: true,
      name: r.identity.fullName,
      team: r.identity.nbaTeam,
      complete: !!r.projection && r.projection.fieldGoalsAttempted != null && r.projection.freeThrowsAttempted != null,
      fe: lineText(r.profiles?.fantasyedge),
      espn: lineText(r.profiles?.espn),
      prior: lineText(r.priorSeason),
      espnAdp: adpText(r),
      feRank: r.rankings?.fantasyEdge?.rank ?? null,
      ecr: r.rankings?.fantasyProsEcr?.rank ?? null,
      rank9dub: val?.rank ?? null,
      rankGp9dub: val?.rankGp ?? null,
    }
  })

  return {
    poolSize,
    teams: 12,
    rounds: 13,
    valued: players.length,
    complete: players.filter((p) => v.values.get(p.id)!.coveredCats === 9).length,
    spearmanVsFantasyEdge: spearman(ours, theirs),
    spearmanVsFantasyEdgePool156: spearman(ours156, theirs),
    spearmanPool156vs200: spearman(top200.map((id) => v.values.get(id)!.rank), top200.map((id) => v156.values.get(id)!.rank)),
    top,
    disagreements,
    spotChecks,
  }
}

// ───────────────────────── markdown ─────────────────────────

const esc = (s: string) => s.replace(/\|/g, '\\|')
const table = (head: string[], rows: (string | number | null | undefined)[][]) =>
  [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map((c) => esc(c == null ? '—' : String(c))).join(' | ')} |`)].join('\n')

export function renderAudit(a: IngestAudit, cmp: ValueComparison, opts: { detail: boolean }): string {
  const c = a.counts
  const L: string[] = []
  L.push(`# 9dub real-data ingest audit${opts.detail ? '' : ' — summary'}`)
  L.push('')
  L.push(`Generated ${a.generatedAt} from \`${a.sourceDir}\` for the ${a.season} season.${opts.detail ? ' **Private:** contains numbers from the source files — keep out of version control.' : ' Counts and decisions only (no source stat lines).'}`)
  L.push('')
  L.push('## Summary')
  L.push('')
  L.push(
    table(
      ['Measure', 'Count'],
      [
        ['Unique canonical players (all sources)', c.canonicalPlayers],
        [`Players with any ${a.season} projection`, c.withProjection],
        ['Complete 9-cat profiles (counting stats + FGA + FTA)', c.completeNineCat],
        ['ESPN-only projection (FG%/FT% without attempts → incomplete)', c.espnOnlyProjection],
        ['Directory-only (ranked/ADP but no projection anywhere)', c.directoryOnly],
        ['Projected GP available (ESPN)', c.withProjectedGp],
        ['ESPN Live Draft Trends rows', c.espnLiveRows],
        ['… usable as ADP (AVG PICK below the ~140 ceiling)', c.espnLiveUsable],
        ["… at ESPN's ~140 ceiling (rarely drafted)", c.espnLiveCapped],
        ['FantasyPros ESPN ordinal used as fallback ADP', c.fantasyProsEspnFallback],
        ['FantasyPros expert consensus ranks', c.fantasyProsEcr],
        ['Fantasy Edge 9-cat ranks', c.fantasyEdgeRank],
      ],
    ),
  )
  L.push('')
  L.push('## Source inventory')
  L.push('')
  L.push(
    table(
      ['File', 'Identified as', 'Status', 'Captured', 'Printed pages', 'Rows', 'Unique players', 'Covers', 'SHA-256'],
      a.files.map((f) => [f.file, f.roleLabel, f.status + (f.duplicateOf ? ` (of ${f.duplicateOf})` : ''), f.capturedAt ?? `file mtime ${f.mtime?.slice(0, 16) ?? '—'}`, f.printedPages, f.rows, f.uniquePlayers, f.coverage, f.sha256.slice(0, 12)]),
    ),
  )
  for (const f of a.files.filter((x) => x.notes.length)) L.push(`- **${f.file}**: ${f.notes.join(' ')}`)
  L.push('')
  L.push('## ESPN results pages vs printed pages')
  L.push('')
  L.push(`- Live Draft Trends: **${a.espnPages.liveDraft.length} distinct ESPN results pages** (${a.espnPages.liveDraft.reduce((s, p) => s + p.players, 0)} players) printed as ${a.files.filter((f) => f.role === 'espn-live-draft').reduce((s, f) => s + (f.printedPages ?? 0), 0)} PDF pages.`)
  for (const p of a.espnPages.liveDraft) L.push(`  - ranks ${p.ranks[0]}–${p.ranks[1]} (${p.players} players): ${p.file}`)
  L.push(`- Projections: **${a.espnPages.projections.length} distinct ESPN results pages** (${a.espnPages.projections.reduce((s, p) => s + p.players, 0)} players, ${a.espnPages.projections.reduce((s, p) => s + p.withProjection, 0)} with a 2026–27 projection) printed as ${a.files.filter((f) => f.role === 'espn-projections').reduce((s, f) => s + (f.printedPages ?? 0), 0)} PDF pages.`)
  for (const p of a.espnPages.projections) L.push(`  - page ${p.order}: ${p.players} players (first: ${p.firstPlayer}), ${p.withProjection} projected — ${p.file}`)
  L.push('')
  L.push('## Overlap between sources (unique players)')
  L.push('')
  L.push(table(['', ...a.overlap.roles.map((r) => ROLE_LABEL[r].split(' (')[0])], a.overlap.roles.map((r, i) => [ROLE_LABEL[r].split(' (')[0], ...a.overlap.matrix[i]])))
  L.push('')
  L.push('## Coverage of the draft-relevant pool')
  L.push('')
  L.push(table(['Top N (by FantasyPros ECR)', 'Players', 'Complete 9-cat', 'Any projection', 'Projected GP', 'ESPN live row', 'ESPN live usable', 'FP ESPN fallback', 'Expert rank'], a.coverageByTier.map((t) => [t.tier, t.players, t.complete9, t.anyProjection, t.gp, t.espnLive, t.espnLiveUsable, t.fpFallback, t.expertRank])))
  L.push('')
  L.push('## Precedence decisions')
  L.push('')
  L.push('- **Default projection:** Fantasy Edge 9-cat line, with FGA/FTA from the line printed under FG%/FT% on its rankings page. FGM = FG% × FGA and FTM = FT% × FTA are **derived** (inputs are rounded).')
  L.push('- **Outside the Fantasy Edge pool:** ESPN projection. ESPN prints FG%/FT% but not attempts, so these players are **incomplete**: FG%/FT% impact unknown, ranked after complete players, excluded from recommendations unless the opt-in volume estimate is on.')
  L.push('- **ESPN projection is an alternate profile**, never averaged with Fantasy Edge. ESPN projected GP/MIN are attached to Fantasy Edge lines as labelled supplemental fields. prior-season `STATISTICS` rows are stored as actuals only.')
  L.push('- **ESPN ADP:** Live Draft Trends `AVG PICK` (snake). Values at ESPN\'s ~140 ceiling mean "rarely drafted" and are not used for timing. FantasyPros\' ESPN column (an integer ordinal) is a labelled fallback only when ESPN has no row. Yahoo and blended ADP are stored separately and never substituted.')
  L.push('- **Rankings are kept apart:** Fantasy Edge rank/value, FantasyPros expert consensus (rank, best, worst, average expert rank, SD), ESPN projections list order, and 9dub\'s own per-game and GP-aware ranks.')
  L.push('- **A/TO** is read only to cross-check AST and TO; it is not a category.')
  L.push('')
  L.push('## Cross-checks')
  L.push('')
  const x = a.crossChecks
  L.push(`- Fantasy Edge CSV vs printed page: ${x.fantasyEdgeCsvVsPdf.compared} players compared, **${x.fantasyEdgeCsvVsPdf.mismatches.length} mismatches**, ${x.fantasyEdgeCsvVsPdf.missing.length} CSV names not on the page.`)
  for (const m of x.fantasyEdgeCsvVsPdf.mismatches.slice(0, 10)) L.push(`  - ${m}`)
  L.push(`- Previously combined 9dub CSV (reference only) vs printed FGA/FTA: ${x.derivedVsPdf.compared} compared, **${x.derivedVsPdf.mismatches.length} mismatches**.`)
  L.push(`- Points identity PTS ≈ 2·FG%·FGA + 3PM + FT%·FTA on ${x.ptsIdentity.checked} Fantasy Edge lines: max |residual| **${x.ptsIdentity.maxAbsResidual.toFixed(3)}** points (rounding only). A swapped or misread attempt column would break this.`)
  if (opts.detail) for (const w of x.ptsIdentity.worst) L.push(`  - ${w.name}: ${w.residual.toFixed(3)}`)
  L.push(`- Derived makes ≤ attempts: ${x.makesWithinAttempts.checked} checked, ${x.makesWithinAttempts.violations.length} violations.`)
  L.push(`- ESPN A/TO vs AST/TO (within display rounding): ${x.assistTurnover.checked} rows, ${x.assistTurnover.mismatches.length} mismatches.`)
  for (const m of x.assistTurnover.mismatches.slice(0, 10)) L.push(`  - ${m}`)
  L.push(`- ESPN row labels used as projections: ${Object.entries(x.espnLabels.projection).map(([k, n]) => `${k} ×${n}`).join(', ')}; prior-season rows: ${Object.entries(x.espnLabels.prior).map(([k, n]) => `${k} ×${n}`).join(', ')}.`)
  L.push(`- Outliers (per-game PTS > 40, REB > 16, AST > 13, TO > 5.5, BLK > 4.5, STL > 3): ${x.outliers.length ? x.outliers.join('; ') : 'none'}.`)
  L.push('')
  L.push('## Conflicts, duplicates and ambiguities')
  L.push('')
  L.push(`- Team differs between sources: **${a.conflicts.team.length}** players (ESPN team used; all values kept in provenance).`)
  for (const t of a.conflicts.team.slice(0, opts.detail ? 60 : 15)) L.push(`  - ${t.name}: ${Object.entries(t.values).map(([k, v]) => `${ROLE_LABEL[k as keyof typeof ROLE_LABEL]?.split(' (')[0] ?? k} ${v ?? '—'}`).join(' · ')}`)
  L.push(`- ESPN positions differ between the two ESPN pages: ${a.conflicts.positions.length}.`)
  for (const t of a.conflicts.positions.slice(0, 20)) L.push(`  - ${t.name}: ${Object.entries(t.values).map(([k, v]) => `${k} ${v ?? '—'}`).join(' · ')}`)
  L.push(`- Same player listed twice inside one source (resolved by team agreement): ${a.duplicates.length}.`)
  for (const d of a.duplicates) L.push(`  - ${d.name} — ${d.reason} (kept row ${d.kept.row ?? d.kept.page}, dropped ${d.dropped.map((l) => l.row ?? l.page).join(', ')})`)
  L.push(`- Unresolved same-name rows: ${a.unresolved.length}.`)
  for (const u of a.unresolved) L.push(`  - ${u.name} (${ROLE_LABEL[u.role]}): ${u.reason}`)
  L.push(`- Players found in only one source: ${a.singleSource.length}${opts.detail ? '' : ' (names in the private report)'}.`)
  if (opts.detail) L.push(`  - ${a.singleSource.map((s) => `${s.name} [${s.roles.join(',')}]`).join('; ')}`)
  L.push('')
  L.push('## Incomplete players')
  L.push('')
  L.push(`${a.incomplete.length} players lack a complete 9-cat projection. They stay searchable and draftable; their value is shown as partial and they never outrank complete players.`)
  if (opts.detail) {
    const shown = [...a.incomplete].sort((p, q) => (p.espnAdp ?? 999) - (q.espnAdp ?? 999))
    L.push('')
    L.push(table(['Player', 'Reason', 'ESPN ADP'], shown.map((p) => [p.name, p.reason, p.espnAdp == null ? '—' : p.espnAdp.toFixed(1)])))
  }
  L.push('')
  L.push('## Optional shooting-volume estimate (off by default)')
  L.push('')
  L.push(`FTA/FGA ratios (Fantasy Edge pool medians): ${Object.entries(a.volumeEstimate.ftRate).map(([g, r]) => `${g} ${r.toFixed(3)}`).join(', ')}. Validated by re-estimating the ${a.volumeEstimate.validation.n} Fantasy Edge players from their own PTS/3PM/FG%/FT%: FGA mean abs. error **${(100 * a.volumeEstimate.validation.fgaMape).toFixed(1)}%** (90th pct ${(100 * a.volumeEstimate.validation.fgaP90).toFixed(1)}%), FTA mean abs. error **${a.volumeEstimate.validation.ftaMae.toFixed(2)}** per game (90th pct ${a.volumeEstimate.validation.ftaP90.toFixed(2)}). Good enough to rank deep players roughly; not a projection.`)
  L.push('')
  L.push('## 9dub valuation vs Fantasy Edge')
  L.push('')
  L.push(`9dub per-game z-scores (12 teams × 13 rounds, reference pool ${cmp.poolSize}; ${cmp.valued} valued players, ${cmp.complete} complete). Spearman rank correlation with Fantasy Edge's published order on shared players: **${cmp.spearmanVsFantasyEdge.toFixed(3)}** (reference pool 156: ${cmp.spearmanVsFantasyEdgePool156.toFixed(3)}). Pool 156 vs 200 agreement over 9dub's top 200: ${cmp.spearmanPool156vs200.toFixed(3)}.`)
  if (opts.detail) {
    L.push('')
    L.push('### Top 30 (9dub per-game)')
    L.push('')
    L.push(table(['#', 'Player', 'Team', '9dub total z', 'FE rank', 'FE value', 'ESPN ADP', 'FP ECR'], cmp.top.map((t) => [t.rank, t.name, t.team, t.total.toFixed(2), t.feRank, t.feValue == null ? null : t.feValue.toFixed(2), t.espnAdp, t.ecr])))
    L.push('')
    L.push('### Largest rank disagreements (Fantasy Edge top 150)')
    L.push('')
    L.push(table(['Player', '9dub rank', 'FE rank', 'Δ', 'Largest |z| categories'], cmp.disagreements.map((d) => [d.name, d.rank, d.feRank, d.delta > 0 ? `+${d.delta}` : d.delta, d.note])))
    L.push('')
    L.push('## Spot checks against the sources')
    L.push('')
    for (const s of cmp.spotChecks) {
      if (!s.found) {
        L.push(`- **${s.query}** — not found in any source.`)
        continue
      }
      L.push(`- **${s.name}** (${s.team ?? '—'}) — ${s.complete ? 'complete' : 'INCOMPLETE'}; 9dub #${s.rank9dub ?? '—'} per-game / #${s.rankGp9dub ?? '—'} GP-aware; FE #${s.feRank ?? '—'}; FP ECR #${s.ecr ?? '—'}; ESPN ADP ${s.espnAdp}`)
      L.push(`  - Fantasy Edge: ${s.fe ?? '—'}`)
      L.push(`  - ESPN projection: ${s.espn ?? '—'}`)
      L.push(`  - ESPN prior season: ${s.prior ?? '—'}`)
    }
  }
  L.push('')
  L.push('## Row-level parser issues')
  L.push('')
  const errs = a.issues.filter((i) => i.level === 'error')
  const warns = a.issues.filter((i) => i.level === 'warn')
  L.push(`${errs.length} errors, ${warns.length} warnings.`)
  for (const i of a.issues.slice(0, 50)) L.push(`- ${i.level}: ${i.message} — ${i.loc.file}${i.loc.page ? ` p.${i.loc.page}` : ''}${i.loc.row ? ` row ${i.loc.row}` : ''}`)
  L.push('')
  return L.join('\n')
}
