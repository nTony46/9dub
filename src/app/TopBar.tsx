import { Keyboard, Moon, RefreshCw, Sun } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { IconButton } from '@/components/ui/Button'
import { Tip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/cn'
import { useApp } from '@/store/appStore'
import { useDraft } from '@/store/derived'
import { emit } from './events'
import { isLiveRoute, navigate, useRoute, type Route } from './router'

const NAV: { label: string; route: Route; match: (r: Route) => boolean; key: string }[] = [
  { label: 'Live Draft', route: 'draft', match: isLiveRoute, key: '1' },
  { label: 'Season', route: 'season', match: (r) => r === 'season', key: '4' },
  { label: 'NBA Players', route: 'players', match: (r) => r === 'players', key: '5' },
  { label: 'Settings & Data', route: 'settings', match: (r) => r === 'settings', key: '6' },
]

/** Shown only for the fictional demo pool; with real data the top bar stays quiet. */
export function DatasetChip() {
  const ds = useApp((s) => s.dataset)
  if (ds?.kind !== 'demo') return null
  return (
    <Tip side="bottom" content="Fictional demo players. Import real projections in Settings & Data.">
      <button type="button" onClick={() => navigate('settings', 'data')} className="flex h-7 items-center rounded-md px-1 hover:bg-stand">
        <Badge tone="warn">DEMO DATA</Badge>
      </button>
    </Tip>
  )
}

/** "now", "4m", "2h", "3d". */
function ago(ms: number): string {
  const m = Math.floor(ms / 60_000)
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}

/** One click re-reads the ESPN league (read-only) and brings rosters, IR, names and live scores up to date. */
export function EspnRefresh() {
  const state = useApp((s) => s.espnState)
  const syncing = useApp((s) => s.espnSyncing)
  const error = useApp((s) => s.espnError)
  const syncedAt = useApp((s) => s.season.espn?.syncedAt ?? null)
  const leagueName = useApp((s) => s.season.espn?.leagueName ?? null)
  const syncEspn = useApp((s) => s.syncEspn)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  if (state === 'off' || state === 'unknown') return null
  const run = async () => {
    if (state === 'setup') return navigate('settings', 'league')
    const r = await syncEspn()
    setNow(Date.now())
    if (!r.ok) toast.error(r.error ?? 'ESPN sync failed')
    else if (r.changes?.length) toast.success(`ESPN · ${r.changes.length} change${r.changes.length === 1 ? '' : 's'}`, { description: r.changes.slice(0, 5).join(' · ') + (r.changes.length > 5 ? ' …' : '') })
    else toast('ESPN · up to date')
  }
  const label = state === 'setup' ? 'Connect your ESPN league (Settings)' : syncing ? 'Syncing with ESPN…' : `Refresh from ESPN${leagueName ? ` · ${leagueName}` : ''}${syncedAt ? ` · synced ${ago(now - syncedAt)} ago` : ''}`
  return (
    <Tip side="bottom" content={error && !syncing ? <div className="max-w-[260px] text-bad">{error}</div> : label}>
      <button
        type="button"
        onClick={() => void run()}
        disabled={syncing}
        aria-label={label}
        data-testid="espn-refresh"
        className={cn(
          'flex h-7 items-center gap-1.5 rounded-md border px-2 text-[12px] tnum transition-colors hover:bg-stand hover:text-chalk',
          error && !syncing ? 'border-bad/40 text-bad' : 'border-seam text-chalk-3',
        )}
      >
        <RefreshCw size={13} className={cn(syncing && 'animate-spin')} />
        <span>{state === 'setup' ? 'ESPN' : syncedAt ? ago(now - syncedAt) : 'Sync'}</span>
      </button>
    </Tip>
  )
}

export function TopBar() {
  const { route } = useRoute()
  const theme = useApp((s) => s.prefs.theme)
  const setPrefs = useApp((s) => s.setPrefs)
  const draftDone = useDraft().complete
  // Once the draft is over the league views lead with the league, not the draft room.
  const home: Route = draftDone ? 'league' : 'draft'
  const nav = NAV.map((n) => (n.route === 'draft' && draftDone ? { ...n, label: 'My League', route: home } : n))
  return (
    <header className="flex h-12 shrink-0 items-center gap-5 border-b border-seam bg-arena px-4">
      <button type="button" onClick={() => navigate(home)} className="flex items-baseline gap-1.5" aria-label="9dub home">
        <span className="font-display text-[22px] font-bold leading-none tracking-tight">
          <span className="text-clock">9</span>dub
        </span>
      </button>
      <nav className="flex items-center gap-0.5" aria-label="Primary">
        {nav.map((n) => {
          const active = n.match(route)
          return (
            <button
              key={n.route}
              type="button"
              onClick={() => navigate(n.route)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative h-12 whitespace-nowrap px-3 text-[14px] font-medium transition-colors',
                active ? 'text-chalk' : 'text-chalk-3 hover:text-chalk-2',
              )}
            >
              {n.label}
              {active ? <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-clock" /> : null}
            </button>
          )
        })}
      </nav>
      <div className="ml-auto flex items-center gap-1.5">
        <DatasetChip />
        <EspnRefresh />
        <IconButton label="Keyboard shortcuts (?)" onClick={() => emit('open-help')}>
          <Keyboard size={15} />
        </IconButton>
        <IconButton label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setPrefs({ theme: theme === 'dark' ? 'light' : 'dark' })}>
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </IconButton>
      </div>
    </header>
  )
}
