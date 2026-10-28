import { ArrowDown, ArrowRight, ArrowUp, Bandage, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CATEGORIES, CATEGORY_META, type Category } from '@/analytics/categories'
import { chaseVerdict, OUTLOOK_TEXT, outlookOf, type Outlook } from '@/analytics/chase'
import { scoreText, weekTotals, type CategoryCall, type DaySlate, type SideProjection, type WeekCall, type WeekTotals as Totals } from '@/analytics/matchup'
import { Positions } from '@/components/PlayerBits'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Segmented, Select, Switch } from '@/components/ui/Controls'
import { Tip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { useApp } from '@/store/appStore'
import { teamLabel, type EngineData, type PlayerInfo } from '@/store/derived'
import { applyTrade, irPlacement, todayIso, type TradeDraft } from '@/store/season'
import type { MatchupWeek } from '@/store/schema'
import { PlayerPicker } from './PlayerPicker'
import { WeekGrid } from './WeekGrid'
import { chasePlan, dayLabel, lineSource, liveFor, opponentName, projectWeek, rangeText, type ChasePlan, type FinalResult, type ProjectionOptions, type ScheduleIndex, type WeekProjection } from './model'

const pct3 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(3).replace(/^0/, ''))
const n1 = (x: number | null | undefined) => (x == null ? '—' : x.toFixed(1))
const fmtCat = (c: Category, v: number | null) => (c === 'FG' || c === 'FT' ? pct3(v) : n1(v))
/** ESPN's totals so far are whole counts. */
const fmtNow = (c: Category, v: number | null) => (c === 'FG' || c === 'FT' ? pct3(v) : v == null ? '—' : String(Math.round(v)))
const catHead = (c: Category) => (c === 'FG' ? 'FG%' : c === 'FT' ? 'FT%' : c)
const catValue = (t: Totals, c: Category): number | null =>
  c === 'FG' ? t.fgPct : c === 'FT' ? t.ftPct : t[({ '3PM': 'tpm', PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk', TO: 'tov' } as const)[c]]
const scoreTone = (w: Pick<WeekCall, 'wins' | 'losses'>) => (w.wins > w.losses ? 'text-plus' : w.wins < w.losses ? 'text-minus' : 'text-chalk')

/** One week, head to head: projected totals and calls, ESPN-style daily lineups, and a trade lab. */
export function MatchupDetail({
  week,
  weekNo,
  weeks,
  engine,
  index,
  rosters,
  teamOf,
  me,
  opts,
  setOpts,
}: {
  week: MatchupWeek
  weekNo: number
  weeks: MatchupWeek[]
  engine: EngineData
  index: ScheduleIndex
  rosters: string[][]
  teamOf: Map<string, number>
  me: number
  opts: ProjectionOptions
  setOpts: (o: ProjectionOptions) => void
}) {
  const settings = useApp((s) => s.settings)
  const [opp, setOpp] = useState<number | null>(week.opponent)
  const [trade, setTrade] = useState<TradeDraft>({ give: [], get: [] })
  const today = todayIso()
  const espnLive = useApp((s) => s.season.espn?.live)
  const live = useMemo(() => liveFor(espnLive, weekNo, me, opp), [espnLive, weekNo, me, opp])
  const proj = useMemo(
    () => projectWeek(engine, index, rosters[me], opp == null ? [] : rosters[opp], week.start, week.end, opts, live),
    [engine, index, rosters, me, opp, week.start, week.end, opts, live],
  )
  const [dayIdx, setDayIdx] = useState(() => Math.max(0, proj.dates.indexOf(today)))
  const [view, setView] = useState<'week' | 'day'>('week')
  const [show, setShow] = useState<'projected' | 'current'>('projected')
  const from = today > week.start ? today : week.start

  const tradeActive = trade.give.length + trade.get.length > 0
  const applied = useMemo(() => applyTrade(rosters, teamOf, me, trade), [rosters, teamOf, me, trade])
  const projT = useMemo(
    () => (tradeActive ? projectWeek(engine, index, applied.rosters[me], opp == null ? [] : applied.rosters[opp], week.start, week.end, opts, live) : null),
    [tradeActive, engine, index, applied, me, opp, week.start, week.end, opts, live],
  )

  // Pickups for the rest of this week: free agents (on no roster as of the last sync), tried in place of the drop.
  const injuries = useApp((s) => s.season.injuries)
  const pool = useMemo(
    () => engine.players.filter((p) => (p.line || p.standIn) && p.team && !teamOf.has(p.id) && !injuries.some((i) => i.playerId === p.id) && p.rec.provenance?.status?.tag !== 'out').map((p) => p.id),
    [engine, teamOf, injuries],
  )
  const rank = (id: string) => {
    const v = engine.valuation.values.get(id)
    return v ? (engine.ctx.basis === 'gpAware' ? v.rankGp : v.rank) : 9999
  }
  const active = useMemo(() => irPlacement(rosters[me], injuries, settings.irSlots, today).active, [rosters, me, injuries, settings.irSlots, today])
  const dropOptions = useMemo(() => [...active].sort((a, b) => rank(b) - rank(a)), [active]) // eslint-disable-line react-hooks/exhaustive-deps
  const needDrop = active.length >= settings.rounds
  const [dropChoice, setDropChoice] = useState<string | null>(null)
  const drop = needDrop ? (dropChoice && active.includes(dropChoice) ? dropChoice : (dropOptions[0] ?? null)) : null
  const plan = useMemo(
    () => (opp == null ? null : chasePlan(engine, index, rosters[me], rosters[opp], week.start, week.end, opts, live, pool, drop, today)),
    [engine, index, rosters, me, opp, week.start, week.end, opts, live, pool, drop, today],
  )

  const { call } = proj
  const oppLabel = opp == null ? 'No opponent' : opp === week.opponent ? opponentName(settings, week) : teamLabel(settings, opp)
  const myName = teamLabel(settings, me)
  const started = proj.live && (proj.live.me.fga + proj.live.me.pts + proj.live.them.fga + proj.live.them.pts > 0)
  const current = show === 'current' && !!started

  return (
    <section className="rounded-lg border border-seam bg-floor" data-testid="matchup-detail">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 pt-4">
        <h2 className="min-w-0 font-display text-[24px] font-semibold leading-tight tracking-tight">
          <span className="text-clock">{myName}</span> <span className="font-normal text-chalk-3">{week.away ? 'at' : 'vs'}</span> {oppLabel}
        </h2>
        <div className="ml-auto flex items-start gap-6 text-right">
          {started && proj.live ? (
            <Tip content={`ESPN totals as of ${new Date(proj.live.asOf).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`}>
              <div data-testid="live-score" className={cn(!current && 'opacity-50')}>
                <div className="label-caps">Now</div>
                <div className={cn('font-display text-[44px] font-bold leading-none tracking-tight tnum', scoreTone(proj.live.now))}>{scoreText(proj.live.now)}</div>
              </div>
            </Tip>
          ) : null}
          {projT ? (
            <div>
              <div className="label-caps text-clock">With trade</div>
              <div className={cn('font-display text-[44px] font-bold leading-none tracking-tight tnum', scoreTone(projT.call))} data-testid="trade-score">
                {scoreText(projT.call)}
              </div>
            </div>
          ) : null}
          <div>
            <div className="label-caps">Projected</div>
            <div className={cn('font-display text-[44px] font-bold leading-none tracking-tight tnum', scoreTone(call), (projT || current) && 'opacity-50')} data-testid="matchup-score">
              {scoreText(call)}
            </div>
          </div>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 px-5">
        <label className="flex items-center gap-2 text-[13px] text-chalk-2">
          Compare with
          <Select value={opp ?? ''} onChange={(e) => setOpp(e.target.value === '' ? null : Number(e.target.value))} className="h-8 w-[280px] text-[13px]" aria-label="Opponent">
            {rosters.map((_, i) =>
              i === me ? null : (
                <option key={i} value={i}>
                  {teamLabel(settings, i)}
                  {i === week.opponent ? ' (scheduled)' : ''}
                </option>
              ),
            )}
          </Select>
        </label>
        <div className="flex items-center gap-2 text-[13px] text-chalk-2">
          <Switch checked={opts.availability} onChange={(v) => setOpts({ ...opts, availability: v })} label="Expect missed games" />
          <Tip content="Scale each game by projected games played ÷ 82 (a 65-game player counts ~79% of each game). Off = everyone not marked out plays.">
            <span>Expect missed games</span>
          </Tip>
        </div>
        {started ? (
          <Segmented<'projected' | 'current'>
            className="ml-auto"
            label="Category totals"
            size="xs"
            value={show}
            onChange={setShow}
            options={[
              { value: 'projected', label: 'Projected' },
              { value: 'current', label: 'Current' },
            ]}
          />
        ) : null}
      </div>

      <div className="mt-3 overflow-x-auto px-5 pb-2">
        <CategoryTable proj={proj} current={current} myName={myName} oppName={oppLabel} plan={plan} name={(id) => engine.byId.get(id)?.name ?? id} />
      </div>

      {plan ? (
        <Pickups
          plan={plan}
          engine={engine}
          drop={drop}
          dropOptions={needDrop ? dropOptions : []}
          setDrop={setDropChoice}
          onTry={(id) => {
            setTrade({ give: drop ? [drop] : [], get: [id] })
            setTimeout(() => document.querySelector('[data-testid="trade-lab"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
          }}
        />
      ) : null}

      <TradeLab
        engine={engine}
        rosters={rosters}
        teamOf={teamOf}
        me={me}
        opp={opp}
        trade={trade}
        setTrade={setTrade}
        applied={applied}
        before={proj}
        after={projT}
        espnLive={espnLive}
        weeks={weeks}
        index={index}
        opts={opts}
        today={today}
      />

      <div className="border-t border-seam px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h3 className="label-caps">Lineups</h3>
          <Segmented<'week' | 'day'>
            label="Lineup view"
            size="xs"
            value={view}
            onChange={setView}
            options={[
              { value: 'week', label: 'Week' },
              { value: 'day', label: 'Day by slot' },
            ]}
          />
        </div>
        {view === 'week' ? (
          <WeekGrid
            me={proj.me}
            them={proj.them}
            rosters={{ me: rosters[me], them: opp == null ? [] : rosters[opp] }}
            names={{ me: myName, them: oppLabel }}
            engine={engine}
            index={index}
            from={from}
          />
        ) : (
          <>
            <DayStrip proj={proj} selected={dayIdx} onSelect={setDayIdx} />
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <LineupCard title={myName} mine day={proj.me.days[dayIdx]} side={proj.me} roster={rosters[me]} engine={engine} index={index} />
              {opp != null ? <LineupCard title={oppLabel} day={proj.them.days[dayIdx]} side={proj.them} roster={rosters[opp]} engine={engine} index={index} /> : null}
            </div>
          </>
        )}
      </div>

      <WeekTotals proj={proj} engine={engine} myName={myName} oppName={oppLabel} roster={{ me: rosters[me], them: opp == null ? [] : rosters[opp] }} opts={opts} />
    </section>
  )
}

/** "est." / "repl." beside a player with no projection, explaining the numbers used for him. */
function SourceTag({ p }: { p: Pick<PlayerInfo, 'line' | 'standIn'> }) {
  const src = lineSource(p)
  if (!src) return null
  return (
    <Tip content={src.text}>
      <span className="shrink-0 text-[11px] text-chalk-4">{src.tag}</span>
    </Tip>
  )
}

type Call = 'W' | 'L' | 'T'
const CALL_TONE: Record<Call, string> = { W: 'text-plus', L: 'text-minus', T: 'text-chalk-3' }

/** A week ESPN has scored: the final score, each side's totals, and the margin in every category. */
export function FinalDetail({ week, weekNo, final, me }: { week: MatchupWeek; weekNo: number; final: FinalResult; me: number }) {
  const settings = useApp((s) => s.settings)
  const syncedAt = useApp((s) => s.season.espn?.syncedAt)
  const myName = teamLabel(settings, me)
  const oppName = final.opp === week.opponent ? opponentName(settings, week) : teamLabel(settings, final.opp)
  const mine = weekTotals(final.me.totals)
  const theirs = weekTotals(final.them.totals)
  const score = final.me
  // My edge in each category (fewer turnovers counts as ahead); ESPN's own call decides who won it.
  const rows = CATEGORIES.map((c) => {
    const a = catValue(mine, c)
    const b = catValue(theirs, c)
    const edge = a == null || b == null ? null : c === 'TO' ? b - a : a - b
    const call: Call | null = final.me.cats[c] ?? (edge == null ? null : edge > 0 ? 'W' : edge < 0 ? 'L' : 'T')
    return { c, a, b, edge, call }
  })
  const value = (c: Category, v: number | null) => (c === 'FG' || c === 'FT' ? pct3(v) : v == null ? '—' : String(Math.round(v)))
  const margin = (c: Category, edge: number | null) => {
    if (edge == null) return '—'
    if (Math.abs(edge) < 1e-9) return 'even'
    const sign = edge > 0 ? '+' : '−'
    return c === 'FG' || c === 'FT' ? `${sign}${Math.abs(edge).toFixed(3).replace(/^0/, '')}` : `${sign}${Math.round(Math.abs(edge))}`
  }
  return (
    <section className="rounded-lg border border-seam bg-floor" data-testid="matchup-final">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 className="font-display text-[24px] font-semibold leading-tight tracking-tight">
            <span className="text-clock">{myName}</span> <span className="font-normal text-chalk-3">{week.away ? 'at' : 'vs'}</span> {oppName}
          </h2>
          <p className="mt-1 text-[13px] text-chalk-3">
            Week {weekNo} · {rangeText(week.start, week.end)} · {score.wins > score.losses ? 'You won' : score.wins < score.losses ? 'You lost' : 'Tied'}
          </p>
        </div>
        <Tip content={`ESPN's final score${syncedAt ? ` · synced ${new Date(syncedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}`}>
          <div className="ml-auto text-right">
            <div className="label-caps">Final</div>
            <div className={cn('font-display text-[44px] font-bold leading-none tracking-tight tnum', scoreTone(score))} data-testid="final-score">
              {scoreText(score)}
            </div>
          </div>
        </Tip>
      </header>

      <div className="mt-4 overflow-x-auto px-5 pb-4">
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[14px]" data-testid="final-categories">
          <thead>
            <tr className="text-[12.5px] text-chalk-3">
              <th className="h-9 border-b border-seam-strong pr-3 text-left font-medium">Team</th>
              {CATEGORIES.map((c) => (
                <th key={c} className="border-b border-seam-strong px-2 text-right font-display text-[14px] font-semibold tracking-wide text-chalk-2">
                  <Tip content={CATEGORY_META[c].name}>
                    <span>{catHead(c)}</span>
                  </Tip>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['mine', 'theirs'] as const).map((side) => (
              <tr key={side}>
                <td className={cn('h-11 max-w-[170px] truncate border-b border-seam pr-3 font-medium', side === 'mine' ? 'text-clock' : 'text-chalk')}>{side === 'mine' ? myName : oppName}</td>
                {rows.map((r) => {
                  const won = r.call === (side === 'mine' ? 'W' : 'L')
                  return (
                    <td key={r.c} className={cn('border-b border-seam px-2 text-right font-mono tnum', won ? 'font-semibold text-chalk' : 'text-chalk-2', won && (side === 'mine' ? 'bg-plus/12' : 'bg-minus/12'))}>
                      {value(r.c, side === 'mine' ? r.a : r.b)}
                    </td>
                  )
                })}
              </tr>
            ))}
            <tr>
              <td className="pr-3 pt-2.5 text-[12.5px] text-chalk-3">
                <Tip content="Your edge at the final whistle: + means you were ahead (for TO, fewer is ahead).">
                  <span>Margin</span>
                </Tip>
              </td>
              {rows.map((r) => (
                <td key={r.c} className={cn('px-2 pt-2.5 text-right font-mono text-[13px] font-medium tnum', r.call ? CALL_TONE[r.call] : 'text-chalk-4')} data-testid={`margin-${r.c}`}>
                  {margin(r.c, r.edge)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

const OUTLOOK_TONE: Record<Outlook, string> = { safe: 'text-plus', ahead: 'text-plus', 'toss-up': 'text-warn', behind: 'text-minus', 'far-behind': 'text-minus' }

const COUNT_FIELD = { '3PM': 'tpm', PTS: 'pts', REB: 'reb', AST: 'ast', STL: 'stl', BLK: 'blk', TO: 'tov' } as const

/** Hover detail for a category: the gap, what's left to play, and what the best single pickup adds. */
function OutlookTip({ c, plan, name }: { c: CategoryCall; plan: ChasePlan | null; name: (id: string) => string }) {
  const pct = c.cat === 'FG' || c.cat === 'FT'
  const best = plan?.best[c.cat]
  const verdict = plan ? chaseVerdict(c, best?.share ?? null) : null
  const label = catHead(c.cat)
  const gap = c.edge == null ? null : pct ? `${(Math.abs(c.edge) * 100).toFixed(1)} pts` : Math.abs(c.edge).toFixed(1)
  const left = (t: Totals) => (pct ? `${(c.cat === 'FG' ? t.fga : t.fta).toFixed(0)} ${c.cat}A` : `+${(t[COUNT_FIELD[c.cat as keyof typeof COUNT_FIELD]] as number).toFixed(1)}`)
  return (
    <div className="max-w-[260px] space-y-1">
      <div className="font-medium text-chalk">
        {CATEGORY_META[c.cat].name}: {c.edge == null ? 'no data' : Math.abs(c.edge) < 1e-9 ? 'even' : `${c.edge > 0 ? 'up' : 'down'} ${gap}`} at the end of the week
      </div>
      {plan ? (
        <div>
          Still to play ({plan.restDays} day{plan.restDays === 1 ? '' : 's'}): you {left(plan.restMe)} · them {left(plan.restThem)}
        </div>
      ) : null}
      {best && c.cat !== 'TO' && Math.abs(best.add) >= 0.05 ? (
        <div>
          Best pickup: {best.add > 0 ? '+' : '−'}
          {Math.abs(best.add).toFixed(1)}
          {pct ? ' pts' : ` ${label}`} — {name(best.id)}
        </div>
      ) : null}
      {verdict === 'chase' ? <div className="text-clock">Worth chasing: one pickup makes this a real race.</div> : null}
      {verdict === 'let-go' ? <div className="text-chalk-3">Let it go: no single pickup closes this gap.</div> : null}
      {pct && c.flip && c.winner !== 'me' ? <div className="text-chalk-3">To flip: {c.flip}.</div> : null}
    </div>
  )
}

/**
 * Both sides' category totals and calls. Projected (default): the week's projected final.
 * Current: ESPN's totals so far and who leads each category right now.
 */
function CategoryTable({
  proj,
  current,
  myName,
  oppName,
  plan,
  name,
}: {
  proj: WeekProjection
  current: boolean
  myName: string
  oppName: string
  plan: ChasePlan | null
  name: (id: string) => string
}) {
  const { call, me, them } = proj
  const live = current ? proj.live : null
  const shown = live ? live.now : call
  return (
    <table className="w-full min-w-[720px] border-separate border-spacing-0 text-[14px]" data-testid="matchup-categories" data-mode={live ? 'current' : 'projected'}>
      <thead>
        <tr className="text-[12.5px] text-chalk-3">
          <th className="h-9 border-b border-seam-strong pr-3 text-left font-medium">Team</th>
          <th className="border-b border-seam-strong px-2 text-right font-medium">
            {live ? (
              <Tip content="Games still to play in a starting slot, from today's rosters.">
                <span>Left</span>
              </Tip>
            ) : (
              <Tip content="Games in a starting slot over the week. Hover a day below for benched games.">
                <span>Starts</span>
              </Tip>
            )}
          </th>
          {CATEGORIES.map((c) => (
            <th key={c} className="border-b border-seam-strong px-2 text-right font-display text-[14px] font-semibold tracking-wide text-chalk-2">
              <Tip content={CATEGORY_META[c].name}>
                <span>{catHead(c)}</span>
              </Tip>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(['mine', 'theirs'] as const).map((side) => {
          const s = side === 'mine' ? me : them
          return (
            <tr key={side}>
              <td className={cn('h-11 max-w-[170px] truncate border-b border-seam pr-3 font-medium', side === 'mine' ? 'text-clock' : 'text-chalk')}>{side === 'mine' ? myName : oppName}</td>
              <td className="whitespace-nowrap border-b border-seam px-2 text-right font-mono text-[13px] tnum text-chalk-2">{live ? live.left[side === 'mine' ? 'me' : 'them'] : s.starts}</td>
              {shown.calls.map((c, i) => {
                const won = c.winner === (side === 'mine' ? 'me' : 'them')
                const now = proj.live ? catValue(side === 'mine' ? proj.live.me : proj.live.them, c.cat) : null
                return (
                  <td
                    key={c.cat}
                    className={cn('border-b border-seam px-2 text-right font-mono tnum', won ? 'font-semibold text-chalk' : 'text-chalk-2', won && (side === 'mine' ? 'bg-plus/12' : 'bg-minus/12'))}
                  >
                    {proj.live ? (
                      <Tip content={live ? `Projected final ${fmtCat(c.cat, call.calls[i][side])}` : `So far ${fmtCat(c.cat, now)} (ESPN) · projected final ${fmtCat(c.cat, c[side])}`}>
                        <span>{(live ? fmtNow : fmtCat)(c.cat, c[side])}</span>
                      </Tip>
                    ) : (
                      fmtCat(c.cat, c[side])
                    )}
                  </td>
                )
              })}
            </tr>
          )
        })}
        <tr className={cn(live && 'hidden')}>
          <td className="pr-3 pt-2.5 align-top text-[12.5px] text-chalk-3">Outlook</td>
          <td />
          {call.calls.map((c) => {
            const o = outlookOf(c)
            const verdict = plan ? chaseVerdict(c, plan.best[c.cat]?.share ?? null) : null
            return (
              <td key={c.cat} className="px-2 pb-1 pt-2.5 text-right align-top" data-testid={`outlook-${c.cat}`}>
                <Tip content={<OutlookTip c={c} plan={plan} name={name} />}>
                  <span className={cn('whitespace-nowrap text-[13px] font-medium', o ? OUTLOOK_TONE[o] : 'text-chalk-4')}>{o ? OUTLOOK_TEXT[o] : 'No data'}</span>
                </Tip>
                {verdict ? (
                  <div className={cn('mt-0.5 whitespace-nowrap text-[12px]', verdict === 'chase' ? 'font-semibold text-clock' : 'text-chalk-4')}>{verdict === 'chase' ? 'Chase' : 'Let go'}</div>
                ) : null}
              </td>
            )
          })}
        </tr>
      </tbody>
    </table>
  )
}

const OUTLOOK_RANK: Record<Outlook, number> = { 'far-behind': 0, behind: 1, 'toss-up': 2, ahead: 3, safe: 4 }

/** The few free agents that move a category this week, one click from the trade lab. */
function Pickups({
  plan,
  engine,
  drop,
  dropOptions,
  setDrop,
  onTry,
}: {
  plan: ChasePlan
  engine: EngineData
  drop: string | null
  dropOptions: string[]
  setDrop: (id: string | null) => void
  onTry: (id: string) => void
}) {
  const openPreview = useApp((s) => s.openPreview)
  const rows = plan.options
    .filter((o) => o.gain > 0.02)
    .map((o) => ({
      o,
      moves: CATEGORIES.map((cat, i) => ({ cat, from: outlookOf(plan.baseCall.calls[i]), to: outlookOf(o.call.calls[i]) })).filter(
        (m): m is { cat: Category; from: Outlook; to: Outlook } => m.from != null && m.to != null && m.from !== m.to,
      ),
    }))
    .filter((r) => r.moves.some((m) => OUTLOOK_RANK[m.to] > OUTLOOK_RANK[m.from]))
    .slice(0, 3)
  return (
    <div className="border-t border-seam px-5 py-4" data-testid="pickups">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Tip content="Free agents (on no roster as of your last ESPN sync), each tried for the rest of this week in place of the player you'd drop. They count only on nights they'd start. Recently dropped players may still be on waivers.">
          <h3 className="label-caps">Pickups this week</h3>
        </Tip>
        {dropOptions.length ? (
          <label className="ml-auto flex items-center gap-2 text-[12.5px] text-chalk-3">
            Dropping
            <Select value={drop ?? ''} onChange={(e) => setDrop(e.target.value || null)} className="h-7 w-[210px] text-[12.5px]" aria-label="Player to drop">
              {dropOptions.map((id) => (
                <option key={id} value={id}>
                  {engine.byId.get(id)?.name ?? id}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
      </div>
      {rows.length ? (
        <ul>
          {rows.map(({ o, moves }) => {
            const p = engine.byId.get(o.id)
            return (
              <li key={o.id} className="flex h-10 items-center gap-2.5 border-t border-seam text-[13.5px] first:border-t-0" data-testid="pickup">
                <button type="button" onClick={() => openPreview(o.id)} className="min-w-0 truncate text-left font-medium hover:underline">
                  {p?.name ?? o.id}
                </button>
                <Positions positions={p?.positions ?? []} className="shrink-0 text-[11px]" />
                <span className="shrink-0 font-mono text-[11.5px] text-chalk-3">{p?.team}</span>
                {p ? <SourceTag p={p} /> : null}
                <span className="shrink-0 text-[12px] text-chalk-3">
                  {o.starts} start{o.starts === 1 ? '' : 's'}
                </span>
                <span className="ml-auto flex min-w-0 flex-wrap justify-end gap-1.5">
                  {moves.map((m) => {
                    const up = OUTLOOK_RANK[m.to] > OUTLOOK_RANK[m.from]
                    return (
                      <Tip key={m.cat} content={`${catHead(m.cat)}: ${OUTLOOK_TEXT[m.from]} → ${OUTLOOK_TEXT[m.to]}`}>
                        <span className={cn('inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[11.5px] font-semibold', up ? 'bg-plus/12 text-plus' : 'bg-minus/12 text-minus')}>
                          {catHead(m.cat)}
                          {up ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                        </span>
                      </Tip>
                    )
                  })}
                </span>
                <Button size="xs" variant="subtle" onClick={() => onTry(o.id)}>
                  Try
                </Button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-chalk-3">No single pickup changes a category this week.</p>
      )}
    </div>
  )
}

function DayStrip({ proj, selected, onSelect }: { proj: WeekProjection; selected: number; onSelect: (i: number) => void }) {
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.min(proj.dates.length, 14)}, minmax(0, 1fr))` }} data-testid="day-strip">
      {proj.dates.map((d, i) => {
        const a = proj.me.days[i]
        const b = proj.them.days[i]
        const { dow, day } = dayLabel(d)
        const tbd = proj.tbdDays.includes(d)
        const diff = a.started.length - b.started.length
        return (
          <button
            key={d}
            type="button"
            onClick={() => onSelect(i)}
            aria-pressed={i === selected}
            title={`${dow} ${day}: you ${a.started.length} starts${a.benched.length ? ` (${a.benched.length} benched)` : ''}, them ${b.started.length}${b.benched.length ? ` (${b.benched.length} benched)` : ''}${tbd ? ' · NBA games not scheduled yet' : ''}`}
            className={cn(
              'rounded-md border px-1.5 py-1.5 text-center transition-colors',
              tbd ? 'border-dashed border-warn/45' : 'border-seam',
              diff > 0 ? 'bg-plus/8' : diff < 0 ? 'bg-minus/8' : 'bg-arena',
              i === selected ? 'ring-2 ring-clock-line' : 'hover:border-seam-strong',
            )}
          >
            <div className="text-[12px] text-chalk-2">
              {dow} <span className="text-chalk-3">{day.split(' ')[1]}</span>
            </div>
            <div className="font-mono text-[14px] font-semibold tnum">
              {a.started.length}
              <span className="text-chalk-4"> · </span>
              {b.started.length}
            </div>
          </button>
        )
      })}
    </div>
  )
}

/** One team's lineup for one day, slot by slot like ESPN: starters, bench, IR. */
function LineupCard({
  title,
  mine,
  day,
  side,
  roster,
  engine,
  index,
}: {
  title: string
  mine?: boolean
  day: DaySlate
  side: SideProjection
  roster: string[]
  engine: EngineData
  index: ScheduleIndex
}) {
  const injuries = useApp((s) => s.season.injuries)
  const irSlots = useApp((s) => s.settings.irSlots)
  const rounds = useApp((s) => s.settings.rounds)
  const setInjury = useApp((s) => s.setInjury)
  const openPreview = useApp((s) => s.openPreview)
  const games = index.gameOf.get(day.date)
  const { ir } = irPlacement(roster, injuries, irSlots, day.date)
  const onIr = new Set(ir)
  const benched = new Set(day.benched)
  const benchRows = [
    ...day.bench.map((id) =>
      benched.has(id)
        ? { id, note: 'game · lineup full', tone: 'text-warn' }
        : { id, note: 'no game', tone: 'text-chalk-4' },
    ),
    ...day.out.filter((id) => !onIr.has(id)).map((id) => ({ id, note: 'out · IR full', tone: 'text-bad' })),
  ]
  const benchSlots = Math.max(0, rounds - day.lineup.length)
  const overBench = benchRows.length - benchSlots
  const { dow, day: dd } = dayLabel(day.date)
  const row = (key: string, { slot, id, note, tone, slotTone, dim }: { slot: string; id: string | null; note?: string; tone?: string; slotTone?: string; dim?: boolean }) => {
    const p = id ? engine.byId.get(id) : null
    const out = id ? day.out.includes(id) : false
    return (
      <li key={key} className={cn('group flex h-9 items-center gap-2.5 border-t border-seam text-[13.5px] first:border-t-0', dim && 'text-chalk-3')}>
        <span className={cn('w-11 shrink-0 font-display text-[13px] font-semibold tracking-wide', slotTone ?? 'text-chalk-3')}>{slot}</span>
        {id && p ? (
          <>
            <button type="button" onClick={() => openPreview(id)} className={cn('min-w-0 truncate text-left font-medium hover:underline', out && 'text-chalk-3')}>
              {p.name}
            </button>
            <Positions positions={p.positions} className="hidden shrink-0 text-[11px] sm:inline" />
            <SourceTag p={p} />
            <span className={cn('ml-auto shrink-0 font-mono text-[12.5px] tnum', tone ?? 'text-chalk-2')}>{note ?? (p.team ? (games?.get(p.team) ?? 'no game') : 'FA')}</span>
            <button
              type="button"
              onClick={() => setInjury(id, out ? false : null)}
              className={cn('shrink-0 rounded p-1 hover:bg-stand', out ? 'text-bad' : 'text-chalk-4 opacity-0 focus:opacity-100 group-hover:opacity-100')}
              aria-label={out ? `Mark ${p.name} healthy` : `Mark ${p.name} out`}
              title={out ? 'Mark healthy' : 'Mark out (moves to IR if a slot is free)'}
            >
              <Bandage size={13} />
            </button>
          </>
        ) : (
          <span className="text-[13px] text-chalk-4" title={slot === 'IR' || slot === 'BE' ? undefined : 'Nobody with a game today fits this slot'}>
            Empty
          </span>
        )}
      </li>
    )
  }
  return (
    <div className="min-w-0 rounded-md border border-seam bg-arena px-3 py-2.5" data-testid={mine ? 'lineup-mine' : 'lineup-theirs'}>
      <div className="mb-1 flex items-baseline gap-2">
        <h4 className={cn('min-w-0 truncate font-display text-[17px] font-semibold tracking-tight', mine && 'text-clock')}>{title}</h4>
        <span className="ml-auto shrink-0 text-[12.5px] text-chalk-3">
          {dow} {dd} · {day.started.length} start{day.started.length === 1 ? '' : 's'} · week {side.starts}
        </span>
      </div>
      <ul>
        {day.lineup.map((s, i) => row(`s${i}`, s.playing || !s.id ? { slot: s.slot, id: s.id } : { slot: s.slot, id: s.id, note: 'no game', tone: 'text-chalk-4', dim: true }))}
      </ul>
      <div className="mt-1 border-t border-seam-strong" />
      <ul>
        {benchRows.map((r) => row(`b${r.id}`, { slot: 'BE', id: r.id, note: r.note, tone: r.tone }))}
        {Array.from({ length: Math.max(0, benchSlots - benchRows.length) }, (_, i) => row(`be${i}`, { slot: 'BE', id: null }))}
      </ul>
      {overBench > 0 ? (
        <p className="mt-1 text-[12px] text-warn">
          {overBench} over the {benchSlots} bench slots — roster above {rounds}
        </p>
      ) : null}
      {irSlots ? (
        <>
          <div className="mt-1 border-t border-seam-strong" />
          <ul>
            {Array.from({ length: irSlots }, (_, i) => row(`ir${i}`, { slot: 'IR', id: ir[i] ?? null, note: ir[i] ? 'out' : undefined, tone: 'text-bad', slotTone: 'text-bad/80' }))}
          </ul>
        </>
      ) : null}
    </div>
  )
}

/** Test a trade or pickup against this matchup and the rest of the schedule. */
function TradeLab({
  engine,
  rosters,
  teamOf,
  me,
  opp,
  trade,
  setTrade,
  applied,
  before,
  after,
  espnLive,
  weeks,
  index,
  opts,
  today,
}: {
  engine: EngineData
  rosters: string[][]
  teamOf: Map<string, number>
  me: number
  opp: number | null
  trade: TradeDraft
  setTrade: (t: TradeDraft) => void
  applied: ReturnType<typeof applyTrade>
  before: WeekProjection
  after: WeekProjection | null
  espnLive: Parameters<typeof liveFor>[0]
  weeks: MatchupWeek[]
  index: ScheduleIndex
  opts: ProjectionOptions
  today: string
}) {
  const settings = useApp((s) => s.settings)
  const moveRosterPlayer = useApp((s) => s.moveRosterPlayer)
  const name = (id: string) => engine.byId.get(id)?.name ?? id
  const owner = (id: string) => {
    const t = teamOf.get(id)
    return t == null ? 'Free agent' : t === me ? 'You' : teamLabel(settings, t)
  }
  const exclude = useMemo(() => new Set([...rosters[me], ...trade.get]), [rosters, me, trade.get])
  const active = trade.give.length + trade.get.length > 0

  // Rest of the season (weeks not finished), before vs after the trade.
  const season = useMemo(() => {
    if (!active) return null
    const left = weeks.filter((w) => w.end >= today && w.opponent != null)
    const rows = left.map((w) => {
      const no = weeks.indexOf(w) + 1
      const lv = liveFor(espnLive, no, me, w.opponent)
      const b = projectWeek(engine, index, rosters[me], rosters[w.opponent!], w.start, w.end, opts, lv).call
      const a = projectWeek(engine, index, applied.rosters[me], applied.rosters[w.opponent!], w.start, w.end, opts, lv).call
      return { w, no, b, a }
    })
    const rec = (k: 'a' | 'b') => {
      const won = rows.filter((r) => r[k].wins > r[k].losses).length
      const lost = rows.filter((r) => r[k].wins < r[k].losses).length
      return `${won}–${lost}${rows.length - won - lost ? `–${rows.length - won - lost}` : ''}`
    }
    const catsB = rows.reduce((s, r) => s + r.b.wins, 0)
    const catsA = rows.reduce((s, r) => s + r.a.wins, 0)
    return { rows, before: rec('b'), after: rec('a'), catsB, catsA, flips: rows.filter((r) => Math.sign(r.a.wins - r.a.losses) !== Math.sign(r.b.wins - r.b.losses)) }
  }, [active, weeks, today, engine, index, rosters, me, applied, opts, espnLive])

  const kind = !trade.get.length ? 'Drop' : applied.multiTeam ? 'Multi-team' : applied.partner == null ? 'Free-agent pickup' : `Trade with ${teamLabel(settings, applied.partner)}`
  const record = () => {
    for (const id of trade.get) moveRosterPlayer(id, me, 'trade lab')
    for (const id of trade.give) moveRosterPlayer(id, applied.partner, 'trade lab')
    toast.success(`${kind} recorded in Rosters`)
    setTrade({ give: [], get: [] })
  }

  return (
    <div className="border-t border-seam px-5 py-4" data-testid="trade-lab">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="label-caps">Trade lab</h3>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-chalk-2">You give</div>
          <Chips ids={trade.give} name={name} onRemove={(id) => setTrade({ ...trade, give: trade.give.filter((x) => x !== id) })} empty="Nobody yet" />
          <Select
            value=""
            onChange={(e) => e.target.value && setTrade({ ...trade, give: [...trade.give, e.target.value] })}
            className="mt-2 h-9 w-full max-w-[420px] text-[13px]"
            aria-label="Add a player you give"
            data-testid="trade-give"
          >
            <option value="">Add one of your players…</option>
            {rosters[me]
              .filter((id) => !trade.give.includes(id))
              .map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
          </Select>
        </div>
        <div>
          <div className="mb-1.5 text-[13px] font-medium text-chalk-2">You get</div>
          <Chips ids={trade.get} name={name} sub={owner} onRemove={(id) => setTrade({ ...trade, get: trade.get.filter((x) => x !== id) })} empty="Nobody yet" />
          <div className="mt-2 max-w-[420px]">
            <PlayerPicker engine={engine} exclude={exclude} ownerOf={owner} onPick={(id) => setTrade({ ...trade, get: [...trade.get, id] })} placeholder="Search any player…" testId="trade-get" />
          </div>
        </div>
      </div>

      {active && after ? (
        <div className="mt-4 rounded-md border border-clock-line bg-clock-soft/40 px-4 py-3" data-testid="trade-result">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="text-[13px] font-medium text-chalk-2">{kind}</span>
            <span className="flex items-center gap-2 text-[14px]">
              This week
              <span className={cn('font-mono font-semibold tnum', scoreTone(before.call))}>{scoreText(before.call)}</span>
              <ArrowRight size={14} className="text-chalk-3" />
              <span className={cn('font-mono font-semibold tnum', scoreTone(after.call))}>{scoreText(after.call)}</span>
            </span>
            {season?.rows.length ? (
              <span className="flex items-center gap-2 text-[14px]" data-testid="trade-season">
                Rest of season ({season.rows.length} wk)
                <span className="font-mono font-semibold tnum">{season.before}</span>
                <ArrowRight size={14} className="text-chalk-3" />
                <span className="font-mono font-semibold tnum">{season.after}</span>
                <span className="text-[12.5px] text-chalk-3">
                  · categories won {season.catsB} → {season.catsA}
                </span>
              </span>
            ) : null}
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setTrade({ give: [], get: [] })}>
                Clear
              </Button>
              <Tip content={applied.multiTeam ? 'Players come from more than one team — record each part in Rosters.' : 'Adds the moves to Rosters (each one can be undone there).'}>
                <span>
                  <Button size="sm" variant="primary" onClick={record} disabled={applied.multiTeam}>
                    Record in Rosters
                  </Button>
                </span>
              </Tip>
            </span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <thead>
                <tr className="text-[12px] text-chalk-3">
                  <th className="h-7 text-left font-medium">
                    <Tip content={`Your totals. Blue = projected win, red = projected loss against ${opp == null ? 'no opponent' : teamLabel(settings, opp)}.`}>
                      <span>This week</span>
                    </Tip>
                  </th>
                  {CATEGORIES.map((c) => (
                    <th key={c} className="px-2 text-right font-display text-[13px] font-semibold text-chalk-2">
                      {catHead(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['Now', before.call],
                    ['With trade', after.call],
                  ] as const
                ).map(([label, c]) => (
                  <tr key={label} className="border-t border-seam">
                    <td className="h-8 text-chalk-2">{label}</td>
                    {c.calls.map((x) => (
                      <td key={x.cat} className={cn('px-2 text-right font-mono tnum', x.winner === 'me' ? 'font-semibold text-plus' : x.winner === 'them' ? 'text-minus' : 'text-chalk-3')}>
                        {fmtCat(x.cat, x.mine)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {season?.flips.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px]">
              <span className="text-chalk-3">Weeks that change:</span>
              {season.flips.map((r) => (
                <span key={r.w.id} className="rounded border border-seam bg-floor px-1.5 py-0.5 font-mono tnum">
                  W{r.no} {scoreText(r.b)} → <span className={scoreTone(r.a)}>{scoreText(r.a)}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function Chips({ ids, name, sub, onRemove, empty }: { ids: string[]; name: (id: string) => string; sub?: (id: string) => string; onRemove: (id: string) => void; empty: string }) {
  if (!ids.length) return <div className="text-[13px] text-chalk-4">{empty}</div>
  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map((id) => (
        <span key={id} className="inline-flex items-center gap-1.5 rounded-md border border-seam-strong bg-stand py-1 pl-2.5 pr-1 text-[13px]">
          <span className="font-medium">{name(id)}</span>
          {sub ? <span className="text-[12px] text-chalk-3">{sub(id)}</span> : null}
          <button type="button" onClick={() => onRemove(id)} className="rounded p-0.5 text-chalk-3 hover:bg-booth hover:text-chalk" aria-label={`Remove ${name(id)}`}>
            <X size={12} />
          </button>
        </span>
      ))}
    </div>
  )
}

const WEEK_COLS = [
  { key: 'pts', label: 'PTS' },
  { key: 'reb', label: 'REB' },
  { key: 'ast', label: 'AST' },
  { key: 'stl', label: 'STL' },
  { key: 'blk', label: 'BLK' },
  { key: 'tpm', label: '3PM' },
  { key: 'tov', label: 'TO' },
] as const

/** Each player's starts and projected weekly totals, one team at a time (full width, no side-by-side squeeze). */
function WeekTotals({
  proj,
  engine,
  myName,
  oppName,
  roster,
  opts,
}: {
  proj: WeekProjection
  engine: EngineData
  myName: string
  oppName: string
  roster: { me: string[]; them: string[] }
  opts: ProjectionOptions
}) {
  const [who, setWho] = useState<'me' | 'them'>('me')
  const openPreview = useApp((s) => s.openPreview)
  const side = who === 'me' ? proj.me : proj.them
  const ids = who === 'me' ? roster.me : roster.them
  const full = engine.valuation.settings.fullSeasonGames
  const rows = ids.map((id) => ({ id, p: engine.byId.get(id), w: side.players.get(id) })).sort((a, b) => (b.w?.starts ?? -1) - (a.w?.starts ?? -1))
  return (
    <details className="group border-t border-seam px-5 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-3 py-1 text-[13px] font-medium text-chalk-2 hover:text-chalk">
        <span className="label-caps">Player totals this week</span>
        <span className="text-[12.5px] font-normal text-chalk-3 group-open:hidden">Show</span>
      </summary>
      <div className="mt-2">
        <Segmented<'me' | 'them'>
          label="Team"
          size="xs"
          value={who}
          onChange={setWho}
          options={[
            { value: 'me', label: myName },
            { value: 'them', label: oppName },
          ]}
        />
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13.5px]" data-testid="week-totals">
            <thead>
              <tr className="text-[12px] text-chalk-3">
                <th className="h-8 text-left font-medium">Player</th>
                <th className="px-2 text-right font-medium">Starts / games</th>
                {WEEK_COLS.map((c) => (
                  <th key={c.key} className="px-2 text-right font-medium">
                    {c.label}
                  </th>
                ))}
                <th className="px-2 text-right font-medium">FG%</th>
                <th className="px-2 text-right font-medium">FT%</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ id, p, w }) => {
                const l = p?.line ?? p?.standIn?.line ?? (p ? engine.valuation.replacement.line : null)
                const a = opts.availability && p?.gp != null ? Math.min(1, p.gp / full) : 1
                return (
                  <tr key={id} className="h-9 border-t border-seam">
                    <td className="max-w-[260px]">
                      <span className="flex items-center gap-2">
                        <button type="button" onClick={() => openPreview(id)} className="truncate text-left font-medium hover:underline">
                          {p?.name ?? id}
                        </button>
                        <span className="shrink-0 text-[12px] text-chalk-3">{p?.team ?? 'FA'}</span>
                        {w?.missed ? <Badge tone="bad">out {w.missed}g</Badge> : null}
                        {p ? <SourceTag p={p} /> : null}
                      </span>
                    </td>
                    <td className={cn('px-2 text-right font-mono tnum', w?.benched ? 'text-warn' : 'text-chalk-2')}>{w && l ? `${w.starts} / ${w.games}` : '—'}</td>
                    {WEEK_COLS.map((c) => (
                      <td key={c.key} className="px-2 text-right font-mono tnum text-chalk-2">
                        {w && l && w.starts ? (l[c.key] * w.starts * a).toFixed(1) : <span className="text-chalk-4">·</span>}
                      </td>
                    ))}
                    <td className="px-2 text-right font-mono tnum text-chalk-3">{l?.fga ? pct3(l.fgm! / l.fga) : '—'}</td>
                    <td className="px-2 text-right font-mono tnum text-chalk-3">{l?.fta ? pct3(l.ftm! / l.fta) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  )
}
