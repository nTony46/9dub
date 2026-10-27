import { Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SideProjection } from '@/analytics/matchup'
import { streamingTeams, type TeamFit } from '@/analytics/streaming'
import { Segmented } from '@/components/ui/Controls'
import { Tip } from '@/components/ui/Tooltip'
import { NBA_CITY_CODES } from '@/data/schedule'
import { cn } from '@/lib/cn'
import { useApp } from '@/store/appStore'
import type { EngineData } from '@/store/derived'
import { irPlacement } from '@/store/season'
import { dayLabel, shortName, type ScheduleIndex } from './model'

const CITY: Record<string, string> = Object.fromEntries(Object.entries(NBA_CITY_CODES).map(([city, code]) => [code, city]))
const dow = (iso: string) => dayLabel(iso).dow

/**
 * The matchup week at a glance, as a lineup calendar: one row per roster slot
 * (PG … UTIL, BE, IR) and, for each day, who fills it. Players stay in their
 * usual slot; when a starter has no game, a bench player with a game who fits
 * takes the seat. On top, both sides' games that count, day by day and for the
 * week; below, in the same columns, NBA teams whose games land on the empty
 * nights.
 */
export function WeekGrid({
  me,
  them,
  rosters,
  names,
  engine,
  index,
  from,
}: {
  me: SideProjection
  them: SideProjection
  rosters: { me: string[]; them: string[] }
  names: { me: string; them: string }
  engine: EngineData
  index: ScheduleIndex
  /** First day still to play (today, or the week's start if it hasn't begun). */
  from: string
}) {
  const [who, setWho] = useState<'me' | 'them'>('me')
  const [legend, setLegend] = useState(false)
  const openPreview = useApp((s) => s.openPreview)
  const injuries = useApp((s) => s.season.injuries)
  const irSlots = useApp((s) => s.settings.irSlots)
  const rounds = useApp((s) => s.settings.rounds)
  const side = who === 'me' ? me : them
  const ids = who === 'me' ? rosters.me : rosters.them
  const seats = side.days[0]?.lineup.length ?? 10
  const left = side.days.filter((d) => d.date >= from)
  const sits = left.reduce((s, d) => s + d.benched.length, 0)
  const empty = left.reduce((s, d) => s + d.open, 0)
  const hasOpp = rosters.them.length > 0
  const tally = [
    { key: 'me' as const, name: names.me, days: me.days.map((d) => d.started.length), total: me.starts },
    ...(hasOpp ? [{ key: 'them' as const, name: names.them, days: them.days.map((d) => d.started.length), total: them.starts }] : []),
  ]
  const leftOf = (s: SideProjection) => s.days.reduce((n, d) => n + (d.date >= from ? d.started.length : 0), 0)
  const inProgress = side.days.some((d) => d.date < from) && left.length > 0

  const perDay = useMemo(
    () =>
      side.days.map((d) => {
        const { ir } = irPlacement(ids, injuries, irSlots, d.date)
        const onIr = new Set(ir)
        return { ir, bench: [...d.bench, ...d.out.filter((id) => !onIr.has(id))] }
      }),
    [side.days, ids, injuries, irSlots],
  )
  const starterSlots = side.days[0]?.lineup.map((s) => s.slot) ?? []
  const beRows = Math.max(Math.max(0, rounds - seats), ...perDay.map((x) => x.bench.length))
  const rows: { slot: string; at: (j: number) => string | null; kind: 'start' | 'bench' | 'ir'; i: number }[] = [
    ...starterSlots.map((slot, i) => ({ slot, i, kind: 'start' as const, at: (j: number) => side.days[j].lineup[i]?.id ?? null })),
    ...Array.from({ length: beRows }, (_, i) => ({ slot: 'BE', i, kind: 'bench' as const, at: (j: number) => perDay[j].bench[i] ?? null })),
    ...Array.from({ length: irSlots }, (_, i) => ({ slot: 'IR', i, kind: 'ir' as const, at: (j: number) => perDay[j].ir[i] ?? null })),
  ]

  return (
    <div data-testid="week-grid">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        {hasOpp ? (
          <Tip content={`Games in a starting slot (the ones that count), ${names.me} first; day by day in the grid. ${inProgress ? 'Days already played are counted with today’s rosters. ' : ''}Pickups and injuries change it.`}>
            <span className="flex items-baseline gap-2" data-testid="games-tally">
              <span className="font-display text-[34px] font-semibold leading-none tnum">
                <span className={me.starts > them.starts ? 'text-plus' : me.starts < them.starts ? 'text-minus' : 'text-chalk'}>{me.starts}</span>
                <span className="text-chalk-4">–</span>
                {them.starts}
              </span>
              <span className="text-[13px] text-chalk-2">
                games{inProgress ? ` · ${leftOf(me)}–${leftOf(them)} left` : ''}
              </span>
            </span>
          </Tip>
        ) : null}
        <Stat value={sits} label={sits === 1 ? 'start sits' : 'starts sit'} tone={sits ? 'text-warn' : 'text-chalk'} />
        <Stat value={empty} label={empty === 1 ? 'seat empty' : 'seats empty'} tone={empty ? 'text-chalk' : 'text-plus'} />
        <button
          type="button"
          onClick={() => setLegend((v) => !v)}
          aria-expanded={legend}
          className={cn('mb-0.5 flex h-6 items-center gap-1 rounded-md border px-1.5 text-[12px] hover:text-chalk', legend ? 'border-seam-strong text-chalk-2' : 'border-seam text-chalk-3')}
        >
          <Info size={12} /> Legend
        </button>
        <Segmented<'me' | 'them'>
          className="ml-auto"
          label="Whose week"
          size="xs"
          value={who}
          onChange={setWho}
          options={[
            { value: 'me', label: names.me },
            { value: 'them', label: names.them },
          ]}
        />
      </div>
      {legend ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-chalk-3" data-testid="week-legend">
          <Legend cls="border-plus/45 bg-plus/15" text="plays" />
          <Legend cls="border-dashed border-warn/70" text="sits — crowded night" />
          <Legend cls="border-bad/45 bg-bad/15" text="out" />
          <span className="flex items-center gap-1.5">
            <span className="text-chalk-4">—</span> no game
          </span>
          {who === 'me' ? (
            <>
              <Legend cls="border-dashed border-chalk-3" text="team fits one position only" />
              <Legend cls="border-seam" text="night already full" />
            </>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed border-separate border-spacing-0 text-[13.5px]">
          <colgroup>
            <col className="w-[150px]" />
          </colgroup>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-floor pb-2 text-left align-bottom text-[12px] font-medium text-chalk-3">Slot</th>
              {side.days.map((d) => {
                const past = d.date < from
                const limited = d.open > 0 && d.fits.length < 5
                return (
                  <th key={d.date} className={cn('px-1 pb-2 text-center align-bottom font-normal', past && 'opacity-45')}>
                    <div className="font-display text-[13px] font-semibold uppercase tracking-wide text-chalk-2">{dow(d.date)}</div>
                    <div className="text-[12px] text-chalk-3">{dayLabel(d.date).day}</div>
                    <div className="mt-0.5 whitespace-nowrap text-[12px] font-medium">
                      {d.open ? (
                        <Tip content={limited ? `Only a ${d.fits.join('/')} adds a start (the open seat is position-specific).` : 'Any position fills these seats.'}>
                          <span className="text-chalk">
                            {d.open} open{limited ? ` · ${d.fits.join('/')}` : ''}
                          </span>
                        </Tip>
                      ) : null}
                      {d.open && d.benched.length ? <span className="text-chalk-4"> · </span> : null}
                      {d.benched.length ? <span className="text-warn">{d.benched.length} sit</span> : null}
                      {!d.open && !d.benched.length ? <span className="text-plus">full</span> : null}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {tally.map((t, k) => (
              <tr key={t.key} data-testid={`games-row-${t.key}`}>
                <td className={cn('sticky left-0 z-10 h-9 border-t bg-floor pr-2', k === 0 ? 'border-seam-strong' : 'border-seam')}>
                  <div className="flex items-baseline gap-2">
                    <span className={cn('min-w-0 truncate text-[12px] font-medium', t.key === 'me' ? 'text-clock' : 'text-chalk-2')}>{t.name}</span>
                    <Tip content={`${t.total} games in a starting slot this week`}>
                      <span className="ml-auto shrink-0 font-mono text-[13px] font-semibold tnum text-chalk">{t.total}</span>
                    </Tip>
                  </div>
                </td>
                {t.days.map((n, j) => {
                  const other = tally.length > 1 ? tally[1 - k].days[j] : n
                  return (
                    <td
                      key={side.days[j].date}
                      className={cn(
                        'border-t text-center font-mono text-[13px] tnum',
                        k === 0 ? 'border-seam-strong' : 'border-seam',
                        n > other ? 'font-semibold text-chalk' : n < other ? 'text-chalk-3' : 'text-chalk-2',
                        side.days[j].date < from && 'opacity-45',
                      )}
                    >
                      {n}
                    </td>
                  )
                })}
              </tr>
            ))}
            {rows.map((r, k) => {
              const divider = k === 0 || rows[k - 1].kind !== r.kind
              const edge = divider ? 'border-seam-strong' : 'border-seam'
              return (
                <tr key={`${r.slot}-${r.i}`}>
                  <td className={cn('sticky left-0 z-10 h-[52px] border-t bg-floor font-display text-[13.5px] font-semibold tracking-wide', edge, r.kind === 'ir' ? 'text-bad/80' : 'text-chalk-3')}>{r.slot}</td>
                  {side.days.map((d, j) => {
                    const id = r.at(j)
                    const past = d.date < from
                    if (!id)
                      return (
                        <td key={d.date} className={cn('border-t px-1 text-center text-chalk-4', edge, past && 'opacity-45')}>
                          ·
                        </td>
                      )
                    const p = engine.byId.get(id)
                    const w = side.players.get(id)
                    const game = p?.team ? index.gameOf.get(d.date)?.get(p.team) : undefined
                    const state =
                      r.kind === 'ir' || d.out.includes(id) ? 'out' : d.started.includes(id) ? 'plays' : d.benched.includes(id) ? 'sits' : 'idle'
                    return (
                      <td key={d.date} className={cn('border-t px-1 py-1', edge, past && 'opacity-45')}>
                        <Tip
                          content={
                            <div className="space-y-0.5">
                              <div className="font-medium text-chalk">
                                {p?.name ?? id} <span className="text-chalk-3">{p?.positions.join('/')}</span>
                              </div>
                              <div>{game ? `${game}` : 'No game'} · {w?.games ?? 0} game{w?.games === 1 ? '' : 's'} this week</div>
                              {state === 'sits' ? <div className="text-warn">Has a game, but every seat he fits is taken.</div> : null}
                              {state === 'out' ? <div className="text-bad">Marked out.</div> : null}
                              {game && !p?.line ? <div>No projection — not counted.</div> : null}
                            </div>
                          }
                        >
                          <button
                            type="button"
                            onClick={() => openPreview(id)}
                            className={cn(
                              'block w-full rounded-md border px-1.5 py-1 text-left leading-tight',
                              state === 'plays' && 'border-plus/45 bg-plus/15',
                              state === 'sits' && 'border-dashed border-warn/70',
                              state === 'out' && 'border-bad/45 bg-bad/15',
                              state === 'idle' && 'border-transparent',
                            )}
                          >
                            <span className={cn('block truncate text-[12.5px] font-medium', state === 'idle' ? 'text-chalk-3' : state === 'sits' ? 'text-warn' : state === 'out' ? 'text-bad' : 'text-chalk')}>
                              {shortName(p?.name ?? id)}
                            </span>
                            <span className={cn('block truncate font-mono text-[11px]', state === 'plays' ? 'text-chalk-2' : 'text-chalk-4')}>
                              {state === 'out' ? 'out' : game ? game.replace(' ', '').replace('vs', '') : '—'}
                            </span>
                          </button>
                        </Tip>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
            {who === 'me' ? <StreamingRows days={me.days} index={index} from={from} /> : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className={cn('font-display text-[34px] font-semibold leading-none tnum', tone)}>{value}</span>
      <span className="text-[13px] text-chalk-2">{label}</span>
    </span>
  )
}

function Legend({ cls, text }: { cls: string; text: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('inline-block h-3.5 w-5 rounded border', cls)} />
      {text}
    </span>
  )
}

/**
 * NBA teams to stream from, as rows aligned with the player grid: each team's
 * game sits under its day — filled on open nights, dashed when only one
 * position adds a start, muted when the night is already full.
 */
function StreamingRows({ days, index, from }: { days: SideProjection['days']; index: ScheduleIndex; from: string }) {
  const [mode, setMode] = useState<'open' | 'b2b'>('open')
  const fits = useMemo(() => streamingTeams(days, (d) => index.byDate.get(d), from), [days, index, from])
  const anyDays = (f: TeamFit) => f.days.filter((d) => !d.positions).length
  const ranked = [...fits].sort((a, b) => anyDays(b) - anyDays(a) || b.days.length - a.days.length || b.b2b.length - a.b2b.length || b.teamGames - a.teamGames)
  const rows = (mode === 'b2b' ? ranked.filter((f) => f.b2b.length) : ranked).slice(0, mode === 'b2b' ? 12 : 8)
  const open = days.some((d) => d.date >= from && d.open > 0)
  return (
    <>
      <tr>
        <td colSpan={days.length + 1} className="border-t-2 border-seam-strong pb-1.5 pt-3">
          <div className="flex flex-wrap items-center gap-3" data-testid="streaming-teams">
            <Tip content="NBA teams whose games land on your open nights from today on. +N counts nights where any position starts; dashed nights only help with the listed position.">
              <h4 className="label-caps">Fill the empty seats</h4>
            </Tip>
            <Segmented<'open' | 'b2b'>
              label="Team suggestions"
              size="xs"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'open', label: 'Most open nights' },
                { value: 'b2b', label: 'Back-to-backs' },
              ]}
            />
          </div>
        </td>
      </tr>
      {!open || !rows.length ? (
        <tr>
          <td colSpan={days.length + 1} className="border-t border-seam py-3 text-[13.5px] text-chalk-3">
            {!open ? 'No open seats left this week.' : 'No team plays two of your open nights in a row.'}
          </td>
        </tr>
      ) : (
        rows.map((f) => {
          const fitOn = new Map(f.days.map((d) => [d.date, d.positions]))
          const b2bDays = new Set(f.b2b.flat())
          return (
            <tr key={f.team} data-testid="stream-team">
              <td className="sticky left-0 z-10 h-[52px] border-t border-seam bg-floor pr-2">
                <div className="flex items-center gap-2">
                  <Tip content={CITY[f.team] ?? f.team}>
                    <span className="font-mono text-[13.5px] font-semibold">{f.team}</span>
                  </Tip>
                  <span className="ml-auto flex shrink-0 items-center gap-1.5 pr-1">
                    {f.b2b.length ? <span className="rounded bg-clock-soft px-1 py-px text-[11px] font-semibold text-clock">B2B</span> : null}
                    <span className="w-7 text-right font-mono text-[13.5px] font-semibold tnum text-plus">+{anyDays(f)}</span>
                  </span>
                </div>
              </td>
              {days.map((d) => {
                const game = index.gameOf.get(d.date)?.get(f.team)
                const past = d.date < from
                const helps = fitOn.has(d.date)
                const only = fitOn.get(d.date)
                const open = helps && !past
                const b2b = b2bDays.has(d.date) && !past
                if (!game)
                  return (
                    <td key={d.date} className={cn('border-t border-seam px-1 text-center text-chalk-4', past && 'opacity-45')}>
                      ·
                    </td>
                  )
                return (
                  <td key={d.date} className={cn('border-t border-seam px-1 py-1', past && 'opacity-45')}>
                    <Tip content={past ? 'Already played' : !helps ? 'You have no open seat this night' : only ? `Only a ${only.join('/')} adds a start this night` : `Open seat — any position starts${b2b ? ' (back-to-back)' : ''}`}>
                      <div
                        className={cn(
                          'block w-full rounded-md border px-1.5 py-1 text-left leading-tight',
                          open && !only ? 'border-plus/45 bg-plus/15' : open && only ? 'border-dashed border-chalk-3' : 'border-seam',
                        )}
                      >
                        <span className={cn('block truncate text-[12.5px] font-medium', open ? 'text-chalk' : 'text-chalk-4')}>{game.replace(' ', '').replace('vs', '')}</span>
                        <span className={cn('block truncate font-mono text-[11px]', open ? 'text-chalk-2' : 'text-chalk-4')}>{open && only ? `${only.join('/')} only` : b2b ? 'B2B' : '\u00a0'}</span>
                      </div>
                    </Tip>
                  </td>
                )
              })}
            </tr>
          )
        })
      )}
    </>
  )
}
