/**
 * Behaviour on real data (a private snapshot from
 * `npm run data:ingest`). Skipped when .local-data/real-2026-27.json is absent.
 * Assertions are about properties (quality guardrails, precedence, units,
 * feasibility) — never hard-coded scores — so a data refresh keeps them valid.
 */
import { describe, expect, it } from 'vitest'
import { CATEGORIES } from '@/analytics/categories'
import { explainCandidate } from '@/analytics/recommend'
import { categoryReadout } from '@/analytics/readout'
import { aggregateLines, typicalAtStage } from '@/analytics/team'
import { fillLineup, rosterWarnings, type Position } from '@/analytics/positions'
import { canonicalKey } from '@/data/normalize'
import { compareValues } from '@/data/ingest/report'
import { deriveDraft, uncertainAvailability } from '@/store/draftLogic'
import { defaultSettings } from '@/store/appStore'
import { buildsFor, hasRealData, profileOf, realEnv, realSnapshot, recFor, simulateDraft } from '../fixtures/realData'

// Without the private snapshot (a fresh clone, CI) each suite is registered as skipped without running its body, which reads the snapshot.
const suite = (name: string, body: () => void) =>
  hasRealData ? describe(name, body) : describe.skip(name, () => it.skip('needs a private snapshot (npm run data:ingest)', () => {}))

suite('real snapshot integrity', () => {
  const ds = realSnapshot!
  it('one record per canonical player, unique ids, every projected player has ESPN-style positions', () => {
    const ids = ds.players.map((p) => p.identity.id)
    expect(new Set(ids).size).toBe(ids.length)
    const keys = ds.players.map((p) => canonicalKey(p.identity.fullName))
    expect(new Set(keys).size).toBe(keys.length)
    for (const p of ds.players.filter((r) => r.projection)) expect(p.identity.positions.length, p.identity.fullName).toBeGreaterThan(0)
  })
  it('units and shooting math: fractions in 0–1, makes = % × attempts ≤ attempts, nothing negative', () => {
    for (const r of ds.players) {
      const p = r.projection
      if (!p) continue
      for (const v of [p.points, p.threesMade, p.rebounds, p.assists, p.steals, p.blocks, p.turnovers]) expect(v).toBeGreaterThanOrEqual(0)
      for (const v of [p.fieldGoalPct, p.freeThrowPct]) if (v != null) expect(v > 0 && v < 1, r.identity.fullName).toBe(true)
      if (p.fieldGoalsAttempted != null) {
        expect(p.fieldGoalsMade).toBeCloseTo(p.fieldGoalPct! * p.fieldGoalsAttempted, 9)
        expect(p.fieldGoalsMade!).toBeLessThanOrEqual(p.fieldGoalsAttempted)
        expect(p.freeThrowsMade!).toBeLessThanOrEqual(p.freeThrowsAttempted!)
      }
    }
  })
  it('matches the printed Fantasy Edge two-line cells for Jokić (FG% over FGA, FT% over FTA)', () => {
    const j = ds.players.find((p) => p.identity.id === 'nikola-jokic')!
    expect(j.profiles!.fantasyedge).toMatchObject({ fgPct: 0.574, fga: 18.1, ftPct: 0.821, fta: 6.6 })
  })
  it('never uses prior-season actuals as projections; ESPN rows used are 2027 PROJECTIONS', () => {
    for (const r of ds.players) {
      if (r.priorSeason) expect(r.priorSeason.kind).toBe('actual')
      if (r.projection) expect(['fantasyedge', 'espn']).toContain(r.projection.profile)
      if (r.profiles?.espn) expect(r.profiles.espn.kind).toBe('projection')
    }
  })
  it('ESPN ADP is Live Draft Trends AVG PICK, else the labelled FantasyPros ESPN fallback — never Yahoo or a blend', () => {
    for (const r of ds.players) {
      const p = r.projection
      if (!p) continue
      if (p.espnAdpSource === 'espn-live-draft') expect(p.espnAdp).toBe(r.market!.espnLive!.avgPick)
      if (p.espnAdpSource === 'fantasypros-espn') {
        expect(r.market!.espnLive).toBeNull()
        expect(p.espnAdp).toBe(r.market!.fantasyPros!.espn)
      }
      if (r.market?.espnLive?.capped) expect(p.espnAdp).toBeNull()
      expect(p.otherAdp).toBeNull()
    }
  })
})

suite('real-data valuation', () => {
  const env = realEnv()
  it('agrees closely with the published Fantasy Edge 9-cat order (same method family, different baselines)', () => {
    expect(compareValues(realSnapshot!).spearmanVsFantasyEdge).toBeGreaterThan(0.95)
  })
  it('the reference pool is made of complete players only; incomplete players rank after every complete player', () => {
    for (const id of env.valuation.params.poolIds) expect(env.complete.has(id)).toBe(true)
    const order = env.valuation.orderPerGame
    const firstIncomplete = order.findIndex((id) => !env.complete.has(id))
    expect(order.slice(firstIncomplete).every((id) => !env.complete.has(id))).toBe(true)
  })
  it('team FG% / FT% are total makes ÷ total attempts, not a mean of percentages', () => {
    const ids = ['Giannis Antetokounmpo', 'Stephen Curry'].map(env.id)
    const t = aggregateLines(ids.map((id) => env.ctx.lines.get(id)!.line))
    const ls = ids.map((id) => env.ctx.lines.get(id)!.line)
    expect(t.fgPct).toBeCloseTo((ls[0].fgm! + ls[1].fgm!) / (ls[0].fga! + ls[1].fga!), 12)
    expect(t.ftPct).toBeCloseTo((ls[0].ftm! + ls[1].ftm!) / (ls[0].fta! + ls[1].fta!), 12)
    expect(Math.abs(t.ftPct! - (ls[0].ftm! / ls[0].fta! + ls[1].ftm! / ls[1].fta!) / 2)).toBeGreaterThan(0.005)
  })
  it('unknown GP is never treated as 0 or 82: GP-aware equals per-game for those players', () => {
    const noGp = env.players.filter((p) => p.gp == null)
    expect(noGp.length).toBeGreaterThan(0)
    for (const p of noGp) {
      const v = env.valuation.values.get(p.id)!
      expect(v.gp.availability).toBeNull()
      expect(v.gp.total).toBeCloseTo(v.total, 12)
    }
  })
  it('turnovers are inverted and A/TO is not a category', () => {
    expect(CATEGORIES).not.toContain('A/TO' as never)
    const sorted = [...env.valuation.values.values()].filter((v) => v.raw.TO != null).sort((a, b) => a.raw.TO! - b.raw.TO!)
    expect(sorted[0].z.TO!).toBeGreaterThan(sorted.at(-1)!.z.TO!)
  })
})

suite('real-data recommendations', () => {
  const env = realEnv()
  const N = env.name

  it('Trey Murphy III is not discarded for a poor rebound specialist on a rebounding-light roster', () => {
    const murphy = env.id('Trey Murphy III')
    const guards = ['Shai Gilgeous-Alexander', 'Tyrese Maxey', 'Stephen Curry', 'Tyrese Haliburton'].map(env.id)
    const specialists = ['Mitchell Robinson', 'Daniel Gafford', 'Jusuf Nurkic'].map(env.id)
    const taken = new Set(env.valuation.orderPerGame.filter((id) => id !== murphy && !specialists.includes(id)).slice(0, 44))
    guards.forEach((g) => taken.add(g))
    const rec = recFor(env, { myRoster: guards, taken, round: 5 })
    const decision = rec.bestDecision.map((s) => s.id)
    expect(decision.indexOf(murphy)).toBeGreaterThanOrEqual(0)
    expect(decision.indexOf(murphy)).toBeLessThan(3)
    for (const sp of specialists) {
      const s = rec.scores.get(sp)!
      // Their rebounding helps this roster (positive fit) but they are far below the quality floor.
      expect(s.eligibleDecision, N(sp)).toBe(false)
      expect(decision).not.toContain(sp)
      expect(rec.bestFit.map((x) => x.id)).not.toContain(sp)
    }
    // Anyone ranked above Murphy here must be close to his intrinsic value (a justified, explained exception).
    for (const s of rec.bestDecision.slice(0, decision.indexOf(murphy))) expect(s.quality).toBeGreaterThan(rec.scores.get(murphy)!.quality - 1.5)
  })

  it('does not call punts after one or two picks', () => {
    for (const names of [['Giannis Antetokounmpo'], ['Giannis Antetokounmpo', 'Jalen Duren'], ['Luka Doncic', 'Trae Young']]) {
      const roster = names.map(env.id)
      const builds = buildsFor(env, roster, new Set(roster), 6, roster.length * 12 + 1)
      const ro = categoryReadout(profileOf(env, roster).zSlot, typicalAtStage(env.scale, env.valuation, roster.length), env.scale.sigma, roster.length, builds)
      expect(ro.puntCandidates, names.join('+')).toEqual([])
      expect(ro.label).toBe('Too early to call')
    }
  })

  it('a Giannis + non-shooting bigs core reads FT% as weak and the build lab offers an FT% punt without locking it', () => {
    const roster = ['Giannis Antetokounmpo', 'Jalen Duren', 'Zion Williamson', 'Walker Kessler'].map(env.id)
    const taken = new Set(env.valuation.orderPerGame.slice(0, 44))
    roster.forEach((r) => taken.delete(r))
    const builds = buildsFor(env, roster, new Set([...taken, ...roster]), 6, 49)
    const ro = categoryReadout(profileOf(env, roster).zSlot, typicalAtStage(env.scale, env.valuation, roster.length), env.scale.sigma, roster.length, builds)
    expect(ro.margin.FT).toBeLessThan(-1)
    expect(builds.slice(0, 5).some((b) => b.build.punts.includes('FT'))).toBe(true)
    const rec = recFor(env, { myRoster: roster, taken, round: 5 })
    expect(rec.catWeights.FT).toBeGreaterThan(0) // adaptive mode never hard-punts on its own
  })

  it('high-assist / high-turnover guards: recommendations add frontcourt categories, explanations name them', () => {
    const roster = ['Luka Doncic', 'Trae Young', 'Cade Cunningham', 'LaMelo Ball'].map(env.id)
    const taken = new Set(env.valuation.orderPerGame.slice(0, 44))
    roster.forEach((r) => taken.delete(r))
    const rec = recFor(env, { myRoster: roster, taken, round: 5 })
    const top = rec.bestFit.slice(0, 5)
    expect(top.some((s) => s.catDelta.REB > 0.5 || s.catDelta.BLK > 0.5)).toBe(true)
    const reasons = explainCandidate(rec.bestDecision[0], rec, { adp: null, gp: null, fullSeasonGames: 82, timing: null, fga: 1, fta: 1 })
    expect(reasons.length).toBeGreaterThan(1)
  })

  it('positional feasibility: nine bigs and four picks left → every lane candidate fills an open starter slot; warning shown', () => {
    const roster = ['Nikola Jokic', 'Victor Wembanyama', 'Anthony Davis', 'Domantas Sabonis', 'Walker Kessler', 'Alperen Sengun', 'Zach Edey', 'Jalen Duren', 'Evan Mobley'].map(env.id)
    const rec = recFor(env, { myRoster: roster, round: 10 })
    expect(rec.lineup?.tight).toBe(true)
    const players = roster.map((id) => ({ id, positions: env.positions(id) as Position[] }))
    const openBefore = fillLineup(players).unfilledStarters.length
    for (const s of [...rec.bestDecision, ...rec.bestFit].slice(0, 10))
      expect(fillLineup([...players, { id: s.id, positions: env.positions(s.id) as Position[] }]).unfilledStarters.length, N(s.id)).toBeLessThan(openBefore)
    expect(rosterWarnings(players, 13).some((w) => w.level === 'warn')).toBe(true)
  })

  it('timing matters: at the turn the decision lane prefers players who will not last to the next pick, and says so', () => {
    const myPicks = [12, 13, 36, 37]
    const taken = new Set(env.adpOrder.slice(0, 12))
    const mine = [env.adpOrder[11]]
    taken.delete(mine[0])
    const rec = recFor(env, { myRoster: mine, taken, currentPick: 13, myPicks, round: 2 })
    const top = rec.bestDecision[0]
    expect(env.adp(top.id)!).toBeLessThan(36)
    const latest = rec.bestOverall.find((s) => (env.adp(s.id) ?? 0) > 50 && s.eligibleDecision)
    if (latest) {
      const why = explainCandidate(latest, rec, { adp: env.adp(latest.id), gp: null, fullSeasonGames: 82, timing: { currentPick: 13, decisionPick: 13, followingPick: 36 }, fga: 1, fta: 1 })
      expect(why.some((r) => r.kind === 'timing')).toBe(true)
    }
  })

  it('a full 12-team, 13-round simulated draft yields legal, lineup-feasible and competitive rosters', () => {
    for (const slot of [1, 6, 12]) {
      const { rosters } = simulateDraft(env, slot)
      const all = rosters.flat()
      expect(all.length).toBe(156)
      expect(new Set(all).size).toBe(156)
      const mine = rosters[slot - 1]
      expect(mine.length).toBe(13)
      expect(fillLineup(mine.map((id) => ({ id, positions: env.positions(id) as Position[] }))).unfilledStarters).toEqual([])
      const totals = rosters.map((r) => CATEGORIES.reduce((s, c) => s + profileOf(env, r).zSlot[c], 0))
      const better = totals.filter((t) => t > totals[slot - 1]).length
      expect(better, `slot ${slot}`).toBeLessThanOrEqual(3)
    }
  })

  it('partial logging: players inferred as possibly taken stay available (never removed without a pick record)', () => {
    const settings = { ...defaultSettings(), userSlot: 6 }
    const now = Date.now()
    // Only my own picks are recorded (6 and 19); picks 1–5 and 7–18 are gaps.
    const picks = [6, 19].map((overall, i) => ({ overall, playerId: env.adpOrder[i * 10 + 3], teamIndex: 5, at: now, manualTeam: false }))
    const d = deriveDraft({ id: 'x', name: 'x', createdAt: now, updatedAt: now, picks, log: [], targetPick: null }, settings)
    expect(d.isPartial).toBe(true)
    const undraftedByAdp = env.adpOrder.filter((id) => !d.draftedBy.has(id) && (env.adp(id) ?? Infinity) < (d.currentPick ?? 0) + 6)
    const uncertain = uncertainAvailability(d.gaps.length, undraftedByAdp)
    expect(uncertain.size).toBeGreaterThan(0)
    for (const id of uncertain) expect(d.draftedBy.has(id)).toBe(false)
  })
})

suite('real-data profiles and options', () => {
  it('ESPN profile: complete only where attempts can be borrowed (cross-source), ranking stays coherent', () => {
    const espn = realEnv({ profile: 'espn' })
    const base = realEnv()
    expect(espn.complete.size).toBeGreaterThan(150)
    const top = espn.valuation.orderPerGame.slice(0, 20)
    for (const id of top) expect(base.valuation.values.get(id)!.rank).toBeLessThan(80)
  })
  it('opting into the volume estimate completes ESPN-only lines without letting them leap into the early rounds', () => {
    const est = realEnv({ estimateVolume: true })
    const base = realEnv()
    expect(est.complete.size).toBeGreaterThan(base.complete.size)
    const promoted = [...est.valuation.values.values()].filter((v) => v.complete && !base.complete.has(v.id))
    expect(Math.min(...promoted.map((v) => v.rank))).toBeGreaterThan(60)
  })
})
