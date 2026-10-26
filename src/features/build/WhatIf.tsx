import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { CATEGORIES, CATEGORY_META } from '@/analytics/categories'
import type { EngineContext } from '@/analytics/team'
import type { UtilityContext } from '@/analytics/utility'
import { basisTotal } from '@/analytics/valuation'
import { sumEdges, whatIf } from '@/analytics/whatif'
import { Positions } from '@/components/PlayerBits'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Controls'
import { cn } from '@/lib/cn'
import { divergingFill } from '@/lib/diverging'
import { signed } from '@/lib/format'
import { useApp } from '@/store/appStore'
import { searchPlayers, type EngineData } from '@/store/derived'

/**
 * Compare 2–3 candidates without drafting them: per-category change in
 * slot-adjusted strength, league-rank movement, quality and edge change.
 */
export function WhatIf({
  engine,
  ctx,
  roster,
  utility,
  exclude,
  rankLabel = 'rank',
}: {
  engine: EngineData
  ctx: EngineContext
  roster: readonly string[]
  utility: UtilityContext
  exclude: Set<string>
  rankLabel?: string
}) {
  const ids = useApp((s) => s.compareIds)
  const setCompare = useApp((s) => s.setCompare)
  const openPreview = useApp((s) => s.openPreview)
  const [q, setQ] = useState('')
  const results = useMemo(() => (q.trim() ? searchPlayers(engine, q, { limit: 6, exclude }) : []), [engine, q, exclude])
  const rows = useMemo(
    () =>
      ids
        .filter((id) => engine.valuation.values.has(id) && !roster.includes(id))
        .map((id) => {
          const w = whatIf(ctx, roster, [id], utility)
          return { id, w, edge: sumEdges(w.edgesAfter) - sumEdges(w.edgesBefore) }
        }),
    [ids, engine, ctx, roster, utility],
  )
  const bestEdge = Math.max(...rows.map((r) => r.edge), -Infinity)

  return (
    <div data-testid="what-if">
      <div className="relative mb-2">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-chalk-4" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={ids.length >= 3 ? 'Comparing 3 — remove one to add another' : 'Add a player to compare (up to 3)…'}
          disabled={ids.length >= 3}
          className="pl-8"
          aria-label="Add player to what-if comparison"
        />
        {results.length ? (
          <ul className="anim-pop absolute inset-x-0 top-9 z-20 rounded-lg border border-seam-strong bg-booth py-1 shadow-pop">
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] hover:bg-stand"
                  onClick={() => {
                    setCompare([...ids.filter((x) => x !== p.id), p.id])
                    setQ('')
                  }}
                >
                  {p.name} <span className="text-[11px] text-chalk-4">{p.team}</span> <Positions positions={p.positions} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {!rows.length ? (
        <p className="py-3 text-[12px] leading-relaxed text-chalk-3">
          Preview what adding a player does before committing. Add players here, or use <span className="text-chalk-2">Compare</span> in any player preview.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-[12px]">
              <thead>
                <tr className="text-[11px] text-chalk-3">
                  <th className="h-7 border-b border-seam px-1 text-left font-medium">Player</th>
                  <th className="border-b border-seam px-1 text-right font-medium">Value</th>
                  {CATEGORIES.map((c) => (
                    <th key={c} className="border-b border-seam px-0.5 text-center font-display text-[11px] font-semibold">
                      {CATEGORY_META[c].label}
                    </th>
                  ))}
                  <th className="border-b border-seam px-1 text-right font-medium">Edges</th>
                  <th className="border-b border-seam" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ id, w, edge }) => {
                  const info = engine.byId.get(id)!
                  return (
                    <tr key={id}>
                      <td className="h-9 border-b border-seam px-1">
                        <button type="button" onClick={() => openPreview(id)} className="max-w-[140px] truncate text-left font-medium hover:underline">
                          {info.name}
                        </button>
                      </td>
                      <td className="border-b border-seam px-1 text-right font-mono tnum">{signed(basisTotal(engine.valuation.values.get(id)!, ctx.basis))}</td>
                      {CATEGORIES.map((c) => {
                        const dz = w.deltaZ[c]
                        const dr = w.rankBefore[c] - w.rankAfter[c]
                        return (
                          <td key={c} className="border-b border-seam p-[1px]">
                            <div
                              className="flex h-8 min-w-[40px] flex-col items-center justify-center rounded-[3px] font-mono text-[11px] tnum"
                              style={{ background: divergingFill(dz, 2.2, 0.6) }}
                              title={`${CATEGORY_META[c].label}: ${signed(dz, 2)} z · ${rankLabel} ${w.rankBefore[c]}→${w.rankAfter[c]}`}
                            >
                              <span>{signed(dz)}</span>
                              {dr !== 0 ? <span className={cn('text-[9.5px]', dr > 0 ? 'text-plus' : 'text-minus')}>{dr > 0 ? `▲${dr}` : `▼${-dr}`}</span> : null}
                            </div>
                          </td>
                        )
                      })}
                      <td className={cn('border-b border-seam px-1 text-right font-mono tnum', edge === bestEdge && rows.length > 1 && 'font-semibold text-clock')}>
                        {signed(edge, 2)}
                      </td>
                      <td className="border-b border-seam pl-1">
                        <button type="button" aria-label={`Remove ${info.name} from comparison`} onClick={() => setCompare(ids.filter((x) => x !== id))} className="rounded p-1 text-chalk-4 hover:text-chalk">
                          <X size={12} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] leading-snug text-chalk-4">
              Cells: change in slot-adjusted category strength (z) and {rankLabel} movement. Edges: change in summed category edges (construction index). Nothing is drafted.
            </p>
            <Button size="xs" variant="ghost" onClick={() => setCompare([])}>
              Discard all
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
