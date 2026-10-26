import { generateDemoDataset } from '@/data/demo/generate'
import { toEnginePlayer } from '@/data/engineAdapter'
import { leagueScale, valuePlayers, type EngineContext, type EnginePlayer, type StatLine } from '@/analytics'

/** Build a per-game line from makes/attempts so FG%/FT% are explicit. */
export function line(p: Partial<StatLine> & { fg?: [number, number]; ft?: [number, number] }): StatLine {
  return {
    pts: p.pts ?? 10,
    tpm: p.tpm ?? 1,
    reb: p.reb ?? 4,
    ast: p.ast ?? 2,
    stl: p.stl ?? 0.8,
    blk: p.blk ?? 0.4,
    tov: p.tov ?? 1.2,
    fgm: p.fg ? p.fg[0] : (p.fgm ?? null),
    fga: p.fg ? p.fg[1] : (p.fga ?? null),
    ftm: p.ft ? p.ft[0] : (p.ftm ?? null),
    fta: p.ft ? p.ft[1] : (p.fta ?? null),
  }
}

export function player(id: string, l: StatLine, gp: number | null = 70): EnginePlayer {
  return { id, line: l, gp }
}

/** Conceptual "Trey Murphy"-type: a strong, balanced, low-turnover scoring wing (fictional numbers). */
export const MURPHY_LIKE = player(
  'fx-wing-star',
  line({ pts: 21.5, tpm: 3.1, reb: 5.4, ast: 2.6, stl: 1.4, blk: 0.65, tov: 1.5, fg: [7.4, 15.6], ft: [3.6, 4.1] }),
  74,
)
/** Low-tier rebound specialist: big REB number, little else, poor FT on low volume (fictional). */
export const GLASS_SPECIALIST = player(
  'fx-glass-specialist',
  line({ pts: 7.2, tpm: 0, reb: 10.8, ast: 1.0, stl: 0.55, blk: 1.0, tov: 1.1, fg: [3.0, 5.6], ft: [1.1, 2.1] }),
  70,
)

export function demoEngine(extra: EnginePlayer[] = [], opts: { teams?: number; rounds?: number } = {}) {
  const teams = opts.teams ?? 12
  const rounds = opts.rounds ?? 13
  const ds = generateDemoDataset()
  const players = [...ds.players.map((r) => toEnginePlayer(r)!), ...extra]
  const valuation = valuePlayers(players, { poolSize: 200, teams, rounds, fullSeasonGames: 82 })
  const ctx: EngineContext = {
    valuation,
    lines: new Map(players.map((p) => [p.id, { line: p.line, gp: p.gp }])),
    basis: 'perGame',
    rosterSize: rounds,
  }
  const scale = leagueScale(ctx, teams)
  const archetype = new Map(ds.players.map((r) => [r.identity.id, String(r.projection!.raw?.archetype ?? '')]))
  const adp = new Map<string, number | null>(ds.players.map((r) => [r.identity.id, r.projection!.espnAdp]))
  return { ds, players, valuation, ctx, scale, archetype, adp, teams, rounds }
}
