import { AlertTriangle, CalendarDays, Undo2 } from 'lucide-react'
import { useMemo } from 'react'
import { toast } from 'sonner'
import { formatPick } from '@/analytics/draftOrder'
import { undoWithToast } from '@/app/actions'
import { leagueTabs, navigate, useRoute } from '@/app/router'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Kbd } from '@/components/ui/Controls'
import { Tip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { useApp } from '@/store/appStore'
import { teamLabel, useDraft, useEngine } from '@/store/derived'
import { currentWeek, todayIso } from '@/store/season'
import { rangeText } from '@/features/season/model'

/** League sub-navigation plus the "on the clock" scoreboard — or, once the draft is over, where the season stands. */
export function LiveBar() {
  const { route } = useRoute()
  const d = useDraft()
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const canUndo = useApp((s) => s.undoStack.length > 0)
  const engine = useEngine()
  const orphaned = engine ? [...d.draftedBy.keys()].filter((id) => !engine.byId.has(id)).length : 0
  const mineOnClock = d.isUserOnClock
  const postDraft = d.complete
  // After the draft the pick controls only matter on the recap, where picks can still be corrected.
  const draftControls = !postDraft || route === 'draft'

  return (
    <div className="flex h-11 shrink-0 items-center gap-4 border-b border-seam bg-floor px-4">
      <div role="tablist" aria-label={postDraft ? 'League views' : 'Live draft views'} className="flex items-center gap-0.5">
        {leagueTabs(postDraft).map((t) => (
          <button
            key={t.route}
            role="tab"
            type="button"
            aria-selected={route === t.route}
            onClick={() => navigate(t.route)}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium transition-colors',
              route === t.route ? 'bg-stand text-chalk shadow-[0_0_0_1px_var(--seam-strong)]' : 'text-chalk-3 hover:text-chalk',
            )}
          >
            {t.label}
            <Kbd className="hidden xl:inline-flex">{t.key}</Kbd>
          </button>
        ))}
      </div>

      <div className="h-5 w-px bg-seam" />

      {/* The clock */}
      <div className="flex min-w-0 items-center gap-3" aria-live="polite">
        {postDraft ? (
          <span className="font-display text-[14px] font-semibold tracking-wide text-chalk-3">Draft complete</span>
        ) : (
          <>
            <span className="label-caps">On the clock</span>
            <span
              data-testid="on-clock"
              className={cn(
                'flex h-7 items-center gap-2 rounded-md px-2.5 font-display text-[16px] font-semibold tracking-wide',
                mineOnClock ? 'bg-clock text-clock-ink' : 'bg-stand text-chalk',
              )}
            >
              <span className="font-mono text-[12px] font-semibold tnum opacity-80">{formatPick(d.currentPick!, settings.teams)}</span>
              <span className="truncate">{mineOnClock ? 'YOU' : teamLabel(settings, d.onClockTeam!)}</span>
              <span className="font-mono text-[11px] font-medium tnum opacity-70">#{d.currentPick}</span>
            </span>
            {d.userTeam == null ? null : d.nextUserPick == null ? (
              <span className="text-[12px] text-chalk-3">No picks left for you</span>
            ) : mineOnClock ? (
              d.followingUserPick ? (
                <span className="text-[12px] text-chalk-3">
                  then <span className="font-mono tnum text-chalk-2">#{d.followingUserPick}</span>
                </span>
              ) : null
            ) : (
              <span className="text-[12px] text-chalk-3">
                Your pick <span className="font-mono tnum text-chalk">#{d.nextUserPick}</span> ·{' '}
                <span className="font-semibold text-clock">in {d.picksUntilUser}</span>
              </span>
            )}
          </>
        )}
        {d.isPartial ? (
          <Tip content={`Picks ${d.gaps.slice(0, 8).join(', ')}${d.gaps.length > 8 ? '…' : ''} are unrecorded. Players likely taken in them are flagged "possibly taken"; recommendations are less certain.`}>
            <Badge tone="warn">
              <AlertTriangle size={11} /> Partial log · {d.gaps.length} unrecorded
            </Badge>
          </Tip>
        ) : null}
        {orphaned ? (
          <Tip content="These recorded picks reference players that are not in the active dataset (e.g. after a Replace import). They still occupy their pick slots; edit them or re-activate the earlier snapshot.">
            <Badge tone="bad">
              <AlertTriangle size={11} /> {orphaned} pick{orphaned === 1 ? '' : 's'} not in dataset
            </Badge>
          </Tip>
        ) : null}
      </div>

      {draftControls ? (
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[12px] text-chalk-3">
            Your slot
            <select
              aria-label="Your draft slot"
              value={settings.userSlot ?? ''}
              onChange={(e) => {
                const v = e.target.value ? Number(e.target.value) : null
                const r = setSettings({ userSlot: v })
                if (!r.ok) toast.error(r.error)
                else if (d.draftedBy.size) toast(`Slot set to ${v ?? '—'}. Recorded picks keep their teams.`)
              }}
              className={cn(
                'h-7 rounded-md border bg-well px-1.5 font-mono text-[12px] tnum text-chalk',
                settings.userSlot == null ? 'border-clock-line' : 'border-seam',
              )}
            >
              <option value="">—</option>
              {Array.from({ length: settings.teams }, (_, i) => (
                <option key={i} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <span className="font-mono text-[11.5px] tnum text-chalk-3" title="Picks recorded / total">
            {d.draftedBy.size}/{d.totalPicks}
          </span>
          <Button size="sm" variant="subtle" disabled={!canUndo} onClick={undoWithToast} title="Undo last change (u or ⌘Z)">
            <Undo2 size={13} /> Undo
          </Button>
        </div>
      ) : (
        <ThisWeek />
      )}
    </div>
  )
}

/** The matchup in progress (or next), one click from its projection. */
function ThisWeek() {
  const weeks = useApp((s) => s.season.matchups)
  const settings = useApp((s) => s.settings)
  const sorted = useMemo(() => [...weeks].sort((a, b) => a.start.localeCompare(b.start)), [weeks])
  const week = currentWeek(sorted, todayIso())
  if (!week) {
    return (
      <Button className="ml-auto" size="sm" variant="subtle" onClick={() => navigate('season')}>
        <CalendarDays size={13} /> Set up matchups
      </Button>
    )
  }
  const n = sorted.indexOf(week) + 1
  const opp = week.opponent != null ? teamLabel(settings, week.opponent) : week.label || 'opponent not set'
  return (
    <button
      type="button"
      onClick={() => navigate('season', week.id)}
      className="ml-auto flex h-7 min-w-0 items-center gap-2 rounded-md border border-seam px-2.5 text-[12.5px] text-chalk-2 hover:bg-stand hover:text-chalk"
      title="Open this matchup's projection"
    >
      <CalendarDays size={13} className="shrink-0 text-chalk-3" />
      <span className="font-medium text-chalk">Week {n}</span>
      <span className="truncate">vs {opp}</span>
      <span className="shrink-0 text-[12px] tnum text-chalk-3">{rangeText(week.start, week.end)}</span>
    </button>
  )
}
