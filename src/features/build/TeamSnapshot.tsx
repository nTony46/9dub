import { X } from 'lucide-react'
import { CATEGORIES, catLabel, type CatRecord } from '@/analytics/categories'
import { rosterWarnings } from '@/analytics/positions'
import type { CategoryReadout } from '@/analytics/readout'
import type { TeamProfile } from '@/analytics/team'
import { basisTotal } from '@/analytics/valuation'
import { CatStrip } from '@/components/CatStrip'
import { Positions } from '@/components/PlayerBits'
import { Badge } from '@/components/ui/Badge'
import { Tip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { signed } from '@/lib/format'
import { useApp } from '@/store/appStore'
import { useLineupSlots, type EngineData } from '@/store/derived'

/** Compact roster + nine-cell standing strip + plain-language readout. */
export function TeamSnapshot({
  profile,
  readout,
  engine,
  confidence,
  onRemove,
  maxRows,
  unvalued = [],
}: {
  profile: TeamProfile
  readout: CategoryReadout
  engine: EngineData
  confidence: 'low' | 'medium' | 'higher'
  onRemove?: (id: string) => void
  maxRows?: number
  /** Rostered players with no projection: listed, never valued. */
  unvalued?: readonly string[]
}) {
  const openPreview = useApp((s) => s.openPreview)
  const slots = useLineupSlots()
  const basis = engine.ctx.basis
  const margins: CatRecord<number | null> = readout.margin
  const warnings = rosterWarnings(
    [...profile.playerIds, ...unvalued].map((id) => ({ id, positions: engine.byId.get(id)?.positions ?? [] })),
    profile.rosterSize,
    slots,
  )
  const ids = maxRows ? profile.playerIds.slice(-maxRows) : profile.playerIds
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="truncate text-[14.5px] font-semibold" data-testid="build-label">
          {readout.label}
        </div>
        <Tip content={`How settled this read is: ${confidence} confidence after ${profile.count} of ${profile.rosterSize} picks.`}>
          <div className="shrink-0 font-mono text-[12px] tnum text-chalk-3">
            {profile.count}/{profile.rosterSize}
          </div>
        </Tip>
      </div>
      <CatStrip z={margins} scale={0.9} size="md" labels className="max-w-full overflow-hidden" />
      <div className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
        <span className="text-chalk-3">Strong</span>
        <span className="text-chalk-2">{readout.strengths.length ? readout.strengths.slice(0, 4).map(catLabel).join(', ') : '—'}</span>
        <span className="text-chalk-3">Weak</span>
        <span className="text-chalk-2">
          {readout.recoverable.length ? readout.recoverable.slice(0, 4).map(catLabel).join(', ') : '—'}
          {readout.recoverable.length ? <span className="text-chalk-4"> (recoverable)</span> : null}
        </span>
        {readout.puntCandidates.length ? (
          <>
            <span className="text-chalk-3">Punt?</span>
            <span className="text-warn">{readout.puntCandidates.map(catLabel).join(', ')}</span>
          </>
        ) : null}
      </div>
      {profile.count || unvalued.length ? (
        <ul className="mt-3 border-t border-seam pt-2" data-testid="my-roster">
          {ids.map((id) => {
            const info = engine.byId.get(id)!
            const v = engine.valuation.values.get(id)!
            return (
              <li key={id} className="group flex h-7 items-center gap-2 text-[13px]">
                <button type="button" onClick={() => openPreview(id)} className="min-w-0 flex-1 truncate text-left hover:underline">
                  {info.name}
                </button>
                <Positions positions={info.positions} className="text-[11px]" />
                <span className="w-11 text-right font-mono text-[12px] tnum text-chalk-3">{signed(basisTotal(v, basis))}</span>
                {onRemove ? (
                  <button type="button" aria-label={`Remove ${info.name}`} onClick={() => onRemove(id)} className="rounded p-0.5 text-chalk-4 hover:bg-stand hover:text-bad">
                    <X size={12} />
                  </button>
                ) : null}
              </li>
            )
          })}
          {unvalued.map((id) => {
            const info = engine.byId.get(id)
            return (
              <li key={id} className="group flex h-7 items-center gap-2 text-[13px]">
                <button type="button" onClick={() => openPreview(id)} className="min-w-0 flex-1 truncate text-left text-chalk-2 hover:underline">
                  {info?.name ?? id}
                </button>
                <Tip content="No projection for this season in any source: his slot is valued at replacement level.">
                  <span className="inline-flex"><Badge tone="outline">no proj.</Badge></span>
                </Tip>
                {onRemove ? (
                  <button type="button" aria-label={`Remove ${info?.name ?? id}`} onClick={() => onRemove(id)} className="rounded p-0.5 text-chalk-4 hover:bg-stand hover:text-bad">
                    <X size={12} />
                  </button>
                ) : null}
              </li>
            )
          })}
          {profile.open - unvalued.length > 0 ? (
            <li className="flex h-7 items-center text-[12px] text-chalk-4">
              + {profile.open - unvalued.length} open slot{profile.open - unvalued.length === 1 ? '' : 's'} (valued at replacement level)
            </li>
          ) : null}
        </ul>
      ) : null}
      {warnings.length ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {warnings.map((w) => (
            <Badge key={w.text} tone={w.level === 'warn' ? 'warn' : 'outline'} className="h-auto whitespace-normal py-0.5 text-left font-medium">
              {w.text}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function marginRecord(r: CategoryReadout): CatRecord<number> {
  return r.margin
}

export const CAT_ORDER = CATEGORIES

export function strengthTone(m: number): string {
  return cn(m >= 0.2 ? 'text-plus' : m <= -0.2 ? 'text-minus' : 'text-chalk-3')
}
