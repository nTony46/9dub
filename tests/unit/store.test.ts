import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateDemoDataset } from '@/data/demo/generate'
import { NineDubDB, db, setDb } from '@/store/db'
import { defaultPersisted, persistedSlice, useApp } from '@/store/appStore'
import { deriveDraft } from '@/store/draftLogic'
import { migrateState } from '@/store/schema'

const demo = generateDemoDataset({ count: 120 })
const ids = demo.players.map((p) => p.identity.id)

async function freshStore(name: string) {
  setDb(new NineDubDB(name))
  useApp.setState({ ...defaultPersisted(), hydrated: false, dataset: null, datasets: [], undoStack: [], previewId: null, compareIds: [] })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      json: async () => (String(url).endsWith('manifest.json') ? { datasets: [{ file: 'demo.json', default: true }] } : demo),
    })),
  )
  await useApp.getState().hydrate()
}

const derived = () => deriveDraft(useApp.getState().draft, useApp.getState().settings)

describe('live draft mechanics (store)', () => {
  beforeEach(async () => {
    await freshStore(`t-${Math.random()}`)
  })

  it('hydrates the bundled dataset on a fresh install', () => {
    const s = useApp.getState()
    expect(s.hydrated).toBe(true)
    expect(s.dataset?.kind).toBe('demo')
    expect(s.activeDatasetId).toBe(demo.id)
  })

  it('drafting assigns the player to the team on the clock and removes him from availability', () => {
    useApp.getState().setSettings({ userSlot: 2 })
    expect(useApp.getState().draftPlayer(ids[0]).ok).toBe(true)
    expect(useApp.getState().draftPlayer(ids[1]).ok).toBe(true)
    const d = derived()
    expect(d.rosters[0]).toEqual([ids[0]])
    expect(d.rosters[1]).toEqual([ids[1]]) // my team (slot 2)
    expect(d.draftedBy.has(ids[0])).toBe(true)
    expect(d.currentPick).toBe(3)
    expect(d.nextUserPick).toBe(23) // slot 2 in a 12-team snake: 2, 23, 26, …
  })

  it('rejects duplicate players and picks outside the draft', () => {
    useApp.getState().draftPlayer(ids[0])
    const dup = useApp.getState().draftPlayer(ids[0])
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.error).toMatch(/already drafted/)
    expect(useApp.getState().draftPlayer(ids[5], { overall: 999 }).ok).toBe(false)
    expect(useApp.getState().draftPlayer(ids[5], { overall: 1 }).ok).toBe(false) // pick 1 taken
  })

  it('undo, edit and remove keep rosters consistent', () => {
    const s = useApp.getState()
    for (let i = 0; i < 5; i++) s.draftPlayer(ids[i])
    expect(useApp.getState().undo()).toBeTruthy()
    expect(derived().draftedBy.size).toBe(4)
    expect(derived().draftedBy.has(ids[4])).toBe(false)

    // Replace the player at pick 2 and move pick 3 to team 9.
    expect(useApp.getState().editPick(2, { playerId: ids[50] }).ok).toBe(true)
    expect(useApp.getState().editPick(3, { teamIndex: 8 }).ok).toBe(true)
    let d = derived()
    expect(d.rosters[1]).toEqual([ids[50]])
    expect(d.draftedBy.has(ids[1])).toBe(false)
    expect(d.rosters[8]).toEqual([ids[2]])
    expect(d.rosters[2]).toEqual([])
    expect(d.picksByOverall.get(3)!.manualTeam).toBe(true)
    // Editing to a player who is already drafted is refused.
    expect(useApp.getState().editPick(2, { playerId: ids[0] }).ok).toBe(false)

    expect(useApp.getState().removePick(1).ok).toBe(true)
    d = derived()
    expect(d.rosters[0]).toEqual([])
    expect(d.gaps).toEqual([1])
    expect(d.isPartial).toBe(true)
    // Undo restores the removed pick.
    useApp.getState().undo()
    expect(derived().rosters[0]).toEqual([ids[0]])
  })

  it('supports logging only my own picks (partial log) with explicit targets', () => {
    useApp.getState().setSettings({ userSlot: 6 })
    useApp.getState().setTargetPick(6)
    expect(useApp.getState().draftPlayer(ids[10]).ok).toBe(true)
    const d = derived()
    expect(d.rosters[5]).toEqual([ids[10]])
    expect(d.gaps).toEqual([1, 2, 3, 4, 5])
    expect(d.currentPick).toBe(7)
    expect(useApp.getState().draft.targetPick).toBeNull()
  })

  it('changing the slot before the draft regenerates my picks; team count is locked mid-draft', () => {
    useApp.getState().setSettings({ userSlot: 1 })
    expect(derived().userPicks.slice(0, 3)).toEqual([1, 24, 25])
    useApp.getState().setSettings({ userSlot: 12 })
    expect(derived().userPicks.slice(0, 3)).toEqual([12, 13, 36])
    useApp.getState().draftPlayer(ids[0])
    const r = useApp.getState().setSettings({ teams: 10 })
    expect(r.ok).toBe(false)
    // Slot can still change mid-draft; recorded picks keep their teams.
    expect(useApp.getState().setSettings({ userSlot: 1 }).ok).toBe(true)
    expect(derived().rosters[0]).toEqual([ids[0]])
    expect(derived().userTeam).toBe(0)
  })
})

describe('persistence', () => {
  it('restores the draft, shortlist and settings after a reload', async () => {
    const dbName = `persist-${Math.random()}`
    await freshStore(dbName)
    const { startAutosave } = await import('@/store/appStore')
    vi.stubGlobal('window', Object.assign(globalThis.window ?? {}, { addEventListener: () => {}, removeEventListener: () => {} }))
    vi.stubGlobal('document', Object.assign(globalThis.document ?? {}, { addEventListener: () => {}, removeEventListener: () => {} }))
    const stop = startAutosave(10)
    useApp.getState().setSettings({ userSlot: 4, leagueName: 'Test league' })
    useApp.getState().draftPlayer(ids[0])
    useApp.getState().draftPlayer(ids[1])
    useApp.getState().toggleShortlist(ids[7])
    await new Promise((r) => setTimeout(r, 60))
    stop()
    // "Reload": wipe memory, re-hydrate from the same IndexedDB.
    useApp.setState({ ...defaultPersisted(), hydrated: false, dataset: null })
    await useApp.getState().hydrate()
    const s = useApp.getState()
    expect(s.settings.userSlot).toBe(4)
    expect(s.settings.leagueName).toBe('Test league')
    expect(s.draft.picks.map((p) => p.playerId)).toEqual([ids[0], ids[1]])
    expect(s.shortlist).toEqual([ids[7]])
    expect(s.dataset?.id).toBe(demo.id)
  })
})

describe('session export / import', () => {
  beforeEach(async () => {
    await freshStore(`sess-${Math.random()}`)
  })

  it('round-trips a session with a schema version', async () => {
    useApp.getState().draftPlayer(ids[0])
    useApp.getState().toggleShortlist(ids[9])
    const file = JSON.parse(JSON.stringify(useApp.getState().exportSession(false)))
    expect(file.schemaVersion).toBe(1)
    useApp.getState().resetDraft()
    expect(useApp.getState().draft.picks).toHaveLength(0)
    const r = await useApp.getState().importSession(file)
    expect(r.ok).toBe(true)
    expect(useApp.getState().draft.picks[0].playerId).toBe(ids[0])
    expect(useApp.getState().shortlist).toEqual([ids[9]])
  })

  it('rejects invalid files without touching current data', async () => {
    useApp.getState().draftPlayer(ids[0])
    expect((await useApp.getState().importSession({ hello: 'world' })).ok).toBe(false)
    const future = { app: '9dub', kind: 'session', schemaVersion: 99, exportedAt: '', state: { ...persistedSlice(useApp.getState()), schemaVersion: 99 } }
    const r = await useApp.getState().importSession(future)
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/newer/)
    expect(useApp.getState().draft.picks).toHaveLength(1)
  })

  it('migrates an unversioned state object and fills defaults', () => {
    const legacy = { settings: { teams: 10, rounds: 14 }, draft: { id: 'x', name: 'old', createdAt: 1, updatedAt: 1 } }
    const m = migrateState(legacy)
    expect(m.ok).toBe(true)
    if (m.ok) {
      expect(m.state.schemaVersion).toBe(1)
      expect(m.state.settings.teams).toBe(10)
      expect(m.state.draft.picks).toEqual([])
      expect(m.state.prefs.theme).toBe('dark')
    }
  })
})

describe('dataset refresh on an existing draft (stable ids, backup, undo, reload)', () => {
  const asLocal = (id: string, mutate?: (d: typeof demo) => void) => {
    const d = structuredClone(demo)
    d.id = id
    d.kind = 'local'
    mutate?.(d)
    return d
  }

  it('re-links picks, undo history and the shortlist by name, backs up first, and survives a reload', async () => {
    await freshStore(`refresh-${Math.random()}`)
    const a = asLocal('local-a')
    expect((await useApp.getState().addDataset(a, true)).ok).toBe(true)
    useApp.getState().setSettings({ userSlot: 1 })
    for (const id of ids.slice(0, 5)) expect(useApp.getState().draftPlayer(id).ok).toBe(true)
    useApp.getState().toggleShortlist(ids[2])
    useApp.getState().toggleShortlist(ids[9])
    // Refreshed sources spell one player differently, so his id changes; another player is new.
    const renamedFrom = ids[2]
    const b = asLocal('local-b', (d) => {
      const r = d.players.find((p) => p.identity.id === renamedFrom)!
      r.identity.id = 'renamed-player'
      r.identity.fullName = `${r.identity.fullName} III`
      r.projection!.playerId = 'renamed-player'
    })
    const res = await useApp.getState().addDataset(b, true)
    expect(res.ok).toBe(true)
    expect(res.remapped).toBe(1)
    expect(res.unmatched).toEqual([])
    expect(res.backupKey).toMatch(/^backup:/)
    let s = useApp.getState()
    expect(s.activeDatasetId).toBe('local-b')
    expect(s.draft.picks.map((p) => p.playerId)).toEqual([ids[0], ids[1], 'renamed-player', ids[3], ids[4]])
    expect(s.shortlist).toEqual(['renamed-player', ids[9]])
    expect(s.undoStack.every((u) => u.picks.every((p) => p.playerId !== renamedFrom))).toBe(true)
    // Undo still works on the re-linked history.
    expect(useApp.getState().undo()).not.toBeNull()
    expect(useApp.getState().draft.picks).toHaveLength(4)
    // The pre-switch backup can be listed and restored.
    const backups = await useApp.getState().listBackups()
    expect(backups.some((x) => x.key === res.backupKey && x.picks === 5)).toBe(true)
    // Persist and reload.
    await db().kv.put({ key: 'state', value: persistedSlice(useApp.getState()), savedAt: Date.now() } as { key: string; value: unknown })
    useApp.setState({ ...defaultPersisted(), hydrated: false, dataset: null })
    await useApp.getState().hydrate()
    s = useApp.getState()
    expect(s.dataset?.id).toBe('local-b')
    expect(s.draft.picks.map((p) => p.playerId)).toEqual([ids[0], ids[1], 'renamed-player', ids[3]])
    // Rolling back to the old snapshot re-links the other way.
    const back = await useApp.getState().activateDataset('local-a')
    expect(back.remapped).toBeGreaterThan(0)
    expect(useApp.getState().draft.picks[2].playerId).toBe(renamedFrom)
  })

  it('first launch prefers a local real-data snapshot served by the dev server; the demo is the fallback', async () => {
    setDb(new NineDubDB(`first-${Math.random()}`))
    useApp.setState({ ...defaultPersisted(), hydrated: false, dataset: null, datasets: [], undoStack: [], localSnapshots: [] })
    const local = asLocal('local-first')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url)
        if (u.includes('local-data/manifest.json')) return { ok: true, json: async () => ({ datasets: [{ id: 'local-first', file: 'real-2026-27.json', name: 'Real', season: '2026-27', kind: 'local', players: 120, default: true }] }) }
        if (u.includes('local-data/')) return { ok: true, json: async () => local }
        return { ok: true, json: async () => (u.endsWith('manifest.json') ? { datasets: [{ file: 'demo.json', default: true }] } : demo) }
      }),
    )
    await useApp.getState().hydrate()
    expect(useApp.getState().dataset?.id).toBe('local-first')
    expect(useApp.getState().localSnapshots).toHaveLength(1)
  })
})
