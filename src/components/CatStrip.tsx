import { CATEGORIES, CATEGORY_META, type CatRecord, type Category } from '@/analytics/categories'
import { cn } from '@/lib/cn'
import { divergingFill } from '@/lib/diverging'
import { signed } from '@/lib/format'

/**
 * The nine-cell category strip — 9dub's signature. Same order everywhere
 * (FG FT 3PM PTS REB AST STL BLK TO), blue = helps, red = hurts, gray = neutral,
 * hatched = unknown (missing source data). Numbers are always available via
 * the cell title and the adjacent tables; color is never the only signal.
 */
export function CatStrip({
  z,
  scale = 2,
  size = 'sm',
  labels = false,
  dim,
  className,
}: {
  z: CatRecord<number | null>
  scale?: number
  size?: 'xs' | 'sm' | 'md'
  labels?: boolean
  /** Categories to render faded (e.g. punted). */
  dim?: Category[]
  className?: string
}) {
  const w = size === 'xs' ? 8 : size === 'sm' ? 12 : 24
  const h = size === 'xs' ? 12 : size === 'sm' ? 16 : 20
  const summary = CATEGORIES.map((c) => `${CATEGORY_META[c].label} ${z[c] == null ? 'unknown' : signed(z[c])}`).join(', ')
  return (
    <div className={cn('inline-flex flex-col', className)} role="img" aria-label={summary}>
      <div className="inline-flex gap-[2px]">
        {CATEGORIES.map((c) => {
          const v = z[c]
          return (
            <span
              key={c}
              title={`${CATEGORY_META[c].label} ${v == null ? 'unknown (missing data)' : signed(v, 2)}`}
              className={cn('rounded-[2px]', dim?.includes(c) && 'opacity-30')}
              style={{
                width: w,
                height: h,
                background:
                  v == null
                    ? 'repeating-linear-gradient(135deg, var(--seam-strong) 0 2px, transparent 2px 4px)'
                    : divergingFill(v, scale),
              }}
            />
          )
        })}
      </div>
      {labels ? (
        <div className="mt-0.5 inline-flex gap-[2px]">
          {CATEGORIES.map((c) => (
            <span key={c} style={{ width: w }} className="text-center font-display text-[10px] font-semibold tracking-wide text-chalk-3">
              {c === '3PM' ? '3P' : c}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Column header aligned to the sm strip cells. */
export function StripHeader() {
  return (
    <span className="inline-flex gap-[2px]" aria-label="Categories: FG% FT% 3PM PTS REB AST STL BLK TO">
      {CATEGORIES.map((c) => (
        <span key={c} className="w-[12px] text-center font-display text-[9.5px] font-semibold leading-none tracking-tighter text-chalk-3">
          {STRIP_ABBR[c]}
        </span>
      ))}
    </span>
  )
}

const STRIP_ABBR: Record<Category, string> = { FG: 'FG', FT: 'FT', '3PM': '3P', PTS: 'PT', REB: 'RB', AST: 'AS', STL: 'ST', BLK: 'BK', TO: 'TO' }

export function StripLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 text-[11px] text-chalk-3', className)}>
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: divergingFill(2) }} /> helps
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: 'var(--mid)' }} /> neutral
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: divergingFill(-2) }} /> hurts
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: 'repeating-linear-gradient(135deg, var(--seam-strong) 0 2px, transparent 2px 4px)' }} /> unknown
      </span>
      <span className="text-chalk-4">order: FG FT 3P PTS REB AST STL BLK TO</span>
    </div>
  )
}
