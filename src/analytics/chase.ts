import { CATEGORIES, type Category } from './categories'
import { compareWeek, weekTotals, type CategoryCall, type WeekCall, type WeekTotals } from './matchup'

/**
 * Is a category worth chasing this week?
 *
 * The league scores head-to-head each category, so every category won counts:
 * the aim is the most categories won, and a move is worth its change in the
 * expected number of categories won (the sum of each category's model share,
 * see `CategoryCall.share`). That is the objective used by recent work on
 * fantasy-basketball valuation (normal approximation of the weekly margin per
 * category, summed across categories); applying it to one pickup for the rest
 * of a week is this module's extension.
 *
 * A pickup changes only what is still to be played: what's settled stays, the
 * remaining games are re-projected with the new player in (and the dropped one
 * out), and the uncertainty is that of the remaining games only.
 */

export type Outlook = 'safe' | 'ahead' | 'toss-up' | 'behind' | 'far-behind'

export const OUTLOOK_TEXT: Record<Outlook, string> = { safe: 'Safe', ahead: 'Ahead', 'toss-up': 'Toss-up', behind: 'Behind', 'far-behind': 'Far behind' }

/** Where a category stands, from the closeness bands (toss-up < 0.5×, lean < 1.5×, clear beyond the noise scale). */
export function outlookOf(c: CategoryCall): Outlook | null {
  if (!c.winner || !c.closeness) return null
  if (c.winner === 'tie' || c.closeness === 'toss-up') return 'toss-up'
  if (c.winner === 'me') return c.closeness === 'clear' ? 'safe' : 'ahead'
  return c.closeness === 'clear' ? 'far-behind' : 'behind'
}

/** One pickup must lift a category's share by at least this much to call it worth chasing. */
export const CHASE_MIN_GAIN = 0.15

export type ChaseVerdict = 'chase' | 'let-go'

/** Chase = a single pickup clearly improves a category you're not already winning; let go = you're behind and none does. */
export function chaseVerdict(now: CategoryCall, bestShare: number | null): ChaseVerdict | null {
  const o = outlookOf(now)
  if (o == null || o === 'safe' || o === 'ahead' || now.share == null) return null
  if (bestShare != null && bestShare - now.share >= CHASE_MIN_GAIN) return 'chase'
  return o === 'toss-up' ? null : 'let-go'
}

const COUNTS = ['pts', 'tpm', 'reb', 'ast', 'stl', 'blk', 'tov', 'fgm', 'fga', 'ftm', 'fta'] as const

/** a − b on the counting fields (percentages recomputed). */
export function subtractTotals(a: WeekTotals, b: WeekTotals): WeekTotals {
  const out = {} as Omit<WeekTotals, 'fgPct' | 'ftPct'>
  for (const k of COUNTS) out[k] = a[k] - b[k]
  return weekTotals(out)
}

/** a + b on the counting fields. */
function plus(a: WeekTotals, b: WeekTotals): WeekTotals {
  const out = {} as Omit<WeekTotals, 'fgPct' | 'ftPct'>
  for (const k of COUNTS) out[k] = a[k] + b[k]
  return weekTotals(out)
}

export interface ChaseBase {
  /** Projected (or settled + projected) week totals. */
  me: WeekTotals
  them: WeekTotals
  /** The part of each total still to be played. */
  restMe: WeekTotals
  restThem: WeekTotals
  /** Totals so far are real (ESPN): uncertainty comes from the remaining games only. */
  live: boolean
}

export interface PickupInput {
  id: string
  /** Games he would start for you in the rest of the week. */
  starts: number
  /** My remaining totals with him in (and the drop out). */
  restMe: WeekTotals
}

export interface PickupResult {
  id: string
  starts: number
  call: WeekCall
  /** Change in expected categories won — for ranking only, never shown as a number. */
  gain: number
  /** Change in my remaining totals. */
  adds: WeekTotals
}

const expectedWins = (w: WeekCall) => w.calls.reduce((s, c) => s + (c.share ?? 0), 0)

/** Re-score the week for each pickup and rank them by the change in expected categories won. */
export function rankPickups(base: ChaseBase, options: readonly PickupInput[]): { baseCall: WeekCall; results: PickupResult[] } {
  const rest = (restMe: WeekTotals) => (base.live ? { me: restMe, them: base.restThem } : undefined)
  const baseCall = compareWeek(base.me, base.them, rest(base.restMe))
  const settled = subtractTotals(base.me, base.restMe)
  const e0 = expectedWins(baseCall)
  const results = options.map((o) => {
    const me = plus(settled, o.restMe)
    const call = compareWeek(me, base.them, rest(o.restMe))
    return { id: o.id, starts: o.starts, call, gain: expectedWins(call) - e0, adds: subtractTotals(o.restMe, base.restMe) }
  })
  results.sort((a, b) => b.gain - a.gain)
  return { baseCall, results }
}

export interface BestForCategory {
  id: string
  share: number
  /** That pickup's change in my final total (percentage points for FG% / FT%). */
  add: number
}

/** For each category, the single pickup that helps it most. */
export function bestPerCategory(baseCall: WeekCall, results: readonly PickupResult[]): Partial<Record<Category, BestForCategory>> {
  const out: Partial<Record<Category, BestForCategory>> = {}
  for (const cat of CATEGORIES) {
    const i = CATEGORIES.indexOf(cat)
    const before = baseCall.calls[i]
    for (const r of results) {
      const c = r.call.calls[i]
      if (c.share == null) continue
      if (!out[cat] || c.share > out[cat]!.share) {
        const add = cat === 'FG' || cat === 'FT' ? ((c.mine ?? 0) - (before.mine ?? 0)) * 100 : (c.mine ?? 0) - (before.mine ?? 0)
        out[cat] = { id: r.id, share: c.share, add }
      }
    }
  }
  return out
}
