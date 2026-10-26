import { AlertTriangle, Star } from 'lucide-react'
import type { Position } from '@/analytics/positions'
import { RISK_TEXT, type RiskLabel } from '@/analytics/timing'
import { FLAG_TEXT } from '@/data/normalize'
import type { CompletenessFlag } from '@/data/schema'
import { cn } from '@/lib/cn'
import { Badge } from './ui/Badge'
import { Tip } from './ui/Tooltip'

export function Positions({ positions, className }: { positions: Position[]; className?: string }) {
  if (!positions.length) return <span className={cn('text-[11px] text-chalk-4', className)}>—</span>
  return <span className={cn('font-display text-[11.5px] font-semibold tracking-wide text-chalk-3', className)}>{positions.join('/')}</span>
}

export function QualityMark({ level, flags }: { level: 'complete' | 'partial' | 'limited' | 'none'; flags: readonly CompletenessFlag[] }) {
  if (level === 'complete') return null
  if (level === 'none')
    return (
      <Tip content="No projection for this season in any source. Searchable and draftable, but not valued or recommended.">
        <span className="inline-flex"><Badge tone="outline">no proj.</Badge></span>
      </Tip>
    )
  const relevant = flags.filter((f) => f !== 'missing-adp' && f !== 'derived-fg-pct' && f !== 'derived-ft-pct' && f !== 'derived-fgm' && f !== 'derived-ftm')
  return (
    <Tip
      content={
        <div>
          <div className="mb-1 font-medium text-chalk">{level === 'limited' ? 'Incomplete 9-cat line — ranked after complete players, not recommended' : 'Data quality: partial'}</div>
          <ul className="list-disc pl-4">
            {relevant.map((f) => (
              <li key={f}>{FLAG_TEXT[f]}</li>
            ))}
          </ul>
        </div>
      }
    >
      <span aria-label={`Data quality ${level}`} className={cn('inline-flex', level === 'limited' ? 'text-bad' : 'text-warn')}>
        <AlertTriangle size={12} strokeWidth={2.25} />
      </span>
    </Tip>
  )
}

export function RiskBadge({ label, pick }: { label: RiskLabel | null; pick?: number | null }) {
  if (!label) return null
  const tone = label === 'likely-gone' ? 'bad' : label === 'at-risk' ? 'warn' : 'neutral'
  return (
    <Tip content={`Rough heuristic from a single ADP number${pick ? ` vs. pick #${pick}` : ''} — not a probability.`}>
      <Badge tone={tone}>{RISK_TEXT[label]}</Badge>
    </Tip>
  )
}

export function StarButton({ on, onToggle, name }: { on: boolean; onToggle: () => void; name: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={on ? `Remove ${name} from shortlist` : `Add ${name} to shortlist`}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={cn('rounded p-1 transition-colors', on ? 'text-clock' : 'text-chalk-4 hover:text-chalk-2')}
    >
      <Star size={13} fill={on ? 'currentColor' : 'none'} strokeWidth={2} />
    </button>
  )
}

/** ESPN ADP with a mark for where it came from; non-ESPN or capped values are visibly different. */
export function AdpValue({ adp, source, note, muted }: { adp: number | null; source: string | null; note: string | null; muted?: boolean }) {
  if (adp == null) {
    if (note)
      return (
        <Tip content={note}>
          <span className="font-mono tnum text-chalk-4">140+</span>
        </Tip>
      )
    return <span className="text-chalk-4">—</span>
  }
  if (source === 'ESPN live' || source === 'ESPN') return <span className={cn('font-mono tnum', muted && 'text-chalk-3')}>{adp.toFixed(1)}</span>
  const fallback = source === 'ESPN via FantasyPros'
  return (
    <Tip content={fallback ? 'ESPN ADP rank as republished by FantasyPros (integer ordinal). Fallback: this player has no ESPN Live Draft Trends row.' : `${source ?? 'Other'} ADP — not ESPN`}>
      <span className="font-mono tnum text-chalk-3">
        {fallback ? adp.toFixed(0) : adp.toFixed(1)}
        {fallback ? '†' : '*'}
      </span>
    </Tip>
  )
}
