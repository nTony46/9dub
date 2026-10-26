import type { ReactNode } from 'react'
import { CATEGORIES, CATEGORY_META, type CatRecord, type Category } from '@/analytics/categories'
import { cn } from '@/lib/cn'
import { signed } from '@/lib/format'
import { Tip } from './ui/Tooltip'

/**
 * Diverging horizontal bars, one row per category, centered on a neutral
 * zero line. Used for team strength vs. a benchmark and for before/after deltas.
 */
export function CategoryBars({
  values,
  scale,
  tooltip,
  annotations,
  delta,
  dim,
  compact = false,
}: {
  values: CatRecord<number>
  /** Value mapped to a full half-width bar. */
  scale: number
  tooltip?: (c: Category) => ReactNode
  /** Right-hand text per category (e.g. raw total, league rank). */
  annotations?: (c: Category) => ReactNode
  /** Optional overlay delta (e.g. what-if) drawn as an outline extension. */
  delta?: CatRecord<number>
  dim?: Category[]
  compact?: boolean
}) {
  return (
    <div className="flex flex-col">
      {CATEGORIES.map((c) => {
        const v = values[c]
        const pct = (x: number) => Math.min(50, (Math.abs(x) / scale) * 50)
        const after = delta ? v + delta[c] : null
        const row = (
          <div className={cn('group grid items-center gap-2', compact ? 'h-7' : 'h-8', annotations ? 'grid-cols-[44px_1fr_56px_auto]' : 'grid-cols-[44px_1fr_56px]', dim?.includes(c) && 'opacity-40')}>
            <span className="font-display text-[14px] font-semibold tracking-wide text-chalk-2">{CATEGORY_META[c].label}</span>
            <div className="relative h-3.5">
              <div className="absolute inset-y-0 left-1/2 w-px bg-seam-strong" />
              <div
                className={cn('absolute inset-y-[2px] rounded-[3px]', v >= 0 ? 'bg-plus/75' : 'bg-minus/75')}
                style={v >= 0 ? { left: '50%', width: `${pct(v)}%` } : { right: '50%', width: `${pct(v)}%` }}
              />
              {after != null && Math.abs(delta![c]) > 0.01 ? (
                <div
                  className={cn('absolute inset-y-0 rounded-[3px] border-[1.5px] border-dashed', after >= v ? 'border-plus' : 'border-minus')}
                  style={
                    after >= 0 && v >= 0
                      ? { left: `${50 + pct(Math.min(v, after))}%`, width: `${Math.abs(pct(after) - pct(v))}%` }
                      : after < 0 && v < 0
                        ? { right: `${50 + pct(Math.max(v, after))}%`, width: `${Math.abs(pct(after) - pct(v))}%` }
                        : after >= 0
                          ? { left: '50%', width: `${pct(after)}%` }
                          : { right: '50%', width: `${pct(after)}%` }
                  }
                />
              ) : null}
            </div>
            <span className="text-right font-mono text-[12.5px] tnum text-chalk-2">
              {delta ? <span className={delta[c] > 0.05 ? 'text-plus' : delta[c] < -0.05 ? 'text-minus' : 'text-chalk-4'}>{signed(delta[c])}</span> : signed(v)}
            </span>
            {annotations ? <span className="min-w-[76px] text-right text-[12.5px] text-chalk-3">{annotations(c)}</span> : null}
          </div>
        )
        return tooltip ? (
          <Tip key={c} content={tooltip(c)} side="left" delay={150}>
            {row}
          </Tip>
        ) : (
          <div key={c}>{row}</div>
        )
      })}
    </div>
  )
}
