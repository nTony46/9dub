import { Grid3x3, Pencil } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatPick, pickSlot } from '@/analytics/draftOrder'
import { on } from '@/app/events'
import { Positions } from '@/components/PlayerBits'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Controls'
import { cn } from '@/lib/cn'
import { useApp } from '@/store/appStore'
import { teamLabel, useDraft, useEngine } from '@/store/derived'
import { DraftBoardModal, PickEditor } from './DraftBoard'

export function DraftLogPane() {
  const d = useDraft()
  const engine = useEngine()!
  const settings = useApp((s) => s.settings)
  const setTargetPick = useApp((s) => s.setTargetPick)
  const [editing, setEditing] = useState<number | null>(null)
  const [board, setBoard] = useState(false)
  useEffect(() => on('open-board', () => setBoard(true)), [])

  const upcoming = useMemo(() => {
    if (d.currentPick == null) return []
    const out: number[] = []
    for (let o = d.currentPick; o <= d.totalPicks && out.length < 8; o++) if (!d.picksByOverall.has(o)) out.push(o)
    return out
  }, [d])
  const recent = useMemo(() => [...d.picksByOverall.values()].sort((a, b) => b.overall - a.overall).slice(0, 18), [d])

  return (
    <aside className="flex min-h-0 flex-col border-r border-seam bg-arena" aria-label="Draft order and log">
      <div className="flex items-center justify-between px-3 pb-1.5 pt-3.5">
        <h2 className="label-caps">Up next</h2>
        <Button size="xs" variant="ghost" onClick={() => setBoard(true)} title="Full draft board (b)">
          <Grid3x3 size={12} /> Board <Kbd className="ml-0.5">b</Kbd>
        </Button>
      </div>
      <ol className="px-2" data-testid="upcoming">
        {upcoming.map((o, i) => {
          const t = pickSlot(o, settings.teams).teamIndex
          const mine = t === d.userTeam
          return (
            <li
              key={o}
              className={cn(
                'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px]',
                i === 0 && !mine && 'bg-stand',
                mine && 'bg-clock-soft',
              )}
            >
              <span className="w-9 font-mono text-[12px] tnum text-chalk-3">{formatPick(o, settings.teams)}</span>
              <span className={cn('flex-1 truncate', i === 0 ? 'font-semibold text-chalk' : 'text-chalk-2', mine && 'font-semibold text-clock')}>
                {mine ? 'You' : teamLabel(settings, t)}
              </span>
              <span className="font-mono text-[11.5px] tnum text-chalk-4">#{o}</span>
            </li>
          )
        })}
        {!upcoming.length ? <li className="px-1.5 py-2 text-[12px] text-chalk-3">No picks remaining.</li> : null}
      </ol>

      {d.gaps.length ? (
        <div className="mx-2 mt-3 rounded-md border border-warn/30 bg-warn/8 p-2">
          <div className="mb-1 text-[11.5px] font-medium text-warn">{d.gaps.length} unrecorded pick{d.gaps.length === 1 ? '' : 's'}</div>
          <div className="flex flex-wrap gap-1">
            {d.gaps.slice(0, 18).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setTargetPick(g)}
                className="rounded border border-seam px-1.5 font-mono text-[10.5px] tnum text-chalk-2 hover:bg-stand"
                title={`Fill pick #${g} (${teamLabel(settings, pickSlot(g, settings.teams).teamIndex)})`}
              >
                #{g}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mx-3 mt-4 flex items-center justify-between border-t border-seam pb-1.5 pt-3.5">
        <h2 className="label-caps">Recent picks</h2>
        <span className="font-mono text-[12px] tnum text-chalk-3">{d.draftedBy.size}</span>
      </div>
      <ol className="min-h-0 flex-1 overflow-y-auto px-2 pb-3" data-testid="recent-picks">
        {recent.map((p) => {
          const info = engine.byId.get(p.playerId)
          const mine = p.teamIndex === d.userTeam
          return (
            <li key={p.overall} className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-stand">
              <span className="w-8 shrink-0 font-mono text-[11.5px] tnum text-chalk-4">#{p.overall}</span>
              <div className="min-w-0 flex-1">
                <div className={cn('truncate text-[13px] font-medium', mine && 'text-clock')}>{info?.name ?? p.playerId}</div>
                <div className="flex items-center gap-1.5 text-[11.5px] text-chalk-3">
                  <span className="truncate">{mine ? 'You' : teamLabel(settings, p.teamIndex)}</span>
                  {info ? <Positions positions={info.positions} className="text-[11px]" /> : null}
                  {p.manualTeam ? <span className="text-warn">· reassigned</span> : null}
                </div>
              </div>
              <button
                type="button"
                aria-label={`Edit pick ${p.overall}`}
                onClick={() => setEditing(p.overall)}
                className="rounded p-1 text-chalk-4 opacity-0 hover:bg-booth hover:text-chalk focus:opacity-100 group-hover:opacity-100"
              >
                <Pencil size={12} />
              </button>
            </li>
          )
        })}
        {!recent.length ? (
          <li className="px-1.5 py-2 text-[12px] leading-relaxed text-chalk-3">
            No picks yet. Search a name and press <Kbd>Enter</Kbd> to record it for the team on the clock.
          </li>
        ) : null}
      </ol>
      <PickEditor overall={editing} onClose={() => setEditing(null)} />
      <DraftBoardModal open={board} onOpenChange={setBoard} onEdit={(o) => setEditing(o)} />
    </aside>
  )
}
