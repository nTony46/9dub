import Dexie, { type Table } from 'dexie'
import type { DatasetMeta, DatasetSnapshot } from '@/data/schema'

/** Local-first persistence. No server; everything lives in this browser profile. */
export class NineDubDB extends Dexie {
  kv!: Table<{ key: string; value: unknown }, string>
  datasets!: Table<DatasetSnapshot, string>
  datasetMeta!: Table<DatasetMeta, string>

  constructor(name = '9dub') {
    super(name)
    this.version(1).stores({
      kv: 'key',
      datasets: 'id',
      datasetMeta: 'id, createdAt',
    })
  }
}

let instance: NineDubDB | null = null
export function db(): NineDubDB {
  if (!instance) instance = new NineDubDB()
  return instance
}

/** Tests can point the store at a fresh database. */
export function setDb(next: NineDubDB): void {
  instance = next
}
