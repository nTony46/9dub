import { Info } from 'lucide-react'
import { compareForFit, explainCandidate, REC_MODE_LABEL, type CandidateScore, type Reason, type RecMode, type RecommendResult, type TimingContext } from '@/analytics/recommend'
import { basisZ } from '@/analytics/valuation'
import { CatStrip } from '@/components/CatStrip'
import { Positions, RiskBadge } from '@/components/PlayerBits'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Controls'
import { Tip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { signed } from '@/lib/format'
import { useApp } from '@/store/appStore'
import type { EngineData } from '@/store/derived'

/** Reason order for the hero card: what it does for *your* roster first; raw value is already in the header. */
const REASON_ORDER: Reason['kind'][] = ['guardrail', 'fit', 'timing', 'strength', 'data', 'cost']

function reasonsFor(s: CandidateScore, rec: RecommendResult, engine: EngineData, timing: TimingContext | null): Reason[] {
  const info = engine.byId.get(s.id)!
  const all = explainCandidate(s, rec, {
    adp: info.adp,
    gp: info.gp,
    fullSeasonGames: engine.valuation.settings.fullSeasonGames,
    timing,
    fga: info.line?.fga ?? null,
    fta: info.line?.fta ?? null,
  })
  // "Adds BLK +2.8, REB +2.5…" and "Biggest roster gains: BLK, REB…" usually name the same categories; keep the roster-gain line.
  const hasGains = all.some((r) => r.kind === 'fit' && r.text.startsWith('Biggest roster gains'))
  return all
    .filter((r) => r.kind !== 'quality' && !(hasGains && r.kind === 'strength'))
    .sort((a, b) => REASON_ORDER.indexOf(a.kind) - REASON_ORDER.indexOf(b.kind))
}

type Tag = 'value' | 'fit' | 'close'
const TAG_TEXT: Record<Tag, { label: string; tip: string }> = {
  value: { label: 'Top value', tip: 'Highest raw 9-cat value still available, regardless of your roster (Best Overall).' },
  fit: { label: 'Best fit', tip: 'Biggest gain in category edges against your league, within a quality window (Best Team Fit).' },
  close: { label: 'Close call', tip: 'Next in the Best Draft Decision ranking (quality, fit and timing combined).' },
}

/**
 * Recommendation panel: one clear pick (Best Draft Decision) with its reasons,
 * then a short, de-duplicated list of alternatives tagged by the lane they come
 * from (Best Overall, Best Team Fit, next decisions). The three lanes stay
 * distinct in the engine; the UI just doesn't repeat the same player three times.
 */
export function RecLanes({
  rec,
  engine,
  timing,
  canDraft,
  onDraft,
  showMode = true,
}: {
  rec: RecommendResult
  engine: EngineData
  timing: TimingContext | null
  canDraft: boolean
  onDraft?: (id: string) => void
  showMode?: boolean
}) {
  const mode = useApp((s) => s.prefs.recMode)
  const setPrefs = useApp((s) => s.setPrefs)
  const lock = useApp((s) => s.buildLock)
  const openPreview = useApp((s) => s.openPreview)
  const basis = engine.ctx.basis
  const names = (id: string) => engine.byId.get(id)?.name ?? id
  const top = rec.bestDecision[0]
  const fitAlt = rec.bestFit[0] && top && rec.bestFit[0].id !== top.id ? rec.bestFit[0] : rec.floorExcluded[0]
  const compare = top && fitAlt ? compareForFit(top, fitAlt, rec, names) : null

  // Alternatives: tagged, unique, never the hero.
  const tagged = new Map<string, { s: CandidateScore; tags: Tag[] }>()
  const add = (s: CandidateScore | undefined, tag: Tag) => {
    if (!s || s.id === top?.id) return
    const cur = tagged.get(s.id)
    if (cur) {
      if (!cur.tags.includes(tag)) cur.tags.push(tag)
    } else tagged.set(s.id, { s, tags: [tag] })
  }
  add(rec.bestOverall[0], 'value')
  add(rec.bestFit[0], 'fit')
  add(rec.bestDecision[1], 'close')
  add(rec.bestDecision[2], 'close')
  add(rec.bestOverall[1], 'value')
  add(rec.bestFit[1], 'fit')
  const alts = [...tagged.values()].slice(0, 4)
  const reasons = top ? reasonsFor(top, rec, engine, timing).slice(0, 3) : []
  const info = top ? engine.byId.get(top.id)! : null

  return (
    <section className="rounded-lg border border-seam bg-floor" data-testid="recommendations">
      <header className="flex items-center gap-2 px-3.5 pt-3">
        <h2 className="label-caps text-clock">Recommended pick</h2>
        <Tip
          content={
            <div className="max-w-[280px] space-y-1">
              <div>
                Best Draft Decision: quality {Math.round(rec.weights.q * 100)}%, team fit {Math.round(rec.weights.f * 100)}%, timing {Math.round(rec.weights.t * 100)}%,
                behind a quality floor so category specialists can't leapfrog clearly better players.
              </div>
              <div className="text-chalk-3">Mode: {REC_MODE_LABEL[mode]}.</div>
              {mode === 'build' && !lock ? <div className="text-warn">No build locked — fit uses all nine categories.</div> : null}
            </div>
          }
        >
          <span className="text-chalk-4" aria-label="How recommendations work">
            <Info size={13} />
          </span>
        </Tip>
      </header>

      {!top || !info ? (
        <p className="px-3.5 pb-3.5 pt-2 text-[13px] text-chalk-3">{rec.rosterFull ? 'Your roster is full.' : 'No eligible players right now.'}</p>
      ) : (
        <div className="px-3.5 pb-3.5 pt-2" data-testid="lane-decision">
          <div className="flex items-baseline gap-2">
            <button type="button" onClick={() => openPreview(top.id)} className="min-w-0 truncate text-left font-display text-[21px] font-semibold leading-tight tracking-tight hover:underline">
              {info.name}
            </button>
            <span className="shrink-0 text-[12px] text-chalk-3">
              {info.team ?? 'FA'} · <Positions positions={info.positions} className="text-[12px]" />
            </span>
            <span className="ml-auto shrink-0 font-mono text-[15px] font-semibold tnum">{signed(top.quality)}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2.5">
            <CatStrip z={basisZ(engine.valuation.values.get(top.id)!, basis)} size="sm" />
            <span className="font-mono text-[12px] tnum text-chalk-3">
              #{top.rank}
              {info.adp != null ? ` · ADP ${info.adp.toFixed(0)}` : ''}
            </span>
            <RiskBadge label={top.riskBefore} pick={timing?.decisionPick} />
          </div>
          {reasons.length ? (
            <ul className="mt-2.5 space-y-1">
              {reasons.map((r, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-chalk-2">
                  <span className={cn('mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full', r.tone === 'good' ? 'bg-plus' : r.tone === 'bad' ? 'bg-minus' : 'bg-chalk-4')} />
                  <span className="text-pretty">{r.text}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {compare ? <p className="mt-2.5 border-l-2 border-seam-strong pl-2.5 text-[12px] leading-snug text-chalk-3 text-pretty">{compare}</p> : null}
          {canDraft && onDraft ? (
            <Button variant="primary" className="mt-3 w-full" onClick={() => onDraft(top.id)}>
              Draft
            </Button>
          ) : null}
        </div>
      )}

      {alts.length ? (
        <div className="border-t border-seam px-3.5 pb-2.5 pt-2.5">
          <div className="mb-1 text-[11.5px] font-medium text-chalk-3">Also consider</div>
          <ul>
            {alts.map(({ s, tags }) => {
              const p = engine.byId.get(s.id)!
              return (
                <li key={s.id} className="flex h-8 items-center gap-2 text-[13px]">
                  <button type="button" onClick={() => openPreview(s.id)} className="min-w-0 truncate text-left font-medium text-chalk hover:underline">
                    {p.name}
                  </button>
                  <Positions positions={p.positions} className="shrink-0 text-[11px]" />
                  <Tip content={<div className="max-w-[260px] space-y-1">{tags.map((t) => <div key={t}>{TAG_TEXT[t].tip}</div>)}</div>}>
                    <span className="shrink-0 rounded-[4px] bg-stand px-1.5 py-px text-[11px] font-medium text-chalk-3">
                      {TAG_TEXT[tags[0]].label}
                      {tags.length > 1 ? ` +${tags.length - 1}` : ''}
                    </span>
                  </Tip>
                  <span className="ml-auto shrink-0 font-mono text-[12px] tnum text-chalk-2">{signed(s.quality)}</span>
                  {canDraft && onDraft ? (
                    <button type="button" onClick={() => onDraft(s.id)} className="shrink-0 rounded px-1.5 py-0.5 text-[12px] font-medium text-chalk-3 hover:bg-stand hover:text-chalk">
                      Draft
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
      {showMode ? (
        <footer className="flex items-center gap-2 border-t border-seam px-3.5 py-2">
          <span className="text-[12px] text-chalk-3">Mode</span>
          <Segmented<RecMode>
            label="Recommendation mode"
            size="xs"
            value={mode}
            onChange={(m) => setPrefs({ recMode: m })}
            options={[
              { value: 'adaptive', label: 'Adaptive', title: REC_MODE_LABEL.adaptive },
              { value: 'bpa', label: 'Best available', title: REC_MODE_LABEL.bpa },
              { value: 'fit', label: 'Fit', title: REC_MODE_LABEL.fit },
              { value: 'build', label: 'Build', title: lock ? REC_MODE_LABEL.build : 'Optimize Selected Build — lock a build in My Build first' },
            ]}
          />
        </footer>
      ) : null}
    </section>
  )
}
