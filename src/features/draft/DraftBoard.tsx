import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { formatPick, pickSlot, snakeOrder } from '@/analytics/draftOrder'
import { emit } from '@/app/events'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Dialog'
import { Input, Select } from '@/components/ui/Controls'
import { cn } from '@/lib/cn'
import { useApp } from '@/store/appStore'
import { searchPlayers, teamLabel, useDraft, useEngine } from '@/store/derived'

/** Edit, reassign or remove any recorded pick; or target an empty pick for the next entry. */
export function PickEditor({ overall, onClose }: { overall: number | null; onClose: () => void }) {
  const d = useDraft()
  const engine = useEngine()!
  const settings = useApp((s) => s.settings)
  const editPick = useApp((s) => s.editPick)
  const removePick = useApp((s) => s.removePick)
  const setTargetPick = useApp((s) => s.setTargetPick)
  const draftPlayer = useApp((s) => s.draftPlayer)
  const [q, setQ] = useState('')
  const pick = overall != null ? d.picksByOverall.get(overall) : undefined
  const results = useMemo(() => (q.trim() ? searchPlayers(engine, q, { limit: 6 }) : []), [engine, q])
  if (overall == null) return null
  const defTeam = pickSlot(overall, settings.teams).teamIndex
  const close = () => {
    setQ('')
    onClose()
  }
  const report = (r: { ok: boolean; error?: string; message?: string }) => {
    if (!r.ok) toast.error(r.error)
    else {
      toast(r.message)
      close()
    }
  }
  return (
    <Modal
      open
      onOpenChange={(o) => !o && close()}
      title={`Pick ${formatPick(overall, settings.teams)} · #${overall}`}
      description={pick ? `${teamLabel(settings, pick.teamIndex)} — ${engine.byId.get(pick.playerId)?.name ?? pick.playerId}` : `Unrecorded · snake order: ${teamLabel(settings, defTeam)}`}
      className="w-[min(480px,calc(100vw-32px))]"
    >
      <div className="space-y-4 p-5">
        {pick ? (
          <div className="flex items-center gap-2">
            <span className="w-24 text-[12px] text-chalk-2">Team</span>
            <Select
              aria-label="Team for this pick"
              value={pick.teamIndex}
              onChange={(e) => report(editPick(overall, { teamIndex: Number(e.target.value) }))}
              className="flex-1"
            >
              {settings.teamNames.map((n, i) => (
                <option key={i} value={i}>
                  {n || `Team ${i + 1}`}
                  {i === defTeam ? ' (snake order)' : ''}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div>
          <div className="mb-1.5 text-[12px] text-chalk-2">{pick ? 'Replace player' : 'Record a player at this pick'}</div>
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name…" aria-label="Search player for this pick" />
          <ul className="mt-1.5 space-y-0.5">
            {results.map((p) => {
              const taken = d.draftedBy.get(p.id)
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={!!taken && taken.overall !== overall}
                    onClick={() => report(pick ? editPick(overall, { playerId: p.id }) : draftPlayer(p.id, { overall }))}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-stand disabled:opacity-40"
                  >
                    <span>
                      {p.name} <span className="text-[11px] text-chalk-4">{p.team}</span>
                    </span>
                    {taken ? <span className="text-[11px] text-chalk-3">taken #{taken.overall}</span> : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-seam pt-4">
          {pick ? (
            <Button variant="danger" onClick={() => report(removePick(overall))}>
              Remove pick
            </Button>
          ) : (
            <Button
              onClick={() => {
                setTargetPick(overall)
                close()
                setTimeout(() => emit('focus-search'), 0)
              }}
            >
              Use the main search for #{overall}
            </Button>
          )}
          <Button variant="ghost" onClick={close}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** Full rounds × teams board. Click any cell to edit or fill it. */
export function DraftBoardModal({ open, onOpenChange, onEdit }: { open: boolean; onOpenChange: (o: boolean) => void; onEdit: (overall: number) => void }) {
  const d = useDraft()
  const engine = useEngine()!
  const settings = useApp((s) => s.settings)
  const order = useMemo(() => snakeOrder(settings.teams, settings.rounds), [settings.teams, settings.rounds])
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Draft board" description="Click a cell to edit, reassign, remove or fill a pick." className="w-[min(1320px,calc(100vw-32px))]">
      <div className="overflow-auto p-4">
        <table className="w-full border-separate border-spacing-[3px] text-[11.5px]">
          <thead>
            <tr>
              <th className="w-8" />
              {settings.teamNames.map((n, i) => (
                <th key={i} className={cn('truncate px-1 pb-1 text-left font-display text-[12px] font-semibold tracking-wide', i === d.userTeam ? 'text-clock' : 'text-chalk-2')}>
                  {n || `Team ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: settings.rounds }, (_, r) => (
              <tr key={r}>
                <td className="pr-1 text-right font-mono text-[10.5px] tnum text-chalk-4">R{r + 1}</td>
                {Array.from({ length: settings.teams }, (_, t) => {
                  const slot = order.find((s) => s.round === r + 1 && s.teamIndex === t)!
                  const p = d.picksByOverall.get(slot.overall)
                  const reassigned = [...d.picksByOverall.values()].find((x) => x.overall === slot.overall && x.teamIndex !== t)
                  const isCurrent = d.currentPick === slot.overall
                  const info = p ? engine.byId.get(p.playerId) : null
                  return (
                    <td key={t}>
                      <button
                        type="button"
                        onClick={() => onEdit(slot.overall)}
                        className={cn(
                          'flex h-11 w-full min-w-[86px] flex-col justify-center rounded-md border px-1.5 text-left',
                          p ? 'border-seam bg-stand hover:bg-booth' : 'border-dashed border-seam hover:bg-stand',
                          isCurrent && 'border-clock-line bg-clock-soft',
                          t === d.userTeam && !p && 'border-clock-line/60',
                        )}
                      >
                        <span className="font-mono text-[9.5px] tnum text-chalk-4">
                          {formatPick(slot.overall, settings.teams)} · #{slot.overall}
                        </span>
                        <span className={cn('truncate', p ? 'font-medium text-chalk' : 'text-chalk-4')}>
                          {info ? info.name : isCurrent ? 'on the clock' : d.gaps.includes(slot.overall) ? 'unrecorded' : ''}
                        </span>
                        {reassigned ? <span className="truncate text-[9.5px] text-warn">→ {teamLabel(settings, reassigned.teamIndex)}</span> : null}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}
