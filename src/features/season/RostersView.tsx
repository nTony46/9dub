import { ArrowLeftRight, Bandage, Pencil, Undo2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Positions } from '@/components/PlayerBits'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Controls'
import { Empty, Panel } from '@/components/ui/Panel'
import { statusText } from '@/data/ingest/types'
import { cn } from '@/lib/cn'
import { relTime } from '@/lib/format'
import { useApp } from '@/store/appStore'
import { teamLabel, useEngine, useLineupSlots, type EngineData } from '@/store/derived'
import { ESPN_MOVE_NOTE } from '@/store/espnSync'
import { irPlacement, todayIso } from '@/store/season'
import { PlayerPicker } from './PlayerPicker'
import { baseLineup, useCurrentRosters } from './model'


/** ESPN injury designations, short. */
const ESPN_STATUS: Record<string, string> = { OUT: 'O', DAY_TO_DAY: 'DTD', SUSPENSION: 'SSPD', INJURY_RESERVE: 'IR' }

/**
 * Rosters by team, laid out like ESPN's roster page (PG … UTIL, BE, IR). Drop,
 * IR or trade any player and add pickups; every change is a roster move on top
 * of the draft, with its own undo. Team names can be edited in place.
 */
export function RostersView() {
  const engine = useEngine()
  const settings = useApp((s) => s.settings)
  const moves = useApp((s) => s.season.rosterMoves)
  const undoRosterMove = useApp((s) => s.undoRosterMove)
  const renameTeam = useApp((s) => s.renameTeam)
  const { rosters, teamOf } = useCurrentRosters()
  const me = settings.userSlot != null ? settings.userSlot - 1 : null
  const [team, setTeam] = useState<number>(me ?? 0)
  const [editing, setEditing] = useState<number | null>(null)
  if (!engine) return <Empty title="No dataset loaded" />
  const label = (i: number | null) => (i == null ? 'Free agents' : teamLabel(settings, i))

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]" data-testid="rosters-view">
      <Panel title="Teams" bodyClassName="px-2 pb-2">
        <ul>
          {rosters.map((r, i) => (
            <li key={i}>
              {editing === i ? (
                <NameInput team={i} onDone={() => setEditing(null)} rename={renameTeam} current={teamLabel(settings, i)} />
              ) : (
                <button
                  type="button"
                  onClick={() => setTeam(i)}
                  onDoubleClick={() => setEditing(i)}
                  aria-current={i === team ? 'true' : undefined}
                  title="Double-click to rename"
                  className={cn('flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-[13.5px] hover:bg-stand', i === team && 'bg-stand')}
                >
                  <span className="w-5 shrink-0 font-mono text-[11.5px] tnum text-chalk-4">{i + 1}</span>
                  <span className={cn('min-w-0 flex-1 truncate', i === me ? 'font-semibold text-clock' : 'text-chalk')}>{teamLabel(settings, i)}</span>
                  <span className="shrink-0 font-mono text-[12px] tnum text-chalk-3">{r.length}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-4">
        <TeamRoster
          key={team}
          team={team}
          me={me}
          roster={rosters[team] ?? []}
          rosters={rosters}
          teamOf={teamOf}
          engine={engine}
        />

        <Panel title="Changes since the draft">
          {moves.length ? (
            <ul className="divide-y divide-seam" data-testid="roster-moves">
              {[...moves].reverse().map((m) => (
                <li key={m.id} className="flex h-9 items-center gap-3 text-[13px]">
                  <span className="w-20 shrink-0 text-[12px] text-chalk-3">{relTime(m.at)}</span>
                  <span className="min-w-0 truncate font-medium">{engine.byId.get(m.playerId)?.name ?? m.playerId}</span>
                  <span className="min-w-0 truncate text-chalk-3">
                    {label(m.from)} → {label(m.to)}
                  </span>
                  {m.note === ESPN_MOVE_NOTE ? <Badge tone="outline">ESPN</Badge> : null}
                  <Button size="xs" variant="ghost" className="ml-auto" onClick={() => undoRosterMove(m.id)} aria-label="Undo this change">
                    <Undo2 size={12} /> Undo
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-chalk-3">None yet.</p>
          )}
        </Panel>
      </div>
    </div>
  )
}

function NameInput({ team, current, rename, onDone }: { team: number; current: string; rename: (team: number, name: string) => void; onDone: () => void }) {
  return (
    <Input
      autoFocus
      defaultValue={current}
      aria-label="Team name"
      className="h-9 w-full font-medium"
      onFocus={(e) => e.target.select()}
      onBlur={(e) => {
        if (e.target.value.trim() && e.target.value.trim() !== current) rename(team, e.target.value)
        onDone()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') {
          ;(e.target as HTMLInputElement).value = current
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

function TeamRoster({
  team,
  me,
  roster,
  rosters,
  teamOf,
  engine,
}: {
  team: number
  me: number | null
  roster: string[]
  rosters: string[][]
  teamOf: Map<string, number>
  engine: EngineData
}) {
  const [editing, setEditing] = useState(false)
  const settings = useApp((s) => s.settings)
  const injuries = useApp((s) => s.season.injuries)
  const espn = useApp((s) => s.season.espn?.players)
  const moveRosterPlayer = useApp((s) => s.moveRosterPlayer)
  const undoRosterMove = useApp((s) => s.undoRosterMove)
  const setInjury = useApp((s) => s.setInjury)
  const renameTeam = useApp((s) => s.renameTeam)
  const openPreview = useApp((s) => s.openPreview)
  const today = todayIso()
  const onTeam = useMemo(() => new Set(roster), [roster])
  const place = irPlacement(roster, injuries, settings.irSlots, today)
  const slots = useLineupSlots()
  const starters = slots.filter((s) => s.starter).length
  const rows = baseLineup(roster, engine, place.ir, settings.irSlots, Math.max(0, settings.rounds - starters), slots)
  const over = place.active.length - settings.rounds
  const name = (id: string) => engine.byId.get(id)?.name ?? id

  const move = (id: string, to: number | null) => {
    const r = moveRosterPlayer(id, to)
    if (!r.ok) return toast.error(r.error ?? 'Could not move player')
    const mv = useApp.getState().season.rosterMoves.at(-1)!
    const what = to == null ? `Dropped ${name(id)}` : to === team ? `Added ${name(id)}` : `${name(id)} → ${teamLabel(settings, to)}`
    toast.success(what, { action: { label: 'Undo', onClick: () => undoRosterMove(mv.id) } })
  }
  const ownerOf = (id: string) => {
    const t = teamOf.get(id)
    return t == null ? 'Free agent' : t === team ? 'On this team' : teamLabel(settings, t)
  }

  return (
    <section className="rounded-lg border border-seam bg-floor px-4 py-3" data-testid="roster-card">
      <div className="mb-2 flex items-center gap-2">
        {editing ? (
          <div className="max-w-[360px] flex-1">
            <NameInput team={team} current={teamLabel(settings, team)} rename={renameTeam} onDone={() => setEditing(false)} />
          </div>
        ) : (
          <>
            <h2
              className={cn('min-w-0 truncate font-display text-[20px] font-semibold tracking-tight', team === me && 'text-clock')}
              onDoubleClick={() => setEditing(true)}
              title="Double-click to rename"
            >
              {teamLabel(settings, team)}
            </h2>
            <button type="button" onClick={() => setEditing(true)} className="rounded p-1 text-chalk-4 hover:bg-stand hover:text-chalk" aria-label="Rename team">
              <Pencil size={13} />
            </button>
          </>
        )}
        {over > 0 ? (
          <Badge tone="warn" className="ml-auto">
            {over} over the {settings.rounds}-player limit
          </Badge>
        ) : null}
      </div>

      <ul data-testid="roster-table">
        {rows.map((r, k) => {
          const groupStart = k > 0 && (r.slot === 'BE' || r.slot === 'IR') && rows[k - 1].slot !== r.slot
          const p = r.id ? engine.byId.get(r.id) : null
          const ir = r.slot === 'IR'
          const inj = r.id ? injuries.find((i) => i.playerId === r.id && (i.until == null || i.until >= today)) : undefined
          const espnStatus = r.id ? espn?.[r.id]?.status : null
          const dataStatus = p?.rec.provenance?.status
          return (
            <li
              key={`${r.slot}-${k}`}
              data-player-row={r.id ?? undefined}
              className={cn('group flex h-10 items-center gap-2.5 border-t text-[13.5px]', k === 0 ? 'border-transparent' : groupStart ? 'border-seam-strong' : 'border-seam')}
            >
              <span className={cn('w-11 shrink-0 font-display text-[13px] font-semibold tracking-wide', ir ? 'text-bad/80' : 'text-chalk-3')}>{r.slot}</span>
              {r.id && p ? (
                <>
                  <button type="button" onClick={() => openPreview(r.id!)} className={cn('min-w-0 truncate text-left font-medium hover:underline', ir && 'text-chalk-2')}>
                    {p.name}
                  </button>
                  <Positions positions={p.positions} className="hidden shrink-0 text-[11px] sm:inline" />
                  <span className="shrink-0 font-mono text-[11.5px] text-chalk-3">{p.team ?? 'FA'}</span>
                  {espnStatus ? (
                    <Badge tone={espnStatus === 'DAY_TO_DAY' ? 'warn' : 'bad'}>{ESPN_STATUS[espnStatus] ?? espnStatus.replace(/_/g, ' ')}</Badge>
                  ) : dataStatus && !espn ? (
                    <Badge tone={dataStatus.tag === 'out' || dataStatus.tag === 'suspended' ? 'bad' : 'warn'}>{statusText(dataStatus.tag)}</Badge>
                  ) : null}
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {ir || inj ? (
                      <>
                        <Input
                          type="date"
                          value={inj?.until ?? ''}
                          onChange={(e) => setInjury(r.id!, e.target.value || null)}
                          className="h-7 w-[128px] text-[12px]"
                          aria-label={`${p.name} out until`}
                          title="Out until (empty = until further notice)"
                        />
                        <Button size="xs" variant="ghost" onClick={() => setInjury(r.id!, false)} aria-label={`Activate ${p.name}`}>
                          Activate
                        </Button>
                      </>
                    ) : (
                      <Button size="xs" variant="ghost" className="text-chalk-3" onClick={() => setInjury(r.id!, null)} aria-label={`Move ${p.name} to IR`} title="Mark out — goes to IR if a slot is free">
                        <Bandage size={12} /> IR
                      </Button>
                    )}
                    <TradeMenu playerName={p.name} team={team} rosters={rosters} onPick={(to) => move(r.id!, to)} />
                    <Button size="xs" variant="ghost" className="text-chalk-3 hover:text-bad" onClick={() => move(r.id!, null)} aria-label={`Drop ${p.name}`}>
                      <X size={12} /> Drop
                    </Button>
                  </span>
                </>
              ) : (
                <span className="text-[13px] text-chalk-4">Empty</span>
              )}
            </li>
          )
        })}
      </ul>

      <div className="mt-3 max-w-[460px]">
        <PlayerPicker engine={engine} exclude={onTeam} ownerOf={ownerOf} onPick={(id) => move(id, team)} placeholder={`Add a player to ${teamLabel(settings, team)}…`} testId="roster-add" />
      </div>
    </section>
  )
}

/** "Trade" → pick the team he goes to. */
function TradeMenu({ playerName, team, rosters, onPick }: { playerName: string; team: number; rosters: string[][]; onPick: (to: number) => void }) {
  const settings = useApp((s) => s.settings)
  return (
    <label className="relative flex h-6 cursor-pointer items-center gap-1 rounded-[5px] px-2 text-[12px] text-chalk-3 hover:bg-stand hover:text-chalk">
      <ArrowLeftRight size={12} /> Trade
      <select
        aria-label={`Trade ${playerName} to`}
        value=""
        onChange={(e) => e.target.value !== '' && onPick(Number(e.target.value))}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="">Trade to…</option>
        {rosters.map((_, i) =>
          i === team ? null : (
            <option key={i} value={i}>
              {teamLabel(settings, i)}
            </option>
          ),
        )}
      </select>
    </label>
  )
}
