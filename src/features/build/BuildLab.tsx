import { Lock, Unlock } from 'lucide-react'
import { useState } from 'react'
import { catLabel } from '@/analytics/categories'
import { buildId, type BuildEvaluation, type BuildLock, type BuildViability } from '@/analytics/builds'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Segmented } from '@/components/ui/Controls'
import { Tip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { signed } from '@/lib/format'
import { useApp } from '@/store/appStore'
import type { EngineData } from '@/store/derived'

const VIABILITY_TONE: Record<BuildViability, Tone> = { strong: 'plus', viable: 'neutral', fragile: 'warn', unlikely: 'minus' }

export function BuildLab({
  builds,
  engine,
  lock,
  onLock,
  assumedSlot,
  picksMade,
}: {
  builds: BuildEvaluation[]
  engine: EngineData
  lock: BuildLock | null
  onLock: (lock: BuildLock | null) => void
  assumedSlot: number | null
  picksMade: number
}) {
  const openPreview = useApp((s) => s.openPreview)
  const [filter, setFilter] = useState<'top' | 'single' | 'double' | 'all'>('top')
  const lockedId = lock ? buildId(lock.punts) : null
  const balanced = builds.find((b) => b.build.kind === 'balanced')
  const shown = (
    filter === 'top'
      ? builds.slice(0, 6)
      : filter === 'single'
        ? builds.filter((b) => b.build.kind !== 'double')
        : filter === 'double'
          ? builds.filter((b) => b.build.kind === 'double')
          : builds
  ).concat(filter === 'top' && balanced && !builds.slice(0, 6).includes(balanced) ? [balanced] : [])
  const early = picksMade <= 2

  return (
    <div data-testid="build-lab">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Segmented
          label="Builds shown"
          size="xs"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'top', label: 'Top' },
            { value: 'single', label: 'Single punts' },
            { value: 'double', label: 'Double punts' },
            { value: 'all', label: `All ${builds.length}` },
          ]}
        />
        {lock ? (
          <Badge tone="clock">
            <Lock size={10} /> {lock.mode} lock: {lock.punts.length ? `punt ${lock.punts.map(catLabel).join(' + ')}` : 'balanced'}
          </Badge>
        ) : (
          <span className="text-[12.5px] text-chalk-3">No build locked — 9dub never locks one for you.</span>
        )}
      </div>
      {early ? (
        <p className="mb-2.5 text-[13px] leading-relaxed text-chalk-2">
          <span className="font-medium">Early read ({picksMade} of {engine.ctx.rosterSize} picks, low confidence).</span> Keep drafting for quality; these are directions the
          board keeps open, not plans.
        </p>
      ) : null}
      {assumedSlot != null ? (
        <p className="mb-2.5 text-[12.5px] text-warn">Draft slot not set — builds assume slot {assumedSlot}. Set your slot for accurate pick timing.</p>
      ) : null}
      <div className="grid gap-2">
        {shown.map((b) => (
          <BuildCard
            key={b.build.id}
            b={b}
            engine={engine}
            locked={lockedId === b.build.id}
            showConfidence={!early}
            onLock={onLock}
            onPreview={openPreview}
          />
        ))}
      </div>
      <p className="mt-2.5 text-[12px] leading-relaxed text-chalk-3">
        Hard punt ignores the category when scoring fit; soft punt keeps it at reduced weight. Locks change team-fit recommendations only — a player's own 9-cat value never changes.
      </p>
    </div>
  )
}

function BuildCard({
  b,
  engine,
  locked,
  showConfidence,
  onLock,
  onPreview,
}: {
  b: BuildEvaluation
  engine: EngineData
  locked: boolean
  showConfidence: boolean
  onLock: (lock: BuildLock | null) => void
  onPreview: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  // The headline numbers (ahead x/9, vs balanced) are already in the header; lead with what the build means for *this* roster.
  const lines = b.rationale.filter((r) => !r.startsWith('Exploratory'))
  const summary = lines.find((r) => /^(Abandons|Your roster already trails|You have little invested|Relative thin spots)/.test(r)) ?? lines[0]
  const rest = lines.filter((r) => r !== summary)
  return (
    <article className={cn('rounded-lg border bg-floor px-3.5 py-3', locked ? 'border-clock-line' : 'border-seam')}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-[18px] font-semibold leading-none tracking-tight">{b.build.label}</h3>
        <Tip content={`Viability vs. staying balanced${showConfidence ? ` · confidence ${b.confidence}` : ''}.`}>
          <span className="inline-flex">
            <Badge tone={VIABILITY_TONE[b.viability]}>{b.viability}</Badge>
          </span>
        </Tip>
        <Tip
          content={
            <div className="max-w-[300px]">
              Simulated end-of-draft standing if you draft toward this build (opponents take players in ADP order): categories ahead of a typical finished team, and
              category edges vs. staying balanced — a construction index, not a win probability.
            </div>
          }
        >
          <span className="ml-auto font-mono text-[12.5px] tnum text-chalk-2">
            ahead {b.catsAhead.length}/9 · {signed(b.vsBalanced, 2)} vs balanced
          </span>
        </Tip>
      </header>
      {summary ? <p className="mt-1.5 text-[13px] leading-snug text-chalk-2 text-pretty">{summary}</p> : null}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12.5px]">
        <span className="text-chalk-3">Targets now:</span>
        {b.sim.nextTargets.map((id) => (
          <button key={id} type="button" onClick={() => onPreview(id)} className="font-medium text-chalk hover:underline">
            {engine.byId.get(id)?.name}
          </button>
        ))}
        {!b.sim.nextTargets.length ? <span className="text-chalk-4">—</span> : null}
      </div>
      {open && rest.length ? (
        <ul className="mt-2 space-y-0.5 border-l-2 border-seam-strong pl-2.5">
          {rest.map((r, i) => (
            <li key={i} className="text-[12.5px] leading-snug text-chalk-3 text-pretty">
              {r}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2.5 flex items-center gap-1.5">
        {locked ? (
          <Button size="xs" variant="subtle" onClick={() => onLock(null)}>
            <Unlock size={11} /> Unlock
          </Button>
        ) : (
          <>
            <Button size="xs" variant="subtle" onClick={() => onLock({ punts: b.build.punts, mode: 'hard' })} title="Hard punt: the category is ignored for fit">
              <Lock size={11} /> {b.build.punts.length ? 'Hard punt' : 'Lock balanced'}
            </Button>
            {b.build.punts.length ? (
              <Button size="xs" variant="ghost" onClick={() => onLock({ punts: b.build.punts, mode: 'soft' })} title="Soft punt: the category is de-emphasised, not ignored">
                Soft punt
              </Button>
            ) : null}
          </>
        )}
        {rest.length ? (
          <Button size="xs" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Less' : 'Why?'}
          </Button>
        ) : null}
        {b.build.punts.length ? (
          <Tip content="Raw 9-cat value given up versus drafting the best player available.">
            <span className="ml-auto font-mono text-[12px] tnum text-chalk-3">cost {b.opportunityCost > 0 ? b.opportunityCost.toFixed(1) : '0.0'} z</span>
          </Tip>
        ) : null}
      </div>
    </article>
  )
}
