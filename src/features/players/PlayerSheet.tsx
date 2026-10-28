import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CATEGORIES, CATEGORY_META, catRecord, type Category } from '@/analytics/categories'
import { formatPick } from '@/analytics/draftOrder'
import { basisZ, weightedTotal } from '@/analytics/valuation'
import { sumEdges, whatIf } from '@/analytics/whatif'
import { draftWithToast } from '@/app/actions'
import { CategoryBars } from '@/components/CategoryBars'
import { AdpValue, Positions } from '@/components/PlayerBits'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Controls'
import { Sheet } from '@/components/ui/Dialog'
import { Tip } from '@/components/ui/Tooltip'
import { FLAG_TEXT } from '@/data/normalize'
import type { VolumeOrigin } from '@/data/engineAdapter'
import { statusText } from '@/data/ingest/types'
import type { ProfileLine, ProjectionOverride } from '@/data/schema'
import type { PlayerValue } from '@/analytics/types'
import { cn } from '@/lib/cn'
import { dateShort, num, pct, signed } from '@/lib/format'
import { signClass } from '@/lib/diverging'
import { useApp } from '@/store/appStore'
import { teamLabel, useDraft, useEngine, useLive, type PlayerInfo } from '@/store/derived'
import { lineSource } from '@/features/season/model'

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-b border-seam px-6 py-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="label-caps">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

export function PlayerSheet() {
  const id = useApp((s) => s.previewId)
  const openPreview = useApp((s) => s.openPreview)
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && openPreview(null)} title={<SheetTitle id={id} />} description={<SheetSub id={id} />} width={640}>
      {id ? <SheetBody id={id} /> : null}
    </Sheet>
  )
}

function SheetTitle({ id }: { id: string | null }) {
  const engine = useEngine()
  return <>{id ? (engine?.byId.get(id)?.name ?? id) : ''}</>
}

function SheetSub({ id }: { id: string | null }) {
  const engine = useEngine()
  const d = useDraft()
  const settings = useApp((s) => s.settings)
  if (!id || !engine) return null
  const info = engine.byId.get(id)
  if (!info) return null
  const pick = d.draftedBy.get(id)
  const status = info.rec.provenance?.status
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-display text-[12px] font-semibold tracking-wide text-chalk-2">{info.team ?? 'FA'}</span>
      <Positions positions={info.positions} />
      {pick ? (
        <Badge tone="outline">
          Drafted · {teamLabel(settings, pick.teamIndex)} · {formatPick(pick.overall, settings.teams)}
        </Badge>
      ) : (
        <Badge tone="good">Available</Badge>
      )}
      {status ? (
        <Tip content={`As printed by ${status.source} when captured. Not a live injury feed.`}>
          <span className="inline-flex">
            <Badge tone={status.tag === 'out' || status.tag === 'suspended' ? 'bad' : 'warn'}>{statusText(status.tag)}</Badge>
          </span>
        </Tip>
      ) : info.proj?.riskFlag && info.proj.riskFlag !== 'none' ? (
        <Badge tone="warn">{info.proj.riskFlag}</Badge>
      ) : null}
      {!info.valued ? <Badge tone="outline">no projection</Badge> : !info.complete ? <Badge tone="warn">incomplete 9-cat line</Badge> : null}
    </span>
  )
}

const VOLUME_TEXT: Record<VolumeOrigin, string> = {
  sourced: 'attempts from the source',
  derived: 'makes derived as % × attempts',
  'cross-source': 'attempts borrowed from another source (cross-source volume proxy)',
  estimated: 'attempts estimated from the points identity (opt-in estimate)',
  missing: 'no attempts — impact unknown',
}

function shootingText(made: number | null | undefined, att: number | null | undefined, origin: VolumeOrigin | undefined) {
  if (att == null || origin === 'missing' || !origin) return <span className="text-warn">{VOLUME_TEXT.missing}</span>
  return (
    <>
      {num(made ?? null)} / {num(att)} per game ·{' '}
      <span className={origin === 'estimated' || origin === 'cross-source' ? 'text-warn' : ''}>{VOLUME_TEXT[origin]}</span>
    </>
  )
}

function SheetBody({ id }: { id: string }) {
  const engine = useEngine()
  const live = useLive()
  const d = useDraft()
  const settings = useApp((s) => s.settings)
  const shortlist = useApp((s) => s.shortlist)
  const toggleShortlist = useApp((s) => s.toggleShortlist)
  const compareIds = useApp((s) => s.compareIds)
  const setCompare = useApp((s) => s.setCompare)
  const [showRaw, setShowRaw] = useState(false)

  const info = engine?.byId.get(id)
  const v = engine?.valuation.values.get(id)
  const wi = useMemo(() => {
    if (!engine || !live || !v || live.myTeam == null || d.draftedBy.has(id)) return null
    return whatIf(engine.ctx, live.my.playerIds, [id], live.utility)
  }, [engine, live, id, d, v])
  const buildFit = useMemo(() => {
    if (!engine || !live || !v) return []
    const pool = live.available.includes(id) ? live.available : [...live.available, id]
    return live.builds.slice(0, 6).map((b) => {
      const scored = pool.map((pid) => ({ pid, s: weightedTotal(basisZ(engine.valuation.values.get(pid)!, engine.ctx.basis), b.weights) })).sort((a, b2) => b2.s - a.s)
      return { b, rank: scored.findIndex((x) => x.pid === id) + 1, score: scored.find((x) => x.pid === id)!.s }
    })
  }, [engine, live, id, v])

  if (!engine || !info) return <div className="p-5 text-chalk-3">Player not in the active dataset.</div>
  const p = info.proj
  const l = info.line
  const basis = engine.ctx.basis
  const params = engine.valuation.params
  const drafted = d.draftedBy.has(id)
  const ecr = info.rec.rankings?.fantasyProsEcr
  const profileLabel = info.profileUsed ? (info.rec.profiles?.[info.profileUsed]?.label ?? p?.source ?? info.profileUsed) : null

  return (
    <div className="pb-8" data-testid="player-sheet">
      <div className="flex flex-wrap items-center gap-2 border-b border-seam px-6 py-4">
        {!drafted && d.currentPick != null ? (
          <Button variant="primary" onClick={() => draftWithToast(id) && useApp.getState().openPreview(null)}>
            Draft for {d.isUserOnClock ? 'me' : teamLabel(settings, d.onClockTeam!)} · #{d.currentPick}
          </Button>
        ) : null}
        <Button variant="subtle" onClick={() => toggleShortlist(id)}>
          {shortlist.includes(id) ? '★ Shortlisted' : '☆ Shortlist'}
        </Button>
        {v && !d.complete ? (
          <Button
            variant="subtle"
            onClick={() => {
              setCompare(compareIds.includes(id) ? compareIds.filter((x) => x !== id) : [...compareIds, id])
              toast(compareIds.includes(id) ? 'Removed from comparison' : 'Added to comparison (My Build → What-if)')
            }}
          >
            {compareIds.includes(id) ? 'In comparison' : 'Compare'}
          </Button>
        ) : null}
        <div className="ml-auto grid grid-cols-4 gap-4 text-right">
          <div>
            <div className="text-[11.5px] text-chalk-3">9dub rank</div>
            <div className="font-mono text-[15px] font-semibold tnum">
              {v ? `#${v.rank}` : '—'}
              {v && !v.complete ? <span className="text-warn">≈</span> : null}
            </div>
          </div>
          <div>
            <Tip content={info.gp == null ? 'No projected GP: the GP-aware value equals per-game (unknown GP is never treated as 0 or 82).' : `Availability-adjusted with ${info.gp} projected GP.`}>
              <div className="text-[11.5px] text-chalk-3">GP-aware</div>
            </Tip>
            <div className="font-mono text-[15px] font-semibold tnum">
              {v ? `#${v.rankGp}` : '—'}
              {v && info.gp == null ? <span className="text-chalk-4">?</span> : null}
            </div>
          </div>
          <div>
            <div className="text-[11.5px] text-chalk-3">{info.adpSource === 'ESPN via FantasyPros' ? 'ESPN ADP (FP)' : 'ESPN ADP'}</div>
            <div className="font-mono text-[15px] font-semibold tnum">
              <AdpValue adp={info.adp} source={info.adpSource} note={info.adpNote} />
            </div>
          </div>
          <div>
            <div className="text-[11.5px] text-chalk-3">{ecr ? 'Expert rank' : (p?.otherAdpLabel ?? 'Src rank')}</div>
            <div className="font-mono text-[15px] font-semibold tnum">{ecr ? `#${ecr.rank}` : p?.otherAdp != null ? p.otherAdp.toFixed(1) : (p?.sourceNineCatRank ?? '—')}</div>
          </div>
        </div>
      </div>

      {l ? (
        <Section
          title="Projection · per game"
          aside={
            <span className="text-right text-[11px] text-chalk-4">
              {profileLabel}
              {p?.sourceUpdatedAt ? ` · ${dateShort(p.sourceUpdatedAt)}` : ''}
            </span>
          }
        >
          <div className="grid grid-cols-11 gap-px overflow-hidden rounded-md border border-seam bg-seam text-center">
            {[
              ['GP', info.gp ?? '—'],
              ['MIN', num(p?.minutesPerGame ?? null)],
              ['PTS', num(l.pts)],
              ['3PM', num(l.tpm)],
              ['REB', num(l.reb)],
              ['AST', num(l.ast)],
              ['STL', num(l.stl, 2)],
              ['BLK', num(l.blk, 2)],
              ['TO', num(l.tov)],
              ['FG%', pct(info.fgPct)],
              ['FT%', pct(info.ftPct)],
            ].map(([k, val]) => (
              <div key={k as string} className="bg-floor px-1 py-2">
                <div className="font-display text-[12px] font-semibold tracking-wide text-chalk-3">{k}</div>
                <div className="font-mono text-[14px] tnum">{val}</div>
              </div>
            ))}
          </div>
          <div className="mt-2.5 space-y-1 text-[12.5px] text-chalk-3">
            <div>FG: {shootingText(l.fgm, l.fga, info.volume?.fg)}</div>
            <div>FT: {shootingText(l.ftm, l.fta, info.volume?.ft)}</div>
            <div>GP/MIN: {p?.gpSource ?? (info.gp == null ? 'not projected by this source' : profileLabel)}</div>
          </div>
        </Section>
      ) : (
        <Section title="Projection">
          <p className="text-[12px] text-chalk-3">
            No projection for this season in any loaded source. {info.name} can be searched and drafted (so the board stays accurate), but is not valued or
            recommended.{' '}
            {info.standIn
              ? 'For weekly matchups he counts at the estimate below, from his actual ESPN stats.'
              : 'In weekly matchups he counts at replacement level until an ESPN sync brings his stats.'}
          </p>
          {info.standIn ? (
            <>
              <div className="mt-3 grid grid-cols-10 gap-px overflow-hidden rounded-md border border-seam bg-seam text-center" data-testid="stand-in-line">
                {[
                  ['MIN', num(info.standIn.mpg)],
                  ['PTS', num(info.standIn.line.pts)],
                  ['3PM', num(info.standIn.line.tpm)],
                  ['REB', num(info.standIn.line.reb)],
                  ['AST', num(info.standIn.line.ast)],
                  ['STL', num(info.standIn.line.stl, 2)],
                  ['BLK', num(info.standIn.line.blk, 2)],
                  ['TO', num(info.standIn.line.tov)],
                  ['FG%', pct(info.standIn.line.fga ? info.standIn.line.fgm! / info.standIn.line.fga : null)],
                  ['FT%', pct(info.standIn.line.fta ? info.standIn.line.ftm! / info.standIn.line.fta : null)],
                ].map(([k, val]) => (
                  <div key={k as string} className="bg-floor px-1 py-2">
                    <div className="font-display text-[12px] font-semibold tracking-wide text-chalk-3">{k}</div>
                    <div className="font-mono text-[14px] tnum">{val}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[12px] text-chalk-3">{lineSource(info)?.text}</p>
            </>
          ) : null}
        </Section>
      )}

      {v ? (
        <Section
          title={`Category value · ${basis === 'perGame' ? 'per game' : 'GP-aware'}`}
          aside={
            <span className="font-mono text-[12px] tnum">
              total <span className="font-semibold">{signed(basis === 'perGame' ? v.total : v.gp.total)}</span>
              {v.coveredCats < 9 ? <span className="text-warn"> ({v.coveredCats}/9 cats — partial)</span> : null}
            </span>
          }
        >
          <CategoryBars
            values={catRecord((c) => basisZ(v, basis)[c] ?? 0)}
            scale={3}
            compact
            annotations={(c) => {
              if (basisZ(v, basis)[c] == null) return <span className="text-warn">unknown</span>
              if (c === 'FG' || c === 'FT') {
                const base = c === 'FG' ? params.fgBaseline : params.ftBaseline
                return (
                  <span title={`Impact = makes − ${pct(base)} × attempts`}>
                    {signed(v.raw[c], 2)} mk vs {pct(base)}
                  </span>
                )
              }
              return <span>{num(v.raw[c], c === 'STL' || c === 'BLK' ? 2 : 1)}/g</span>
            }}
          />
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-chalk-3 text-pretty">
            FG%/FT% are valued by <em>impact</em>: makes above the reference pool's attempt-weighted rate × attempts, so volume matters. TO is inverted. Reference
            pool: top {params.poolSize} players, frozen for this dataset.
            {v.gp.availability != null ? ` GP-aware total ${signed(v.gp.total)} (plays ${Math.round(v.gp.availability * 100)}% of games; missed games at replacement level).` : ' No GP projection — GP-aware value equals per-game.'}
            {!v.complete ? ' Partial line: the missing categories count as average in this total, so he is ranked after every complete player and kept out of recommendations.' : ''}
          </p>
        </Section>
      ) : null}

      {wi ? (
        <Section
          title="If you draft him"
          aside={
            <Tip content="Sum over the nine categories of the change in your average head-to-head edge (0–1 per category) against each team. A construction index, not a win probability.">
              <span className={cn('font-mono text-[12px] tnum', signClass(sumEdges(wi.edgesAfter) - sumEdges(wi.edgesBefore), 0.005))}>
                {signed(sumEdges(wi.edgesAfter) - sumEdges(wi.edgesBefore), 2)} category edges
              </span>
            </Tip>
          }
        >
          <CategoryBars
            values={catRecord((c) => (wi.before.zSlot[c] - (live!.opponents.length ? live!.opponents.reduce((s, o) => s + o[c], 0) / live!.opponents.length : live!.typicalNow[c])) / engine.scale.sigma[c])}
            delta={catRecord((c) => wi.deltaZ[c] / engine.scale.sigma[c])}
            scale={1.5}
            compact
            annotations={(c) => (
              <span className="font-mono tnum">
                rk {wi.rankBefore[c]}→<span className={wi.rankAfter[c] < wi.rankBefore[c] ? 'text-plus' : wi.rankAfter[c] > wi.rankBefore[c] ? 'text-minus' : ''}>{wi.rankAfter[c]}</span>
              </span>
            )}
          />
          <p className="mt-2 text-[11.5px] leading-relaxed text-chalk-3">
            Bars: your slot-adjusted standing vs. the league average (σ units); dashed = change if added. Ranks among {live!.opponents.length + 1} teams. Category edges
            are a construction index, not a win probability.
          </p>
        </Section>
      ) : null}

      {buildFit.length ? (
        <Section title="Build fit" aside={<span className="text-[11px] text-chalk-4">rank among available under each build</span>}>
          <div className="grid grid-cols-2 gap-1.5">
            {buildFit.map(({ b, rank, score }) => (
              <div key={b.build.id} className="flex items-center justify-between rounded-md border border-seam px-2 py-1 text-[12px]">
                <span className="truncate text-chalk-2">{b.build.label}</span>
                <span className="font-mono tnum">
                  <span className={rank <= 5 ? 'font-semibold text-clock' : 'text-chalk-2'}>#{rank}</span> <span className="text-chalk-4">{signed(score)}</span>
                </span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <SourcesSection info={info} v={v ?? null} />

      <Section title="Notes & data quality">
        {p?.injuryOrRoleNote ? <p className="mb-2 rounded-md bg-stand px-3 py-2 text-[13px] text-chalk-2">{p.injuryOrRoleNote}</p> : <p className="mb-2 text-[13px] text-chalk-3">No injury, role or preseason note in this dataset.</p>}
        {p?.completenessFlags.length ? (
          <ul className="mb-2 space-y-0.5 text-[12.5px] text-chalk-3">
            {p.completenessFlags.map((f) => (
              <li key={f}>· {FLAG_TEXT[f]}</li>
            ))}
          </ul>
        ) : null}
        {info.rec.provenance?.warnings.length ? (
          <ul className="mb-2 space-y-0.5 text-[11.5px] text-warn">
            {info.rec.provenance.warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        ) : null}
        {!info.rec.rankings ? (
          <div className="text-[11.5px] text-chalk-3">
            ESPN rank {p?.espnRank ?? '—'} · source 9-cat rank {p?.sourceNineCatRank ?? '—'} · these are kept separate from 9dub's rank.
          </div>
        ) : null}
        {p?.raw ? (
          <button type="button" className="mt-2 text-[11.5px] text-chalk-3 underline-offset-2 hover:underline" onClick={() => setShowRaw((x) => !x)}>
            {showRaw ? 'Hide' : 'Show'} raw source fields
          </button>
        ) : null}
        {showRaw && p?.raw ? (
          <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-well p-2 font-mono text-[10.5px] text-chalk-3">{JSON.stringify(p.raw, null, 1)}</pre>
        ) : null}
      </Section>

      {info.valued ? <OverrideEditor id={id} /> : null}
    </div>
  )
}

/** Every source's own numbers for this player, kept side by side (never blended). */
function SourcesSection({ info, v }: { info: PlayerInfo; v: PlayerValue | null }) {
  const rec = info.rec
  const lines: ProfileLine[] = [...Object.values(rec.profiles ?? {}), ...(rec.priorSeason ? [rec.priorSeason] : [])]
  const m = rec.market
  const r = rec.rankings
  const prov = rec.provenance
  if (!lines.length && !m && !r) return null
  const teams = prov ? [...new Set(Object.values(prov.teamBySource).filter(Boolean))] : []
  const cell = (x: number | null | undefined, d = 1) => (x == null ? '—' : x.toFixed(d))
  return (
    <Section title="Sources & market" aside={<span className="text-[11px] text-chalk-4">each source shown separately</span>}>
      {lines.length ? (
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-[12px]" data-testid="source-lines">
            <thead>
              <tr className="text-[11px] text-chalk-3">
                <th className="h-6 text-left font-medium">Line</th>
                {['GP', 'PTS', '3PM', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FG% (FGA)', 'FT% (FTA)'].map((h) => (
                  <th key={h} className="px-[3px] text-right font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((x) => (
                <tr key={x.id} className={cn('border-t border-seam', x.kind === 'actual' && 'text-chalk-3')}>
                  <td className="h-6 pr-1" title={`${x.label}${x.sourceFile ? ` — ${x.sourceFile}${x.sourcePage ? ` p.${x.sourcePage}` : ''}` : ''}`}>
                    {LINE_SHORT[x.id] ?? x.label}
                    {info.profileUsed === x.id ? <span className="ml-1 text-clock" aria-label="in use">●</span> : null}
                  </td>
                  <td className="px-[3px] text-right font-mono tnum">{x.gp ?? '—'}</td>
                  <td className="px-[3px] text-right font-mono tnum">{cell(x.pts)}</td>
                  <td className="px-[3px] text-right font-mono tnum">{cell(x.tpm)}</td>
                  <td className="px-[3px] text-right font-mono tnum">{cell(x.reb)}</td>
                  <td className="px-[3px] text-right font-mono tnum">{cell(x.ast)}</td>
                  <td className="px-[3px] text-right font-mono tnum">{cell(x.stl)}</td>
                  <td className="px-[3px] text-right font-mono tnum">{cell(x.blk)}</td>
                  <td className="px-[3px] text-right font-mono tnum">{cell(x.tov)}</td>
                  <td className="px-[3px] text-right font-mono tnum">
                    {pct(x.fgPct)} <span className="text-chalk-4">({x.fga != null ? x.fga.toFixed(1) : '—'})</span>
                  </td>
                  <td className="px-[3px] text-right font-mono tnum">
                    {pct(x.ftPct)} <span className="text-chalk-4">({x.fta != null ? x.fta.toFixed(1) : '—'})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10.5px] text-chalk-4">
            <span className="text-clock">●</span> = line the engine is using. “Actual” rows are 2025–26 statistics for reference only — never used as projections. Hover a row for its
            source file.
          </p>
        </div>
      ) : null}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]" data-testid="market-ranks">
        <dt className="text-chalk-3">ESPN Live ADP</dt>
        <dd className="text-chalk-2">
          {m?.espnLive ? (
            <>
              <span className="font-mono tnum">{m.espnLive.avgPick.toFixed(1)}</span> AVG PICK (snake) · rank {m.espnLive.rank}
              {m.espnLive.avgPickTrend7d != null ? ` · 7-day ${signed(m.espnLive.avgPickTrend7d, 1)}` : ''}
              {m.espnLive.pctRostered != null ? ` · ${m.espnLive.pctRostered}% rostered` : ''}
              {m.espnLive.capped ? <span className="text-warn"> · at ESPN's ~140 ceiling (rarely drafted)</span> : null}
              {m.espnLive.capturedAt ? <span className="text-chalk-4"> · captured {dateShort(m.espnLive.capturedAt)}</span> : null}
            </>
          ) : (
            <span className="text-chalk-4">not in the ESPN Live Draft Trends capture</span>
          )}
        </dd>
        <dt className="text-chalk-3">FantasyPros ADP</dt>
        <dd className="text-chalk-2">
          {m?.fantasyPros ? (
            <>
              ESPN {m.fantasyPros.espn ?? '—'}
              {!m.espnLive && m.fantasyPros.espn != null ? <span className="text-warn"> (used as fallback)</span> : null} · Yahoo {m.fantasyPros.yahoo ?? '—'} · avg {m.fantasyPros.avg ?? '—'}
            </>
          ) : (
            <span className="text-chalk-4">—</span>
          )}
        </dd>
        <dt className="text-chalk-3">Fantasy Edge</dt>
        <dd className="text-chalk-2">
          {r?.fantasyEdge ? `#${r.fantasyEdge.rank} 9-cat${r.fantasyEdge.value != null ? ` (value ${signed(r.fantasyEdge.value)})` : ''}` : '—'}
          {m?.fantasyEdgeAdp != null ? <span className="text-chalk-4"> · ADP {m.fantasyEdgeAdp} (platform not stated)</span> : null}
        </dd>
        <dt className="text-chalk-3">FantasyPros ECR</dt>
        <dd className="text-chalk-2">
          {r?.fantasyProsEcr ? (
            <>
              #{r.fantasyProsEcr.rank}
              {r.fantasyProsEcr.best != null ? ` · experts ${r.fantasyProsEcr.best}–${r.fantasyProsEcr.worst}` : ''}
              {r.fantasyProsEcr.avg != null ? ` · avg expert rank ${r.fantasyProsEcr.avg}` : ''}
              {r.fantasyProsEcr.sd != null ? ` · SD ${r.fantasyProsEcr.sd}` : ''}
            </>
          ) : (
            '—'
          )}
        </dd>
        {r?.espnProjectionOrder != null ? (
          <>
            <dt className="text-chalk-3">ESPN list order</dt>
            <dd className="text-chalk-2">#{r.espnProjectionOrder} on ESPN's projections page (not a 9-cat rank)</dd>
          </>
        ) : null}
        <dt className="text-chalk-3">9dub</dt>
        <dd className="text-chalk-2">{v ? `#${v.rank} per-game · #${v.rankGp} GP-aware${v.complete ? '' : ' · partial line (ranked after complete players)'}` : 'not valued'}</dd>
        {teams.length > 1 ? (
          <>
            <dt className="text-chalk-3">Team by source</dt>
            <dd className="text-chalk-2">
              {Object.entries(prov!.teamBySource)
                .map(([k, t]) => `${SOURCE_SHORT[k] ?? k} ${t ?? '—'}`)
                .join(' · ')}
            </dd>
          </>
        ) : null}
        {prov?.sources.length ? (
          <>
            <dt className="text-chalk-3">Found in</dt>
            <dd className="text-chalk-3">{prov.sources.map((s) => SOURCE_SHORT[s] ?? s).join(', ')}</dd>
          </>
        ) : null}
      </dl>
      {prov?.notes.length ? <p className="mt-1.5 text-[11px] text-chalk-4">{prov.notes.join(' · ')}</p> : null}
    </Section>
  )
}

const LINE_SHORT: Record<string, string> = {
  fantasyedge: 'Fantasy Edge',
  espn: 'ESPN proj.',
  'espn-prior': 'ESPN ’26 actual',
}

const SOURCE_SHORT: Record<string, string> = {
  'espn-live-draft': 'ESPN Live Draft Trends',
  'espn-projections': 'ESPN projections',
  'fantasyedge-pdf': 'Fantasy Edge',
  'fantasyedge-csv': 'Fantasy Edge CSV',
  'fantasypros-ecr': 'FantasyPros ECR',
  'fantasypros-adp': 'FantasyPros ADP',
}

const OV_FIELDS: { key: keyof ProjectionOverride; label: string; cat?: Category }[] = [
  { key: 'gamesProjected', label: 'GP' },
  { key: 'points', label: 'PTS', cat: 'PTS' },
  { key: 'threesMade', label: '3PM', cat: '3PM' },
  { key: 'rebounds', label: 'REB', cat: 'REB' },
  { key: 'assists', label: 'AST', cat: 'AST' },
  { key: 'steals', label: 'STL', cat: 'STL' },
  { key: 'blocks', label: 'BLK', cat: 'BLK' },
  { key: 'turnovers', label: 'TO', cat: 'TO' },
  { key: 'fieldGoalsAttempted', label: 'FGA' },
  { key: 'freeThrowsAttempted', label: 'FTA' },
]

function OverrideEditor({ id }: { id: string }) {
  const existing = useApp((s) => s.overrides[id])
  const setOverride = useApp((s) => s.setOverride)
  const [open, setOpen] = useState(!!existing)
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(existing ?? {}).map(([k, v]) => [k, String(v)])),
  )
  return (
    <Section
      title="Manual override"
      aside={
        <button type="button" className="text-[11.5px] text-chalk-3 hover:text-chalk" onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : existing ? 'Edit override' : 'Override projection'}
        </button>
      }
    >
      {existing && !open ? <p className="text-[12px] text-warn">This player has a manual override applied to all valuations.</p> : null}
      {!open && !existing ? <p className="text-[12px] text-chalk-3">Adjust per-game numbers you disagree with; the original source values are kept.</p> : null}
      {open ? (
        <div>
          <div className="grid grid-cols-5 gap-2">
            {OV_FIELDS.map((f) => (
              <label key={f.key} className="text-[11px] text-chalk-3">
                {f.label}
                <Input
                  inputMode="decimal"
                  value={draft[f.key] ?? ''}
                  placeholder="—"
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                  className="mt-0.5 h-7 font-mono text-[12px] tnum"
                />
              </label>
            ))}
          </div>
          <label className="mt-2 block text-[11px] text-chalk-3">
            Note
            <Input value={draft.note ?? ''} onChange={(e) => setDraft({ ...draft, note: e.target.value })} className="mt-0.5 h-7" />
          </label>
          <div className="mt-2.5 flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                const ov: ProjectionOverride = {}
                for (const f of OV_FIELDS) {
                  const raw = draft[f.key]
                  if (raw == null || raw.trim() === '') continue
                  const n = Number(raw)
                  if (!Number.isFinite(n) || n < 0) return toast.error(`${f.label} must be a non-negative number`)
                  ;(ov as Record<string, number>)[f.key] = n
                }
                if (draft.note?.trim()) ov.note = draft.note.trim()
                setOverride(id, ov)
                toast('Override saved — valuations recomputed')
              }}
            >
              Save override
            </Button>
            {existing ? (
              <Button size="sm" variant="subtle" onClick={() => (setOverride(id, null), setDraft({}), toast('Override removed'))}>
                Remove override
              </Button>
            ) : null}
          </div>
          <p className="mt-2 text-[11px] text-chalk-4">Overrides change this player's line and, because the reference pool is recomputed from the edited data, can shift other values slightly.</p>
        </div>
      ) : null}
    </Section>
  )
}

export const CAT_NAMES = CATEGORIES.map((c) => CATEGORY_META[c].name)
