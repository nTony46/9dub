/**
 * Single-table ingestion: turn ONE local file the user obtained legitimately
 * (CSV/TSV export, or a table they copied and saved as .tsv/.txt) into a
 * normalized, versioned 9dub snapshot. No network access — this script never
 * scrapes a website. For the multi-source folder (ESPN/Fantasy Edge PDFs and
 * FantasyPros CSVs) use `npm run data:ingest` instead.
 *
 *   npm run data:build -- --in path/to/projections.csv \
 *       --source "Hashtag Basketball projections (user paste)" \
 *       --url https://hashtagbasketball.com/fantasy-basketball-projections \
 *       --season 2026-27 --retrieved 2026-10-16 [--unit perGame|totals] \
 *       [--merge-adp path/to/adp.tsv] [--out .local-data/my-2026-27.json] [--default]
 *
 * Output defaults to the private, git-ignored .local-data/ folder (served only by the
 * dev/preview server). Only write to public/data/ if you have the right to ship the data.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { parseTableText } from '../../src/data/import/parseTable'
import { defaultOptionsFor, detectUnit, initialMapping, mapRows, planImport, type ImportOptions } from '../../src/data/import/pipeline'
import { FIELD_LABEL } from '../../src/data/import/fields'
import { DatasetSnapshotSchema, type DatasetSnapshot } from '../../src/data/schema'
import { upsertManifest } from './manifest'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(`--${name}`)

function run(path: string, base: DatasetSnapshot | null, overrides: Partial<ImportOptions>): DatasetSnapshot {
  const text = readFileSync(path, 'utf8')
  if (path.endsWith('.json')) {
    const snap = DatasetSnapshotSchema.parse(JSON.parse(text))
    return snap
  }
  const table = parseTableText(text)
  const mapping = initialMapping(table)
  const opts: ImportOptions = { ...defaultOptionsFor(table.preset, new Date().toISOString().slice(0, 10)), ...overrides }
  if (!overrides.unit) opts.unit = detectUnit(table, mapping)
  console.log(`\n${basename(path)}: preset=${table.preset}, ${table.rows.length} rows, unit=${opts.unit}`)
  table.notes.forEach((n) => console.log(`  note: ${n}`))
  table.headers.forEach((h, i) => console.log(`  ${h.padEnd(14)} → ${FIELD_LABEL[mapping[i]]}`))
  const rows = mapRows(table, mapping, opts)
  const plan = planImport(rows, base ? 'merge' : 'replace', base, opts)
  console.log('  counts', plan.counts)
  plan.matches
    .filter((m) => m.status === 'invalid' || m.status === 'ambiguous')
    .slice(0, 20)
    .forEach((m) => console.log(`  row ${m.row.index + 1} ${m.status}: ${m.row.name} — ${m.message ?? ''}`))
  if (!plan.snapshot) throw new Error(plan.error ?? 'import failed')
  return plan.snapshot
}

const input = arg('in')
if (!input) {
  console.error('Usage: npm run data:build -- --in <file> [--source name] [--url url] [--season 2026-27] [--retrieved YYYY-MM-DD] [--unit perGame|totals] [--merge-adp file] [--out file] [--default]')
  process.exit(1)
}
const overrides: Partial<ImportOptions> = {}
if (arg('source')) overrides.sourceName = arg('source')!
if (arg('url')) overrides.sourceUrl = arg('url')!
if (arg('season')) overrides.season = arg('season')!
if (arg('retrieved')) overrides.retrievedAt = arg('retrieved')!
if (arg('unit')) overrides.unit = arg('unit') as 'perGame' | 'totals'

let snap = run(resolve(input), null, overrides)
const adp = arg('merge-adp')
if (adp) snap = run(resolve(adp), snap, { retrievedAt: overrides.retrievedAt ?? new Date().toISOString().slice(0, 10) })
const out = resolve(arg('out') ?? join('.local-data', `${snap.season.replace(/[^0-9a-z-]/gi, '')}-import.json`))
snap.id = basename(out, '.json')
// Private output → a 'local' snapshot the app lists under "Local real-data snapshots".
if (!out.includes(`${join('public', 'data')}`)) snap.kind = 'local'
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(snap))
upsertManifest(dirname(out), { id: snap.id, file: basename(out), name: snap.name, season: snap.season, kind: snap.kind, players: snap.players.length }, flag('default'))
console.log(`\nWrote ${snap.players.length} players → ${out}${flag('default') ? ' (default dataset)' : ''}`)
