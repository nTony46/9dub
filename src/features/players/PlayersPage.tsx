import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Position } from '@/analytics/positions'
import { on } from '@/app/events'
import { StripLegend } from '@/components/CatStrip'
import { Badge } from '@/components/ui/Badge'
import { Input, Segmented } from '@/components/ui/Controls'
import { normalizeName } from '@/data/normalize'
import { useApp } from '@/store/appStore'
import { useDraft, useEngine, useLive } from '@/store/derived'
import { PlayerTable } from './PlayerTable'
import { buildRows } from './rows'

type Avail = 'all' | 'available' | 'drafted' | 'shortlist' | 'flagged'

export function PlayersPage() {
  const engine = useEngine()
  const live = useLive()
  const d = useDraft()
  const settings = useApp((s) => s.settings)
  const shortlist = useApp((s) => s.shortlist)
  const prefs = useApp((s) => s.prefs)
  const setPrefs = useApp((s) => s.setPrefs)
  const toggleShortlist = useApp((s) => s.toggleShortlist)
  const openPreview = useApp((s) => s.openPreview)
  const [q, setQ] = useState('')
  const [avail, setAvail] = useState<Avail>('all')
  const [pos, setPos] = useState<'ALL' | Position>('ALL')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => on('focus-search', () => ref.current?.focus()), [])

  const allRows = useMemo(
    () => (engine ? buildRows(engine, { d, settings, uncertain: live?.uncertain, rec: live?.rec, shortlist }) : []),
    [engine, d, settings, live, shortlist],
  )
  const rows = useMemo(() => {
    const key = normalizeName(q)
    const star = new Set(shortlist)
    return allRows.filter((r) => {
      if (key && !r.info.searchKey.includes(key) && r.info.team?.toLowerCase() !== key) return false
      if (pos !== 'ALL' && !r.info.positions.includes(pos)) return false
      if (avail === 'available') return r.status !== 'drafted'
      if (avail === 'drafted') return r.status === 'drafted'
      if (avail === 'shortlist') return star.has(r.id)
      if (avail === 'flagged') return r.info.quality !== 'complete' || !!r.info.proj?.injuryOrRoleNote
      return true
    })
  }, [allRows, q, pos, avail, shortlist])

  if (!engine) return <div className="p-8 text-chalk-3">No dataset loaded.</div>
  const flagged = engine.players.filter((p) => p.quality !== 'complete').length
  const ds = engine.dataset

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-seam bg-floor">
        <div className="mx-auto max-w-[1240px] px-5 py-3.5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-[24px] font-semibold tracking-tight">NBA Players</h1>
          {ds.kind === 'demo' ? <Badge tone="warn">Fictional demo pool</Badge> : null}
          {flagged ? (
            <Badge tone="outline">
              {engine.completeIds.size} complete 9-cat · {engine.players.filter((p) => p.valued && !p.complete).length} partial ·{' '}
              {engine.players.filter((p) => !p.valued).length} not projected
            </Badge>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative w-[280px]">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-chalk-4" />
            <Input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name or team…" className="pl-8" aria-label="Filter players" />
          </div>
          <Segmented<Avail>
            label="Availability"
            size="xs"
            value={avail}
            onChange={setAvail}
            options={[
              { value: 'all', label: 'All' },
              { value: 'available', label: 'Undrafted' },
              { value: 'drafted', label: 'Drafted' },
              { value: 'shortlist', label: `★ ${shortlist.length}` },
              { value: 'flagged', label: 'Flags & notes' },
            ]}
          />
          <Segmented<'ALL' | Position>
            label="Position"
            size="xs"
            value={pos}
            onChange={setPos}
            options={(['ALL', 'PG', 'SG', 'SF', 'PF', 'C'] as const).map((p) => ({ value: p, label: p === 'ALL' ? 'All pos' : p }))}
          />
          <Segmented<'compact' | 'advanced'>
            label="Columns"
            size="xs"
            value={prefs.tableMode}
            onChange={(v) => setPrefs({ tableMode: v })}
            options={[
              { value: 'compact', label: 'Simple' },
              { value: 'advanced', label: 'Detailed' },
            ]}
          />
          <span className="ml-auto font-mono text-[12px] tnum text-chalk-3">{rows.length} shown</span>
        </div>
        <StripLegend className="mt-2.5" />
        </div>
      </div>
      <PlayerTable
          className="mx-auto w-full max-w-[1240px] flex-1"
          rows={rows}
          engine={engine}
          basis={settings.valuationBasis}
          advanced={prefs.tableMode === 'advanced'}
          onPreview={openPreview}
          onStar={toggleShortlist}
          showFit={false}
          showTiming={false}
          hidden={['rec']}
          initialSort={[{ id: 'rank', desc: false }]}
        />
    </div>
  )
}
