/**
 * Re-ingest the private source folder into a validated local snapshot.
 *
 *   npm run data:ingest                               # reads "Fantasy Draft Data/"
 *   npm run data:ingest -- --dir "Fantasy Draft Data" --out .local-data
 *
 * Reads PDFs (embedded text layer only — no OCR, no network) and CSVs,
 * identifies each file by its content, reconciles players, and writes:
 *   .local-data/real-2026-27.json          the snapshot the app can activate
 *   .local-data/manifest.json              local snapshot list served to the dev/preview app
 *   .local-data/history/<id>.json          previous snapshots (rollback)
 *   .local-data/audit/REAL_DATA_AUDIT.md   full readable audit (private: contains source numbers)
 *   .local-data/audit/AUDIT_SUMMARY.md     counts and decisions only
 *   .local-data/audit/ingest-audit.json    machine-readable audit
 * Everything under .local-data/ is git-ignored. Source files are only read.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { classifyCsv, classifyPdf } from '../../src/data/ingest/classify'
import { parseEspnProjections, parseLiveDraftTrends } from '../../src/data/ingest/espn'
import { parseCsv, parseFantasyEdgeCsv, parseFantasyEdgePdf } from '../../src/data/ingest/fantasyEdge'
import { parseDerived9dub, parseFantasyProsAdp, parseFantasyProsEcr } from '../../src/data/ingest/fantasyPros'
import { DEFAULT_INGEST_OPTIONS, reconcile, type IngestFile } from '../../src/data/ingest/reconcile'
import { espnProjectionLabel } from '../../src/data/seasonLabel'
import { compareValues, renderAudit } from '../../src/data/ingest/report'
import { DatasetSnapshotSchema } from '../../src/data/schema'
import { readPdf } from './ingest/readPdf'
import { upsertManifest } from './manifest'

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return walk(p)
    return e.isFile() && !e.name.startsWith('.') ? [p] : []
  })
}

const dir = resolve(arg('dir', 'Fantasy Draft Data'))
const out = resolve(arg('out', '.local-data'))
const season = arg('season', DEFAULT_INGEST_OPTIONS.season)
if (!existsSync(dir)) {
  console.error(`Source folder not found: ${dir}\nPut your files in "Fantasy Draft Data/" (or pass --dir).`)
  process.exit(1)
}

const files: IngestFile[] = []
for (const path of walk(dir).sort()) {
  const rel = relative(dir, path)
  const buf = readFileSync(path)
  const sha256 = createHash('sha256').update(buf).digest('hex')
  const st = statSync(path)
  const lower = rel.toLowerCase()
  const f: IngestFile = { file: rel, sha256, size: st.size, mtime: st.mtime.toISOString(), kind: lower.endsWith('.pdf') ? 'pdf' : lower.endsWith('.csv') ? 'csv' : 'other', result: null }
  try {
    if (f.kind === 'pdf') {
      const pages = await readPdf(path)
      const textItems = pages.reduce((s, p) => s + p.items.length, 0)
      if (!textItems) throw new Error('PDF has no text layer (scanned image?) — not parsed; OCR is intentionally not used.')
      const role = classifyPdf(pages)
      f.result =
        role === 'espn-live-draft' ? parseLiveDraftTrends(pages, rel)
        : role === 'espn-projections' ? parseEspnProjections(pages, rel)
        : role === 'fantasyedge-pdf' ? parseFantasyEdgePdf(pages, rel)
        : { parsed: { role: 'unknown', rows: [] }, issues: [], capturedAt: null, printedPages: pages.length }
    } else if (f.kind === 'csv') {
      const text = buf.toString('utf8')
      const role = classifyCsv(parseCsv(text).headers)
      f.result =
        role === 'fantasyedge-csv' ? parseFantasyEdgeCsv(text, rel)
        : role === 'fantasypros-ecr' ? parseFantasyProsEcr(text, rel)
        : role === 'fantasypros-adp' ? parseFantasyProsAdp(text, rel)
        : role === 'derived-9dub' ? parseDerived9dub(text, rel)
        : { parsed: { role: 'unknown', rows: [] }, issues: [], capturedAt: null, printedPages: null }
    } else f.result = { parsed: { role: 'unknown', rows: [] }, issues: [], capturedAt: null, printedPages: null }
  } catch (e) {
    f.error = (e as Error).message
  }
  files.push(f)
  console.log(`  ${(f.result?.parsed.role ?? 'error').padEnd(17)} ${String(f.result?.parsed.rows.length ?? 0).padStart(4)} rows  ${rel}${f.error ? `  ⚠ ${f.error}` : ''}`)
}

const now = new Date().toISOString()
const { snapshot, audit } = reconcile(files, { ...DEFAULT_INGEST_OPTIONS, season, projectionLabel: espnProjectionLabel(season), now, snapshotId: 'pending', sourceDir: relative(process.cwd(), dir) || dir })
// Snapshot id = hash of the reconciled players: re-running on unchanged inputs is idempotent, while
// changed files (or improved ingest logic) produce a new id the app offers as an update.
const contentHash = createHash('sha256').update(JSON.stringify(snapshot.players)).digest('hex').slice(0, 10)
const snapshotId = `local-${season}-${contentHash}`
snapshot.id = snapshotId

const parsed = DatasetSnapshotSchema.safeParse(snapshot)
if (!parsed.success) {
  console.error('Snapshot failed schema validation:', parsed.error.issues.slice(0, 5))
  process.exit(1)
}

const comparison = compareValues(snapshot)
mkdirSync(join(out, 'audit'), { recursive: true })
mkdirSync(join(out, 'history'), { recursive: true })
const file = `real-${season}.json`
const target = join(out, file)
if (existsSync(target)) {
  try {
    const prev = JSON.parse(readFileSync(target, 'utf8')) as { id?: string }
    if (prev.id && prev.id !== snapshotId) copyFileSync(target, join(out, 'history', `${prev.id}.json`))
  } catch {
    /* unreadable previous snapshot — keep going, it is replaced */
  }
}
writeFileSync(target, JSON.stringify(snapshot))
upsertManifest(
  out,
  {
    id: snapshot.id,
    file,
    name: snapshot.name,
    season: snapshot.season,
    kind: snapshot.kind,
    players: snapshot.players.length,
    projected: audit.counts.withProjection,
    complete: audit.counts.completeNineCat,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
  },
  true,
)
writeFileSync(join(out, 'audit', 'ingest-audit.json'), JSON.stringify({ audit, comparison }, null, 1))
writeFileSync(join(out, 'audit', 'REAL_DATA_AUDIT.md'), renderAudit(audit, comparison, { detail: true }))
writeFileSync(join(out, 'audit', 'AUDIT_SUMMARY.md'), renderAudit(audit, comparison, { detail: false }))

const c = audit.counts
console.log(`\nSnapshot ${snapshot.id}: ${c.canonicalPlayers} players — ${c.completeNineCat} complete 9-cat, ${c.espnOnlyProjection} ESPN-only (no attempts), ${c.directoryOnly} directory-only.`)
console.log(`ESPN Live ADP rows ${c.espnLiveRows} (${c.espnLiveUsable} usable, ${c.espnLiveCapped} at ESPN's ~140 ceiling); FantasyPros ESPN fallback ${c.fantasyProsEspnFallback}.`)
console.log(`9dub vs Fantasy Edge rank correlation (Spearman, shared players): ${comparison.spearmanVsFantasyEdge.toFixed(3)}`)
console.log(`Issues: ${audit.issues.filter((i) => i.level === 'error').length} errors, ${audit.issues.filter((i) => i.level === 'warn').length} warnings.`)
console.log(`\nWrote ${relative(process.cwd(), target)} and audit in ${relative(process.cwd(), join(out, 'audit'))}/`)
console.log('Next: npm run dev → Settings & Data → Data & imports → "Local real-data snapshots" → Activate (or accept the banner).')
