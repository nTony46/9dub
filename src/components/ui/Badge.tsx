import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export type Tone = 'neutral' | 'clock' | 'plus' | 'minus' | 'good' | 'warn' | 'bad' | 'outline'

const TONE: Record<Tone, string> = {
  neutral: 'bg-stand text-chalk-2 border-seam',
  clock: 'bg-clock-soft text-clock border-clock-line',
  plus: 'bg-plus/12 text-plus border-plus/30',
  minus: 'bg-minus/12 text-minus border-minus/30',
  good: 'bg-good/12 text-good border-good/30',
  warn: 'bg-warn/12 text-warn border-warn/35',
  bad: 'bg-bad/12 text-bad border-bad/30',
  outline: 'bg-transparent text-chalk-3 border-seam-strong',
}

export function Badge({ tone = 'neutral', className, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-[4px] border px-1.5 text-[10.5px] font-semibold leading-none tracking-wide',
        TONE[tone],
        className,
      )}
      {...rest}
    />
  )
}
