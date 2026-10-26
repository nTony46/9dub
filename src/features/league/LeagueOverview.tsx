import { ArrowDown, CalendarDays } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CATEGORIES, CATEGORY_META, catLabel, catRecord, type CatRecord, type Category } from '@/analytics/categories'
import { categoryReadout } from '@/analytics/readout'
import { pickAdjusted, pickValueCurve, rankTeams, stageConfidence, teamCategoryScore, type CompareBasis, type TeamProfile, type TeamTotals } from '@/analytics/team'
import { picksForSlot } from '@/analytics/draftOrder'
import { basisTotal } from '@/analytics/valuation'
import { mean } from '@/analytics/math'
import { CatStrip } from '@/components/CatStrip'
import { Positions } from '@/components/PlayerBits'
import { Badge } from '@/components/ui/Badge'
import { Segmented } from '@/components/ui/Controls'
import { Tip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { divergingFill } from '@/lib/diverging'
import { num, pct, signed } from '@/lib/format'
import { navigate } from '@/app/router'
import { useApp } from '@/store/appStore'
import { teamLabel, useDraft, useEngine, useLive } from '@/store/derived'
import type { MatchupWeek } from '@/store/schema'
import { todayIso } from '@/store/season'
import { LiveBar } from '@/features/draft/LiveBar'
import { rangeText } from '@/features/season/model'

type ValueMode = 'raw' | 'score' | 'rank'
type Basis = CompareBasis | 'pickAdjusted'
type Adjusted = ReturnType<typeof pickAdjusted>
type SortKey = Category | 'total' | 'team'

function rawValue(t: TeamTotals, c: Category): number | null {
  switch (c) {
    case 'FG':
      return t.fgPct
    case 'FT':
      return t.ftPct
    case '3PM':
      return t.tpm
    case 'PTS':
      return t.pts
    case 'REB':
      return t.reb
    case 'AST':
      return t.ast
    case 'STL':
      return t.stl
    case 'BLK':
      return t.blk
    case 'TO':
      return t.tov
  }
}

function totalsFor(p: TeamProfile, basis: CompareBasis): TeamTotals {
  if (basis === 'slotAdjusted') return p.totalsSlot
  if (basis === 'current' || p.count === 0) return p.totals
  const t = p.totals
  const n = p.count
  return { ...t, pts: t.pts / n, tpm: t.tpm / n, reb: t.reb / n, ast: t.ast / n, stl: t.stl / n, blk: t.blk / n, tov: t.tov / n }
}

export function LeagueOverview() {
  const engine = useEngine()
  const live = useLive()
  const d = useDraft()
  const settings = useApp((s) => s.settings)
  const prefs = useApp((s) => s.prefs)
  const setPrefs = useApp((s) => s.setPrefs)
  const [selected, setSelected] = useState<number | null>(null)
  const adjusted = useMemo<Adjusted[]>(() => {
    if (!engine || !live) return []
    // After the draft there are no picks to expect: compare full rosters, any open spot (say, a player on IR) at replacement level.
    if (live.postDraft) return live.profiles.map((p) => ({ z: p.zSlot, total: CATEGORIES.reduce((s, c) => s + p.zSlot[c], 0), totals: p.totalsSlot }))
    const curve = pickValueCurve(engine.ctx, d.totalPicks)
    return live.profiles.map((p, t) =>
      pickAdjusted(
        p,
        engine.ctx,
        picksForSlot(t + 1, settings.teams, settings.rounds).filter((o) => !d.picksByOverall.has(o)),
        curve,
      ),
    )
  }, [engine, live, d, settings.teams, settings.rounds])

  if (!engine || !live) return <div className="p-8 text-chalk-3">No dataset loaded.</div>
  const minPicks = Math.min(...live.profiles.map((p) => p.count))
  const maxPicks = Math.max(...live.profiles.map((p) => p.count))
  const conf = stageConfidence(minPicks, settings.rounds)

  return (
    <div className="flex h-full flex-col">
      <LiveBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1500px] px-5 py-4">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[22px] font-semibold tracking-tight">League overview</h1>
            <Segmented<'simple' | 'advanced'>
              label="League view"
              value={prefs.leagueView}
              onChange={(v) => setPrefs({ leagueView: v })}
              options={[
                { value: 'simple', label: 'Simple' },
                { value: 'advanced', label: 'Advanced' },
              ]}
            />
            {live.postDraft ? null : (
              <Tip
                content={`Rosters so far (${minPicks === maxPicks ? `${minPicks}` : `${minPicks}–${maxPicks}`} of ${settings.rounds} picks): standings mostly reflect who picked first early on.`}
              >
                <span>
                  <Badge tone={conf === 'low' ? 'warn' : conf === 'medium' ? 'neutral' : 'good'}>confidence {conf}</Badge>
                </span>
              </Tip>
            )}
          </div>
          {prefs.leagueView === 'simple' ? (
            <SimpleView live={live} engine={engine} adjusted={adjusted} selected={selected} onSelect={setSelected} myTeam={d.userTeam} />
          ) : (
            <AdvancedView live={live} adjusted={adjusted} myTeam={d.userTeam} />
          )}
        </div>
      </div>
    </div>
  )
}

function leagueMean(scores: CatRecord<number>[]): CatRecord<number> {
  return catRecord((c) => mean(scores.map((s) => s[c])))
}

function SimpleView({
  live,
  engine,
  adjusted,
  selected,
  onSelect,
  myTeam,
}: {
  live: NonNullable<ReturnType<typeof useLive>>
  engine: NonNullable<ReturnType<typeof useEngine>>
  adjusted: Adjusted[]
  selected: number | null
  onSelect: (i: number | null) => void
  myTeam: number | null
}) {
  const settings = useApp((s) => s.settings)
  const openPreview = useApp((s) => s.openPreview)
  const weeks = useApp((s) => s.season.matchups)
  const meetings = useMemo(() => meetingsBySlot(weeks), [weeks])
  const lm = leagueMean(adjusted.map((a) => a.z))
  const totals = adjusted.map((a) => a.total)
  const order = [...totals.keys()].sort((a, b) => totals[b] - totals[a])
  const strengthRank = new Map(order.map((t, i) => [t, i + 1]))
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-2.5" data-testid="league-simple">
      {live.profiles.map((p, i) => {
        const r = categoryReadout(adjusted[i].z, lm, engine.scale.sigma, p.count, undefined, live.postDraft)
        const open = selected === i
        const weak = [...r.puntCandidates, ...r.recoverable]
        return (
          <article
            key={i}
            className={cn(
              'rounded-lg border bg-floor p-3 transition-colors',
              i === myTeam ? 'border-clock-line' : 'border-seam',
              open && 'col-span-2 row-span-2',
            )}
          >
            <button type="button" onClick={() => onSelect(open ? null : i)} className="flex w-full items-start justify-between gap-2 text-left" aria-expanded={open}>
              <div className="min-w-0">
                <div className={cn('truncate font-display text-[17px] font-semibold tracking-tight', i === myTeam && 'text-clock')}>
                  {teamLabel(settings, i)}
                  {i === myTeam ? ' · you' : ''}
                </div>
                <div className="text-[11px] text-chalk-3">
                  Slot {i + 1} · {p.count} {live.postDraft ? 'player' : 'pick'}
                  {p.count === 1 ? '' : 's'}
                  {p.count ? ` · ${r.label}` : ''}
                </div>
              </div>
              <Tip
                content={
                  live.postDraft
                    ? "Total strength rank across the nine categories, on today's rosters; an open roster spot counts at replacement level."
                    : "Pick-adjusted total strength rank: actual picks plus a neutral expectation for each team's remaining picks at their draft positions."
                }
              >
                <span className="shrink-0 text-right">
                  <span className="block font-mono text-[18px] font-semibold leading-none tnum">#{strengthRank.get(i)}</span>
                  <span className="text-[10px] text-chalk-4">strength</span>
                </span>
              </Tip>
            </button>
            {i !== myTeam && meetings.get(i)?.length ? <Meetings weeks={meetings.get(i)!} /> : null}
            {p.count ? (
              <>
                <div className="mt-2">
                  <CatStrip z={r.margin} scale={0.9} size="md" labels />
                </div>
                <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 text-[11.5px]">
                  <span className="text-chalk-3">Strong</span>
                  <span className="truncate text-chalk-2">{r.strengths.slice(0, 3).map(catLabel).join(', ') || '—'}</span>
                  <span className="text-chalk-3">Weak</span>
                  <span className="truncate text-chalk-2">{weak.slice(0, 3).map(catLabel).join(', ') || '—'}</span>
                </div>
              </>
            ) : (
              <div className="mt-2 text-[11.5px] text-chalk-4">No picks yet — standing will appear after the first pick.</div>
            )}
            <ul className={cn('mt-2 border-t border-seam pt-1.5', !open && 'max-h-[108px] overflow-hidden')}>
              {p.playerIds.length ? (
                p.playerIds.map((id) => {
                  const info = engine.byId.get(id)!
                  return (
                    <li key={id} className="flex h-[21px] items-center gap-1.5 text-[12px]">
                      <button type="button" className="min-w-0 truncate text-left text-chalk-2 hover:text-chalk hover:underline" onClick={() => openPreview(id)}>
                        {info.name}
                      </button>
                      <Positions positions={info.positions} className="text-[10.5px]" />
                      {open ? <span className="ml-auto font-mono text-[11px] tnum text-chalk-3">{signed(basisTotal(engine.valuation.values.get(id)!, engine.ctx.basis))}</span> : null}
                    </li>
                  )
                })
              ) : live.unvalued[i].length ? null : (
                <li className="text-[12px] text-chalk-4">No picks yet</li>
              )}
              {live.unvalued[i].map((id) => (
                <li key={id} className="flex h-[21px] items-center gap-1.5 text-[12px]">
                  <button type="button" className="min-w-0 truncate text-left text-chalk-3 hover:text-chalk hover:underline" onClick={() => openPreview(id)}>
                    {engine.byId.get(id)?.name ?? id}
                  </button>
                  <Badge tone="outline">no proj.</Badge>
                </li>
              ))}
              {live.ir[i].map((id) => (
                <li key={id} className="flex h-[21px] items-center gap-1.5 text-[12px]">
                  <button type="button" className="min-w-0 truncate text-left text-chalk-3 line-through decoration-chalk-4 hover:text-chalk" onClick={() => openPreview(id)}>
                    {engine.byId.get(id)?.name ?? id}
                  </button>
                  <Badge tone="bad">IR</Badge>
                </li>
              ))}
            </ul>
            {!open && p.playerIds.length + live.ir[i].length > 5 ? (
              <div className="mt-1 text-[11px] text-chalk-4">+{p.playerIds.length + live.ir[i].length - 5} more — click to expand</div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

interface Meeting {
  n: number
  week: MatchupWeek
}

/** Opponent slot → the weeks you play them, in schedule order. */
function meetingsBySlot(weeks: readonly MatchupWeek[]): Map<number, Meeting[]> {
  const out = new Map<number, Meeting[]>()
  ;[...weeks]
    .sort((a, b) => a.start.localeCompare(b.start))
    .forEach((week, k) => {
      if (week.opponent != null) out.set(week.opponent, [...(out.get(week.opponent) ?? []), { n: k + 1, week }])
    })
  return out
}

/** When you play this team: the next meeting (or the last, once all are past), linked to its projection. */
function Meetings({ weeks }: { weeks: Meeting[] }) {
  const today = todayIso()
  const next = weeks.find((m) => m.week.end >= today) ?? weeks[weeks.length - 1]
  const current = next.week.start <= today && today <= next.week.end
  return (
    <button
      type="button"
      onClick={() => navigate('season', next.week.id)}
      className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-chalk-3 hover:text-chalk"
      title={`You play them in week ${weeks.map((m) => m.n).join(', ')}. Open the matchup.`}
    >
      <CalendarDays size={12} className="shrink-0" />
      <span className={cn('font-medium', current ? 'text-clock' : 'text-chalk-2')}>{current ? 'This week' : `Week ${next.n}`}</span>
      <span>{rangeText(next.week.start, next.week.end)}</span>
      {weeks.length > 1 ? <span className="text-chalk-4">· {weeks.length}× this season</span> : null}
    </button>
  )
}

function AdvancedView({ live, adjusted, myTeam }: { live: NonNullable<ReturnType<typeof useLive>>; adjusted: Adjusted[]; myTeam: number | null }) {
  const settings = useApp((s) => s.settings)
  const prefs = useApp((s) => s.prefs)
  const setPrefs = useApp((s) => s.setPrefs)
  const engine = useEngine()!
  const [sort, setSort] = useState<SortKey>('total')
  const mode = prefs.leagueValue as ValueMode
  const post = live.postDraft
  // Pick-adjusted has nothing to adjust once every pick is in; full rosters (open spots at replacement) take its place.
  const basis: Basis = post && prefs.leagueBasis === 'pickAdjusted' ? 'slotAdjusted' : (prefs.leagueBasis as Basis)
  const profiles = live.profiles

  const scores = profiles.map((p, i) => (basis === 'pickAdjusted' ? adjusted[i].z : teamCategoryScore(p, basis)))
  const ranks = rankTeams(scores)
  const totalScore = scores.map((s) => CATEGORIES.reduce((a, c) => a + s[c], 0))
  const totalRank = totalScore.map((t) => 1 + totalScore.filter((x) => x > t + 1e-9).length)
  const raws = profiles.map((p, i) => (basis === 'pickAdjusted' ? adjusted[i].totals : totalsFor(p, basis)))
  // Colour = distance from the league mean in team-level σ (not the cross-team SD),
  // so near-identical teams stay neutral instead of being stretched to extremes.
  const perPlayer = basis === 'perPlayer'
  const colStats = catRecord((c) => ({
    m: mean(scores.map((s) => s[c])),
    sd: perPlayer ? Math.max(engine.scale.sdZ[c], 0.25) : engine.scale.sigma[c],
  }))
  const totalSigma = Math.sqrt(CATEGORIES.reduce((s, c) => s + colStats[c].sd ** 2, 0))
  const totalStats = { m: mean(totalScore), sd: totalSigma }

  const order = [...profiles.keys()].sort((a, b) => {
    if (sort === 'team') return a - b
    if (sort === 'total') return totalScore[b] - totalScore[a]
    return scores[b][sort] - scores[a][sort]
  })

  const header = (key: SortKey, label: string, title?: string) => (
    <th key={key} className="h-9 border-b border-seam-strong px-1 text-center align-middle" aria-sort={sort === key ? 'descending' : undefined}>
      <button
        type="button"
        onClick={() => setSort(key)}
        title={title ?? `Sort teams by ${label}`}
        className={cn('inline-flex items-center gap-0.5 font-display text-[12.5px] font-semibold tracking-wide', sort === key ? 'text-chalk' : 'text-chalk-3 hover:text-chalk')}
      >
        {label}
        {sort === key && key !== 'team' ? <ArrowDown size={11} /> : null}
      </button>
    </th>
  )

  return (
    <div data-testid="league-advanced">
      <div className="mb-2.5 flex flex-wrap items-center gap-2">
        <Segmented<ValueMode>
          label="Value shown"
          size="xs"
          value={mode}
          onChange={(v) => setPrefs({ leagueValue: v })}
          options={[
            { value: 'raw', label: 'Raw production', title: 'Projected per-game production; FG%/FT% from makes ÷ attempts' },
            { value: 'score', label: 'Category score', title: 'Sum of player z-scores (volume-weighted FG/FT, inverted TO)' },
            { value: 'rank', label: 'League rank', title: '1 = best' },
          ]}
        />
        <Segmented<Basis>
          label="Comparison basis"
          size="xs"
          value={basis}
          onChange={(v) => setPrefs({ leagueBasis: v })}
          options={
            post
              ? [
                  { value: 'slotAdjusted', label: 'Full roster', title: 'Every rostered player; an open spot (a player on IR without a pickup) counts at replacement level' },
                  { value: 'perPlayer', label: 'Per player', title: 'Average per rostered player' },
                  { value: 'current', label: 'Roster sums', title: 'Raw sums of active players — teams with an empty spot look weaker' },
                ]
              : [
                  { value: 'pickAdjusted', label: 'Pick-adjusted', title: "Actual picks + a neutral expectation for each team's remaining picks at their draft positions — fair across unequal pick counts" },
                  { value: 'slotAdjusted', label: 'Replacement-filled', title: 'Open roster slots filled at replacement level (teams with fewer picks look weaker)' },
                  { value: 'perPlayer', label: 'Per player', title: 'Average per rostered player' },
                  { value: 'current', label: 'Current roster', title: 'Raw sums of rostered players — NOT comparable across unequal roster sizes' },
                ]
          }
        />
        {basis === 'current' ? <Badge tone="warn">Raw sums: teams with more {post ? 'players' : 'picks'} look stronger</Badge> : null}

      </div>
      <div className="overflow-x-auto rounded-lg border border-seam bg-floor">
        <table className="w-full border-separate border-spacing-0 text-[12.5px]">
          <thead>
            <tr>
              <th className="h-9 border-b border-seam-strong px-3 text-left">
                <button type="button" onClick={() => setSort('team')} className="label-caps hover:text-chalk">
                  Team
                </button>
              </th>
              <th className="h-9 w-12 border-b border-seam-strong px-1 text-center font-display text-[12px] font-semibold text-chalk-3">{post ? 'Players' : 'Picks'}</th>
              {CATEGORIES.map((c) => header(c, CATEGORY_META[c].label))}
              {header('total', 'Total', 'Sort by total category score')}
            </tr>
          </thead>
          <tbody>
            {order.map((i) => {
              const p = profiles[i]
              return (
                <tr key={i} className={cn(i === myTeam && 'bg-clock-soft/50')}>
                  <td className="h-10 border-b border-seam px-3">
                    <div className={cn('truncate font-medium', i === myTeam && 'text-clock')}>{teamLabel(settings, i)}</div>
                    <div className="text-[10.5px] text-chalk-4">slot {i + 1}</div>
                  </td>
                  <td className="border-b border-seam text-center font-mono text-[12px] tnum text-chalk-2">{p.count}</td>
                  {CATEGORIES.map((c) => {
                    const z = (scores[i][c] - colStats[c].m) / colStats[c].sd
                    const raw = rawValue(raws[i], c)
                    const display =
                      mode === 'rank'
                        ? `${ranks[i][c]}`
                        : mode === 'score'
                          ? signed(scores[i][c])
                          : c === 'FG' || c === 'FT'
                            ? pct(raw)
                            : num(raw, c === 'STL' || c === 'BLK' ? 2 : 1)
                    const t = raws[i]
                    return (
                      <td key={c} className="border-b border-seam p-[2px]">
                        <Tip
                          content={
                            <div className="space-y-0.5">
                              <div className="font-medium text-chalk">
                                {teamLabel(settings, i)} · {CATEGORY_META[c].name}
                              </div>
                              <div>
                                Raw:{' '}
                                {c === 'FG'
                                  ? `${pct(t.fgPct)} (${num(t.fgm)}/${num(t.fga)})${t.fgMissing ? ` · ${t.fgMissing} player(s) without attempts excluded` : ''}`
                                  : c === 'FT'
                                    ? `${pct(t.ftPct)} (${num(t.ftm)}/${num(t.fta)})${t.ftMissing ? ` · ${t.ftMissing} excluded` : ''}`
                                    : `${num(raw, 2)} per game`}
                              </div>
                              <div>Category score: {signed(scores[i][c], 2)} z</div>
                              <div>League rank: {ranks[i][c]} of {profiles.length}</div>
                              {c === 'TO' ? <div className="text-chalk-3">Fewer turnovers = better (score inverted).</div> : null}
                            </div>
                          }
                        >
                          <div
                            className="flex h-9 min-w-[54px] items-center justify-center rounded-[4px] font-mono text-[12px] tnum text-chalk"
                            style={{ background: divergingFill(z, 0.75, 0.7) }}
                          >
                            {display}
                          </div>
                        </Tip>
                      </td>
                    )
                  })}
                  <td className="border-b border-seam p-[2px]">
                    <div
                      className="flex h-9 min-w-[64px] items-center justify-center rounded-[4px] font-mono text-[12px] font-semibold tnum"
                      style={{ background: divergingFill((totalScore[i] - totalStats.m) / totalStats.sd, 0.5, 0.7) }}
                    >
                      {mode === 'rank' ? totalRank[i] : signed(totalScore[i])}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
