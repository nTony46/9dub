import { useEffect, useRef, useState } from 'react'
import { Toaster } from 'sonner'
import { TooltipProvider } from '@/components/ui/Tooltip'
import { Modal } from '@/components/ui/Dialog'
import { Kbd } from '@/components/ui/Controls'
import { PlayerSheet } from '@/features/players/PlayerSheet'
import { DraftRoom } from '@/features/draft/DraftRoom'
import { LeagueOverview } from '@/features/league/LeagueOverview'
import { MyBuild } from '@/features/build/MyBuild'
import { PlayersPage } from '@/features/players/PlayersPage'
import { SeasonPage } from '@/features/season/SeasonPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { SetupPage } from '@/features/setup/SetupPage'
import { ESPN_STALE_MS, startAutosave, useApp } from '@/store/appStore'
import { useDraft } from '@/store/derived'
import { undoWithToast } from './actions'
import { emit, on } from './events'
import { leagueTabs, navigate, useRoute, type Route } from './router'
import { ErrorBoundary } from './ErrorBoundary'
import { DataBanner } from './DataBanner'
import { TopBar } from './TopBar'

const OTHER_KEYS: Record<string, Route> = { '4': 'season', '5': 'players', '6': 'settings' }

function keyRoutes(draftDone: boolean): Record<string, Route> {
  return { ...Object.fromEntries(leagueTabs(draftDone).map((t) => [t.key, t.route])), ...OTHER_KEYS }
}

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  if (!t) return false
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'
}

export function App() {
  const hydrated = useApp((s) => s.hydrated)
  const bootError = useApp((s) => s.bootError)
  const bootNotice = useApp((s) => s.bootNotice)
  const theme = useApp((s) => s.prefs.theme)
  const { route } = useRoute()
  const draftDone = useDraft().complete
  const espnState = useApp((s) => s.espnState)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    void useApp.getState().hydrate()
    return startAutosave()
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  useEffect(() => on('open-help', () => setHelp(true)), [])

  // Keep ESPN data fresh while the app is open: every 15 minutes, and on return to the tab when it's 10+ minutes old.
  useEffect(() => {
    const refresh = (minAge: number) => {
      const s = useApp.getState()
      if (s.espnState !== 'ready' || s.espnSyncing || document.visibilityState !== 'visible') return
      if (Date.now() - (s.season.espn?.syncedAt ?? 0) < minAge) return
      if (!s.season.espn) return // the first sync is started on load (or by the button)
      void s.syncEspn()
    }
    const timer = setInterval(() => refresh(ESPN_STALE_MS), 15 * 60_000)
    const onVisible = () => refresh(ESPN_STALE_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  // Opening the app with no page in the address lands on the league once the draft is over.
  const landed = useRef(false)
  useEffect(() => {
    if (!hydrated || landed.current) return
    landed.current = true
    if (draftDone && !window.location.hash.replace(/^#\/?/, '')) navigate('league')
  }, [hydrated, draftDone])

  // A fresh install with ESPN sync available starts on the setup page (once; skipping it counts).
  const offeredSetup = useRef(false)
  useEffect(() => {
    if (!hydrated || offeredSetup.current || espnState === 'unknown') return
    offeredSetup.current = true
    const s = useApp.getState()
    if (espnState !== 'off' && !s.prefs.setupDone && !s.draft.picks.length && !s.season.espn && !window.location.hash.replace(/^#\/?/, '')) navigate('setup')
  }, [hydrated, espnState])

  useEffect(() => {
    const keys = keyRoutes(draftDone)
    // Search lives in the draft room during the draft; afterwards, on the player list.
    const toSearch = () => {
      if (route !== 'draft' && route !== 'players') navigate(draftDone ? 'players' : 'draft')
      setTimeout(() => emit('focus-search'), 0)
    }
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toSearch()
        return
      }
      if (isTyping(e.target) || e.altKey) return
      if (document.querySelector('[role="dialog"]')) return
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault()
        undoWithToast()
        return
      }
      if (mod) return
      if (e.key === '/') {
        e.preventDefault()
        toSearch()
      } else if (keys[e.key]) {
        navigate(keys[e.key])
      } else if (e.key === 'u') {
        undoWithToast()
      } else if (e.key === '?') {
        setHelp(true)
      } else if (e.key === 'b' && route === 'draft') {
        emit('open-board')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [route, draftDone])

  return (
    <TooltipProvider delayDuration={350}>
      <div className="flex h-full min-w-0 flex-col">
        <TopBar />
        <DataBanner />
        {bootNotice ? (
          <div role="status" className="flex items-center gap-3 border-b border-clock-line bg-clock-soft px-4 py-2 text-[13px] text-chalk-2">
            {bootNotice}
            <button type="button" className="ml-auto text-[12.5px] text-chalk-3 hover:text-chalk" onClick={() => useApp.setState({ bootNotice: null })}>
              Dismiss
            </button>
          </div>
        ) : null}
        {bootError ? (
          <div role="alert" className="border-b border-bad/30 bg-bad/10 px-4 py-2 text-[12.5px] text-bad">
            {bootError}
          </div>
        ) : null}
        <main className="min-h-0 flex-1">
          <ErrorBoundary resetKey={route}>
          {!hydrated ? (
            <div className="flex h-full items-center justify-center text-[13px] text-chalk-3">Loading local data…</div>
          ) : route === 'draft' ? (
            <DraftRoom />
          ) : route === 'league' ? (
            <LeagueOverview />
          ) : route === 'build' ? (
            <MyBuild />
          ) : route === 'season' ? (
            <SeasonPage />
          ) : route === 'players' ? (
            <PlayersPage />
          ) : route === 'setup' ? (
            <SetupPage />
          ) : (
            <SettingsPage />
          )}
          </ErrorBoundary>
        </main>
      </div>
      {hydrated ? (
        <ErrorBoundary>
          <PlayerSheet />
        </ErrorBoundary>
      ) : null}
      <Toaster
        theme={theme}
        position="bottom-center"
        toastOptions={{
          style: { background: 'var(--booth)', color: 'var(--chalk)', border: '1px solid var(--seam-strong)', fontSize: 12.5 },
        }}
      />
      <Modal open={help} onOpenChange={setHelp} title="Keyboard shortcuts" description="Shortcuts are ignored while you type in a field, except where noted.">
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 p-5 text-[12.5px]">
          {[
            [['/'], 'Focus player search'],
            [['⌘', 'K'], 'Focus search (works anywhere)'],
            [['↑', '↓'], 'Move through search results'],
            [['Enter'], 'Draft highlighted player for the team on the clock'],
            [['⇧', 'Enter'], 'Preview highlighted player'],
            [['Esc'], 'Clear search / close panel'],
            [['u'], 'Undo last draft change'],
            [['⌘', 'Z'], 'Undo last draft change'],
            [['b'], `Open full draft board (${draftDone ? 'Draft Recap' : 'Draft Room'})`],
            ...leagueTabs(draftDone).map((t) => [[t.key], t.label]),
            [['4'], 'Season (matchups & rosters)'],
            [['5'], 'NBA Players'],
            [['6'], 'Settings & Data'],
            [['?'], 'This help'],
          ].map(([keys, label]) => (
            <div key={`${label}-${(keys as string[]).join('+')}`} className="flex items-center justify-between gap-3 border-b border-seam py-1.5">
              <span className="text-chalk-2">{label as string}</span>
              <span className="flex gap-1">
                {(keys as string[]).map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </Modal>
    </TooltipProvider>
  )
}
