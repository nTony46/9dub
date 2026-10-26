/**
 * Generate the bundled FICTIONAL demo pool into public/data and update the manifest.
 *   npm run data:demo
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { generateDemoDataset } from '../../src/data/demo/generate'
import { DatasetSnapshotSchema } from '../../src/data/schema'
import { upsertManifest } from './manifest'

const out = join(process.cwd(), 'public', 'data')
mkdirSync(out, { recursive: true })
const ds = generateDemoDataset({ seed: 9, count: 280 })
const ok = DatasetSnapshotSchema.safeParse(ds)
if (!ok.success) {
  console.error(ok.error.issues.slice(0, 5))
  process.exit(1)
}
const file = 'demo-2026-27.json'
writeFileSync(join(out, file), JSON.stringify(ds))
upsertManifest(out, { id: ds.id, file, name: ds.name, season: ds.season, kind: ds.kind, players: ds.players.length, default: true })
console.log(`Wrote ${ds.players.length} fictional demo players → public/data/${file}`)
