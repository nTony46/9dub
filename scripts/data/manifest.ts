import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ManifestEntry {
  id: string
  file: string
  name: string
  season: string
  kind: string
  players: number
  projected?: number
  complete?: number
  sourceUpdatedAt?: string | null
  default?: boolean
}

/**
 * Maintain a snapshot manifest. public/data/manifest.json lists bundled (shippable)
 * snapshots; .local-data/manifest.json lists private local snapshots served only by
 * the dev/preview server. The app loads the `default` entry on first run.
 */
export function upsertManifest(dir: string, entry: ManifestEntry, makeDefault = entry.default ?? false): void {
  const path = join(dir, 'manifest.json')
  const m: { generatedAt: string; datasets: ManifestEntry[] } = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { generatedAt: '', datasets: [] }
  m.datasets = m.datasets.filter((d) => d.id !== entry.id && d.file !== entry.file)
  if (makeDefault) m.datasets.forEach((d) => (d.default = false))
  m.datasets.push({ ...entry, default: makeDefault })
  m.generatedAt = new Date().toISOString()
  writeFileSync(path, JSON.stringify(m, null, 2) + '\n')
}
