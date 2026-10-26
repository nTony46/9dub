import { useMemo } from 'react'
import { CATEGORIES, CATEGORY_META, type Category } from '@/analytics/categories'
import type { TeamProfile, TeamTotals } from '@/analytics/team'
import { navigate } from '@/app/router'
import { Tip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { divergingFill } from '@/lib/diverging'
import { num, pct, signed } from '@/lib/format'
import { useApp } from '@/store/appStore'
import { teamLabel, useLineupSlots, type EngineData } from '@/store/derived'
import { todayIso } from '@/store/season'
import { liveFor, projectWeek, rangeText, useCurrentRosters, useInjuries, useScheduleIndex } from '@/features/season/model'

/** Within this many team-level σ a category reads as even rather than an edge either way. */
const EVEN = 0.05

function raw(t: TeamTotals, c: Category): number | null {
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

const shown = (c: Category, v: number | null) => (c === 'FG' || c === 'FT' ? pct(v) : num(v, 1))

interface Cell {
  /** My total minus theirs (percentage points for FG% / FT%). */
  diff: number | null
  /** Colour position: my edge over the noise scale (week) or over team-level spread (per game). */
  z: number | null
  mine: number | null
  theirs: number | null
}

/**
 * Your roster against each team, category by category, in schedule order.
 * With the NBA schedule loaded each row is the projection of the week you
 * play them — the same numbers as Season (real game counts, daily lineups,
 * players marked out, live totals for the week in progress). Without it, it
 * falls back to per-game season strength.
 */
export function HeadToHead({ profiles, me, engine }: { profiles: TeamProfile[]; me: number; engine: EngineData }) {
  const settings = useApp((s) => s.settings)
  const weeks = useApp((s) => s.season.matchups)
  const espnLive = useApp((s) => s.season.espn?.live)
  const index = useScheduleIndex()
  const slots = useLineupSlots()
  const { rosters } = useCurrentRosters()
  const injuries = useInjuries()
  const today = todayIso()
  const rows = useMemo(() => {
    const sorted = [...weeks].sort((a, b) => a.start.localeCompare(b.start))
    const mine = profiles[me]
    const opts = { availability: settings.valuationBasis === 'gpAware', injuries, slots }
    return profiles
      .map((p, i) => {
        if (i === me) return null
        const meetings = sorted.map((w, k) => ({ n: k + 1, w })).filter((m) => m.w.opponent === i)
        const next = meetings.find((m) => m.w.end >= today) ?? meetings[meetings.length - 1] ?? null
        if (index && next) {
          const { call } = projectWeek(engine, index, rosters[me], rosters[i], next.w.start, next.w.end, opts, liveFor(espnLive, next.n, me, i))
          const cells = call.calls.map<Cell>((c) => ({
            diff: c.mine == null || c.theirs == null ? null : c.cat === 'FG' || c.cat === 'FT' ? (c.mine - c.theirs) * 100 : c.mine - c.theirs,
            z: c.edge != null && c.noise ? c.edge / c.noise : null,
            mine: c.mine,
            theirs: c.theirs,
          }))
          return { i, next, cells, won: call.wins, lost: call.losses, even: call.ties, perWeek: true }
        }
        const cells = CATEGORIES.map<Cell>((c) => {
          const a = raw(mine.totalsSlot, c)
          const b = raw(p.totalsSlot, c)
          return { diff: a != null && b != null ? (c === 'FG' || c === 'FT' ? (a - b) * 100 : a - b) : null, z: (mine.zSlot[c] - p.zSlot[c]) / engine.scale.sigma[c], mine: a, theirs: b }
        })
        const won = cells.filter((c) => (c.z ?? 0) > EVEN).length
        const lost = cells.filter((c) => (c.z ?? 0) < -EVEN).length
        return { i, next, cells, won, lost, even: CATEGORIES.length - won - lost, perWeek: false }
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => (a.next?.w.start ?? '9999').localeCompare(b.next?.w.start ?? '9999') || a.i - b.i)
  }, [profiles, me, engine, weeks, today, index, rosters, injuries, espnLive, settings.valuationBasis, slots])

  return (
    <div className="overflow-x-auto" data-testid="head-to-head">
      <table className="w-full table-fixed border-separate border-spacing-0 text-[12.5px]">
        <colgroup>
          <col className="w-[34%]" />
          {CATEGORIES.map((c) => (
            <col key={c} />
          ))}
          <col className="w-[52px]" />
        </colgroup>
        <thead>
          <tr>
            <th className="h-8 border-b border-seam-strong pr-2 text-left label-caps">Opponent</th>
            {CATEGORIES.map((c) => (
              <th key={c} className="h-8 border-b border-seam-strong text-center font-display text-[12px] font-semibold text-chalk-3">
                {CATEGORY_META[c].label}
              </th>
            ))}
            <th className="h-8 border-b border-seam-strong text-right font-display text-[12px] font-semibold text-chalk-3">Score</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const current = r.next != null && r.next.w.start <= today && today <= r.next.w.end
            return (
              <tr key={r.i} className={cn(current && 'bg-clock-soft/50')}>
                <td className="h-10 border-b border-seam pr-2">
                  <div className="truncate font-medium text-chalk">{teamLabel(settings, r.i)}</div>
                  {r.next ? (
                    <button
                      type="button"
                      onClick={() => navigate('season', r.next!.w.id)}
                      className={cn('text-[11px] hover:text-chalk hover:underline', current ? 'font-medium text-clock' : 'text-chalk-3')}
                      title="Open this matchup's projection"
                    >
                      {current ? 'This week' : `Week ${r.next.n}`} · {rangeText(r.next.w.start, r.next.w.end)}
                    </button>
                  ) : (
                    <div className="text-[11px] text-chalk-4">slot {r.i + 1}</div>
                  )}
                </td>
                {CATEGORIES.map((c, k) => {
                  const { diff, z, mine: a, theirs: b } = r.cells[k]
                  return (
                    <td key={c} className="border-b border-seam p-[2px]">
                      <Tip
                        content={
                          <div className="space-y-0.5">
                            <div className="font-medium text-chalk">{CATEGORY_META[c].name}</div>
                            <div>
                              You {shown(c, a)} · {teamLabel(settings, r.i)} {shown(c, b)}
                              {c === 'FG' || c === 'FT' ? '' : r.perWeek ? ' that week' : ' per game'}
                            </div>
                            {c === 'TO' ? <div className="text-chalk-3">Fewer turnovers is better.</div> : null}
                          </div>
                        }
                      >
                        <div
                          className="flex h-8 items-center justify-center rounded-[4px] font-mono text-[11.5px] tnum text-chalk"
                          style={{ background: divergingFill(z, r.perWeek ? 1.5 : 1, 0.7) }}
                        >
                          {signed(diff, 1)}
                        </div>
                      </Tip>
                    </td>
                  )
                })}
                <td className="border-b border-seam text-right font-mono text-[13px] font-semibold tnum text-chalk">
                  {r.won}–{r.lost}
                  {r.even ? `–${r.even}` : ''}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
