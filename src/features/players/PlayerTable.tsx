import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, FileText } from 'lucide-react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useMemo, useRef, useState } from 'react'
import { CATEGORIES, CATEGORY_META, type Category } from '@/analytics/categories'
import type { CandidateScore } from '@/analytics/recommend'
import type { PlayerValue } from '@/analytics/types'
import { basisRank, basisTotal, basisZ } from '@/analytics/valuation'
import { CatStrip, StripHeader } from '@/components/CatStrip'
import { AdpValue, Positions, QualityMark, RiskBadge, StarButton } from '@/components/PlayerBits'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Tip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { num, pct, signed } from '@/lib/format'
import type { EngineData, PlayerInfo } from '@/store/derived'

export interface PlayerRow {
  id: string
  info: PlayerInfo
  /** Null for directory-only players (no projection in any source). */
  v: PlayerValue | null
  status: 'available' | 'drafted' | 'uncertain' | 'rostered'
  draftedLabel?: string
  score?: CandidateScore
  decisionRank?: number
  adpGap: number | null
  starred: boolean
}

const col = createColumnHelper<PlayerRow>()

function statCell(r: PlayerRow, key: 'pts' | 'tpm' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov', digits = 1) {
  const l = r.info.line
  return l ? num(l[key], digits) : '—'
}

const VOLUME_NOTE: Record<string, string> = {
  'cross-source': 'x-src',
  estimated: 'est.',
}

/** FG%/FT% cell: percentage plus makes/attempts, with a mark when attempts are borrowed or estimated. */
function shootingCell(r: PlayerRow, kind: 'fg' | 'ft') {
  const l = r.info.line
  const pctV = kind === 'fg' ? r.info.fgPct : r.info.ftPct
  const made = kind === 'fg' ? l?.fgm : l?.ftm
  const att = kind === 'fg' ? l?.fga : l?.fta
  const origin = r.info.volume?.[kind]
  return (
    <span className="font-mono tnum">
      {pct(pctV)}
      <span className={cn('ml-1 text-[10.5px]', origin === 'estimated' || origin === 'cross-source' ? 'text-warn' : 'text-chalk-4')}>
        {att != null ? `${num(made)}/${num(att)}${origin && VOLUME_NOTE[origin] ? ` ${VOLUME_NOTE[origin]}` : ''}` : 'no vol.'}
      </span>
    </span>
  )
}

export interface PlayerTableProps {
  rows: PlayerRow[]
  engine: EngineData
  basis: 'perGame' | 'gpAware'
  advanced: boolean
  /** Label for the primary row action (e.g. "Draft", "Add"); omit for no action. */
  actionLabel?: string
  onAction?: (id: string) => void
  actionDisabled?: (r: PlayerRow) => boolean
  onPreview: (id: string) => void
  onStar: (id: string) => void
  showFit: boolean
  showTiming: boolean
  timingPick?: number | null
  initialSort?: SortingState
  highlightId?: string | null
  emptyText?: string
  punts?: Category[]
  /** Column ids to hide (e.g. to keep the Draft Room compact). */
  hidden?: string[]
  /** Highlight the top recommended rows' action (only when it's the user's pick). */
  emphasizeRecs?: boolean
  /** Classes for the table's own scroll container. */
  className?: string
  /** Narrow layouts: compact strips and tighter cell padding. */
  dense?: boolean
}

const ROW_H = 36

const SortIcon = ({ dir }: { dir: false | 'asc' | 'desc' }) =>
  dir === 'asc' ? <ArrowUp size={11} /> : dir === 'desc' ? <ArrowDown size={11} /> : null

export const PlayerTable = memo(function PlayerTable(props: PlayerTableProps) {
  const { rows, basis, advanced, actionLabel, onAction, actionDisabled, onPreview, onStar, showFit, showTiming, timingPick, punts } = props
  const [sorting, setSorting] = useState<SortingState>(props.initialSort ?? [{ id: 'rank', desc: false }])

  const columns = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- TanStack v8 needs `any` for mixed accessor value types
    const cols: ColumnDef<PlayerRow, any>[] = [
      col.display({
        id: 'star',
        header: '',
        size: 26,
        cell: (c) => <StarButton on={c.row.original.starred} onToggle={() => onStar(c.row.original.id)} name={c.row.original.info.name} />,
      }),
      col.accessor((r) => r.info.name, {
        id: 'player',
        header: 'Player',
        size: 230,
        sortingFn: 'alphanumeric',
        cell: (c) => {
          const r = c.row.original
          const p = r.info.proj
          return (
            <div className="flex min-w-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => onPreview(r.id)}
                title="Open player details"
                className={cn('truncate text-left text-[13.5px] font-medium hover:underline', r.status === 'drafted' ? 'text-chalk-3 line-through decoration-chalk-4' : 'text-chalk')}
              >
                {r.info.name}
              </button>
              <span className="shrink-0 text-[11.5px] text-chalk-3">
                {r.info.team ?? 'FA'} · <Positions positions={r.info.positions} className="text-[11.5px]" />
              </span>
              <QualityMark level={r.info.quality} flags={p?.completenessFlags ?? []} />
              {p?.injuryOrRoleNote ? (
                <Tip content={p.injuryOrRoleNote}>
                  <span className={cn('inline-flex', p.riskFlag === 'injury' ? 'text-bad' : 'text-warn')} aria-label="Has note">
                    <FileText size={12} />
                  </span>
                </Tip>
              ) : null}
              {r.info.overridden ? <Badge tone="outline">edited</Badge> : null}
            </div>
          )
        },
      }),
      col.accessor((r) => (r.status === 'available' ? 0 : r.status === 'uncertain' ? 1 : 2), {
        id: 'status',
        header: 'Status',
        size: 92,
        cell: (c) => {
          const r = c.row.original
          if (r.status === 'drafted' || r.status === 'rostered') return <span className="truncate text-[11.5px] text-chalk-3">{r.draftedLabel}</span>
          if (r.status === 'uncertain')
            return (
              <Tip content="Some earlier picks are unrecorded; this player's ADP suggests he may already be gone.">
                <Badge tone="warn">possibly taken</Badge>
              </Tip>
            )
          return <span className="text-[11.5px] text-good">available</span>
        },
      }),
      col.accessor((r) => r.info.adp ?? (r.info.adpNote ? 9000 : 9999), {
        id: 'adp',
        header: () => (
          <Tip content="ESPN Live Draft Trends AVG PICK. † = FantasyPros-reported ESPN ordinal (fallback); 140+ = at ESPN's ceiling (rarely drafted); * = a non-ESPN ADP.">ADP</Tip>
        ),
        size: 52,
        cell: (c) => {
          const i = c.row.original.info
          return <AdpValue adp={i.adp} source={i.adpSource} note={i.adpNote} />
        },
      }),
      col.accessor((r) => (r.v ? basisRank(r.v, basis) : 99999), {
        id: 'rank',
        header: () => <Tip content={`9dub raw 9-cat rank (${basis === 'perGame' ? 'per-game' : 'GP-aware'}), frozen for this dataset. ≈ = partial line (missing FG%/FT% volume), ranked after complete players.`}>Rank</Tip>,
        size: 48,
        cell: (c) => {
          const v = c.row.original.v
          if (!v) return <span className="text-chalk-4">—</span>
          return (
            <span className="font-mono tnum">
              {c.getValue()}
              {v.coveredCats < 9 ? <span className="text-warn">≈</span> : null}
            </span>
          )
        },
      }),
      col.accessor((r) => r.info.rec.rankings?.fantasyEdge?.rank ?? r.info.proj?.sourceNineCatRank ?? 9999, {
        id: 'srcRank',
        header: () => <Tip content="The source's own 9-cat rank (Fantasy Edge for the real-data snapshot), kept separate from 9dub's rank.">Src</Tip>,
        size: 44,
        cell: (c) => <span className="font-mono tnum text-chalk-3">{c.row.original.info.rec.rankings?.fantasyEdge?.rank ?? c.row.original.info.proj?.sourceNineCatRank ?? '—'}</span>,
      }),
      col.accessor((r) => r.info.rec.rankings?.fantasyProsEcr?.rank ?? 9999, {
        id: 'ecr',
        header: () => <Tip content="FantasyPros expert consensus rank (an expert ranking, not ADP and not a 9-cat value).">ECR</Tip>,
        size: 44,
        cell: (c) => {
          const e = c.row.original.info.rec.rankings?.fantasyProsEcr
          if (!e) return <span className="text-chalk-4">—</span>
          return (
            <Tip content={`FantasyPros ECR #${e.rank}${e.best != null ? ` · best ${e.best}, worst ${e.worst}` : ''}${e.avg != null ? ` · avg expert rank ${e.avg}` : ''}${e.sd != null ? ` · SD ${e.sd}` : ''}`}>
              <span className="font-mono tnum text-chalk-3">{e.rank}</span>
            </Tip>
          )
        },
      }),
      col.accessor((r) => (r.v ? basisTotal(r.v, basis) : -999), {
        id: 'value',
        header: () => <Tip content="Total 9-cat z-score (volume-weighted FG%/FT%, inverted TO).">Value</Tip>,
        size: 54,
        sortDescFirst: true,
        cell: (c) => (c.row.original.v ? <span className="font-mono font-semibold tnum">{signed(c.getValue() as number)}</span> : <span className="text-chalk-4">—</span>),
      }),
      col.display({
        id: 'strip',
        header: () => (props.dense ? <span className="font-display text-[10px] text-chalk-4">9-cat</span> : <StripHeader />),
        size: props.dense ? 96 : 140,
        cell: (c) => {
          const v = c.row.original.v
          if (!v) return <span className="text-[11px] text-chalk-4">not projected</span>
          return <CatStrip z={basisZ(v, basis)} dim={punts} size={props.dense ? 'xs' : 'sm'} />
        },
      }),
    ]
    if (showFit)
      cols.push(
        col.accessor((r) => r.score?.fit ?? -1, {
          id: 'fit',
          header: () => <Tip content="Team-fit index: weighted gain in category edges vs. your league if added (relative, not a probability).">Fit</Tip>,
          size: 54,
          sortDescFirst: true,
          cell: (c) => {
            const s = c.row.original.score
            if (!s) return <span className="text-chalk-4">—</span>
            const w = Math.max(0, Math.min(1, s.f))
            return (
              <div
                className={cn('h-1.5 w-11 overflow-hidden rounded-full bg-well', !s.eligibleFit && 'opacity-50')}
                title={`Team-fit index ${(s.fit * 100).toFixed(1)} (relative)${s.eligibleFit ? '' : ' — below the quality window for fit picks'}`}
              >
                <div className="h-full rounded-full bg-plus/80" style={{ width: `${w * 100}%` }} />
              </div>
            )
          },
        }),
        col.accessor((r) => r.decisionRank ?? 9999, {
          id: 'rec',
          header: () => <Tip content="Rank in the Best Draft Decision lane (quality + fit + timing, behind a quality floor).">Rec</Tip>,
          size: 44,
          cell: (c) => {
            const r = c.row.original
            if (r.decisionRank == null) return <span className="text-chalk-4">—</span>
            return <span className={cn('font-mono tnum', r.decisionRank <= 3 ? 'font-semibold text-clock' : 'text-chalk-2')}>{r.decisionRank}</span>
          },
        }),
      )
    if (showTiming)
      cols.push(
        col.accessor((r) => r.adpGap ?? -999, {
          id: 'gap',
          header: () => <Tip content="Current pick minus ADP. Positive = still here past his ADP. Rough heuristic.">±ADP</Tip>,
          size: 50,
          sortDescFirst: true,
          cell: (c) => {
            const g = c.row.original.adpGap
            if (g == null) return <span className="text-chalk-4">—</span>
            return <span className={cn('font-mono tnum', g >= 5 ? 'text-plus' : g <= -15 ? 'text-chalk-4' : 'text-chalk-2')}>{signed(g, 0)}</span>
          },
        }),
        col.display({
          id: 'risk',
          header: () => <Tip content={`Rough availability at your next pick${timingPick ? ` (#${timingPick})` : ''}, from ADP only.`}>At pick</Tip>,
          size: 80,
          cell: (c) => <RiskBadge label={c.row.original.score?.riskBefore ?? null} pick={timingPick} />,
        }),
      )
    if (advanced) {
      cols.push(
        col.accessor((r) => r.info.fgPct ?? 0, {
          id: 'fg',
          header: () => <Tip content="FG% with makes/attempts per game. x-src = attempts borrowed from another source's profile; est. = opt-in PTS-identity estimate; no vol. = impact unknown.">FG%</Tip>,
          size: 100,
          cell: (c) => shootingCell(c.row.original, 'fg'),
        }),
        col.accessor((r) => r.info.ftPct ?? 0, {
          id: 'ft',
          header: 'FT%',
          size: 94,
          cell: (c) => shootingCell(c.row.original, 'ft'),
        }),
      )
      const stats: [string, 'tpm' | 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov', number][] = [
        ['3PM', 'tpm', 1],
        ['PTS', 'pts', 1],
        ['REB', 'reb', 1],
        ['AST', 'ast', 1],
        ['STL', 'stl', 2],
        ['BLK', 'blk', 2],
        ['TO', 'tov', 1],
      ]
      for (const [label, key, digits] of stats)
        cols.push(
          col.accessor((r) => Number(statCell(r, key, 3)), {
            id: key,
            header: label,
            size: 44,
            sortDescFirst: key !== 'tov',
            cell: (c) => <span className="font-mono tnum">{statCell(c.row.original, key, digits)}</span>,
          }),
        )
      cols.push(
        col.accessor((r) => r.info.gp ?? 0, {
          id: 'gp',
          header: () => <Tip content="Projected games. For Fantasy Edge lines this is ESPN's projected GP (supplemental, labelled). — = unknown (never treated as 0 or 82).">GP</Tip>,
          size: 38,
          sortDescFirst: true,
          cell: (c) => <span className="font-mono tnum text-chalk-2">{c.row.original.info.gp ?? '—'}</span>,
        }),
        col.accessor((r) => r.info.proj?.minutesPerGame ?? 0, {
          id: 'min',
          header: 'MIN',
          size: 40,
          sortDescFirst: true,
          cell: (c) => <span className="font-mono tnum text-chalk-2">{num(c.row.original.info.proj?.minutesPerGame ?? null)}</span>,
        }),
        col.accessor((r) => r.info.proj?.espnRank ?? r.info.rec.rankings?.espnProjectionOrder ?? 9999, {
          id: 'espnRank',
          header: () => <Tip content="Position in ESPN's projections list (ESPN's own ordering, points-league flavoured; not a 9-cat value).">ESPN rk</Tip>,
          size: 54,
          cell: (c) => <span className="font-mono tnum text-chalk-3">{c.row.original.info.proj?.espnRank ?? c.row.original.info.rec.rankings?.espnProjectionOrder ?? '—'}</span>,
        }),
      )
    }
    if (actionLabel && onAction)
      cols.push(
        col.display({
          id: 'action',
          header: '',
          size: actionLabel.length > 6 ? 84 : 66,
          cell: (c) => {
            const r = c.row.original
            const top = props.emphasizeRecs && r.decisionRank === 1
            return (
              <div className="flex items-center justify-end">
                <Button size="xs" variant={top ? 'primary' : 'subtle'} disabled={actionDisabled?.(r)} onClick={() => onAction(r.id)} title={top ? 'Recommended pick' : undefined}>
                  {actionLabel}
                </Button>
              </div>
            )
          },
        }),
      )
    return cols
  }, [basis, advanced, actionLabel, onAction, actionDisabled, onPreview, onStar, showFit, showTiming, timingPick, punts, props.emphasizeRecs, props.dense])

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, columnVisibility: Object.fromEntries((props.hidden ?? []).map((h) => [h, false])) },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (r) => r.id,
  })

  const scrollRef = useRef<HTMLDivElement>(null)
  const model = table.getRowModel().rows
  // Only visible rows are rendered (fixed 30px rows) so each pick re-renders ~40 rows, not 280.
  const virtualizer = useVirtualizer({ count: model.length, getScrollElement: () => scrollRef.current, estimateSize: () => ROW_H, overscan: 14 })
  const items = virtualizer.getVirtualItems()
  const padTop = items.length ? items[0].start : 0
  const padBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0

  if (!rows.length)
    return (
      <div className={props.className}>
        <div className="px-4 py-10 text-center text-[12.5px] text-chalk-3">{props.emptyText ?? 'No players match.'}</div>
      </div>
    )

  return (
    <div ref={scrollRef} className={cn('min-h-0 overflow-auto', props.className)}>
    <table className="w-full border-separate border-spacing-0 text-[13px]" data-testid="player-table">
      <thead className="sticky top-0 z-10 bg-floor">
        {table.getHeaderGroups().map((hg) => (
          <tr key={hg.id}>
            {hg.headers.map((h) => {
              const sortable = h.column.getCanSort()
              const dir = h.column.getIsSorted()
              return (
                <th
                  key={h.id}
                  style={h.column.id === 'player' ? { minWidth: 168 } : { width: h.getSize() }}
                  aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                  className={cn(
                    'h-9 border-b border-seam-strong bg-floor text-left align-middle text-[12px] font-semibold text-chalk-3',
                    props.dense ? 'px-1.5' : 'px-2.5',
                    h.column.id === 'action' && 'sticky right-0',
                  )}
                >
                  {h.isPlaceholder ? null : sortable ? (
                    <button type="button" onClick={h.column.getToggleSortingHandler()} className={cn('inline-flex items-center gap-0.5 hover:text-chalk', dir && 'text-chalk')}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      <SortIcon dir={dir} />
                    </button>
                  ) : (
                    flexRender(h.column.columnDef.header, h.getContext())
                  )}
                </th>
              )
            })}
          </tr>
        ))}
      </thead>
      <tbody>
        {padTop > 0 ? <tr aria-hidden style={{ height: padTop }} /> : null}
        {items.map((vi) => {
          const row = model[vi.index]
          const r = row.original
          return (
            <tr
              key={row.id}
              data-player-id={r.id}
              className={cn(
                'group h-[36px] hover:bg-stand/70',
                r.status === 'drafted' && 'opacity-55',
                props.highlightId === r.id && 'bg-clock-soft',
              )}
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={cn(
                    'border-b border-seam align-middle',
                    props.dense ? 'px-1.5' : 'px-2.5',
                    cell.column.id === 'action' && 'sticky right-0 bg-floor group-hover:bg-stand',
                    cell.column.id === 'action' && props.highlightId === r.id && 'bg-clock-soft',
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          )
        })}
        {padBottom > 0 ? <tr aria-hidden style={{ height: padBottom }} /> : null}
      </tbody>
    </table>
    </div>
  )
})

export const CATEGORY_KEYS: Category[] = [...CATEGORIES]
export const CAT_LABEL = (c: Category) => CATEGORY_META[c].label
