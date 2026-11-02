import { ArrowLeftRight, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CATEGORIES, CATEGORY_META, type Category } from '@/analytics/categories'
import type { StatLine } from '@/analytics/types'
import { Positions } from '@/components/PlayerBits'
import { Badge } from '@/components/ui/Badge'
import { Button, IconButton } from '@/components/ui/Button'
import { Input, Segmented, Select } from '@/components/ui/Controls'
import { Empty, Panel } from '@/components/ui/Panel'
import { Tip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { divergingFill, signClass } from '@/lib/diverging'
import { normalizeName } from '@/data/normalize'
import { useApp } from '@/store/appStore'
import { teamLabel, useEngine, useLineupSlots, type EngineData } from '@/store/derived'
import { irPlacement, todayIso } from '@/store/season'
import {
  applyLab,
  finishedWeeks,
  labLineFor,
  labPlayers,
  labWeeks,
  leagueMetrics,
  lineValues,
  overallRank,
  strongest,
  teamWeeks,
  tierOf,
  volumeFactors,
  type LabBasis,
  type LabChange,
  type LabMetrics,
  type LabTrade,
} from './lab'
import { useCurrentRosters, useInjuries, useScheduleIndex, type ProjectionOptions } from './model'

const ord = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th')
const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const TIER = { win: { label: 'Win', text: 'text-good' }, swing: { label: 'Swing', text: 'text-warn' }, punt: { label: 'Punt', text: 'text-bad' } } as const
/** Heat fills: each category's weekly totals as z-scores across the league (fewer turnovers = better), full color at 1.2 SD. */
const HEAT_SCALE = 1.2
const HEAT_MAX = 0.7
const weeklyText = (c: Category, v: number) => (c === 'FG' || c === 'FT' ? v.toFixed(3).replace(/^0/, '') : `${c === 'PTS' ? v.toFixed(0) : v.toFixed(1)}/wk`)

/** Every team's z-score in each category (sign: better = positive) and in categories won per matchup. */
function heatOf(m: LabMetrics): { cats: Record<Category, number>; strength: number }[] {
  const z = (xs: number[]) => {
    const mu = xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, xs.length)) || 1
    return xs.map((x) => (x - mu) / sd)
  }
  const byCat = Object.fromEntries(CATEGORIES.map((c) => [c, z(m.teams.map((t) => (c === 'TO' ? -t.weekly[c] : t.weekly[c])))])) as Record<Category, number[]>
  const strength = z(m.strength)
  return m.teams.map((_, t) => ({ cats: Object.fromEntries(CATEGORIES.map((c) => [c, byCat[c][t]])) as Record<Category, number>, strength: strength[t] }))
}

/**
 * Roster Lab: try waiver pickups (any of your players for any free agent or
 * waiver player, as many changes as you like) and a trade, and see how your
 * league ranks and matchup odds move over the rest of the regular season.
 */
export function RosterLab() {
  const engine = useEngine()
  const settings = useApp((s) => s.settings)
  const espn = useApp((s) => s.season.espn)
  const weeks = useApp((s) => s.season.matchups)
  const injuriesList = useApp((s) => s.season.injuries)
  const index = useScheduleIndex()
  const slots = useLineupSlots()
  const injuries = useInjuries()
  const { rosters } = useCurrentRosters()
  const me = settings.userSlot != null && settings.userSlot <= settings.teams ? settings.userSlot - 1 : null
  const today = todayIso()
  const [basisPick, setBasis] = useState<LabBasis>('season')
  const [changes, setChanges] = useState<LabChange[]>([{ drop: null, add: null }])
  const [trade, setTrade] = useState<LabTrade | null>(null)

  const active = useMemo(() => rosters.map((r) => irPlacement(r, injuriesList, settings.irSlots, today).active), [rosters, injuriesList, settings.irSlots, today])
  // The season basis needs this season's stats for (nearly) every rostered player; syncs before the Roster Lab kept only some.
  const hasStats = useMemo(() => {
    const ids = active.flat()
    return ids.length > 0 && ids.filter((id) => espn?.stats?.[id]).length >= 0.8 * ids.length
  }, [active, espn?.stats])
  const basis: LabBasis = hasStats ? basisPick : 'projection'
  const available = useMemo(() => Object.entries(espn?.stats ?? {}).filter(([id, s]) => s.available && engine?.byId.has(id)).map(([id]) => id), [espn?.stats, engine])
  const opts = useMemo<ProjectionOptions>(() => ({ availability: false, injuries, slots, lineups: espn?.lineups ?? null }), [injuries, slots, espn?.lineups])
  const lab = useMemo(() => {
    if (!engine || !index || me == null) return null
    const playing = (d: string) => index.byDate.get(d)
    const lineFor = labLineFor(espn?.stats, basis)
    const seasonLines = labLineFor(espn?.stats, 'season')
    const pool = new Set([...active.flat(), ...available])
    const lineOf = (f: (id: string) => StatLine | null) => new Map([...pool].map((id) => [id, f(id) ?? engine.byId.get(id)?.line ?? null] as const).filter((x): x is [string, StatLine] => x[1] != null))
    const values = lineValues(lineOf(lineFor))
    const seasonValues = lineValues(lineOf(seasonLines))
    const value = (id: string) => values.get(id) ?? -99
    const all = labWeeks(weeks, today)
    // How much each team actually plays (streaming, full lineups), measured with this season's lines so either basis gets the same factor.
    const fin = finishedWeeks(weeks, espn?.results, today)
    const volume = hasStats ? volumeFactors(active.map((r) => labPlayers(r, engine, opts, seasonLines, (id) => seasonValues.get(id) ?? -99)), fin, playing, slots) : active.map(() => 1)
    const project = (ids: readonly string[], t: number) => teamWeeks(labPlayers(ids, engine, opts, lineFor, value), all, playing, slots, volume[t])
    const base = active.map((r, t) => project(r, t))
    const metrics = leagueMetrics(base, me)
    return { lineFor, value, base, metrics, top4: strongest(metrics.strength, me, 4), project, weeks: all.length, finished: fin.length, volume }
  }, [engine, index, me, espn?.stats, espn?.results, basis, active, available, weeks, today, opts, slots, hasStats])

  const scenario = useMemo(() => {
    if (!lab || me == null) return null
    const valid = changes.filter((c) => c.add)
    const t = trade && (trade.give.length || trade.get.length) ? trade : null
    if (!valid.length && !t) return null
    const ros = applyLab(active, me, valid, t)
    const weeksNow = lab.base.map((w, k) => (k === me || k === t?.team ? lab.project(ros[k], k) : w))
    return { metrics: leagueMetrics(weeksNow, me, lab.top4), partner: t?.team ?? null, rosters: ros }
  }, [lab, me, changes, trade, active])

  if (!engine) return <Empty title="No player data loaded" />
  if (me == null) return <Empty title="Pick your team first">Set your draft slot in Settings → League to try roster changes.</Empty>
  if (!index || !weeks.length || !lab) return <Empty title="No schedule yet">The Roster Lab needs the NBA schedule and your league’s matchup weeks (sync ESPN, or add them under Matchups).</Empty>
  if (!lab.weeks) return <Empty title="The regular season is over">There are no regular-season weeks left to project.</Empty>
  if (!active[me]?.length) return <Empty title="Your roster is empty">Sync ESPN, or add your players under Rosters, to try changes.</Empty>

  const mine = active[me]
  const name = (id: string) => engine.byId.get(id)?.name ?? id
  const used = new Set([...changes.flatMap((c) => [c.drop, c.add]), ...(trade?.give ?? []), ...(trade?.get ?? [])].filter((x): x is string => !!x))
  const setChange = (i: number, patch: Partial<LabChange>) => setChanges((cs) => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)))
  const reset = () => {
    setChanges([{ drop: null, add: null }])
    setTrade(null)
  }
  const after = scenario?.metrics ?? null
  const base = lab.metrics

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="max-w-[860px] text-[13px] leading-snug text-chalk-3">
          Try pickups and a trade, then see how your league ranks and matchup odds move over the rest of the regular season ({lab.weeks} week{lab.weeks === 1 ? '' : 's'}): every team’s weeks are projected
          with the daily lineup engine on the real NBA schedule and compared category by category with every other team.
        </p>
        <div className="ml-auto flex items-center gap-2">
          {hasStats ? (
            <Segmented<LabBasis>
              label="Stat basis"
              value={basis}
              onChange={setBasis}
              options={[
                { value: 'season', label: 'This season', title: "ESPN's actual stats this season, blended toward last season for the noisy categories" },
                { value: 'projection', label: 'Projections', title: "9dub's projections" },
              ]}
            />
          ) : (
            <span className="text-[12.5px] text-chalk-3">Projections · Refresh from ESPN for this season’s stats</span>
          )}
          <Button variant="subtle" size="sm" onClick={reset} disabled={!scenario}>
            Reset
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Roster changes" subtitle="Drop any of your players for any free agent or waiver player. Changes stack.">
          <div className="space-y-2">
            {changes.map((c, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2" data-testid={`lab-change-${i}`}>
                <Select aria-label="Player to drop" value={c.drop ?? ''} onChange={(e) => setChange(i, { drop: e.target.value || null })} className="min-w-[190px] flex-1">
                  <option value="">Nobody (an open spot)</option>
                  {mine
                    .filter((id) => id === c.drop || !used.has(id))
                    .sort((a, b) => name(a).localeCompare(name(b)))
                    .map((id) => (
                      <option key={id} value={id}>
                        Drop {name(id)}
                      </option>
                    ))}
                </Select>
                <span className="hidden text-[12px] text-chalk-4 sm:inline">→</span>
                <div className="min-w-[220px] flex-[1.4]">
                  {c.add ? (
                    <div className="flex h-8 items-center gap-2 rounded-md border border-seam bg-well px-2 text-[12.5px]">
                      <span className="truncate font-medium text-chalk">{name(c.add)}</span>
                      <WaiverTag stats={espn?.stats?.[c.add]} />
                      <IconButton label="Clear pickup" className="ml-auto" onClick={() => setChange(i, { add: null })}>
                        <X size={13} />
                      </IconButton>
                    </div>
                  ) : (
                    <FreeAgentPicker engine={engine} pool={available.filter((id) => !used.has(id))} value={lab.value} lineFor={lab.lineFor} stats={espn?.stats} onPick={(id) => setChange(i, { add: id })} />
                  )}
                </div>
                <IconButton label="Remove this change" onClick={() => setChanges((cs) => (cs.length === 1 ? [{ drop: null, add: null }] : cs.filter((_, k) => k !== i)))}>
                  <X size={14} />
                </IconButton>
              </div>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setChanges((cs) => [...cs, { drop: null, add: null }])} data-testid="lab-add-change">
              <Plus size={14} /> Add another change
            </Button>
          </div>
        </Panel>

        <Panel title="See how a trade performs" subtitle="Players move both ways, so the other team’s weeks change too, and so do your ranks against them.">
          <TradeBuilder engine={engine} me={me} rosters={active} trade={trade} setTrade={setTrade} used={used} teamName={(t) => teamLabel(settings, t)} />
        </Panel>
      </div>

      <Results base={base} after={after} teams={settings.teams} me={me} />

      <LeagueTable
        base={base}
        after={after}
        me={me}
        partner={scenario?.partner ?? null}
        players={(scenario?.rosters ?? active).map((r) => r.length)}
        teamName={(t) => teamLabel(settings, t)}
      />


      <p className="text-[12px] leading-snug text-chalk-4">
        {basis === 'season'
          ? 'This season: ESPN’s actual minutes and per-minute production; steals, blocks, threes and shooting lean more on last season while the sample is small.'
          : 'Projections: 9dub’s projections for everyone.'}{' '}
        {lab.finished
          ? `Each team’s weeks are scaled by how much it has actually played in the ${lab.finished} finished week${lab.finished === 1 ? '' : 's'} (streaming, full lineups), within ±25%. `
          : ''}
        Ranks compare average weekly totals among all {settings.teams} teams; win rates are model estimates that compare options, not exact odds. Differences under about 3 points are noise. Injury returns and role changes aren’t modeled.
      </p>
    </div>
  )
}

function WaiverTag({ stats }: { stats: { waiverClears: string | null } | undefined }) {
  const [now] = useState(() => Date.now())
  if (!stats?.waiverClears || Date.parse(stats.waiverClears) <= now) return <Badge tone="outline">FA</Badge>
  const d = new Date(stats.waiverClears)
  return <Badge tone="warn">Waivers · {d.toLocaleDateString('en-US', { weekday: 'short' })}</Badge>
}

const lineText = (l: StatLine | null | undefined) => (l ? `${l.pts.toFixed(1)}p ${l.reb.toFixed(1)}r ${l.ast.toFixed(1)}a ${l.stl.toFixed(1)}s ${l.blk.toFixed(1)}b ${l.tpm.toFixed(1)} 3pm` : '')

/** Search the free agents and waiver players; with no search, the best on the current basis. */
function FreeAgentPicker({
  engine,
  pool,
  value,
  lineFor,
  stats,
  onPick,
}: {
  engine: EngineData
  pool: readonly string[]
  value: (id: string) => number
  lineFor: (id: string) => StatLine | null
  stats: Record<string, { waiverClears: string | null }> | undefined
  onPick: (id: string) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const results = useMemo(() => {
    const k = normalizeName(q)
    return pool
      .filter((id) => !k || normalizeName(engine.byId.get(id)?.name ?? '').includes(k))
      .sort((a, b) => value(b) - value(a))
      .slice(0, 8)
  }, [pool, q, engine, value])
  return (
    <div className="relative">
      <Input
        value={q}
        placeholder="Add a free agent or waiver player…"
        aria-label="Player to add"
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) onPick(results[0])
          if (e.key === 'Escape') setOpen(false)
        }}
        data-testid="lab-add-search"
      />
      {open && results.length ? (
        <ul role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[300px] overflow-y-auto rounded-md border border-seam-strong bg-booth py-1 shadow-lg">
          {results.map((id) => {
            const p = engine.byId.get(id)
            return (
              <li key={id} role="option" aria-selected={false}>
                <button type="button" className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] hover:bg-stand" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(id)}>
                  <span className="font-medium text-chalk">{p?.name ?? id}</span>
                  <span className="text-chalk-4">{p?.team ?? 'FA'}</span>
                  <Positions positions={p?.positions ?? []} />
                  <WaiverTag stats={stats?.[id]} />
                  <span className="ml-auto whitespace-nowrap font-mono text-[11.5px] text-chalk-3">{lineText(lineFor(id) ?? p?.line)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function TradeBuilder({
  engine,
  me,
  rosters,
  trade,
  setTrade,
  used,
  teamName,
}: {
  engine: EngineData
  me: number
  rosters: string[][]
  trade: LabTrade | null
  setTrade: (t: LabTrade | null) => void
  used: Set<string>
  teamName: (t: number) => string
}) {
  const name = (id: string) => engine.byId.get(id)?.name ?? id
  const others = rosters.map((_, t) => t).filter((t) => t !== me)
  const toggle = (side: 'give' | 'get', id: string) => {
    if (!trade) return
    const list = trade[side]
    setTrade({ ...trade, [side]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id] })
  }
  const chips = (ids: readonly string[], side: 'give' | 'get') => (
    <div className="flex flex-wrap gap-1.5">
      {[...ids]
        .sort((a, b) => name(a).localeCompare(name(b)))
        .map((id) => {
          const on = trade?.[side].includes(id) ?? false
          const blocked = !on && side === 'give' && used.has(id)
          return (
            <button
              key={id}
              type="button"
              disabled={blocked}
              aria-pressed={on}
              onClick={() => toggle(side, id)}
              className={cn(
                'h-7 rounded-full border px-2.5 text-[12.5px] transition-colors',
                on ? 'border-clock-line bg-clock-soft text-clock' : 'border-seam bg-well text-chalk-2 hover:text-chalk',
                blocked && 'opacity-40',
              )}
            >
              {name(id)}
            </button>
          )
        })}
    </div>
  )
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ArrowLeftRight size={14} className="text-chalk-4" />
        <Select aria-label="Trade partner" value={trade?.team ?? ''} onChange={(e) => setTrade(e.target.value === '' ? null : { team: Number(e.target.value), give: [], get: [] })} className="min-w-[220px]">
          <option value="">Pick a team…</option>
          {others.map((t) => (
            <option key={t} value={t}>
              {teamName(t)}
            </option>
          ))}
        </Select>
        {trade ? (
          <Button variant="ghost" size="xs" onClick={() => setTrade(null)}>
            Clear trade
          </Button>
        ) : null}
      </div>
      {trade ? (
        <>
          <div>
            <div className="label-caps mb-1.5">You give</div>
            {chips(rosters[me], 'give')}
          </div>
          <div>
            <div className="label-caps mb-1.5">You get</div>
            {chips(rosters[trade.team] ?? [], 'get')}
          </div>
        </>
      ) : (
        <p className="text-[12.5px] text-chalk-4">Pick a team, then the players each side sends. Acceptance isn’t judged, only what the trade does to the numbers.</p>
      )}
    </div>
  )
}

function Results({ base, after, teams, me }: { base: LabMetrics; after: LabMetrics | null; teams: number; me: number }) {
  const m = after ?? base
  const z = useMemo(() => heatOf(m), [m])
  const opponents = teams - 1
  const delta = (x: number, digits = 1, suffix = '') =>
    Math.abs(x) < 1e-9 ? <span className="text-chalk-4">no change</span> : <span className={signClass(x)}>{`${x > 0 ? '+' : '−'}${Math.abs(x).toFixed(digits)}${suffix}`}</span>
  const rankDelta = (b: number, a: number) => (b === a ? null : <span className={cn('ml-1 text-[11.5px] font-semibold', b > a ? 'text-plus' : 'text-minus')}>{b > a ? `▲${b - a}` : `▼${a - b}`}</span>)
  const cards: [string, string, React.ReactNode][] = [
    ['Win 5+ categories', pct(m.p5), delta((m.p5 - base.p5) * 100)],
    ['Win 6+ categories', pct(m.p6), delta((m.p6 - base.p6) * 100)],
    ['Win 5+ vs the top four', pct(m.top4), delta((m.top4 - base.top4) * 100)],
    ['Categories won per matchup', `${m.cpm.toFixed(2)} of 9`, delta(m.cpm - base.cpm, 2)],
    ['Overall league rank', `${ord(m.overall)} of ${teams}`, base.overall === m.overall ? <span className="text-chalk-4">no change</span> : rankDelta(base.overall, m.overall)],
  ]
  const groups: Record<'win' | 'swing' | 'punt', string[]> = { win: [], swing: [], punt: [] }
  for (const c of CATEGORIES) groups[tierOf(m.wins[c], opponents)].push(CATEGORY_META[c].label)
  const shifts = CATEGORIES.filter((c) => tierOf(m.wins[c], opponents) !== tierOf(base.wins[c], opponents)).map(
    (c) => `${CATEGORY_META[c].label} ${TIER[tierOf(base.wins[c], opponents)].label} → ${TIER[tierOf(m.wins[c], opponents)].label}`,
  )
  return (
    <Panel title={after ? 'With these changes' : 'Your team now'} subtitle={after ? 'Changes from your current roster in color.' : 'Pick a change above to see how it moves these.'}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="lab-summary">
        {cards.map(([k, v, d]) => (
          <div key={k} className="rounded-md border border-seam bg-well px-3 py-2">
            <div className="text-[11.5px] text-chalk-3">{k}</div>
            <div className="font-display text-[20px] font-semibold tabular-nums">{v}</div>
            {after ? <div className="text-[12px] tabular-nums">{d}</div> : null}
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-9" data-testid="lab-ranks">
        {CATEGORIES.map((c) => {
          const t = tierOf(m.wins[c], opponents)
          const was = base.ranks[c]
          return (
            <div key={c} className="overflow-hidden rounded-md border border-seam bg-well text-center">
              <div className="on-heat px-1.5 pb-1.5 pt-1" style={{ background: divergingFill(z[me].cats[c], HEAT_SCALE, HEAT_MAX) }}>
                <div className="text-[11.5px] font-semibold text-chalk">{CATEGORY_META[c].label}</div>
                <div className="font-display text-[21px] font-bold leading-tight tabular-nums text-chalk">{ord(m.ranks[c])}</div>
              </div>
              <div className="space-y-0.5 px-1 py-1.5">
                <div className="text-[11px] tabular-nums text-chalk-2">
                  {weeklyText(c, m.weekly[c])} · {m.wins[c].toFixed(1)} of {opponents}
                </div>
                <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold tabular-nums">
                  <span className={TIER[t].text}>{TIER[t].label}</span>
                  {after && was !== m.ranks[c] ? (
                    <span className={was > m.ranks[c] ? 'text-plus' : 'text-minus'}>
                      {was > m.ranks[c] ? `▲${was - m.ranks[c]}` : `▼${m.ranks[c] - was}`} <span className="font-normal text-chalk-3">was {ord(was)}</span>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
        {(['win', 'swing', 'punt'] as const).map((t) => (
          <span key={t}>
            <span className="text-chalk-3">{TIER[t].label}:</span> {groups[t].join(' · ') || '—'}
          </span>
        ))}
      </div>
      {after ? <div className="mt-2 rounded-md bg-clock-soft px-3 py-1.5 text-[12.5px] text-chalk-2">{shifts.length ? `Build change: ${shifts.join(', ')}` : 'Same build type as now.'}</div> : null}
      <p className="mt-2 text-[11.5px] text-chalk-4">
        Win: beat {Math.ceil((7 / 11) * opponents)}+ of {opponents} teams in that category in a typical week · Swing: {Math.ceil((4 / 11) * opponents)}–{Math.ceil((7 / 11) * opponents) - 1} · Punt: fewer.
      </p>
    </Panel>
  )
}

type SortKey = Category | 'overall'

/** Every team's league rank in each category, re-ranked with your changes (arrows: moves from now). */
function LeagueTable({
  base,
  after,
  me,
  partner,
  players,
  teamName,
}: {
  base: LabMetrics
  after: LabMetrics | null
  me: number
  partner: number | null
  players: number[]
  teamName: (t: number) => string
}) {
  const m = after ?? base
  const [sort, setSort] = useState<SortKey>('overall')
  const z = useMemo(() => heatOf(m), [m])
  const n = m.teams.length
  const overall = m.strength.map((_, t) => overallRank(m.strength, t))
  const was = base.strength.map((_, t) => overallRank(base.strength, t))
  const order = [...Array(n).keys()].sort((a, b) => (sort === 'overall' ? m.strength[b] - m.strength[a] : m.teams[a].ranks[sort] - m.teams[b].ranks[sort] || m.strength[b] - m.strength[a]))
  const move = (before: number, now: number) =>
    after && before !== now ? <span className="ml-0.5 text-[10.5px] font-semibold">{before > now ? `▲${before - now}` : `▼${now - before}`}</span> : null
  const header = (key: SortKey, label: string, title: string) => (
    <th key={key} className="h-9 border-b border-seam-strong px-0.5 text-center align-middle" aria-sort={sort === key ? 'ascending' : undefined}>
      <button
        type="button"
        onClick={() => setSort(key)}
        title={title}
        className={cn('font-display text-[12.5px] font-semibold tracking-wide', sort === key ? 'text-chalk underline decoration-clock decoration-2 underline-offset-4' : 'text-chalk-3 hover:text-chalk')}
      >
        {label}
      </button>
    </th>
  )
  return (
    <Panel
      title="League"
      subtitle={after ? 'Every team re-ranked with your changes; ▲▼ are moves from now. Other teams move too as you pass them.' : 'Every team’s rank in each category over the rest of the regular season (1 = best). Click a column to sort.'}
    >
      <div className="overflow-x-auto rounded-md border border-seam" data-testid="lab-league">
        <table className="w-full border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr>
              <th className="h-9 border-b border-seam-strong px-3 text-left">
                <span className="label-caps">Team</span>
              </th>
              <th className="h-9 w-12 border-b border-seam-strong px-1 text-center font-display text-[12px] font-semibold text-chalk-3">Players</th>
              {CATEGORIES.map((c) => header(c, CATEGORY_META[c].label, `Sort by ${CATEGORY_META[c].name} rank`))}
              <th className="h-9 border-b border-seam-strong px-2 text-right font-display text-[12px] font-semibold text-chalk-3" title="Expected categories won per matchup against the league (all-play)">
                Cats / matchup
              </th>
              {header('overall', 'Rank', 'Sort by overall rank (categories won per matchup)')}
            </tr>
          </thead>
          <tbody>
            {order.map((t) => {
              const d = after ? m.strength[t] - base.strength[t] : 0
              return (
                <tr key={t} className={cn(t === me && 'bg-clock-soft/50')} data-testid={t === me ? 'lab-league-me' : undefined}>
                  <td className="h-10 border-b border-seam px-3">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('truncate font-medium', t === me ? 'text-clock' : 'text-chalk')}>{teamName(t)}</span>
                      {t === partner ? <Badge tone="outline">Trade</Badge> : null}
                    </div>
                    <div className="text-[10.5px] text-chalk-4">slot {t + 1}</div>
                  </td>
                  <td className="border-b border-seam text-center font-mono text-[12px] tabular-nums text-chalk-2">{players[t]}</td>
                  {CATEGORIES.map((c) => {
                    const r = m.teams[t].ranks[c]
                    return (
                      <td key={c} className="border-b border-seam p-[2px]">
                        <Tip
                          content={
                            <div className="space-y-0.5">
                              <div className="font-medium text-chalk">
                                {teamName(t)} · {CATEGORY_META[c].name}
                              </div>
                              <div>
                                {weeklyText(c, m.teams[t].weekly[c])} · rank {r} of {n}
                                {after && base.teams[t].ranks[c] !== r ? ` (currently ${base.teams[t].ranks[c]})` : ''}
                              </div>
                              {c === 'TO' ? <div className="text-chalk-3">Fewer turnovers = better.</div> : null}
                            </div>
                          }
                        >
                          <div
                            className="on-heat flex h-9 min-w-[46px] items-center justify-center rounded-[4px] font-mono text-[12.5px] font-semibold tabular-nums text-chalk"
                            style={{ background: divergingFill(z[t].cats[c], HEAT_SCALE, HEAT_MAX) }}
                          >
                            {r}
                            {move(base.teams[t].ranks[c], r)}
                          </div>
                        </Tip>
                      </td>
                    )
                  })}
                  <td className="border-b border-seam px-2 text-right font-mono text-[12px] tabular-nums text-chalk-2">
                    {m.strength[t].toFixed(2)}
                    {after && Math.abs(d) >= 0.005 ? <span className={cn('ml-1 text-[11px]', signClass(d, 0.005))}>{`${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}`}</span> : null}
                  </td>
                  <td className="border-b border-seam p-[2px]">
                    <div
                      className="on-heat flex h-9 min-w-[52px] items-center justify-center rounded-[4px] font-mono text-[12.5px] font-bold tabular-nums text-chalk"
                      style={{ background: divergingFill(z[t].strength, HEAT_SCALE, HEAT_MAX) }}
                    >
                      {overall[t]}
                      {move(was[t], overall[t])}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
