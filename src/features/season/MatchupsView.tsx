import { CalendarDays, Plus, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { scoreText } from '@/analytics/matchup'
import { navigate, useRoute } from '@/app/router'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Controls'
import { Tip } from '@/components/ui/Tooltip'
import { Empty, Panel } from '@/components/ui/Panel'
import { cn } from '@/lib/cn'
import { ordinal } from '@/lib/format'
import { useApp } from '@/store/appStore'
import { teamLabel, useEngine, useLineupSlots, type EngineData } from '@/store/derived'
import { currentWeek, todayIso } from '@/store/season'
import type { LeagueSeed, MatchupWeek } from '@/store/schema'
import { FinalDetail, MatchupDetail } from './MatchupDetail'
import { finalFor, liveFor, opponentName, projectWeek, rangeText, useCurrentRosters, useInjuries, useScheduleIndex, type ProjectionOptions } from './model'

export function MatchupsView() {
  const engine = useEngine()
  const index = useScheduleIndex()
  const settings = useApp((s) => s.settings)
  const weeks = useApp((s) => s.season.matchups)
  const { rosters, teamOf } = useCurrentRosters()
  const me = settings.userSlot != null && settings.userSlot <= settings.teams ? settings.userSlot - 1 : null
  const injuries = useInjuries()
  const [availability, setAvailability] = useState(settings.valuationBasis === 'gpAware')
  const slots = useLineupSlots()
  const opts = useMemo<ProjectionOptions>(() => ({ availability, injuries, slots }), [availability, injuries, slots])
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [mapping, setMapping] = useState(false)
  const syncTeamNames = useApp((s) => s.syncTeamNames)
  useEffect(() => syncTeamNames(), [syncTeamNames, weeks])

  const sorted = useMemo(() => [...weeks].sort((a, b) => a.start.localeCompare(b.start)), [weeks])
  // A link from elsewhere (#/season/<week id>) opens that week until another is picked here.
  const { sub } = useRoute()
  const week = sorted.find((w) => w.id === (selected ?? sub)) ?? currentWeek(sorted, todayIso())
  const unmapped = sorted.some((w) => w.opponent == null && w.label)

  const espnLive = useApp((s) => s.season.espn?.live)
  const espnResults = useApp((s) => s.season.espn?.results)
  const standing = useApp((s) => (me == null ? undefined : s.season.espn?.standings.find((t) => t.slot === me + 1)))
  // Weeks ESPN has scored show their final score; the rest are projected.
  const finals = useMemo(() => {
    const out = new Map<string, NonNullable<ReturnType<typeof finalFor>>>()
    if (me == null) return out
    sorted.forEach((w, i) => {
      const f = finalFor(espnResults, i + 1, me)
      if (f) out.set(w.id, f)
    })
    return out
  }, [espnResults, sorted, me])
  const summaries = useMemo(() => {
    if (!engine || !index || me == null) return new Map<string, ReturnType<typeof projectWeek>>()
    return new Map(
      sorted
        .filter((w) => w.opponent != null && w.opponent < rosters.length && !finals.has(w.id))
        .map((w) => [w.id, projectWeek(engine, index, rosters[me], rosters[w.opponent!], w.start, w.end, opts, liveFor(espnLive, sorted.indexOf(w) + 1, me, w.opponent))]),
    )
  }, [engine, index, me, sorted, rosters, opts, espnLive, finals])

  if (!engine) return <Empty title="No dataset loaded" />
  if (me == null)
    return (
      <Panel title="Set your draft slot">
        <p className="text-[13px] text-chalk-2">Matchups compare your roster with your opponent&apos;s, so 9dub needs to know which draft slot is yours.</p>
        <Button className="mt-3" size="sm" onClick={() => navigate('settings', 'league')}>
          Open league settings
        </Button>
      </Panel>
    )

  const results = [...summaries.values()]
  const won = results.filter((p) => p.call.wins > p.call.losses).length
  const lost = results.filter((p) => p.call.wins < p.call.losses).length
  const tied = results.length - won - lost
  // Once a week is scored, the subtitle is ESPN's standings line: the season record in categories and your place.
  const played = standing && standing.wins + standing.losses + standing.ties > 0
  const subtitle = played
    ? `Record ${scoreText(standing)}${standing.rank ? ` · ${ordinal(standing.rank)} of ${settings.teams}` : ''}`
    : summaries.size
      ? `Projected record ${won}–${lost}${tied ? `–${tied}` : ''}`
      : undefined
  const weekFinal = week ? finals.get(week.id) : undefined
  return (
    <div className="grid gap-4" data-testid="matchups-view">
      {!index ? <ScheduleSetup /> : null}
      {!sorted.length ? <LeagueSetup /> : null}
      {sorted.length && (unmapped || mapping) ? <OpponentMapper weeks={sorted} engine={engine} rosters={rosters} me={me} onDone={() => setMapping(false)} /> : null}

      {index && sorted.length ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_316px]">
          <div className="min-w-0">
            {week && weekFinal ? (
              <FinalDetail key={week.id} week={week} weekNo={sorted.indexOf(week) + 1} final={weekFinal} me={me} />
            ) : week && week.opponent != null ? (
              <MatchupDetail
                key={`${week.id}-${week.opponent}`}
                week={week}
                weekNo={sorted.indexOf(week) + 1}
                weeks={sorted}
                engine={engine}
                index={index}
                rosters={rosters}
                teamOf={teamOf}
                me={me}
                opts={opts}
                setOpts={(o) => setAvailability(o.availability)}
              />
            ) : (
              <Panel title="Pick a week">
                <p className="text-[13px] text-chalk-3">{week ? 'Match this week’s opponent to a draft slot to see the projection.' : 'Choose a week from the schedule.'}</p>
              </Panel>
            )}
          </div>

          <Panel
            title="Your schedule"
            subtitle={subtitle}
            actions={
              <>
                <Button size="xs" variant="ghost" onClick={() => setMapping((m) => !m)}>
                  Opponents
                </Button>
                <Button size="xs" variant="ghost" onClick={() => setEditing((e) => !e)}>
                  {editing ? 'Done' : 'Edit'}
                </Button>
              </>
            }
            bodyClassName="px-2 pb-2"
          >
            <ol data-testid="season-weeks">
              {sorted.map((w, i) => {
                const p = summaries.get(w.id)
                const f = finals.get(w.id)
                const active = w.id === week?.id
                return (
                  <li key={w.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(w.id)}
                      aria-current={active ? 'true' : undefined}
                      className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-stand', active && 'bg-stand')}
                    >
                      <span className="w-6 shrink-0 font-mono text-[11.5px] tnum text-chalk-4">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium" title={rangeText(w.start, w.end)}>
                        <span className="font-normal text-chalk-3">{w.away ? '@ ' : 'vs '}</span>
                        {opponentName(settings, w)}
                      </span>
                      {f ? (
                        <Tip content="Final (ESPN)">
                          <span
                            className={cn(
                              'shrink-0 rounded px-1.5 py-0.5 font-mono text-[12.5px] font-semibold tnum',
                              f.me.wins > f.me.losses ? 'bg-plus/20 text-plus' : f.me.wins < f.me.losses ? 'bg-minus/20 text-minus' : 'bg-stand text-chalk',
                            )}
                            data-testid="week-final"
                          >
                            {f.me.wins > f.me.losses ? 'W' : f.me.wins < f.me.losses ? 'L' : 'T'} {scoreText(f.me)}
                          </span>
                        </Tip>
                      ) : p ? (
                        <span
                          className={cn(
                            'shrink-0 rounded px-1.5 py-0.5 font-mono text-[12.5px] font-semibold tnum',
                            p.call.wins > p.call.losses ? 'bg-plus/12 text-plus' : p.call.wins < p.call.losses ? 'bg-minus/12 text-minus' : 'bg-stand text-chalk-2',
                          )}
                        >
                          {scoreText(p.call)}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[11.5px] text-warn">assign</span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ol>
          </Panel>
        </div>
      ) : null}

      {editing ? <ScheduleEditor weeks={sorted} me={me} /> : null}
    </div>
  )
}

function ScheduleSetup() {
  const importSchedule = useApp((s) => s.importSchedule)
  const ref = useRef<HTMLInputElement>(null)
  return (
    <Panel title="NBA schedule needed" subtitle="Matchup projections count how many games each player's NBA team plays in a week.">
      <ol className="list-decimal space-y-1.5 pl-5 text-[13px] text-chalk-2">
        <li>Download the NBA&apos;s &ldquo;Regular Season Schedule By Date&rdquo; PDF.</li>
        <li>
          Run <code className="rounded bg-well px-1.5 py-0.5 font-mono text-[12px]">npm run data:schedule -- --file &quot;path/to/schedule.pdf&quot;</code>, then reload this page.
        </li>
        <li>Or import a schedule JSON that command created.</li>
      </ol>
      <Button className="mt-3" size="sm" variant="subtle" onClick={() => ref.current?.click()}>
        <Upload size={13} /> Import schedule JSON
      </Button>
      <input
        ref={ref}
        type="file"
        accept="application/json,.json"
        className="hidden"
        data-testid="import-schedule"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          let json: unknown
          try {
            json = JSON.parse(await f.text())
          } catch {
            return toast.error('That file is not valid JSON.')
          }
          const r = await importSchedule(json)
          if (r.ok) toast.success('NBA schedule loaded')
          else toast.error(r.error ?? 'Import failed')
        }}
      />
    </Panel>
  )
}

function LeagueSetup() {
  const fetchLeagueSeed = useApp((s) => s.fetchLeagueSeed)
  const applyLeagueSeed = useApp((s) => s.applyLeagueSeed)
  const addMatchup = useApp((s) => s.addMatchup)
  const [seed, setSeed] = useState<LeagueSeed | null>(null)
  useEffect(() => {
    void fetchLeagueSeed().then(setSeed)
  }, [fetchLeagueSeed])
  const opponents = seed ? new Set(seed.matchups.map((m) => m.opponent)).size : 0
  return (
    <Panel title="Your matchup schedule">
      <div className="flex flex-wrap items-center gap-3">
        {seed ? (
          <>
            <Button variant="primary" size="sm" onClick={() => applyLeagueSeed(seed)} data-testid="load-league-seed">
              <CalendarDays size={13} /> Load league schedule ({seed.matchups.length} weeks, {opponents} opponents)
            </Button>
            <span className="text-[12.5px] text-chalk-3">Found on this computer (.local-data).</span>
          </>
        ) : null}
        <Button variant={seed ? 'ghost' : 'subtle'} size="sm" onClick={() => addMatchup()} data-testid="add-week">
          <Plus size={13} /> Add a week manually
        </Button>
      </div>
    </Panel>
  )
}

/** Match each league team name to the draft slot that drafted it. */
function OpponentMapper({ weeks, engine, rosters, me, onDone }: { weeks: MatchupWeek[]; engine: EngineData; rosters: string[][]; me: number; onDone: () => void }) {
  const settings = useApp((s) => s.settings)
  const assignOpponent = useApp((s) => s.assignOpponent)
  const labels = [...new Map(weeks.filter((w) => w.label).map((w) => [w.label, w])).values()]
  const taken = new Map<number, string>()
  labels.forEach((w) => w.opponent != null && taken.set(w.opponent, w.label))
  const top = (i: number) =>
    [...rosters[i]]
      .filter((id) => engine.valuation.values.has(id))
      .sort((a, b) => engine.valuation.values.get(a)!.rank - engine.valuation.values.get(b)!.rank)
      .slice(0, 2)
      .map((id) => engine.byId.get(id)!.name)
      .join(', ')
  const missing = labels.filter((w) => w.opponent == null).length
  return (
    <Panel
      title="Match opponents to draft slots"
      actions={
        !missing ? (
          <Button size="xs" variant="ghost" onClick={onDone}>
            Done
          </Button>
        ) : (
          <Badge tone="warn">{missing} left</Badge>
        )
      }
    >
      <div className="grid gap-x-6 gap-y-2 md:grid-cols-2" data-testid="opponent-mapper">
        {labels.map((w) => (
          <label key={w.label} className="flex items-center gap-3 text-[13px]">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{w.label}</span>
              {w.owner ? <span className="block truncate text-[11.5px] text-chalk-3">{w.owner}</span> : null}
            </span>
            <Select
              value={w.opponent ?? ''}
              onChange={(e) => assignOpponent(w.label, e.target.value === '' ? null : Number(e.target.value))}
              className={cn('h-8 w-[260px] text-[12.5px]', w.opponent == null && 'border-warn/50')}
              aria-label={`Draft slot for ${w.label}`}
            >
              <option value="">Choose slot…</option>
              {rosters.map((_, i) =>
                i === me ? null : (
                  <option key={i} value={i}>
                    Slot {i + 1} · {top(i) || teamLabel(settings, i)}
                    {taken.has(i) && taken.get(i) !== w.label ? ' (used)' : ''}
                  </option>
                ),
              )}
            </Select>
          </label>
        ))}
      </div>
    </Panel>
  )
}

function ScheduleEditor({ weeks, me }: { weeks: MatchupWeek[]; me: number }) {
  const settings = useApp((s) => s.settings)
  const updateMatchup = useApp((s) => s.updateMatchup)
  const removeMatchup = useApp((s) => s.removeMatchup)
  const addMatchup = useApp((s) => s.addMatchup)
  return (
    <Panel title="Edit schedule" actions={<Button size="xs" variant="subtle" onClick={() => addMatchup()}><Plus size={12} /> Week</Button>}>
      <table className="w-full text-[13px]" data-testid="schedule-editor">
        <thead>
          <tr className="text-left text-[12px] text-chalk-3">
            <th className="h-8 w-8 font-medium">#</th>
            <th className="font-medium">Start</th>
            <th className="font-medium">End</th>
            <th className="font-medium">Opponent</th>
            <th className="font-medium">Name in league</th>
            <th className="font-medium">Away</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {weeks.map((w, i) => (
            <tr key={w.id} className="h-10 border-t border-seam">
              <td className="font-mono text-[12px] tnum text-chalk-4">{i + 1}</td>
              <td>
                <Input type="date" value={w.start} onChange={(e) => e.target.value && updateMatchup(w.id, { start: e.target.value })} className="h-8 w-[150px]" aria-label={`Week ${i + 1} start`} />
              </td>
              <td>
                <Input type="date" value={w.end} onChange={(e) => e.target.value && updateMatchup(w.id, { end: e.target.value })} className="h-8 w-[150px]" aria-label={`Week ${i + 1} end`} />
              </td>
              <td>
                <Select value={w.opponent ?? ''} onChange={(e) => updateMatchup(w.id, { opponent: e.target.value === '' ? null : Number(e.target.value) })} className="h-8 w-[200px] text-[12.5px]" aria-label={`Week ${i + 1} opponent`}>
                  <option value="">—</option>
                  {Array.from({ length: settings.teams }, (_, k) =>
                    k === me ? null : (
                      <option key={k} value={k}>
                        {teamLabel(settings, k)}
                      </option>
                    ),
                  )}
                </Select>
              </td>
              <td>
                <Input value={w.label} onChange={(e) => updateMatchup(w.id, { label: e.target.value })} className="h-8 w-[200px]" aria-label={`Week ${i + 1} opponent name`} />
              </td>
              <td>
                <input type="checkbox" checked={w.away} onChange={(e) => updateMatchup(w.id, { away: e.target.checked })} aria-label={`Week ${i + 1} away`} className="accent-[var(--clock)]" />
              </td>
              <td className="text-right">
                <Button size="xs" variant="ghost" onClick={() => removeMatchup(w.id)} aria-label={`Remove week ${i + 1}`}>
                  <Trash2 size={12} />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}
