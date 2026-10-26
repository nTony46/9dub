import { describe, expect, it } from 'vitest'
import { recommend } from '@/analytics/recommend'
import { leagueScale } from '@/analytics/team'
import type { EngineContext } from '@/analytics/team'
import { valuePlayers } from '@/analytics/valuation'
import { generateDemoDataset } from '@/data/demo/generate'
import { toEngineLine } from '@/data/engineAdapter'
import type { DatasetRecord, DatasetSnapshot } from '@/data/schema'
import { applyIdRemap, planIdRemap, referencedIds } from '@/store/remap'
import { defaultPersisted } from '@/store/appStore'
import { line, player } from '../fixtures/engine'

function rec(id: string, over: Partial<DatasetRecord> = {}): DatasetRecord {
  return {
    identity: { id, fullName: id, aliases: [], nbaTeam: 'DEN', espnId: null, positions: ['C'] },
    projection: {
      playerId: id, season: '2026-27', source: 'FE', sourceUpdatedAt: null, gamesProjected: 70, minutesPerGame: 34,
      points: 20, threesMade: 1, rebounds: 10, assists: 3, steals: 1, blocks: 1, turnovers: 2,
      fieldGoalsMade: 8, fieldGoalsAttempted: 16, freeThrowsMade: 3, freeThrowsAttempted: 4, fieldGoalPct: 0.5, freeThrowPct: 0.75,
      injuryOrRoleNote: null, riskFlag: null, espnAdp: null, espnRank: null, sourceNineCatRank: null, otherAdp: null, otherAdpLabel: null,
      espnAdpSource: null, profile: 'fantasyedge', gpSource: null, completenessFlags: ['derived-fgm', 'derived-ftm'],
    },
    profiles: {
      fantasyedge: { id: 'fantasyedge', label: 'FE', kind: 'projection', season: '2026-27', sourceFile: null, sourcePage: null, capturedAt: null, gp: null, min: null, pts: 20, tpm: 1, reb: 10, ast: 3, stl: 1, blk: 1, tov: 2, fgPct: 0.5, ftPct: 0.75, fga: 16, fta: 4, fgm: 8, ftm: 3, origin: { fgm: 'derived', ftm: 'derived' } },
      espn: { id: 'espn', label: 'ESPN', kind: 'projection', season: '2026-27', sourceFile: null, sourcePage: null, capturedAt: null, gp: 66, min: 33, pts: 22, tpm: 1.2, reb: 11, ast: 3, stl: 1, blk: 1.2, tov: 2.1, fgPct: 0.55, ftPct: 0.7, fga: null, fta: null, fgm: null, ftm: null, origin: {} },
    },
    ...over,
  }
}

describe('projection profiles (engine adapter)', () => {
  it('default profile uses the record line with sourced attempts and derived makes', () => {
    const l = toEngineLine(rec('a'), undefined)!
    expect(l.profile).toBe('fantasyedge')
    expect(l.player.line.fga).toBe(16)
    expect(l.volume).toEqual({ fg: 'derived', ft: 'derived' })
    expect(l.player.gp).toBe(70)
  })
  it('ESPN profile keeps ESPN counting stats and percentages, borrowing attempts only as a labelled cross-source proxy', () => {
    const l = toEngineLine(rec('a'), undefined, { profile: 'espn', estimateVolume: false })!
    expect(l.profile).toBe('espn')
    expect(l.player.line.pts).toBe(22)
    expect(l.player.line.fga).toBe(16)
    expect(l.player.line.fgm).toBeCloseTo(0.55 * 16, 10)
    expect(l.volume.fg).toBe('cross-source')
    expect(l.player.gp).toBe(66)
  })
  it('without any attempts the line stays incomplete unless the user opts into the estimate', () => {
    const r = rec('b', { profiles: { espn: rec('x').profiles!.espn } })
    r.volumeEstimate = { espn: { fga: 17.5, fta: 5, method: 'pts-identity', ftRate: 0.286, basis: 'test' } }
    expect(toEngineLine(r, undefined, { profile: 'espn', estimateVolume: false })!.volume.fg).toBe('missing')
    const est = toEngineLine(r, undefined, { profile: 'espn', estimateVolume: true })!
    expect(est.volume).toEqual({ fg: 'estimated', ft: 'estimated' })
    expect(est.player.line.fgm).toBeCloseTo(0.55 * 17.5, 10)
  })
  it('directory-only records have no engine line', () => {
    expect(toEngineLine(rec('c', { projection: null, profiles: {} }), undefined)).toBeNull()
  })
  it('a manual attempts override counts as sourced', () => {
    const r = rec('d', { profiles: {} })
    r.projection = { ...r.projection!, fieldGoalsAttempted: null, fieldGoalsMade: null, completenessFlags: ['missing-fga'] }
    const l = toEngineLine(r, { fieldGoalsAttempted: 12 })!
    expect(l.volume.fg).toBe('sourced')
    expect(l.player.line.fgm).toBeCloseTo(0.5 * 12, 10)
  })
})

describe('incomplete lines never outrank complete ones', () => {
  it('a poor shooter with unknown volume ranks after every complete player and cannot win a lane', () => {
    const complete = Array.from({ length: 30 }, (_, i) =>
      player(`c${i}`, line({ pts: 12 + i * 0.3, tpm: 1, reb: 5, ast: 3, stl: 0.8, blk: 0.5, tov: 1.8, fg: [5 + i * 0.05, 11], ft: [2, 2.6] })),
    )
    // Big counting stats but no attempts: as a partial total it would look elite.
    const partial = player('partial', line({ pts: 30, tpm: 3, reb: 9, ast: 7, stl: 1.5, blk: 1, tov: 2 }))
    const v = valuePlayers([...complete, partial], { poolSize: 20, teams: 4, rounds: 5, fullSeasonGames: 82 })
    const pv = v.values.get('partial')!
    expect(pv.complete).toBe(false)
    expect(pv.total).toBeGreaterThan(v.values.get('c29')!.total)
    expect(pv.rank).toBe(31)
    expect(v.params.poolIds).not.toContain('partial')
    const ctx: EngineContext = { valuation: v, lines: new Map([...complete, partial].map((p) => [p.id, { line: p.line, gp: p.gp }])), basis: 'perGame', rosterSize: 5 }
    const res = recommend({ ctx, scale: leagueScale(ctx, 4), teams: 4, available: v.orderPerGame, myRoster: [], opponentRosters: null, adp: () => null, timing: null, mode: 'adaptive', lock: null, round: 1 })
    expect(res.bestOverall.at(-1)!.id).toBe('partial')
    expect(res.bestDecision.map((s) => s.id)).not.toContain('partial')
    expect(res.bestFit.map((s) => s.id)).not.toContain('partial')
  })
})

describe('lineup feasibility guard', () => {
  it('when every remaining pick must fill an open starter slot, players who cannot are kept out of Decision/Fit and told why', () => {
    const bigs = Array.from({ length: 9 }, (_, i) => player(`big${i}`, line({ pts: 15, tpm: 0.2, reb: 10, ast: 2, stl: 0.7, blk: 1.5, tov: 1.8, fg: [6.5, 11], ft: [2, 3] })))
    const pf = player('pf', line({ pts: 22, tpm: 1.5, reb: 9, ast: 4, stl: 1, blk: 1, tov: 2, fg: [8.5, 16], ft: [3.5, 4.4] }))
    const guard = player('guard', line({ pts: 18, tpm: 2.5, reb: 4, ast: 6, stl: 1.2, blk: 0.3, tov: 2.2, fg: [6.5, 14.5], ft: [3, 3.5] }))
    const all = [...bigs, pf, guard, ...Array.from({ length: 20 }, (_, i) => player(`f${i}`, line({ pts: 8, tpm: 1, reb: 3, ast: 2, stl: 0.6, blk: 0.3, tov: 1.2, fg: [3, 7], ft: [1, 1.3] })))]
    const v = valuePlayers(all, { poolSize: 24, teams: 2, rounds: 13, fullSeasonGames: 82 })
    const ctx: EngineContext = { valuation: v, lines: new Map(all.map((p) => [p.id, { line: p.line, gp: p.gp }])), basis: 'perGame', rosterSize: 13 }
    const pos: Record<string, ('PG' | 'SG' | 'SF' | 'PF' | 'C')[]> = Object.fromEntries(bigs.map((b) => [b.id, ['C']]))
    pos.pf = ['C'] // another center: fills no open starter slot
    pos.guard = ['PG', 'SG']
    const res = recommend({
      ctx, scale: leagueScale(ctx, 2), teams: 2, available: ['pf', 'guard'], myRoster: bigs.map((b) => b.id), opponentRosters: null,
      adp: () => null, timing: null, mode: 'adaptive', lock: null, round: 10, positions: (id) => pos[id] ?? ['SF'],
    })
    expect(res.lineup).toMatchObject({ picksLeft: 4, tight: true })
    expect(res.scores.get('pf')!.positionBlocked.length).toBeGreaterThan(0)
    expect(res.bestDecision.map((s) => s.id)).toEqual(['guard'])
    expect(res.bestFit.map((s) => s.id)).not.toContain('pf')
  })
})

describe('stable ids across dataset changes', () => {
  const demo = generateDemoDataset({ count: 40 })
  const real = (ds: DatasetSnapshot, kind: DatasetSnapshot['kind']): DatasetSnapshot => ({ ...structuredClone(ds), id: `${kind}-x`, kind })
  it('re-links references by canonical name when a refresh renames an id, and reports what it cannot match', () => {
    const before = real(demo, 'local')
    const after = real(demo, 'local')
    after.id = 'local-y'
    const p0 = after.players[0]
    const oldId = p0.identity.id
    p0.identity.id = 'renamed-id'
    p0.identity.fullName = `${p0.identity.fullName} Jr.` // suffix variant: same canonical player
    const s = defaultPersisted()
    s.draft.picks = [{ overall: 1, playerId: oldId, teamIndex: 0, at: 1, manualTeam: false }]
    s.shortlist = [oldId, 'ghost']
    s.overrides = { [oldId]: { points: 1 } }
    s.undoStack = [{ ...s.draft }]
    const plan = planIdRemap(referencedIds(s), after, [before])
    expect(plan.map.get(oldId)).toBe('renamed-id')
    expect(plan.unmatched.map((u) => u.id)).toEqual(['ghost'])
    const next = applyIdRemap(s, plan.map)
    expect(next.draft.picks[0].playerId).toBe('renamed-id')
    expect(next.undoStack[0].picks[0].playerId).toBe('renamed-id')
    expect(next.shortlist).toEqual(['renamed-id', 'ghost'])
    expect(Object.keys(next.overrides)).toEqual(['renamed-id'])
  })
  it('never maps fictional demo players onto a real snapshot', () => {
    const local = real(demo, 'local')
    local.players[0].identity.id = 'other'
    const plan = planIdRemap([demo.players[0].identity.id], local, [demo])
    expect(plan.map.size).toBe(0)
    expect(plan.unmatched[0].reason).toMatch(/fictional/)
  })
})
