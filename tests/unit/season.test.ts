import { beforeEach, describe, expect, it, vi } from 'vitest'
import { generateDemoDataset } from '@/data/demo/generate'
import { NineDubDB, setDb } from '@/store/db'
import { defaultPersisted, useApp } from '@/store/appStore'
import { applyIdRemap, referencedIds } from '@/store/remap'
import { activeInjuries, applyTrade, currentRosters, currentWeek, irPlacement, matchupsFromSeed, syncedTeamNames } from '@/store/season'
import { migrateState, type LeagueSeed, type RosterMove } from '@/store/schema'

const mv = (playerId: string, from: number | null, to: number | null, k = 0): RosterMove => ({ id: `m${k}-${playerId}`, at: k, playerId, from, to, note: '' })

describe('current rosters (draft + post-draft moves)', () => {
  const draft = [
    ['a1', 'a2', 'a3'],
    ['b1', 'b2'],
  ]

  it('applies drops, free-agent adds and trades in order without touching the draft', () => {
    const { rosters, teamOf } = currentRosters(draft, [mv('a2', 0, null, 1), mv('fa1', null, 0, 2), mv('b1', 1, 0, 3), mv('a3', 0, 1, 4)])
    expect(rosters[0]).toEqual(['a1', 'fa1', 'b1'])
    expect(rosters[1]).toEqual(['b2', 'a3'])
    expect(teamOf.has('a2')).toBe(false)
    expect(draft[0]).toEqual(['a1', 'a2', 'a3'])
  })

  it('a dropped and re-added player ends up where the last move put him', () => {
    const { rosters } = currentRosters(draft, [mv('a1', 0, null, 1), mv('a1', null, 1, 2)])
    expect(rosters[0]).toEqual(['a2', 'a3'])
    expect(rosters[1]).toEqual(['b1', 'b2', 'a1'])
  })
})

describe('league schedule seed', () => {
  const seed: LeagueSeed = {
    kind: 'league-schedule',
    myTeamName: 'My Squad',
    matchups: [
      { start: '2026-10-26', end: '2026-11-01', opponent: 'Rivals', owner: 'R', away: false },
      { start: '2026-10-20', end: '2026-10-25', opponent: 'Neighbours', owner: 'N', away: true },
    ],
  }

  it('sorts weeks and maps opponents only when a team name matches exactly', () => {
    const weeks = matchupsFromSeed(seed, ['Team 1', 'Neighbours', 'Team 3'], 2)
    expect(weeks.map((w) => w.label)).toEqual(['Neighbours', 'Rivals'])
    expect(weeks[0].opponent).toBe(1)
    expect(weeks[1].opponent).toBeNull()
    expect(weeks[0].away).toBe(true)
  })

  it('picks the week in progress, else the next, else the last', () => {
    const weeks = matchupsFromSeed(seed, [], null)
    expect(currentWeek(weeks, '2026-10-22')?.label).toBe('Neighbours')
    expect(currentWeek(weeks, '2026-10-26')?.label).toBe('Rivals')
    expect(currentWeek(weeks, '2027-03-01')?.label).toBe('Rivals')
    expect(currentWeek(weeks, '2026-09-01')?.label).toBe('Neighbours')
  })
})

describe('in-season store actions', () => {
  const demo = generateDemoDataset({ count: 120 })
  const ids = demo.players.map((p) => p.identity.id)
  beforeEach(async () => {
    setDb(new NineDubDB(`season-${Math.random()}`))
    useApp.setState({ ...defaultPersisted(), hydrated: false, dataset: null, datasets: [], undoStack: [], previewId: null, compareIds: [], nbaSchedule: null })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({ json: async () => (String(url).endsWith('manifest.json') ? { datasets: [{ file: 'demo.json', default: true }] } : demo) })),
    )
    await useApp.getState().hydrate()
    useApp.getState().setSettings({ userSlot: 1 })
    for (let i = 0; i < 4; i++) useApp.getState().draftPlayer(ids[i])
  })

  it('records post-draft moves with their origin and undoes them individually', () => {
    const s = useApp.getState()
    expect(s.moveRosterPlayer(ids[0], null).ok).toBe(true) // drop my first pick
    expect(s.moveRosterPlayer(ids[50], 0).ok).toBe(true) // add a free agent
    expect(s.moveRosterPlayer(ids[50], 0).ok).toBe(false) // already there
    const moves = useApp.getState().season.rosterMoves
    expect(moves.map((m) => [m.from, m.to])).toEqual([
      [0, null],
      [null, 0],
    ])
    useApp.getState().undoRosterMove(moves[0].id)
    expect(useApp.getState().season.rosterMoves).toHaveLength(1)
    expect(useApp.getState().draft.picks).toHaveLength(4) // the draft log is never edited
  })

  it('maps a league name to a slot for every week and names the team if it was unnamed', () => {
    const s = useApp.getState()
    s.applyLeagueSeed({
      kind: 'league-schedule',
      myTeamName: 'My Squad',
      matchups: [
        { start: '2026-10-20', end: '2026-10-25', opponent: 'Rivals', owner: '', away: false },
        { start: '2027-01-04', end: '2027-01-10', opponent: 'Rivals', owner: '', away: true },
      ],
    })
    expect(useApp.getState().settings.teamNames[0]).toBe('My Squad')
    useApp.getState().assignOpponent('Rivals', 3)
    const st = useApp.getState()
    expect(st.season.matchups.map((w) => w.opponent)).toEqual([3, 3])
    expect(st.settings.teamNames[3]).toBe('Rivals')
    st.renameTeam(3, '  ')
    expect(useApp.getState().settings.teamNames[3]).toBe('Team 4')
  })

  it('states saved before the season feature load with empty season data', () => {
    const old = { ...defaultPersisted() } as Record<string, unknown>
    delete old.season
    const m = migrateState(old)
    expect(m.ok).toBe(true)
    if (m.ok) expect(m.state.season).toEqual({ matchups: [], rosterMoves: [], injuries: [], espn: null })
  })

  it('session export carries the season, and dataset switches re-link moved players', () => {
    useApp.getState().moveRosterPlayer(ids[60], 0)
    const exp = useApp.getState().exportSession(false) as { state: { season: { rosterMoves: RosterMove[] } } }
    expect(exp.state.season.rosterMoves[0].playerId).toBe(ids[60])
    const s = useApp.getState()
    expect(referencedIds(s).has(ids[60])).toBe(true)
    const remapped = applyIdRemap(s, new Map([[ids[60], 'renamed-id']]))
    expect(remapped.season?.rosterMoves[0].playerId).toBe('renamed-id')
  })
})

describe('trade lab and injuries', () => {
  const rosters = [
    ['m1', 'm2', 'm3'],
    ['o1', 'o2'],
    ['x1', 'x2'],
  ]
  const teamOf = new Map<string, number>(rosters.flatMap((r, i) => r.map((id) => [id, i] as [string, number])))

  it('a trade with one team sends my players there; a pickup drops them', () => {
    const t = applyTrade(rosters, teamOf, 0, { give: ['m2'], get: ['o1'] })
    expect(t.partner).toBe(1)
    expect(t.rosters[0]).toEqual(['m1', 'm3', 'o1'])
    expect(t.rosters[1]).toEqual(['o2', 'm2'])
    expect(t.rosters[2]).toEqual(['x1', 'x2'])
    const pickup = applyTrade(rosters, teamOf, 0, { give: ['m3'], get: ['fa9'] })
    expect(pickup.partner).toBeNull()
    expect(pickup.rosters[0]).toEqual(['m1', 'm2', 'fa9'])
    expect(pickup.rosters.flat()).not.toContain('m3')
    expect(applyTrade(rosters, teamOf, 0, { give: [], get: ['o1', 'x1'] }).multiTeam).toBe(true)
  })

  it('injured players fill IR slots first-marked-first; expired injuries stop counting', () => {
    const inj = [
      { playerId: 'm3', until: null, at: 2, note: '' },
      { playerId: 'm1', until: '2026-11-01', at: 1, note: '' },
      { playerId: 'm2', until: '2026-10-01', at: 0, note: '' },
    ]
    expect(irPlacement(rosters[0], inj, 1, '2026-10-20')).toEqual({ ir: ['m1'], outActive: ['m3'], active: ['m2', 'm3'] })
    expect(irPlacement(rosters[0], inj, 2, '2026-11-02')).toEqual({ ir: ['m3'], outActive: [], active: ['m1', 'm2'] })
    expect([...activeInjuries(inj, '2026-10-20').entries()]).toEqual([
      ['m3', null],
      ['m1', '2026-11-01'],
    ])
  })
})

describe('session saved on disk', () => {
  it('restores from .local-data when the browser has no saved state', async () => {
    const demo = generateDemoDataset({ count: 60 })
    const saved = { ...defaultPersisted(), settings: { ...defaultPersisted().settings, userSlot: 7, teamNames: Array.from({ length: 12 }, (_, i) => (i === 6 ? 'From Disk' : `Team ${i + 1}`)) } }
    setDb(new NineDubDB(`disk-${Math.random()}`))
    globalThis.localStorage?.clear?.()
    useApp.setState({ ...defaultPersisted(), hydrated: false, dataset: null, datasets: [], undoStack: [], previewId: null, compareIds: [], bootNotice: null, diskSave: 'unknown' })
    const posts: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        if (init?.method === 'POST') {
          posts.push(JSON.parse(init.body!))
          return { ok: true, json: async () => ({ ok: true }) }
        }
        const u = String(url)
        const body = u.endsWith('session-latest.json')
          ? { app: '9dub', kind: 'session', schemaVersion: 1, exportedAt: '2026-10-19T20:00:00.000Z', state: saved }
          : u.endsWith('manifest.json')
            ? { datasets: [{ file: 'demo.json', default: true }] }
            : demo
        return { ok: true, json: async () => body }
      }),
    )
    await useApp.getState().hydrate()
    const s = useApp.getState()
    expect(s.settings.userSlot).toBe(7)
    expect(s.settings.teamNames[6]).toBe('From Disk')
    expect(s.bootNotice).toMatch(/Restored your session/)
    await vi.waitFor(() => expect(useApp.getState().diskSave).toBe('on'))
    expect(posts).toHaveLength(1)
  })

  it('the dev server writes a valid session atomically, keeps daily copies, and refuses anything else', async () => {
    const { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } = await import('node:fs')
    const { join } = await import('node:path')
    const { tmpdir } = await import('node:os')
    const { saveSession } = await import('../../scripts/localDataPlugin')
    const root = mkdtempSync(join(tmpdir(), '9dub-session-'))
    expect(saveSession(root, '{"app":"other"}').ok).toBe(false)
    expect(saveSession(root, 'not json').ok).toBe(false)
    mkdirSync(join(root, 'session-backups'), { recursive: true })
    for (let d = 1; d <= 20; d++) writeFileSync(join(root, 'session-backups', `session-2026-09-${String(d).padStart(2, '0')}.json`), '{}')
    const body = JSON.stringify({ app: '9dub', kind: 'session', schemaVersion: 1, exportedAt: 'x', state: { schemaVersion: 1 } })
    expect(saveSession(root, body).ok).toBe(true)
    expect(readFileSync(join(root, 'session-latest.json'), 'utf8')).toBe(body)
    const backups = readdirSync(join(root, 'session-backups'))
    expect(backups).toHaveLength(14)
    expect(backups).toContain(`session-${new Date().toISOString().slice(0, 10)}.json`)
  })
})

describe('team names follow the opponent mapping', () => {
  const wk = (label: string, opponent: number | null) => ({ id: label, start: '2026-10-20', end: '2026-10-25', opponent, label, owner: '', away: false })
  it('repairs a name left behind when a league team was moved to another slot; keeps typed names', () => {
    // "Night Shift" was first put on slot 2 (index 1), then moved to slot 3; "Bench Mob" now owns slot 2.
    const names = ['Team 1', 'Night Shift', 'Night Shift', 'My Custom Name', 'Me']
    const weeks = [wk('Night Shift', 2), wk('Bench Mob', 1), wk('Rivals', 3)]
    expect(syncedTeamNames(names, weeks, 4)).toEqual(['Team 1', 'Bench Mob', 'Night Shift', 'My Custom Name', 'Me'])
  })
  it('resets a slot whose league name moved elsewhere, and changes nothing when already in sync', () => {
    expect(syncedTeamNames(['Night Shift', 'Team 2', 'Night Shift'], [wk('Night Shift', 2)], null)).toEqual(['Team 1', 'Team 2', 'Night Shift'])
    expect(syncedTeamNames(['Team 1', 'Team 2', 'Night Shift'], [wk('Night Shift', 2)], null)).toBeNull()
  })
})
