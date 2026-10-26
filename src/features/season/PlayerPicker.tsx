import { Plus } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Positions } from '@/components/PlayerBits'
import { Input } from '@/components/ui/Controls'
import { cn } from '@/lib/cn'
import { searchPlayers, type EngineData } from '@/store/derived'

/** Name search that picks one player. `ownerOf` labels where each result currently is (fantasy team or free agent). */
export function PlayerPicker({
  engine,
  onPick,
  exclude,
  ownerOf,
  placeholder = 'Add a player…',
  testId,
}: {
  engine: EngineData
  onPick: (id: string) => void
  exclude?: Set<string>
  ownerOf: (id: string) => string
  placeholder?: string
  testId?: string
}) {
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const listId = useId()
  const results = useMemo(() => (q.trim() ? searchPlayers(engine, q, { exclude, limit: 8, basis: engine.ctx.basis }) : []), [engine, q, exclude])
  const pick = (id: string) => {
    onPick(id)
    setQ('')
    setHi(0)
  }
  return (
    <div className="relative">
      <Plus size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-chalk-4" />
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setHi(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHi((h) => Math.min(h + 1, results.length - 1))
          else if (e.key === 'ArrowUp') setHi((h) => Math.max(h - 1, 0))
          else if (e.key === 'Enter' && results[hi]) pick(results[hi].id)
          else if (e.key === 'Escape') setQ('')
          else return
          e.preventDefault()
        }}
        placeholder={placeholder}
        className="pl-8"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-label={placeholder}
        data-testid={testId}
      />
      {results.length ? (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-seam-strong bg-booth py-1 shadow-lg">
          {results.map((p, i) => {
            const v = engine.valuation.values.get(p.id)
            return (
              <li
                key={p.id}
                role="option"
                aria-selected={i === hi}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(p.id)
                }}
                className={cn('flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px]', i === hi && 'bg-stand')}
              >
                <span className="min-w-0 truncate font-medium">{p.name}</span>
                <span className="shrink-0 text-[11.5px] text-chalk-3">{p.team ?? 'FA'}</span>
                <Positions positions={p.positions} className="shrink-0 text-[11px]" />
                <span className="ml-auto shrink-0 text-[11.5px] text-chalk-3">{ownerOf(p.id)}</span>
                <span className="w-10 shrink-0 text-right font-mono text-[11.5px] tnum text-chalk-4">{v ? `#${engine.ctx.basis === 'gpAware' ? v.rankGp : v.rank}` : '—'}</span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
