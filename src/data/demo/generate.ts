/**
 * Seeded generator for the bundled DEMO pool. Every player is FICTIONAL.
 * Stat lines are drawn from archetype per-36 rates scaled by a talent curve so
 * the pool has realistic shapes (bigs with FG%/REB/BLK, guards with AST/3PM,
 * TO correlated with usage) for exercising the engine and UI. These are not
 * projections of real people and must never be presented as such.
 */
import type { Position } from '@/analytics/positions'
import { valuePlayers } from '@/analytics/valuation'
import { toEnginePlayer } from '../engineAdapter'
import { finalizeProjection, NBA_TEAMS } from '../normalize'
import { DATASET_SCHEMA_VERSION, type DatasetSnapshot, type PlayerProjection, type ProjectedRecord } from '../schema'

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12)
  const v = rand()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

interface Archetype {
  key: string
  weight: number
  positions: Position[][]
  per36: { fga: number; fgp: number; tpm: number; fta: number; ftp: number; reb: number; ast: number; stl: number; blk: number; tov: number }
}

const ARCHETYPES: Archetype[] = [
  { key: 'lead-guard', weight: 0.11, positions: [['PG'], ['PG', 'SG']], per36: { fga: 18.5, fgp: 0.458, tpm: 2.6, fta: 5.5, ftp: 0.86, reb: 4.8, ast: 8.2, stl: 1.4, blk: 0.3, tov: 3.3 } },
  { key: 'scoring-guard', weight: 0.13, positions: [['SG'], ['PG', 'SG'], ['SG', 'SF']], per36: { fga: 19.5, fgp: 0.452, tpm: 3.0, fta: 5.0, ftp: 0.865, reb: 4.6, ast: 4.6, stl: 1.1, blk: 0.35, tov: 2.5 } },
  { key: 'defensive-guard', weight: 0.09, positions: [['PG', 'SG'], ['SG']], per36: { fga: 11.5, fgp: 0.445, tpm: 1.8, fta: 2.2, ftp: 0.79, reb: 4.8, ast: 5.2, stl: 2.0, blk: 0.5, tov: 1.8 } },
  { key: '3d-wing', weight: 0.17, positions: [['SG', 'SF'], ['SF']], per36: { fga: 12.5, fgp: 0.452, tpm: 2.9, fta: 2.2, ftp: 0.81, reb: 5.4, ast: 2.3, stl: 1.5, blk: 0.6, tov: 1.3 } },
  { key: 'scoring-wing', weight: 0.11, positions: [['SF'], ['SF', 'PF']], per36: { fga: 19, fgp: 0.472, tpm: 2.2, fta: 6.0, ftp: 0.84, reb: 6.4, ast: 4.2, stl: 1.1, blk: 0.6, tov: 2.5 } },
  { key: 'point-forward', weight: 0.06, positions: [['SF', 'PF'], ['PF']], per36: { fga: 15.5, fgp: 0.505, tpm: 1.3, fta: 5.0, ftp: 0.74, reb: 8.4, ast: 6.6, stl: 1.3, blk: 0.8, tov: 3.1 } },
  { key: 'stretch-big', weight: 0.11, positions: [['PF', 'C'], ['PF']], per36: { fga: 14, fgp: 0.478, tpm: 2.3, fta: 3.6, ftp: 0.8, reb: 9.2, ast: 2.4, stl: 0.8, blk: 1.4, tov: 1.7 } },
  { key: 'post-big', weight: 0.06, positions: [['C'], ['PF', 'C']], per36: { fga: 15.5, fgp: 0.565, tpm: 0.4, fta: 5.8, ftp: 0.7, reb: 12.2, ast: 3.6, stl: 0.9, blk: 1.3, tov: 2.5 } },
  { key: 'rim-protector', weight: 0.08, positions: [['C']], per36: { fga: 9.5, fgp: 0.64, tpm: 0.1, fta: 4.0, ftp: 0.62, reb: 12.8, ast: 1.9, stl: 0.8, blk: 2.7, tov: 1.6 } },
  { key: 'energy-big', weight: 0.08, positions: [['PF', 'C'], ['C']], per36: { fga: 8.5, fgp: 0.585, tpm: 0.3, fta: 3.0, ftp: 0.67, reb: 11.0, ast: 1.9, stl: 1.3, blk: 1.6, tov: 1.3 } },
]

const FIRST = [
  'Arlo', 'Bram', 'Cass', 'Dario', 'Emeka', 'Fenn', 'Gus', 'Halden', 'Idris', 'Jory', 'Kato', 'Lio', 'Marek', 'Nilo', 'Oren',
  'Pax', 'Quill', 'Rafe', 'Soren', 'Tavi', 'Ulan', 'Vance', 'Wynn', 'Xavi', 'Yorke', 'Zev', 'Abel', 'Booker', 'Cyrus', 'Deni',
  'Ezra', 'Flynn', 'Grady', 'Hollis', 'Ivo', 'Jalen', 'Kenji', 'Lazar', 'Moses', 'Nash', 'Odell', 'Pierce', 'Rocco', 'Silas',
  'Teo', 'Umar', 'Vito', 'Wes', 'Yuri', 'Zane', 'Amari', 'Bodhi', 'Caius', 'Dax', 'Elio', 'Fitz', 'Gideon', 'Huck', 'Isak', 'Jude',
]
const LAST = [
  'Okafor-Lane', 'Brandvold', 'Castellano', 'Durrant', 'Eberhart', 'Falkner', 'Galloway', 'Hartigan', 'Iverholm', 'Jessup',
  'Kowalczyk', 'Lindqvist', 'Mabry', 'Novak-Reyes', 'Oduya', 'Pellegrino', 'Quarles', 'Rasmussen', 'Sutterfield', 'Tolliver',
  'Udeh', 'Vasquez-Hale', 'Whitlock', 'Yarbrough', 'Zielinski', 'Ashby', 'Beaumont', 'Calloway', 'Delacroix', 'Ellison',
  'Fairbanks', 'Greaves', 'Holloway', 'Ingram-Shaw', 'Jankovic', 'Kessler', 'Lomax', 'Merriweather', 'Nkemelu', 'Oyelaran',
  'Prescott', 'Quintero', 'Radcliffe', 'Sandoval', 'Thibodeau', 'Underhill', 'Varga', 'Wexley', 'Yoon', 'Zamora', 'Abernathy',
  'Blackwood', 'Cordero', 'Dunmore', 'Easterly', 'Fenwick', 'Gatling', 'Hawthorne', 'Ilunga', 'Juarez',
]

export interface DemoOptions {
  seed?: number
  count?: number
  season?: string
  createdAt?: string
}

const r1 = (x: number) => Math.round(x * 10) / 10
const r2 = (x: number) => Math.round(x * 100) / 100
const r3 = (x: number) => Math.round(x * 1000) / 1000

export function generateDemoDataset(opts: DemoOptions = {}): DatasetSnapshot {
  const seed = opts.seed ?? 9
  const count = opts.count ?? 280
  const season = opts.season ?? '2026-27'
  const createdAt = opts.createdAt ?? '2026-10-16T00:00:00.000Z'
  const rand = mulberry32(seed)
  const pickArch = () => {
    let x = rand()
    for (const a of ARCHETYPES) {
      x -= a.weight
      if (x <= 0) return a
    }
    return ARCHETYPES[ARCHETYPES.length - 1]
  }

  const usedNames = new Set<string>()
  const name = () => {
    for (;;) {
      const n = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`
      if (!usedNames.has(n)) {
        usedNames.add(n)
        return n
      }
    }
  }

  const records: ProjectedRecord[] = []
  for (let i = 0; i < count; i++) {
    const arch = pickArch()
    const t = Math.pow(1 - i / (count - 1), 0.9)
    const min = Math.min(37, Math.max(10, 15 + 21 * t + 2 * gaussian(rand)))
    const scale = min / 36
    const usage = 0.78 + 0.42 * t
    const n = (sd = 0.13) => Math.max(0.35, 1 + sd * gaussian(rand))
    const s = arch.per36
    const fga = Math.min(23.5, s.fga * scale * usage * n(0.1))
    const fgp = Math.min(0.72, Math.max(0.38, s.fgp + 0.012 * (t - 0.5) + 0.022 * gaussian(rand)))
    const fta = Math.min(10.5, s.fta * scale * usage * n(0.2))
    const ftp = Math.min(0.93, Math.max(0.5, s.ftp + 0.045 * gaussian(rand)))
    const fgm = fga * fgp
    const ftm = fta * ftp
    const tpm = Math.min(fgm * 0.85, s.tpm * scale * (0.85 + 0.3 * t) * n(0.18))
    const pts = 2 * fgm + tpm + ftm
    const reb = s.reb * scale * (0.85 + 0.3 * t) * n()
    const ast = s.ast * scale * usage * n()
    const stl = s.stl * scale * (0.85 + 0.3 * t) * n(0.16)
    const blk = s.blk * scale * (0.85 + 0.3 * t) * n(0.2)
    const tov = s.tov * scale * usage * n(0.12)
    const injuryProne = rand() < 0.15
    const gp = Math.round(injuryProne ? 45 + rand() * 17 : 62 + rand() * 16)
    const fullName = name()
    const positions = arch.positions[Math.floor(rand() * arch.positions.length)]
    const team = NBA_TEAMS[Math.floor(rand() * NBA_TEAMS.length)]

    const missingVolume = i % 29 === 17
    const missingGp = i % 41 === 23
    let note: string | null = null
    let riskFlag: PlayerProjection['riskFlag'] = 'none'
    if (i % 23 === 5) {
      note = 'Demo note (fictional): returning from a lower-body injury; early-season minutes may be managed.'
      riskFlag = 'injury'
    } else if (i % 31 === 11) {
      note = 'Demo note (fictional): role uncertain after an off-season signing at his position.'
      riskFlag = 'role'
    }

    const projection = finalizeProjection({
      playerId: `demo-${String(i + 1).padStart(3, '0')}`,
      season,
      source: '9dub demo generator (fictional)',
      sourceUpdatedAt: createdAt,
      gamesProjected: missingGp ? null : gp,
      minutesPerGame: r1(min),
      points: r1(pts),
      threesMade: r1(tpm),
      rebounds: r1(reb),
      assists: r1(ast),
      steals: r2(stl),
      blocks: r2(blk),
      turnovers: r1(tov),
      fieldGoalsMade: missingVolume ? null : r2(fgm),
      fieldGoalsAttempted: missingVolume ? null : r2(fga),
      freeThrowsMade: missingVolume ? null : r2(ftm),
      freeThrowsAttempted: missingVolume ? null : r2(fta),
      fieldGoalPct: r3(fgp),
      freeThrowPct: r3(ftp),
      injuryOrRoleNote: note,
      riskFlag,
      espnAdp: null,
      espnRank: null,
      sourceNineCatRank: null,
      otherAdp: null,
      otherAdpLabel: null,
      espnAdpSource: null,
      profile: null,
      gpSource: null,
      completenessFlags: [],
      raw: { archetype: arch.key },
    })
    records.push({
      identity: {
        id: projection.playerId,
        fullName,
        aliases: [],
        nbaTeam: team,
        espnId: null,
        positions,
      },
      projection,
    })
  }

  // ESPN-style ADP / rank are deliberately points-league flavoured (not 9-cat),
  // so the demo exercises the gap between market ADP and 9-cat value.
  const fp = (p: PlayerProjection) =>
    p.points + p.threesMade + 2 * (p.fieldGoalsMade ?? p.points * 0.37) - (p.fieldGoalsAttempted ?? p.points * 0.8) +
    (p.freeThrowsMade ?? 0) - (p.freeThrowsAttempted ?? 0) + p.rebounds + 2 * p.assists + 4 * p.steals + 4 * p.blocks - 2 * p.turnovers
  const adpOrder = records
    .map((r) => ({ r, s: fp(r.projection) * (0.55 + 0.45 * ((r.projection.gamesProjected ?? 70) / 82)) * Math.exp(0.08 * gaussian(rand)) }))
    .sort((a, b) => b.s - a.s)
  const noisyAdp = adpOrder.map((x, idx) => ({ r: x.r, a: (idx + 1) * Math.exp(0.1 * gaussian(rand)) + rand() }))
  noisyAdp.sort((a, b) => a.a - b.a)
  noisyAdp.forEach((x, idx) => {
    if (idx < 210) x.r.projection.espnAdp = r1(Math.max(1, x.a))
  })
  const rankOrder = records
    .map((r) => ({ r, s: fp(r.projection) * (r.projection.gamesProjected ?? 70) * Math.exp(0.06 * gaussian(rand)) }))
    .sort((a, b) => b.s - a.s)
  rankOrder.forEach((x, idx) => {
    if (idx < 250) x.r.projection.espnRank = idx + 1
  })

  // A "third-party 9-cat rank": our own per-game value plus noise, to stand in
  // for a source's 9-cat ranking column.
  const val = valuePlayers(records.map((r) => toEnginePlayer(r)!), { poolSize: 200, teams: 12, rounds: 13, fullSeasonGames: 82 })
  records
    .map((r) => ({ r, s: val.values.get(r.identity.id)!.total + 0.9 * gaussian(rand) }))
    .sort((a, b) => b.s - a.s)
    .forEach((x, idx) => (x.r.projection.sourceNineCatRank = idx + 1))

  for (const r of records) r.projection = finalizeProjection(r.projection)

  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    id: `demo-${season}-s${seed}`,
    name: 'Demo pool — fictional players',
    season,
    kind: 'demo',
    createdAt,
    sourceUpdatedAt: createdAt,
    sources: [
      {
        name: '9dub demo generator',
        url: null,
        retrievedAt: createdAt,
        fields: ['all'],
        notes: 'Synthetic, seeded, FICTIONAL players. Not real projections, ADP or injuries.',
      },
    ],
    notes:
      'Fictional demo pool for trying the app. Import real 2026–27 projections in Settings → Data (paste a table or upload CSV).',
    parentId: null,
    profiles: [],
    players: records,
  }
}

