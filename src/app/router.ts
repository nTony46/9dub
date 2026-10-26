import { useSyncExternalStore } from 'react'

export type Route = 'draft' | 'league' | 'build' | 'season' | 'players' | 'settings' | 'setup'
export const ROUTES: Route[] = ['draft', 'league', 'build', 'season', 'players', 'settings', 'setup']

function parse(): { route: Route; sub: string | null } {
  const [r, sub] = window.location.hash.replace(/^#\/?/, '').split('/')
  return { route: (ROUTES as string[]).includes(r) ? (r as Route) : 'draft', sub: sub || null }
}

let current = parse()
const listeners = new Set<() => void>()
window.addEventListener('hashchange', () => {
  current = parse()
  listeners.forEach((l) => l())
})

export function navigate(route: Route, sub?: string | null): void {
  const h = `#/${route}${sub ? `/${sub}` : ''}`
  if (window.location.hash !== h) window.location.hash = h
}

export function useRoute(): { route: Route; sub: string | null } {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current,
  )
}

export function isLiveRoute(r: Route): boolean {
  return r === 'draft' || r === 'league' || r === 'build'
}

export interface LeagueTab {
  route: Route
  label: string
  key: string
}

/** The league views and their number keys: the draft room leads during the draft, the league and your team after it. */
export function leagueTabs(draftComplete: boolean): LeagueTab[] {
  return draftComplete
    ? [
        { route: 'league', label: 'League Overview', key: '1' },
        { route: 'build', label: 'My Team', key: '2' },
        { route: 'draft', label: 'Draft Recap', key: '3' },
      ]
    : [
        { route: 'draft', label: 'Draft Room', key: '1' },
        { route: 'league', label: 'League Overview', key: '2' },
        { route: 'build', label: 'My Build', key: '3' },
      ]
}
