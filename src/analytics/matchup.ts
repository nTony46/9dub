import { CATEGORIES, type Category } from './categories'
import { normalCdf } from './math'
import { ESPN_DEFAULT_SLOTS, POSITIONS, fillLineup, type Position, type SlotDef } from './positions'
import type { StatLine } from './types'

/**
 * Weekly head-to-head projection.
 *
 * Every day the lineup is set automatically, like ESPN's Quick Lineup: each
 * player whose NBA team plays (and who isn't marked out) goes into the
 * starting slots (ESPN default: PG SG SF PF C G F UTIL×3) by maximum
 * matching, best players first. Only when more players have games than the
 * slots can hold does anyone sit, and then it is the lowest-value player who
 * fits nowhere. Started games × per-game projection = the week's totals;
 * FG% / FT% are total makes ÷ total attempts.
 *
 * Category calls are deterministic: the side with the better projected total
 * wins. "Toss-up / lean / clear" compares the margin with a rough weekly noise
 * scale (Poisson for counts, binomial for percentages). It is a closeness
 * label, not a calibrated win probability.
 */

export interface MatchupPlayer {
  id: string
  nbaTeam: string | null
  positions: readonly Position[]
  /** Per-game projection; null = no projection (never counted). */
  line: StatLine | null
  /** Lower = started first when the lineup is full (e.g. 9-cat value rank). */
  priority: number
  /** Expected share of games played (1 = healthy). */
  availability?: number
  /** Marked out through this date (inclusive); null = until further notice; undefined = healthy. */
  outThrough?: string | null
}

export function isOutOn(p: Pick<MatchupPlayer, 'outThrough'>, date: string): boolean {
  return p.outThrough !== undefined && (p.outThrough === null || date <= p.outThrough)
}

export interface WeekTotals {
  pts: number
  tpm: number
  reb: number
  ast: number
  stl: number
  blk: number
  tov: number
  fgm: number
  fga: number
  ftm: number
  fta: number
  fgPct: number | null
  ftPct: number | null
}

export interface PlayerWeek {
  id: string
  /** Games he is available for. */
  games: number
  starts: number
  benched: number
  /** Games his team plays while he is marked out. */
  missed: number
}

export interface DaySlate {
  date: string
  /**
   * Starting slots in ESPN order, the way ESPN shows them: players with a game
   * first (they are the ones who count), then the remaining slots filled with
   * players who have no game today (`playing: false`). null = nobody fits.
   */
  lineup: { slot: string; id: string | null; playing: boolean }[]
  /** Players with a game in a starting slot (these count). */
  started: string[]
  /** Had a game but every slot he fits was taken. */
  benched: string[]
  /** No game today (or no projection). */
  idle: string[]
  /** Who sits on the bench: benched players with a game first, then idle players not needed in a slot. */
  bench: string[]
  /** Marked out today. */
  out: string[]
  /** Starting seats nobody with a game fills. */
  open: number
  /** Positions that would add a start today (a player of that position fits an open seat). */
  fits: Position[]
}

export interface SideProjection {
  totals: WeekTotals
  players: Map<string, PlayerWeek>
  /** Scheduled games of projected players. */
  games: number
  /** Games in an active lineup slot (what counts). */
  starts: number
  /** Games lost to a full lineup. */
  benched: number
  days: DaySlate[]
  /** Rostered players without a projection (shown, never counted). */
  noProjection: string[]
  /** Players whose source has no shooting volume (left out of FG% / FT%). */
  missingVolume: { fg: string[]; ft: string[] }
}

const emptyTotals = (): WeekTotals => ({ pts: 0, tpm: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, fgPct: null, ftPct: null })

/** Counting totals (makes and attempts included) → week totals with FG% / FT% computed. */
export function weekTotals(c: Omit<WeekTotals, 'fgPct' | 'ftPct'>): WeekTotals {
  return { ...c, fgPct: c.fga > 0 ? c.fgm / c.fga : null, ftPct: c.fta > 0 ? c.ftm / c.fta : null }
}

/** Sum of two totals (e.g. what's happened so far + what's still to play); percentages from the summed makes and attempts. */
export function addTotals(a: WeekTotals, b: WeekTotals): WeekTotals {
  return weekTotals({
    pts: a.pts + b.pts,
    tpm: a.tpm + b.tpm,
    reb: a.reb + b.reb,
    ast: a.ast + b.ast,
    stl: a.stl + b.stl,
    blk: a.blk + b.blk,
    tov: a.tov + b.tov,
    fgm: a.fgm + b.fgm,
    fga: a.fga + b.fga,
    ftm: a.ftm + b.ftm,
    fta: a.fta + b.fta,
  })
}

export function projectSide(
  players: readonly MatchupPlayer[],
  dates: readonly string[],
  playing: (date: string) => ReadonlySet<string> | undefined,
  slots: readonly SlotDef[] = ESPN_DEFAULT_SLOTS,
  /** Each player's usual starting slot (index into the starter slots), for a stable displayed lineup. */
  home?: ReadonlyMap<string, number>,
): SideProjection {
  const starters = slots.filter((s) => s.starter)
  /** Starter slot indices, position-specific slots first (PG … C, then G/F, then UTIL). */
  const slotOrder = [...starters.keys()].sort((a, b) => (starters[a].accepts.length || 99) - (starters[b].accepts.length || 99))
  const ordered = [...players].sort((a, b) => (a.line ? 0 : 1) - (b.line ? 0 : 1) || a.priority - b.priority)
  const weeks = new Map<string, PlayerWeek>(players.map((p) => [p.id, { id: p.id, games: 0, starts: 0, benched: 0, missed: 0 }]))
  const t = emptyTotals()
  const days: DaySlate[] = []
  let games = 0
  let starts = 0
  for (const date of dates) {
    const teams = playing(date)
    const day: DaySlate = { date, lineup: [], started: [], benched: [], idle: [], bench: [], out: [], open: 0, fits: [] }
    const active: MatchupPlayer[] = []
    const idle: MatchupPlayer[] = []
    for (const p of ordered) {
      const hasGame = !!(teams && p.nbaTeam && teams.has(p.nbaTeam))
      if (isOutOn(p, date)) {
        day.out.push(p.id)
        if (hasGame && p.line) weeks.get(p.id)!.missed++
      } else if (hasGame && p.line) active.push(p)
      else {
        day.idle.push(p.id)
        idle.push(p)
      }
    }
    const fill = fillLineup(
      active.map((p) => ({ id: p.id, positions: p.positions })),
      starters,
    )
    const started = new Set(fill.assignment.filter((x): x is string => x != null))
    day.open = starters.length - started.size
    if (day.open > 0) {
      // A probe player of one position, added last, starts only if he lengthens the best lineup.
      const base = active.map((p) => ({ id: p.id, positions: p.positions }))
      day.fits = POSITIONS.filter((pos) => fillLineup([...base, { id: '__probe', positions: [pos] }], starters).assignment.includes('__probe'))
    }
    // Display lineup, as on ESPN's roster page: the players who start (with a game) are placed first,
    // each in his usual slot where possible; bench players with a game move into slots whose usual
    // player has none. Players without a game then fill what's left, usual slot first.
    const homeFirst = (a: MatchupPlayer, b: MatchupPlayer) => (home?.has(a.id) ? 0 : 1) - (home?.has(b.id) ? 0 : 1) || a.priority - b.priority
    const owner = fillLineup(
      active
        .filter((p) => started.has(p.id))
        .sort(homeFirst)
        .map((p) => ({ id: p.id, positions: p.positions })),
      starters,
      (id) => home?.get(id),
    ).assignment
    // Players without a game only take seats that are still empty (usual seat first) — they never
    // push the players who are actually playing around.
    const fits = (i: number, p: MatchupPlayer) => owner[i] == null && (starters[i].accepts.length === 0 || starters[i].accepts.some((x) => p.positions.includes(x)))
    const waiting: MatchupPlayer[] = []
    for (const p of [...idle].sort(homeFirst)) {
      const own = home?.get(p.id)
      if (own != null && own < starters.length && fits(own, p)) owner[own] = p.id
      else waiting.push(p)
    }
    for (const p of waiting) {
      const i = slotOrder.find((k) => fits(k, p))
      if (i != null) owner[i] = p.id
    }
    day.lineup = starters.map((s, i) => ({ slot: s.label, id: owner[i], playing: owner[i] != null && started.has(owner[i]!) }))
    const inSlot = new Set(owner.filter((x): x is string => x != null))
    for (const p of active) {
      const w = weeks.get(p.id)!
      w.games++
      games++
      if (!started.has(p.id)) {
        w.benched++
        day.benched.push(p.id)
        continue
      }
      w.starts++
      starts++
      day.started.push(p.id)
      const a = p.availability ?? 1
      const l = p.line!
      t.pts += a * l.pts
      t.tpm += a * l.tpm
      t.reb += a * l.reb
      t.ast += a * l.ast
      t.stl += a * l.stl
      t.blk += a * l.blk
      t.tov += a * l.tov
      if (l.fga != null && l.fgm != null && l.fga > 0) {
        t.fgm += a * l.fgm
        t.fga += a * l.fga
      }
      if (l.fta != null && l.ftm != null && l.fta > 0) {
        t.ftm += a * l.ftm
        t.fta += a * l.fta
      }
    }
    day.bench = [...day.benched, ...day.idle.filter((id) => !inSlot.has(id))]
    days.push(day)
  }
  t.fgPct = t.fga > 0 ? t.fgm / t.fga : null
  t.ftPct = t.fta > 0 ? t.ftm / t.fta : null
  return {
    totals: t,
    players: weeks,
    games,
    starts,
    benched: games - starts,
    days,
    noProjection: players.filter((p) => !p.line).map((p) => p.id),
    missingVolume: {
      fg: ordered.filter((p) => p.line && !(p.line.fga && p.line.fgm != null)).map((p) => p.id),
      ft: ordered.filter((p) => p.line && !(p.line.fta && p.line.ftm != null)).map((p) => p.id),
    },
  }
}

export type Closeness = 'toss-up' | 'lean' | 'clear'

export interface CategoryCall {
  cat: Category
  mine: number | null
  theirs: number | null
  /** My advantage in category units (positive = ahead; TO is sign-flipped so fewer is better). */
  edge: number | null
  /** Rough weekly noise scale of the difference (same units). */
  noise: number | null
  winner: 'me' | 'them' | 'tie' | null
  closeness: Closeness | null
  /** What it takes to flip a category I'm projected to lose or tie. */
  flip: string | null
  /**
   * Model share of this category I'd take (win = 1, tie = ½), from a normal
   * approximation of the final margin. Used to rank options and pick labels —
   * never shown as a number (it is not calibrated against real results).
   */
  share: number | null
}

export interface WeekCall {
  calls: CategoryCall[]
  wins: number
  losses: number
  ties: number
}

const COUNT_KEY: Record<Exclude<Category, 'FG' | 'FT'>, keyof WeekTotals> = { '3PM': 'tpm', PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk', TO: 'tov' }

/** Points per made basket squared over points per made basket for a typical line (fallback when makes are unknown). */
const PTS_SPREAD_FALLBACK = 2.3

/**
 * Week-total variance of a counting category for production still to come.
 * Every made basket, rebound, steal… is treated as an independent rare event,
 * so a total's variance equals its mean (Poisson). Points are a weighted sum
 * of made 2s, 3s and free throws, so their variance is 4·2PM + 9·3PM + 1·FTM
 * (compound Poisson) — about 2.3× the points total for a typical scorer.
 */
export function countVariance(t: WeekTotals, cat: Exclude<Category, 'FG' | 'FT'>): number {
  if (cat !== 'PTS') return Math.max(0, t[COUNT_KEY[cat]] as number)
  const twos = Math.max(0, t.fgm - t.tpm)
  const made = 2 * twos + 3 * t.tpm + t.ftm
  const ratio = made > 0 ? (4 * twos + 9 * t.tpm + t.ftm) / made : PTS_SPREAD_FALLBACK
  return Math.max(0, t.pts) * ratio
}

const shareOf = (edge: number, noise: number) => (noise > 0 ? normalCdf(edge / noise) : edge > 1e-9 ? 1 : edge < -1e-9 ? 0 : 0.5)

export function closenessOf(edge: number, noise: number): Closeness {
  const z = noise > 0 ? Math.abs(edge) / noise : Infinity
  return z < 0.5 ? 'toss-up' : z < 1.5 ? 'lean' : 'clear'
}

function pctCall(cat: 'FG' | 'FT', me: WeekTotals, them: WeekTotals, rest?: { me: WeekTotals; them: WeekTotals }): CategoryCall {
  const [m, a] = cat === 'FG' ? [me.fgm, me.fga] : [me.ftm, me.fta]
  const [tm, ta] = cat === 'FG' ? [them.fgm, them.fga] : [them.ftm, them.fta]
  const p = a > 0 ? m / a : null
  const q = ta > 0 ? tm / ta : null
  if (p == null || q == null) return { cat, mine: p, theirs: q, edge: null, noise: null, winner: null, closeness: null, flip: null, share: null }
  const edge = p - q
  // Binomial spread of the attempts still to come, as a share of all the week's attempts.
  const ra = rest ? (cat === 'FG' ? rest.me.fga : rest.me.fta) : a
  const rta = rest ? (cat === 'FG' ? rest.them.fga : rest.them.fta) : ta
  const noise = Math.sqrt((ra * p * (1 - p)) / (a * a) + (rta * q * (1 - q)) / (ta * ta))
  const winner = Math.abs(edge) < 1e-9 ? 'tie' : edge > 0 ? 'me' : 'them'
  const need = q * a - m
  const flip = winner === 'me' ? null : `+${Math.max(0.1, need).toFixed(1)} ${cat === 'FG' ? 'FGM' : 'FTM'} on the same attempts`
  return { cat, mine: p, theirs: q, edge, noise, winner, closeness: closenessOf(edge, noise), flip, share: shareOf(edge, noise) }
}

/**
 * Category calls for two week totals. With `rest` (the part of each total
 * still to be played — the rest is already in the books), the noise scale only
 * counts what can still change.
 */
export function compareWeek(me: WeekTotals, them: WeekTotals, rest?: { me: WeekTotals; them: WeekTotals }): WeekCall {
  const calls: CategoryCall[] = CATEGORIES.map((cat) => {
    if (cat === 'FG' || cat === 'FT') return pctCall(cat, me, them, rest)
    const k = COUNT_KEY[cat]
    const mine = me[k] as number
    const theirs = them[k] as number
    const edge = cat === 'TO' ? theirs - mine : mine - theirs
    const noise = Math.sqrt(countVariance(rest?.me ?? me, cat) + countVariance(rest?.them ?? them, cat))
    const winner = Math.abs(edge) < 1e-9 ? 'tie' : edge > 0 ? 'me' : 'them'
    const flip = winner === 'me' ? null : `${cat === 'TO' ? '−' : '+'}${Math.max(0.1, Math.abs(edge)).toFixed(1)} ${cat}`
    return { cat, mine, theirs, edge, noise, winner, closeness: closenessOf(edge, noise), flip, share: shareOf(edge, noise) }
  })
  return {
    calls,
    wins: calls.filter((c) => c.winner === 'me').length,
    losses: calls.filter((c) => c.winner === 'them').length,
    ties: calls.filter((c) => c.winner === 'tie').length,
  }
}

/** "5–4" or "5–3–1". */
export function scoreText(w: Pick<WeekCall, 'wins' | 'losses' | 'ties'>): string {
  return `${w.wins}–${w.losses}${w.ties ? `–${w.ties}` : ''}`
}
