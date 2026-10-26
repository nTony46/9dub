import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { categoryReadout } from '@/analytics/readout'
import { stageConfidence } from '@/analytics/team'
import { draftWithToast } from '@/app/actions'
import { Segmented } from '@/components/ui/Controls'
import { Panel } from '@/components/ui/Panel'
import { Tip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { useApp } from '@/store/appStore'
import { benchmarkOf, teamLabel, useDraft, useEngine, useLive, type LiveAnalysis } from '@/store/derived'
import type { Position } from '@/analytics/positions'
import { RecLanes } from '@/features/build/RecLanes'
import { TeamSnapshot } from '@/features/build/TeamSnapshot'
import { PlayerTable, type PlayerRow } from '@/features/players/PlayerTable'
import { buildRows } from '@/features/players/rows'
import { DraftLogPane } from './DraftLogPane'
import { DraftSearch } from './DraftSearch'
import { LiveBar } from './LiveBar'

type Avail = 'available' | 'all' | 'shortlist' | 'drafted'
type PosFilter = 'ALL' | Position

export function DraftRoom() {
  const live = useLive()
  if (!live) return <div className="p-8 text-chalk-3">No dataset loaded. Import projections in Settings & Data.</div>
  return (
    <div className="flex h-full flex-col">
      <LiveBar />
      <div className="grid min-h-0 flex-1 grid-cols-[216px_minmax(0,1fr)_328px] xl:grid-cols-[240px_minmax(0,1fr)_368px]">
        <DraftLogPane />
        <BoardPane live={live} />
        <RightRail live={live} />
      </div>
    </div>
  )
}

function BoardPane({ live }: { live: LiveAnalysis }) {
  const engine = useEngine()!
  const d = useDraft()
  const settings = useApp((s) => s.settings)
  const shortlist = useApp((s) => s.shortlist)
  const prefs = useApp((s) => s.prefs)
  const setPrefs = useApp((s) => s.setPrefs)
  const toggleShortlist = useApp((s) => s.toggleShortlist)
  const openPreview = useApp((s) => s.openPreview)
  const lock = useApp((s) => s.buildLock)
  const [avail, setAvail] = useState<Avail>('available')
  const [pos, setPos] = useState<PosFilter>('ALL')
  // Measure the board so narrow laptops get a dense column set instead of clipped controls.
  const boardRef = useRef<HTMLElement>(null)
  const [boardWidth, setBoardWidth] = useState(900)
  useEffect(() => {
    const el = boardRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setBoardWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const dense = boardWidth < 860

  const allRows = useMemo(
    () => buildRows(engine, { d, settings, uncertain: live.uncertain, rec: live.rec, shortlist }),
    [engine, d, settings, live, shortlist],
  )
  const rows = useMemo(() => {
    const star = new Set(shortlist)
    return allRows.filter((r) => {
      if (pos !== 'ALL' && !r.info.positions.includes(pos)) return false
      // Unprojected (directory-only) players stay reachable through search but don't crowd the board.
      if (avail === 'available') return (r.status === 'available' || r.status === 'uncertain') && r.v != null
      if (avail === 'drafted') return r.status === 'drafted'
      if (avail === 'shortlist') return star.has(r.id)
      return true
    })
  }, [allRows, avail, pos, shortlist])

  const onDraft = useCallback((id: string) => void draftWithToast(id), [])
  const disabled = useCallback((r: PlayerRow) => r.status === 'drafted' || d.currentPick == null, [d.currentPick])
  const actionLabel = d.isUserOnClock ? 'Draft' : d.onClockTeam != null ? 'Draft' : undefined

  return (
    <section ref={boardRef} className="flex min-h-0 min-w-0 flex-col" aria-label="Player board">
      <div className="border-b border-seam px-4 pb-2.5 pt-3">
        <DraftSearch live={live} />
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Segmented<Avail>
            label="Availability filter"
            size="xs"
            value={avail}
            onChange={setAvail}
            options={[
              { value: 'available', label: `Available ${live.available.length}` },
              { value: 'shortlist', label: `★ ${shortlist.length}` },
              { value: 'drafted', label: 'Drafted' },
              { value: 'all', label: 'All' },
            ]}
          />
          <Segmented<PosFilter>
            label="Position filter"
            size="xs"
            value={pos}
            onChange={setPos}
            options={(['ALL', 'PG', 'SG', 'SF', 'PF', 'C'] as PosFilter[]).map((p) => ({ value: p, label: p === 'ALL' ? 'All pos' : p }))}
          />
          <Segmented<'compact' | 'advanced'>
            className="ml-auto"
            label="Column set"
            size="xs"
            value={prefs.tableMode}
            onChange={(v) => setPrefs({ tableMode: v })}
            options={[
              { value: 'compact', label: 'Simple', title: 'Name, ADP, rank, value, category strip and fit' },
              { value: 'advanced', label: 'Detailed', title: 'Adds expert rank, timing and every stat' },
            ]}
          />
        </div>
      </div>
      <PlayerTable
          className="flex-1"
          rows={rows}
          engine={engine}
          basis={settings.valuationBasis}
          advanced={prefs.tableMode === 'advanced'}
          actionLabel={actionLabel}
          onAction={onDraft}
          actionDisabled={disabled}
          onPreview={openPreview}
          onStar={toggleShortlist}
          showFit
          emphasizeRecs={d.isUserOnClock}
          showTiming={d.userTeam != null}
          timingPick={d.nextUserPick}
          dense={dense}
          hidden={prefs.tableMode === 'advanced' ? ['status', 'rec'] : dense ? ['srcRank', 'status', 'gap', 'rec', 'ecr', 'risk', 'fit'] : ['srcRank', 'status', 'gap', 'rec', 'ecr', 'risk']}
          punts={lock?.mode === 'hard' ? lock.punts : undefined}
          emptyText={avail === 'shortlist' ? 'Star players to build a shortlist.' : 'No players match these filters.'}
          initialSort={[{ id: 'rank', desc: false }]}
        />
      <div className="flex items-center gap-3 border-t border-seam px-4 py-2 text-[12px] text-chalk-3">
        <span>
          {d.currentPick == null ? (
            'All picks recorded'
          ) : (
            <>
              <span className="font-medium text-chalk-2">Draft</span> records pick #{d.currentPick} for{' '}
              <span className={cn('font-medium', d.isUserOnClock ? 'text-clock' : 'text-chalk-2')}>{d.isUserOnClock ? 'you' : d.onClockTeam != null ? teamLabel(settings, d.onClockTeam) : '—'}</span>
            </>
          )}
        </span>
        <Tip
          content={
            <div className="space-y-1">
              <div>Rank ≈ — partial line (no FG/FT attempts): ranked after complete players, never recommended.</div>
              <div>ADP — ESPN Live Draft Trends AVG PICK. † = FantasyPros-reported ESPN rank (fallback). 140+ = ESPN's ceiling, rarely drafted.</div>
              <div>Strip — FG FT 3P PTS REB AST STL BLK TO: blue helps, red hurts, hatched unknown.</div>
            </div>
          }
        >
          <span className="ml-auto cursor-help underline decoration-dotted underline-offset-2">Legend</span>
        </Tip>
      </div>
    </section>
  )
}

function RightRail({ live }: { live: LiveAnalysis }) {
  const engine = useEngine()!
  const d = useDraft()
  const settings = useApp((s) => s.settings)
  const readout = useMemo(
    () => categoryReadout(live.my.zSlot, benchmarkOf(live.opponents, live.typicalNow), engine.scale.sigma, live.my.count, live.postDraft ? undefined : live.builds, live.postDraft),
    [live, engine],
  )
  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-seam bg-arena p-3" aria-label="My team and recommendations">
      <Panel
        title={live.myTeam != null ? `My team · ${teamLabel(settings, live.myTeam)}` : 'My team'}
        actions={
          live.myTeam != null && d.nextUserPick != null ? (
            <span className="text-[12px] text-chalk-3">
              next pick <span className="font-mono tnum text-chalk-2">#{d.nextUserPick}</span>
            </span>
          ) : null
        }
      >
        {live.myTeam == null ? (
          <p className="text-[13px] leading-relaxed text-chalk-3">
            Set <span className="text-chalk-2">Your slot</span> in the bar above to see your team, timing and team-fit picks. You can already record picks for every team.
          </p>
        ) : (
          <TeamSnapshot profile={live.my} readout={readout} engine={engine} confidence={stageConfidence(live.my.count, settings.rounds)} maxRows={live.postDraft ? undefined : 8} unvalued={live.myTeam != null ? live.unvalued[live.myTeam] : []} />
        )}
      </Panel>
      {d.complete ? null : <RecLanes rec={live.rec} engine={engine} timing={live.timing} canDraft={d.isUserOnClock} onDraft={(id) => void draftWithToast(id)} />}
    </aside>
  )
}
