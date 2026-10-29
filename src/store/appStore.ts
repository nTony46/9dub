import { create } from 'zustand'
import type { BuildLock } from '@/analytics/builds'
import { DatasetSnapshotSchema, datasetMeta, type DatasetMeta, type DatasetSnapshot, type ProjectionOverride } from '@/data/schema'
import { NbaScheduleSchema, addDays, type NbaSchedule } from '@/data/schedule'
import { EspnSnapshotSchema, espnSeasonId } from '@/data/espn'
import { currentSeason } from '@/data/seasonLabel'
import { db } from './db'
import { addPick, deriveDraft, editPick, newSession, removePick, settingsChangeError, type DraftResult } from './draftLogic'
import { applyIdRemap, planIdRemap, referencedIds, type RemapPlan } from './remap'
import { ESPN_IR_NOTE, ESPN_MOVE_NOTE, planEspnDraft, planEspnSync } from './espnSync'
import { currentRosters, matchupsFromSeed, syncedTeamNames, todayIso } from './season'
import {
  LeagueSeedSchema,
  LeagueSettingsSchema,
  PrefsSchema,
  STATE_SCHEMA_VERSION,
  SessionExportSchema,
  migrateState,
  type LeagueSeed,
  type LeagueSettings,
  type MatchupWeek,
  type PersistedState,
  type Prefs,
  type SavedDraft,
} from './schema'

/** A private snapshot built by `npm run data:ingest`, listed in .local-data/manifest.json (served by the dev/preview server only). */
export interface LocalSnapshotEntry {
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

export interface BackupMeta {
  key: string
  at: number
  reason: string
  datasetId: string | null
  picks: number
}

export interface ActivateResult {
  ok: boolean
  error?: string
  /** Player references rewritten to the new snapshot's ids. */
  remapped?: number
  /** References that could not be matched uniquely (left untouched). */
  unmatched?: RemapPlan['unmatched']
  /** Key of the automatic pre-change backup, when one was taken. */
  backupKey?: string
}

export interface AppState extends PersistedState {
  hydrated: boolean
  bootError: string | null
  /** Informational message from start-up (e.g. session restored from disk). */
  bootNotice: string | null
  /** Last successful save of the session to .local-data/session-latest.json (dev/preview server only). */
  diskSavedAt: number | null
  diskSave: 'unknown' | 'on' | 'unavailable'
  dataset: DatasetSnapshot | null
  datasets: DatasetMeta[]
  previewId: string | null
  compareIds: string[]
  /** Local real-data snapshots found on the dev/preview server (empty in a plain static build). */
  localSnapshots: LocalSnapshotEntry[]

  hydrate: () => Promise<void>
  setSettings: (patch: Partial<LeagueSettings>) => { ok: boolean; error?: string }
  draftPlayer: (playerId: string, opts?: { overall?: number; teamIndex?: number }) => DraftResult
  undo: () => string | null
  removePick: (overall: number) => DraftResult
  editPick: (overall: number, changes: { playerId?: string; teamIndex?: number }) => DraftResult
  setTargetPick: (overall: number | null) => void
  resetDraft: (opts?: { saveAs?: string }) => void
  saveDraftAs: (name: string) => void
  restoreDraft: (id: string) => { ok: boolean; error?: string }
  deleteSavedDraft: (id: string) => void
  toggleShortlist: (id: string) => void
  setOverride: (id: string, ov: ProjectionOverride | null) => void
  setBuildLock: (lock: BuildLock | null) => void
  setPrefs: (patch: Partial<Prefs>) => void
  addDataset: (snap: DatasetSnapshot, activate?: boolean) => Promise<ActivateResult>
  activateDataset: (id: string) => Promise<ActivateResult>
  refreshLocalSnapshots: () => Promise<LocalSnapshotEntry[]>
  /** Fetch a local snapshot, store it, and activate it (with backup + id remap). */
  activateLocalSnapshot: (id?: string) => Promise<ActivateResult>
  listBackups: () => Promise<BackupMeta[]>
  backupNow: (reason: string) => Promise<string>
  restoreBackup: (key: string) => Promise<{ ok: boolean; error?: string }>
  deleteDataset: (id: string) => Promise<void>
  exportSession: (includeDataset: boolean) => unknown
  importSession: (raw: unknown) => Promise<{ ok: boolean; error?: string; warning?: string }>
  openPreview: (id: string | null) => void
  setCompare: (ids: string[]) => void

  // ── in-season ──
  /** NBA schedule for matchup projections: reference data cached in IndexedDB, not part of the session. */
  nbaSchedule: NbaSchedule | null
  /** Load the cached schedule, preferring a newer one in .local-data (dev/preview server). */
  loadSchedule: () => Promise<NbaSchedule | null>
  importSchedule: (raw: unknown) => Promise<{ ok: boolean; error?: string }>
  /** League schedule seed in .local-data (dev/preview server), if any. */
  fetchLeagueSeed: () => Promise<LeagueSeed | null>
  applyLeagueSeed: (seed: LeagueSeed) => void
  addMatchup: (week?: Partial<Omit<MatchupWeek, 'id'>>) => void
  updateMatchup: (id: string, patch: Partial<Omit<MatchupWeek, 'id'>>) => void
  removeMatchup: (id: string) => void
  /** Map a league team name (every week that uses it) to a draft slot. */
  assignOpponent: (label: string, team: number | null) => void
  /** Bring auto-assigned team names in line with the opponent mapping (repairs earlier remaps). */
  syncTeamNames: () => void
  renameTeam: (team: number, name: string) => void
  /** Post-draft add / drop / trade: `to` null = drop to free agents. */
  moveRosterPlayer: (playerId: string, to: number | null, note?: string) => { ok: boolean; error?: string }
  undoRosterMove: (id: string) => void
  /** Mark a player out (no games count through `until`; null = until further notice), or healthy with `false`. */
  setInjury: (playerId: string, until: string | null | false) => void

  // ── ESPN (read-only league sync through the local server) ──
  /** off = not available on this server (static build, tests); setup = cookies not saved yet. */
  espnState: 'unknown' | 'off' | 'setup' | 'ready'
  espnSyncing: boolean
  espnError: string | null
  checkEspn: () => Promise<void>
  /** Read the league from ESPN and bring rosters, IR, team names, opponents and live totals up to date. */
  syncEspn: () => Promise<{ ok: boolean; error?: string; changes?: string[] }>
  saveEspnAuth: (patch: { swid?: string; espnS2?: string; leagueId?: number | null }) => Promise<{ ok: boolean; error?: string }>
  /** The account's ESPN fantasy basketball leagues this season. */
  listEspnLeagues: () => Promise<{ ok: boolean; error?: string; leagues?: EspnLeague[]; selected?: number | null }>
  /**
   * First-time setup from ESPN, for a draft not recorded yet: league size, rounds, lineup, your team,
   * team names, the draft, the NBA schedule if none is loaded, then a normal sync (rosters, weeks, results).
   */
  setupFromEspn: () => Promise<{ ok: boolean; error?: string; summary?: string[] }>
}

export interface EspnLeague {
  id: number
  name: string
  /** Your team's name in it. */
  teamName: string
}

/** Sync again on start-up when the last one is older than this. */
export const ESPN_STALE_MS = 10 * 60 * 1000

export function defaultSettings(): LeagueSettings {
  const s = LeagueSettingsSchema.parse({})
  return { ...s, teamNames: Array.from({ length: s.teams }, (_, i) => `Team ${i + 1}`) }
}

export function defaultPersisted(now = Date.now()): PersistedState {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    settings: defaultSettings(),
    draft: newSession('Live draft', now),
    savedDrafts: [],
    shortlist: [],
    overrides: {},
    buildLock: null,
    prefs: PrefsSchema.parse({}),
    activeDatasetId: null,
    undoStack: [],
    season: { matchups: [], rosterMoves: [], injuries: [], espn: null },
  }
}

const PERSISTED_KEYS: (keyof PersistedState)[] = [
  'schemaVersion',
  'settings',
  'draft',
  'savedDrafts',
  'shortlist',
  'overrides',
  'buildLock',
  'prefs',
  'activeDatasetId',
  'undoStack',
  'season',
]

const PERSISTED_UNDO = 30

export function persistedSlice(s: PersistedState): PersistedState {
  const out = {} as Record<string, unknown>
  for (const k of PERSISTED_KEYS) out[k] = s[k]
  out.undoStack = s.undoStack.slice(-PERSISTED_UNDO)
  return out as unknown as PersistedState
}

const LS_KEY = '9dub:state'

/** Synchronous mirror of the persisted slice; survives an immediate refresh where an async IndexedDB write might not. */
function readMirror(): { savedAt: number; value: unknown } | null {
  try {
    const raw = globalThis.localStorage?.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as { savedAt: number; value: unknown }) : null
  } catch {
    return null
  }
}

let nameCache: { ds: DatasetSnapshot | null; map: Map<string, string> } = { ds: null, map: new Map() }
function namesFor(ds: DatasetSnapshot | null): (id: string) => string {
  if (nameCache.ds !== ds) nameCache = { ds, map: new Map((ds?.players ?? []).map((p) => [p.identity.id, p.identity.fullName])) }
  return (id) => nameCache.map.get(id) ?? id
}

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

/** Fetch the bundled default dataset (demo pool) shipped in public/data. */
export async function loadBundledDataset(): Promise<DatasetSnapshot> {
  const base = import.meta.env?.BASE_URL ?? '/'
  const manifest = (await (await fetch(`${base}data/manifest.json`)).json()) as { datasets: { file: string; default?: boolean }[] }
  const entry = manifest.datasets.find((d) => d.default) ?? manifest.datasets[0]
  const raw = await (await fetch(`${base}data/${entry.file}`)).json()
  const parsed = DatasetSnapshotSchema.safeParse(raw)
  if (!parsed.success) throw new Error(`Bundled dataset invalid: ${parsed.error.issues[0]?.message}`)
  return parsed.data
}

const UNDO_LIMIT = 100
const BACKUP_LIMIT = 12

/** Read .local-data/manifest.json through the dev/preview server. Missing (static build, tests) → []. */
export async function fetchLocalManifest(): Promise<LocalSnapshotEntry[]> {
  try {
    const base = import.meta.env?.BASE_URL ?? '/'
    const res = await fetch(`${base}local-data/manifest.json`, { cache: 'no-store' })
    if (res.ok === false) return []
    const m = (await res.json()) as { datasets?: LocalSnapshotEntry[] }
    return (m.datasets ?? []).filter((d) => d && d.kind === 'local' && typeof d.file === 'string' && typeof d.id === 'string')
  } catch {
    return []
  }
}

const SESSION_FILE = 'session-latest.json'

/**
 * Mirror the session to .local-data/session-latest.json through the dev/preview
 * server, so it survives cleared browser data or a different browser. A static
 * build has no endpoint; after one refusal we stop trying.
 */
export async function saveSessionToDisk(): Promise<boolean> {
  const s = useApp.getState()
  if (!s.hydrated || s.diskSave === 'unavailable') return false
  try {
    const base = import.meta.env?.BASE_URL ?? '/'
    const res = await fetch(`${base}local-data/__session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s.exportSession(false)) })
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null
    if (!res.ok || !body?.ok) {
      useApp.setState({ diskSave: 'unavailable' })
      return false
    }
    useApp.setState({ diskSave: 'on', diskSavedAt: Date.now() })
    return true
  } catch {
    useApp.setState({ diskSave: 'unavailable' })
    return false
  }
}

/** A JSON file from .local-data via the dev/preview server; null when absent (static build, tests, local data off). */
async function fetchLocalJson(file: string): Promise<unknown | null> {
  try {
    const base = import.meta.env?.BASE_URL ?? '/'
    const res = await fetch(`${base}local-data/${encodeURIComponent(file)}`, { cache: 'no-store' })
    if (res.ok === false) return null
    return await res.json()
  } catch {
    return null
  }
}

const isDefaultTeamName = (name: string | undefined, i: number) => !name?.trim() || name.trim() === `Team ${i + 1}`

async function fetchLocalSnapshot(entry: LocalSnapshotEntry): Promise<DatasetSnapshot> {
  const base = import.meta.env?.BASE_URL ?? '/'
  const res = await fetch(`${base}local-data/${encodeURIComponent(entry.file)}`, { cache: 'no-store' })
  if (res.ok === false) throw new Error(`HTTP ${res.status}`)
  const parsed = DatasetSnapshotSchema.safeParse(await res.json())
  if (!parsed.success) throw new Error(`Local snapshot invalid: ${parsed.error.issues[0]?.message}`)
  return parsed.data
}

export const useApp = create<AppState>()((set, get) => {
  const commitDraft = (res: DraftResult): DraftResult => {
    if (res.ok) set((s) => ({ undoStack: [...s.undoStack, s.draft].slice(-UNDO_LIMIT), draft: res.session }))
    return res
  }

  return {
    ...defaultPersisted(),
    hydrated: false,
    bootError: null,
    bootNotice: null,
    diskSavedAt: null,
    diskSave: 'unknown',
    dataset: null,
    datasets: [],
    undoStack: [],
    previewId: null,
    compareIds: [],
    localSnapshots: [],
    nbaSchedule: null,
    espnState: 'unknown',
    espnSyncing: false,
    espnError: null,

    hydrate: async () => {
      try {
        const store = db()
        const idbRow = (await store.kv.get('state')) as { key: string; value: unknown; savedAt?: number } | undefined
        const mirror = readMirror()
        let row = mirror && (!idbRow || (idbRow.savedAt ?? 0) < mirror.savedAt) ? { key: 'state', value: mirror.value } : idbRow
        // Nothing saved in this browser (cleared site data, another browser or port): restore the session saved on disk.
        let bootNotice: string | null = null
        let fromDisk = false
        if (!row) {
          const disk = SessionExportSchema.safeParse(await fetchLocalJson(SESSION_FILE))
          if (disk.success) {
            row = { key: 'state', value: disk.data.state }
            fromDisk = true
            bootNotice = `Restored your session from .local-data/${SESSION_FILE} (saved ${new Date(disk.data.exportedAt).toLocaleString()}).`
          }
        }
        let state = defaultPersisted()
        let bootError: string | null = null
        if (row) {
          const m = migrateState(row.value)
          if (m.ok) state = m.state
          else bootError = `Saved state could not be read (${m.error}); started fresh. Your previous data is still in IndexedDB under "state-corrupt".`
          if (!m.ok) await store.kv.put({ key: 'state-corrupt', value: row.value })
        }
        let metas = await store.datasetMeta.orderBy('createdAt').toArray()
        let dataset: DatasetSnapshot | null = null
        if (state.activeDatasetId) dataset = (await store.datasets.get(state.activeDatasetId)) ?? null
        const local = await fetchLocalManifest()
        if (!dataset) {
          // First launch: prefer the private real-data snapshot when the dev/preview server offers one; the demo is the fallback.
          const entry = !row || fromDisk ? (local.find((d) => d.id === state.activeDatasetId) ?? local.find((d) => d.default) ?? local[0]) : undefined
          if (entry) {
            try {
              dataset = await fetchLocalSnapshot(entry)
            } catch {
              dataset = null
            }
          }
          dataset ??= await loadBundledDataset()
          await store.datasets.put(dataset)
          await store.datasetMeta.put(datasetMeta(dataset))
          metas = await store.datasetMeta.orderBy('createdAt').toArray()
          state.activeDatasetId = dataset.id
        }
        set({ ...state, dataset, datasets: metas, hydrated: true, bootError, bootNotice, localSnapshots: local })
        void get().loadSchedule()
        void saveSessionToDisk()
        void get()
          .checkEspn()
          .then(() => {
            const st = get()
            if (st.espnState === 'ready' && Date.now() - (st.season.espn?.syncedAt ?? 0) > ESPN_STALE_MS && deriveDraft(st.draft, st.settings).complete) void st.syncEspn()
          })
      } catch (e) {
        set({ hydrated: true, bootError: `Could not load data: ${(e as Error).message}` })
      }
    },

    setSettings: (patch) => {
      const prev = get().settings
      const merged = { ...prev, ...patch }
      if (patch.teams != null && patch.teams !== prev.teams) {
        merged.teamNames = Array.from({ length: patch.teams }, (_, i) => prev.teamNames[i] ?? `Team ${i + 1}`)
        if (merged.userSlot != null && merged.userSlot > patch.teams) merged.userSlot = null
      }
      const parsed = LeagueSettingsSchema.safeParse(merged)
      if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message }
      const err = settingsChangeError(get().draft, prev, parsed.data)
      if (err) return { ok: false, error: err }
      const slotChanged = parsed.data.userSlot !== prev.userSlot && get().draft.picks.length > 0
      set((s) => ({
        settings: parsed.data,
        draft: slotChanged
          ? {
              ...s.draft,
              log: [...s.draft.log, { at: Date.now(), kind: 'settings' as const, text: `Your slot changed ${prev.userSlot ?? '—'} → ${parsed.data.userSlot ?? '—'} mid-draft; recorded picks keep their teams.` }],
            }
          : s.draft,
      }))
      return { ok: true }
    },

    draftPlayer: (playerId, opts) => commitDraft(addPick(get().draft, get().settings, playerId, opts, namesFor(get().dataset))),

    undo: () => {
      const stack = get().undoStack
      if (!stack.length) return null
      const prev = stack[stack.length - 1]
      const now = Date.now()
      set((s) => ({
        undoStack: stack.slice(0, -1),
        draft: { ...prev, updatedAt: now, log: [...s.draft.log, { at: now, kind: 'undo' as const, text: 'Undid last change' }] },
      }))
      return 'Undid last change'
    },

    removePick: (overall) => commitDraft(removePick(get().draft, get().settings, overall, namesFor(get().dataset))),
    editPick: (overall, changes) => commitDraft(editPick(get().draft, get().settings, overall, changes, namesFor(get().dataset))),
    setTargetPick: (overall) => set((s) => ({ draft: { ...s.draft, targetPick: overall } })),

    resetDraft: (opts) => {
      const s = get()
      if (opts?.saveAs && s.draft.picks.length) s.saveDraftAs(opts.saveAs)
      set((st) => ({ undoStack: [...st.undoStack, st.draft].slice(-UNDO_LIMIT), draft: newSession(st.draft.name) }))
    },

    saveDraftAs: (name) => {
      const { draft, settings } = get()
      const saved: SavedDraft = {
        id: uid('saved'),
        name: name || `Draft ${new Date().toLocaleString()}`,
        savedAt: Date.now(),
        session: draft,
        league: { teams: settings.teams, rounds: settings.rounds, userSlot: settings.userSlot, teamNames: settings.teamNames },
      }
      set((s) => ({ savedDrafts: [saved, ...s.savedDrafts].slice(0, 30) }))
    },

    restoreDraft: (id) => {
      const saved = get().savedDrafts.find((d) => d.id === id)
      if (!saved) return { ok: false, error: 'Saved draft not found' }
      const s = get()
      const settings = { ...s.settings, teams: saved.league.teams, rounds: saved.league.rounds, userSlot: saved.league.userSlot, teamNames: saved.league.teamNames }
      const now = Date.now()
      set((st) => ({
        undoStack: [...st.undoStack, st.draft].slice(-UNDO_LIMIT),
        settings,
        draft: { ...saved.session, updatedAt: now, log: [...saved.session.log, { at: now, kind: 'restore' as const, text: `Restored "${saved.name}"` }] },
      }))
      return { ok: true }
    },

    deleteSavedDraft: (id) => set((s) => ({ savedDrafts: s.savedDrafts.filter((d) => d.id !== id) })),

    toggleShortlist: (id) =>
      set((s) => ({ shortlist: s.shortlist.includes(id) ? s.shortlist.filter((x) => x !== id) : [...s.shortlist, id] })),

    setOverride: (id, ov) =>
      set((s) => {
        const next = { ...s.overrides }
        if (ov && Object.keys(ov).length) next[id] = ov
        else delete next[id]
        return { overrides: next }
      }),

    setBuildLock: (lock) => set({ buildLock: lock }),
    setPrefs: (patch) => set((s) => ({ prefs: { ...s.prefs, ...patch } })),

    addDataset: async (snap, activate = true) => {
      const store = db()
      await store.datasets.put(snap)
      await store.datasetMeta.put(datasetMeta(snap))
      const metas = await store.datasetMeta.orderBy('createdAt').toArray()
      set({ datasets: metas })
      if (activate) return get().activateDataset(snap.id)
      return { ok: true }
    },
    activateDataset: async (id) => {
      const store = db()
      const snap = await store.datasets.get(id)
      if (!snap) return { ok: false, error: 'Snapshot not found' }
      const s = get()
      const refs = referencedIds(s, s.compareIds)
      const nextIds = new Set(snap.players.map((p) => p.identity.id))
      const needs = [...refs].some((r) => !nextIds.has(r))
      let backupKey: string | undefined
      let plan: RemapPlan = { map: new Map(), unmatched: [], kept: refs.size }
      if (needs) {
        // Never alter a draft in place without a way back.
        backupKey = await get().backupNow(`Before switching to "${snap.name}"`)
        const known = [s.dataset, ...(await store.datasets.toArray()).filter((d) => d.id !== s.dataset?.id && d.id !== snap.id)].filter((d): d is DatasetSnapshot => !!d)
        plan = planIdRemap(refs, snap, known)
      }
      const remapped = applyIdRemap(
        { draft: s.draft, undoStack: s.undoStack, savedDrafts: s.savedDrafts, shortlist: s.shortlist, overrides: s.overrides, season: s.season },
        plan.map,
      )
      const now = Date.now()
      const draft = plan.map.size
        ? { ...remapped.draft, log: [...remapped.draft.log, { at: now, kind: 'settings' as const, text: `Dataset switched to "${snap.name}"; ${plan.map.size} player reference(s) re-linked by name.` }] }
        : remapped.draft
      set({ ...remapped, draft, dataset: snap, activeDatasetId: id, compareIds: s.compareIds.map((c) => plan.map.get(c) ?? c) })
      return { ok: true, remapped: plan.map.size, unmatched: plan.unmatched, backupKey }
    },
    refreshLocalSnapshots: async () => {
      const local = await fetchLocalManifest()
      set({ localSnapshots: local })
      return local
    },
    activateLocalSnapshot: async (id) => {
      const local = get().localSnapshots.length ? get().localSnapshots : await get().refreshLocalSnapshots()
      const entry = id ? local.find((d) => d.id === id) : (local.find((d) => d.default) ?? local[0])
      if (!entry) return { ok: false, error: 'No local snapshot found. Run npm run data:ingest, then reload.' }
      try {
        const snap = await fetchLocalSnapshot(entry)
        return await get().addDataset(snap, true)
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
    backupNow: async (reason) => {
      const store = db()
      const at = Date.now()
      const key = `backup:${new Date(at).toISOString()}`
      await store.kv.put({ key, value: { at, reason, datasetId: get().activeDatasetId, state: persistedSlice(get()) } } as { key: string; value: unknown })
      const keys = (await store.kv.toCollection().primaryKeys()).map(String).filter((k) => k.startsWith('backup:')).sort()
      for (const old of keys.slice(0, Math.max(0, keys.length - BACKUP_LIMIT))) await store.kv.delete(old)
      return key
    },
    listBackups: async () => {
      const rows = (await db().kv.toArray()) as { key: string; value: unknown }[]
      return rows
        .filter((r) => r.key.startsWith('backup:'))
        .map((r) => {
          const v = r.value as { at: number; reason: string; datasetId: string | null; state: PersistedState }
          return { key: r.key, at: v.at, reason: v.reason, datasetId: v.datasetId, picks: v.state?.draft?.picks?.length ?? 0 }
        })
        .sort((a, b) => b.at - a.at)
    },
    restoreBackup: async (key) => {
      const row = (await db().kv.get(key)) as { key: string; value: { state: unknown; datasetId: string | null } } | undefined
      if (!row) return { ok: false, error: 'Backup not found' }
      const m = migrateState(row.value.state)
      if (!m.ok) return { ok: false, error: m.error }
      const dsId = row.value.datasetId ?? m.state.activeDatasetId
      const snap = dsId ? await db().datasets.get(dsId) : undefined
      await get().backupNow('Before restoring a backup')
      set((st) => ({ ...m.state, dataset: snap ?? st.dataset, activeDatasetId: snap ? snap.id : st.activeDatasetId, undoStack: [...st.undoStack, st.draft].slice(-UNDO_LIMIT) }))
      return { ok: true }
    },
    deleteDataset: async (id) => {
      if (id === get().activeDatasetId) return
      await db().datasets.delete(id)
      await db().datasetMeta.delete(id)
      set({ datasets: await db().datasetMeta.orderBy('createdAt').toArray() })
    },

    exportSession: (includeDataset) => ({
      app: '9dub',
      kind: 'session',
      schemaVersion: STATE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      state: persistedSlice(get()),
      dataset: includeDataset ? get().dataset : null,
    }),

    importSession: async (raw) => {
      const env = SessionExportSchema.safeParse(raw)
      if (!env.success) return { ok: false, error: 'Not a 9dub session file (expected app: "9dub", kind: "session").' }
      const m = migrateState(env.data.state)
      if (!m.ok) return { ok: false, error: m.error }
      const state = m.state
      let warning: string | undefined
      if (env.data.dataset) {
        await get().addDataset(env.data.dataset, false)
        state.activeDatasetId = env.data.dataset.id
      } else if (state.activeDatasetId && !(await db().datasets.get(state.activeDatasetId))) {
        warning = 'The session references a dataset that is not on this device; keeping the current dataset. Player ids may not match.'
        state.activeDatasetId = get().activeDatasetId
      }
      const dataset = state.activeDatasetId ? ((await db().datasets.get(state.activeDatasetId)) ?? get().dataset) : get().dataset
      set((s) => ({ ...state, dataset, undoStack: [...s.undoStack, s.draft].slice(-UNDO_LIMIT) }))
      return { ok: true, warning }
    },

    openPreview: (id) => set({ previewId: id }),
    setCompare: (ids) => set({ compareIds: ids.slice(0, 3) }),

    loadSchedule: async () => {
      let cached: NbaSchedule | null = null
      try {
        const row = await db().kv.get('nbaSchedule')
        const p = NbaScheduleSchema.safeParse(row?.value)
        if (p.success) cached = p.data
      } catch {
        cached = null
      }
      const season = get().dataset?.season ?? cached?.season ?? currentSeason()
      const local = NbaScheduleSchema.safeParse(await fetchLocalJson(`nba-schedule-${season}.json`))
      let next = cached
      if (local.success && (!cached || local.data.source.sha256 !== cached.source.sha256 || local.data.createdAt > cached.createdAt)) {
        next = local.data
        await db().kv.put({ key: 'nbaSchedule', value: next })
      }
      set({ nbaSchedule: next })
      return next
    },
    importSchedule: async (raw) => {
      const p = NbaScheduleSchema.safeParse(raw)
      if (!p.success) return { ok: false, error: 'Not a 9dub NBA schedule file (create one with npm run data:schedule).' }
      await db().kv.put({ key: 'nbaSchedule', value: p.data })
      set({ nbaSchedule: p.data })
      return { ok: true }
    },
    fetchLeagueSeed: async () => {
      const season = get().dataset?.season ?? currentSeason()
      const p = LeagueSeedSchema.safeParse(await fetchLocalJson(`league-${season}.json`))
      return p.success ? p.data : null
    },
    applyLeagueSeed: (seed) => {
      const { settings } = get()
      const me = settings.userSlot != null ? settings.userSlot - 1 : null
      const matchups = matchupsFromSeed(seed, settings.teamNames, me)
      const teamNames = [...settings.teamNames]
      if (me != null && seed.myTeamName && isDefaultTeamName(teamNames[me], me)) teamNames[me] = seed.myTeamName
      set((s) => ({ season: { ...s.season, matchups }, settings: { ...s.settings, teamNames } }))
    },
    addMatchup: (week) =>
      set((s) => {
        const last = [...s.season.matchups].sort((a, b) => a.start.localeCompare(b.start)).pop()
        const start = week?.start ?? (last ? addDays(last.end, 1) : new Date().toISOString().slice(0, 10))
        const next: MatchupWeek = { id: uid('wk'), start, end: week?.end ?? addDays(start, 6), opponent: week?.opponent ?? null, label: week?.label ?? '', owner: week?.owner ?? '', away: week?.away ?? false }
        return { season: { ...s.season, matchups: [...s.season.matchups, next].sort((a, b) => a.start.localeCompare(b.start)) } }
      }),
    updateMatchup: (id, patch) =>
      set((s) => ({ season: { ...s.season, matchups: s.season.matchups.map((w) => (w.id === id ? { ...w, ...patch } : w)).sort((a, b) => a.start.localeCompare(b.start)) } })),
    removeMatchup: (id) => set((s) => ({ season: { ...s.season, matchups: s.season.matchups.filter((w) => w.id !== id) } })),
    assignOpponent: (label, team) =>
      set((s) => {
        const matchups = s.season.matchups.map((w) => (w.label === label ? { ...w, opponent: team } : w))
        const me = s.settings.userSlot != null ? s.settings.userSlot - 1 : null
        const teamNames = syncedTeamNames(s.settings.teamNames, matchups, me) ?? s.settings.teamNames
        return { season: { ...s.season, matchups }, settings: { ...s.settings, teamNames } }
      }),
    syncTeamNames: () => {
      const s = get()
      const next = syncedTeamNames(s.settings.teamNames, s.season.matchups, s.settings.userSlot != null ? s.settings.userSlot - 1 : null)
      if (next) set((st) => ({ settings: { ...st.settings, teamNames: next } }))
    },
    renameTeam: (team, name) =>
      set((s) => {
        const teamNames = Array.from({ length: s.settings.teams }, (_, i) => s.settings.teamNames[i] ?? `Team ${i + 1}`)
        teamNames[team] = name.trim() || `Team ${team + 1}`
        return { settings: { ...s.settings, teamNames } }
      }),
    moveRosterPlayer: (playerId, to, note = '') => {
      const s = get()
      if (to != null && (to < 0 || to >= s.settings.teams)) return { ok: false, error: 'No such team' }
      const { teamOf } = currentRosters(deriveDraft(s.draft, s.settings).rosters, s.season.rosterMoves)
      const from = teamOf.get(playerId) ?? null
      if (from === to) return { ok: false, error: to == null ? 'Already a free agent' : 'Already on that team' }
      set((st) => ({ season: { ...st.season, rosterMoves: [...st.season.rosterMoves, { id: uid('mv'), at: Date.now(), playerId, from, to, note }] } }))
      return { ok: true }
    },
    undoRosterMove: (id) => set((s) => ({ season: { ...s.season, rosterMoves: s.season.rosterMoves.filter((m) => m.id !== id) } })),
    setInjury: (playerId, until) =>
      set((s) => {
        const rest = s.season.injuries.filter((i) => i.playerId !== playerId)
        const prev = s.season.injuries.find((i) => i.playerId === playerId)
        return { season: { ...s.season, injuries: until === false ? rest : [...rest, { playerId, until, at: prev?.at ?? Date.now(), note: prev?.note ?? '' }] } }
      }),

    checkEspn: async () => {
      type Status = { enabled?: unknown; configured?: unknown }
      const status = await (async (): Promise<Status | null> => {
        try {
          const base = import.meta.env?.BASE_URL ?? '/'
          const res = await fetch(`${base}local-data/__espn/status`, { cache: 'no-store' })
          return res.ok === false ? null : ((await res.json()) as Status)
        } catch {
          return null
        }
      })()
      set({ espnState: status?.enabled !== true ? 'off' : status.configured === true ? 'ready' : 'setup' })
    },
    syncEspn: async () => {
      const s = get()
      if (s.espnSyncing) return { ok: false, error: 'Already syncing' }
      if (!deriveDraft(s.draft, s.settings).complete) {
        const error = 'Record the whole draft first — the sync applies ESPN’s changes on top of it.'
        set({ espnError: error })
        return { ok: false, error }
      }
      set({ espnSyncing: true, espnError: null })
      try {
        const base = import.meta.env?.BASE_URL ?? '/'
        const res = await fetch(`${base}local-data/__espn/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ season: espnSeasonId(s.dataset?.season ?? currentSeason()) }),
        })
        const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; snapshot?: unknown } | null
        if (!body?.ok) throw new Error(body?.error ?? `The local server answered ${res.status}`)
        const snap = EspnSnapshotSchema.parse(body.snapshot)
        const st = get()
        if (snap.teams.length === st.settings.teams && snap.mySlot != null && st.settings.userSlot == null) set((x) => ({ settings: { ...x.settings, userSlot: snap.mySlot } }))
        const plan = planEspnSync(snap, {
          records: (st.dataset?.players ?? []).map((r) => r.identity),
          draftRosters: deriveDraft(st.draft, st.settings).rosters,
          moves: st.season.rosterMoves,
          injuries: st.season.injuries,
          teamNames: st.settings.teamNames,
          teams: st.settings.teams,
          userSlot: get().settings.userSlot,
          weeks: st.season.matchups,
          today: todayIso(),
          lastEspnNames: st.season.espn?.teamNames.length ? st.season.espn.teamNames : undefined,
          lineupSlots: st.settings.lineupSlots,
          irSlots: st.settings.irSlots,
          needsStats: new Set((st.dataset?.players ?? []).filter((r) => !r.projection).map((r) => r.identity.id)),
        })
        if ('error' in plan) throw new Error(plan.error)
        const now = Date.now()
        const touched = new Set([...plan.irAdd, ...plan.irClear])
        set((x) => ({
          settings: {
            ...x.settings,
            ...(plan.teamNames ? { teamNames: plan.teamNames } : {}),
            ...(plan.lineup ? { lineupSlots: plan.lineup.slots, irSlots: Math.min(5, plan.lineup.ir) } : {}),
          },
          season: {
            ...x.season,
            rosterMoves: [...x.season.rosterMoves, ...plan.moves.map((m) => ({ id: uid('mv'), at: now, playerId: m.playerId, from: m.from, to: m.to, note: ESPN_MOVE_NOTE }))],
            injuries: [
              ...x.season.injuries.filter((i) => !touched.has(i.playerId)),
              ...plan.irAdd.map((playerId) => ({ playerId, until: null, at: now, note: ESPN_IR_NOTE })),
            ],
            matchups: plan.weeks ?? x.season.matchups,
            espn: {
              syncedAt: now,
              leagueId: snap.leagueId,
              leagueName: snap.name,
              changes: plan.changes,
              unmatched: plan.unmatched,
              players: plan.players,
              live: snap.live,
              teamNames: snap.teams.map((t) => t.name),
              results: snap.results,
              standings: snap.standings,
              stats: plan.stats,
              teamStatus: snap.teams.map((t) => ({ slot: t.slot, waiverRank: t.waiverRank, pickups: t.pickups })),
            },
          },
          espnSyncing: false,
          espnState: 'ready',
        }))
        return { ok: true, changes: plan.changes }
      } catch (e) {
        const error = (e as Error).message
        set({ espnSyncing: false, espnError: error })
        return { ok: false, error }
      }
    },
    saveEspnAuth: async (patch) => {
      try {
        const base = import.meta.env?.BASE_URL ?? '/'
        const res = await fetch(`${base}local-data/__espn/auth`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
        const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
        await get().checkEspn()
        return body?.ok ? { ok: true } : { ok: false, error: body?.error ?? 'ESPN sync is not available on this server' }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
    listEspnLeagues: async () => {
      try {
        const base = import.meta.env?.BASE_URL ?? '/'
        const season = espnSeasonId(get().dataset?.season ?? currentSeason())
        const res = await fetch(`${base}local-data/__espn/leagues?season=${season}`, { cache: 'no-store' })
        const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; leagues?: EspnLeague[]; selected?: number | null } | null
        return body?.ok ? { ok: true, leagues: body.leagues ?? [], selected: body.selected ?? null } : { ok: false, error: body?.error ?? 'ESPN sync is not available on this server' }
      } catch (e) {
        return { ok: false, error: (e as Error).message }
      }
    },
    setupFromEspn: async () => {
      const s = get()
      if (s.draft.picks.length) return { ok: false, error: 'This session already has draft picks. Setup from ESPN starts from an empty draft (Settings → Session & backups → New draft).' }
      if (s.espnSyncing) return { ok: false, error: 'Already syncing' }
      if (s.dataset?.kind === 'demo') return { ok: false, error: 'The demo pool has made-up players, so ESPN’s draft and rosters can’t be matched to it. Import your projections first (Settings → Data & imports).' }
      set({ espnSyncing: true, espnError: null })
      const base = import.meta.env?.BASE_URL ?? '/'
      const label = s.dataset?.season ?? currentSeason()
      try {
        const res = await fetch(`${base}local-data/__espn/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ season: espnSeasonId(label), withDraft: true }),
        })
        const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; snapshot?: unknown } | null
        if (!body?.ok) throw new Error(body?.error ?? `The local server answered ${res.status}`)
        const snap = EspnSnapshotSchema.parse(body.snapshot)
        if (snap.teams.length < 4 || snap.teams.length > 20) throw new Error(`ESPN has ${snap.teams.length} teams; 9dub supports 4–20.`)
        const lineup = snap.lineup
        const rounds = snap.rounds ?? (lineup ? lineup.slots.length : s.settings.rounds)
        const settings = LeagueSettingsSchema.parse({
          ...s.settings,
          leagueName: snap.name,
          teams: snap.teams.length,
          rounds,
          userSlot: snap.mySlot,
          teamNames: snap.teams.map((t) => t.name),
          ...(lineup ? { lineupSlots: lineup.slots, irSlots: Math.min(5, lineup.ir) } : {}),
        })
        const summary = [`${snap.name}: ${settings.teams} teams, ${rounds} rounds`, snap.mySlot ? `Your team: ${snap.teams[snap.mySlot - 1].name} (pick ${snap.mySlot})` : 'Your team: not found on this ESPN account — pick it in Settings → League']
        if (lineup) summary.push(`Lineup: ${lineup.slots.join(' ')}${lineup.ir ? ` + ${lineup.ir} IR` : ''}`)

        // The draft: ESPN's picks, matched to the player list; drafted players it lacks are added without a projection.
        let dataset = get().dataset
        const plan = planEspnDraft(snap.draft, dataset?.players.map((r) => r.identity) ?? [], settings.teams)
        if (dataset && plan.stubs.length) {
          dataset = { ...dataset, players: [...dataset.players, ...plan.stubs] }
          await db().datasets.put(dataset)
          await db().datasetMeta.put(datasetMeta(dataset))
          set({ datasets: await db().datasetMeta.orderBy('createdAt').toArray() })
        }
        const now = Date.now()
        const draft = {
          ...s.draft,
          updatedAt: now,
          picks: plan.picks.map((p) => ({ ...p, at: now })),
          log: [...s.draft.log, { at: now, kind: 'restore' as const, text: `Imported ${plan.picks.length} picks from ESPN` }],
          targetPick: null,
        }
        set((x) => ({ settings, draft, dataset, undoStack: [...x.undoStack, x.draft].slice(-UNDO_LIMIT) }))
        if (snap.draft.length) summary.push(`Draft: ${plan.picks.length} picks${plan.stubs.length ? ` (${plan.stubs.length} players not in your player list were added without a projection)` : ''}`)

        // The NBA schedule, when none is loaded yet.
        if (!get().nbaSchedule) {
          const r = await fetch(`${base}local-data/__espn/schedule?season=${espnSeasonId(label)}&label=${encodeURIComponent(label)}`, { cache: 'no-store' })
          const sb = (await r.json().catch(() => null)) as { ok?: boolean; schedule?: unknown } | null
          const parsed = NbaScheduleSchema.safeParse(sb?.schedule)
          if (sb?.ok && parsed.success) {
            await db().kv.put({ key: 'nbaSchedule', value: parsed.data })
            set({ nbaSchedule: parsed.data })
            summary.push(`NBA schedule: ${parsed.data.games.length} games`)
          }
        }
        set({ espnSyncing: false, prefs: { ...get().prefs, setupDone: true } })
        if (!deriveDraft(get().draft, get().settings).complete) {
          summary.push('The draft is not complete on ESPN yet: sync again once it is.')
          return { ok: true, summary }
        }
        const sync = await get().syncEspn()
        if (!sync.ok) return { ok: false, error: sync.error, summary }
        const weeks = get().season.matchups.length
        if (weeks) summary.push(`Schedule: ${weeks} weeks`)
        return { ok: true, summary }
      } catch (e) {
        const error = (e as Error).message
        set({ espnSyncing: false, espnError: error })
        return { ok: false, error }
      }
    },
  }
})

let saveTimer: ReturnType<typeof setTimeout> | null = null
let diskTimer: ReturnType<typeof setTimeout> | null = null
let firstPending: number | null = null
let lastSaved: string | null = null

/**
 * Debounced autosave of the persisted slice to IndexedDB (plus a synchronous
 * localStorage mirror). Saves at most `delay` ms after the last change and no
 * later than `maxWait` ms after the first unsaved change. Returns an unsubscribe fn.
 */
export function startAutosave(delay = 150, maxWait = 1000): () => void {
  const flush = () => {
    saveTimer = null
    firstPending = null
    const s = useApp.getState()
    if (!s.hydrated) return
    const slice = persistedSlice(s)
    const json = JSON.stringify(slice)
    if (json === lastSaved) return
    lastSaved = json
    const savedAt = Date.now()
    try {
      globalThis.localStorage?.setItem(LS_KEY, JSON.stringify({ savedAt, value: slice }))
    } catch {
      /* storage full or unavailable — IndexedDB remains the primary store */
    }
    void db().kv.put({ key: 'state', value: slice, savedAt } as { key: string; value: unknown })
    if (diskTimer) clearTimeout(diskTimer)
    diskTimer = setTimeout(() => void saveSessionToDisk(), 1500)
  }
  const unsub = useApp.subscribe((s, prev) => {
    if (!s.hydrated) return
    if (PERSISTED_KEYS.every((k) => s[k] === prev[k])) return
    const now = Date.now()
    firstPending ??= now
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, now - firstPending >= maxWait ? 0 : delay)
  })
  const onHide = () => flush()
  window.addEventListener('pagehide', onHide)
  document.addEventListener('visibilitychange', onHide)
  return () => {
    unsub()
    window.removeEventListener('pagehide', onHide)
    document.removeEventListener('visibilitychange', onHide)
  }
}
