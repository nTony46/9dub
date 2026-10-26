import type { DaySlate } from './matchup'
import { POSITIONS, type Position } from './positions'

/**
 * Streaming help: which NBA teams play on the nights you have empty starting
 * seats. Team-level on purpose — the manager picks the player for the
 * categories they are chasing. Only days on or after `from` count.
 */

export interface TeamFitDay {
  date: string
  /** null = any position fits; otherwise only these positions add a start that day. */
  positions: Position[] | null
}

export interface TeamFit {
  team: string
  /** This team's games that land on a night with an open seat. */
  days: TeamFitDay[]
  /** Consecutive open nights this team covers (back-to-backs). */
  b2b: [string, string][]
  /** All of the team's games in the window (open seat or not). */
  teamGames: number
}

export interface BackToBack {
  first: string
  second: string
  open: [number, number]
  /** Teams that play both nights. */
  teams: string[]
}

type TeamsOn = (date: string) => ReadonlySet<string> | undefined

const nextDay = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

export function streamingTeams(days: readonly DaySlate[], teamsOn: TeamsOn, from: string): TeamFit[] {
  const window = days.filter((d) => d.date >= from)
  const teams = new Set<string>()
  window.forEach((d) => teamsOn(d.date)?.forEach((t) => teams.add(t)))
  const out: TeamFit[] = []
  for (const team of teams) {
    const games = window.filter((d) => teamsOn(d.date)?.has(team))
    const usable = games.filter((d) => d.open > 0)
    if (!usable.length) continue
    const b2b: [string, string][] = []
    for (let i = 1; i < usable.length; i++) if (nextDay(usable[i - 1].date) === usable[i].date) b2b.push([usable[i - 1].date, usable[i].date])
    out.push({
      team,
      days: usable.map((d) => ({ date: d.date, positions: d.fits.length === POSITIONS.length ? null : d.fits })),
      b2b,
      teamGames: games.length,
    })
  }
  return out.sort((a, b) => b.days.length - a.days.length || b.b2b.length - a.b2b.length || b.teamGames - a.teamGames || a.team.localeCompare(b.team))
}

/** Consecutive nights where you have open seats both nights, with the teams playing both. */
export function backToBackWindows(days: readonly DaySlate[], teamsOn: TeamsOn, from: string): BackToBack[] {
  const window = days.filter((d) => d.date >= from)
  const out: BackToBack[] = []
  for (let i = 1; i < window.length; i++) {
    const a = window[i - 1]
    const b = window[i]
    if (nextDay(a.date) !== b.date || a.open <= 0 || b.open <= 0) continue
    const second = teamsOn(b.date)
    const teams = [...(teamsOn(a.date) ?? [])].filter((t) => second?.has(t)).sort()
    out.push({ first: a.date, second: b.date, open: [a.open, b.open], teams })
  }
  return out
}
