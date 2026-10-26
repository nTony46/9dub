import { Crosshair, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatPick } from '@/analytics/draftOrder'
import { basisRank, basisTotal, basisZ } from '@/analytics/valuation'
import { draftWithToast } from '@/app/actions'
import { on } from '@/app/events'
import { CatStrip } from '@/components/CatStrip'
import { Positions } from '@/components/PlayerBits'
import { Badge } from '@/components/ui/Badge'
import { Kbd } from '@/components/ui/Controls'
import { Tip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { signed } from '@/lib/format'
import { useApp } from '@/store/appStore'
import { searchPlayers, teamLabel, useDraft, useEngine, type LiveAnalysis } from '@/store/derived'
import { teamForPick } from '@/store/draftLogic'

/**
 * The primary high-frequency control: type a name, Enter drafts the highlighted
 * player for the team on the clock (or the explicitly targeted pick/team).
 */
export function DraftSearch({ live }: { live: LiveAnalysis }) {
  const engine = useEngine()!
  const d = useDraft()
  const settings = useApp((s) => s.settings)
  const targetPick = useApp((s) => s.draft.targetPick)
  const setTargetPick = useApp((s) => s.setTargetPick)
  const openPreview = useApp((s) => s.openPreview)
  const basis = settings.valuationBasis
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const [open, setOpen] = useState(false)
  const [teamOverride, setTeamOverride] = useState<number | null>(null)
  const [targetOpen, setTargetOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => on('focus-search', () => inputRef.current?.focus()), [])

  // Available players first so Enter never lands on someone already drafted.
  const results = useMemo(() => {
    if (!q.trim()) return []
    const found = searchPlayers(engine, q, { limit: 10, basis })
    return [...found.filter((p) => !d.draftedBy.has(p.id)), ...found.filter((p) => d.draftedBy.has(p.id))].slice(0, 8)
  }, [engine, q, basis, d])
  const clamped = Math.min(hi, Math.max(0, results.length - 1))

  const pickNo = d.currentPick
  const teamIdx = teamOverride ?? (pickNo != null ? teamForPick(pickNo, settings) : null)

  const draft = (id: string) => {
    if (pickNo == null) return
    if (settings.confirmOnEnter && !window.confirm(`Draft ${engine.byId.get(id)?.name} for ${teamLabel(settings, teamIdx!)} at #${pickNo}?`)) return
    const ok = draftWithToast(id, { overall: pickNo, teamIndex: teamOverride ?? undefined })
    if (ok) {
      setQ('')
      setHi(0)
      setTeamOverride(null)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-chalk-4" />
          <input
            ref={inputRef}
            data-testid="draft-search"
            role="combobox"
            aria-expanded={open && results.length > 0}
            aria-controls="draft-search-results"
            aria-activedescendant={results[clamped] ? `dsr-${results[clamped].id}` : undefined}
            aria-label="Search a player to draft"
            value={q}
            placeholder={pickNo == null ? 'Draft complete — search to preview' : 'Search player to draft…'}
            onChange={(e) => {
              setQ(e.target.value)
              setHi(0)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                setHi((h) => Math.min(h + 1, results.length - 1))
                e.preventDefault()
              } else if (e.key === 'ArrowUp') {
                setHi((h) => Math.max(h - 1, 0))
                e.preventDefault()
              } else if (e.key === 'Enter' && results[clamped]) {
                e.preventDefault()
                if (e.shiftKey) openPreview(results[clamped].id)
                else draft(results[clamped].id)
              } else if (e.key === 'Escape') {
                if (q) setQ('')
                else inputRef.current?.blur()
              }
            }}
            className="h-10 w-full rounded-lg border border-seam-strong bg-well pl-9 pr-24 text-[14px] font-medium text-chalk placeholder:font-normal placeholder:text-chalk-4 focus:border-clock-line focus:outline-none"
          />
          <div className="pointer-events-none absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[11px] text-chalk-4">
            {q ? null : (
              <>
                <Kbd>/</Kbd> focus
              </>
            )}
          </div>
        </div>

        {/* Where the next entered pick goes */}
        <div className="relative">
          <Tip content="Pick and team the next entry will be recorded for. Change it to repair the log or record only your own picks.">
            <button
              type="button"
              onClick={() => setTargetOpen((o) => !o)}
              className={cn(
                'flex h-10 items-center gap-2 rounded-lg border px-3 text-left',
                targetPick != null || teamOverride != null ? 'border-clock-line bg-clock-soft' : 'border-seam bg-stand hover:bg-booth',
              )}
              aria-label="Choose pick and team to record"
              data-testid="pick-target"
            >
              <Crosshair size={14} className="text-chalk-3" />
              <span className="flex flex-col leading-tight">
                <span className="text-[10.5px] text-chalk-3">{targetPick != null ? 'Filling pick' : 'Recording'}</span>
                <span className="text-[12.5px] font-medium">
                  {pickNo == null ? '—' : (
                    <>
                      <span className="font-mono tnum">#{pickNo}</span> · {teamIdx === d.userTeam ? 'You' : teamLabel(settings, teamIdx!)}
                    </>
                  )}
                </span>
              </span>
            </button>
          </Tip>
          {targetOpen ? (
            <div className="anim-pop absolute right-0 top-11 z-30 w-[280px] rounded-lg border border-seam-strong bg-booth p-3 shadow-pop">
              <div className="mb-2 label-caps">Record next entry at</div>
              <label className="mb-2 flex items-center justify-between gap-2 text-[12px] text-chalk-2">
                Pick #
                <input
                  type="number"
                  min={1}
                  max={d.totalPicks}
                  defaultValue={pickNo ?? ''}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const v = Number((e.target as HTMLInputElement).value)
                      if (v >= 1 && v <= d.totalPicks && !d.picksByOverall.has(v)) {
                        setTargetPick(v)
                        setTargetOpen(false)
                      }
                    }
                  }}
                  onBlur={(e) => {
                    const v = Number(e.target.value)
                    if (v >= 1 && v <= d.totalPicks && !d.picksByOverall.has(v) && v !== pickNo) setTargetPick(v)
                  }}
                  className="h-7 w-20 rounded-md border border-seam bg-well px-2 font-mono text-[12px] tnum"
                />
              </label>
              <label className="mb-3 flex items-center justify-between gap-2 text-[12px] text-chalk-2">
                Team
                <select
                  value={teamOverride ?? ''}
                  onChange={(e) => setTeamOverride(e.target.value === '' ? null : Number(e.target.value))}
                  className="h-7 w-40 rounded-md border border-seam bg-well px-1.5 text-[12px]"
                >
                  <option value="">Snake order{pickNo != null ? ` (${teamLabel(settings, teamForPick(pickNo, settings))})` : ''}</option>
                  {settings.teamNames.map((n, i) => (
                    <option key={i} value={i}>
                      {n || `Team ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {d.nextUserPick != null && d.nextUserPick !== pickNo ? (
                  <button type="button" className="rounded-md border border-seam px-2 py-1 text-[11.5px] hover:bg-stand" onClick={() => (setTargetPick(d.nextUserPick), setTargetOpen(false))}>
                    Jump to my pick #{d.nextUserPick}
                  </button>
                ) : null}
                {targetPick != null || teamOverride != null ? (
                  <button type="button" className="rounded-md border border-seam px-2 py-1 text-[11.5px] hover:bg-stand" onClick={() => (setTargetPick(null), setTeamOverride(null), setTargetOpen(false))}>
                    Back to normal order
                  </button>
                ) : null}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-chalk-3">
                Skipping ahead leaves earlier picks unrecorded; 9dub then marks likely-taken players as uncertain.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {open && results.length > 0 ? (
        <ul
          id="draft-search-results"
          role="listbox"
          className="anim-pop absolute inset-x-0 top-11 z-30 overflow-hidden rounded-lg border border-seam-strong bg-booth py-1 shadow-pop"
        >
          {results.map((p, i) => {
            const v = engine.valuation.values.get(p.id)
            const taken = d.draftedBy.get(p.id)
            const unsure = live.uncertain.has(p.id)
            return (
              <li
                key={p.id}
                id={`dsr-${p.id}`}
                role="option"
                aria-selected={i === clamped}
                onMouseEnter={() => setHi(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (e.shiftKey) openPreview(p.id)
                  else draft(p.id)
                }}
                className={cn('grid cursor-pointer grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-3 py-1.5', i === clamped && 'bg-stand')}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className={cn('truncate font-medium', taken && 'text-chalk-3 line-through')}>{p.name}</span>
                  <span className="font-display text-[11px] font-semibold text-chalk-4">{p.team ?? 'FA'}</span>
                  <Positions positions={p.positions} />
                  {taken ? (
                    <Badge tone="outline">
                      {teamLabel(settings, taken.teamIndex)} {formatPick(taken.overall, settings.teams)}
                    </Badge>
                  ) : unsure ? (
                    <Badge tone="warn">possibly taken</Badge>
                  ) : null}
                </div>
                {v ? <CatStrip z={basisZ(v, basis)} size="xs" /> : <span className="text-[11px] text-chalk-4">no projection</span>}
                <span className="w-12 text-right font-mono text-[11.5px] tnum text-chalk-2">
                  {v ? signed(basisTotal(v, basis)) : '—'}
                  {v && !v.complete ? <span className="text-warn">≈</span> : null}
                </span>
                <span className="w-20 text-right font-mono text-[11px] tnum text-chalk-3">
                  {v ? `#${basisRank(v, basis)}` : '—'} · {p.adp != null ? p.adp.toFixed(0) : p.adpNote ? '140+' : '—'}
                </span>
              </li>
            )
          })}
          <li className="flex items-center gap-3 border-t border-seam px-3 pb-1 pt-1.5 text-[11px] text-chalk-4">
            <span>
              <Kbd>Enter</Kbd> draft
            </span>
            <span>
              <Kbd>⇧</Kbd>
              <Kbd>Enter</Kbd> preview
            </span>
            <span>
              <Kbd>Esc</Kbd> clear
            </span>
            <span className="ml-auto">value · rank · ADP</span>
          </li>
        </ul>
      ) : null}
    </div>
  )
}
