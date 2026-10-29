import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { nbaScheduleFromEspn, snapshotFromEspn, type EspnSnapshot, type SnapshotOptions } from '../src/data/espn.ts'
import type { NbaSchedule } from '../src/data/schedule.ts'

/**
 * Read-only ESPN league sync, run by the local dev server only.
 *
 * Uses the user's own ESPN cookies (SWID + espn_s2) from
 * .local-data/espn/auth.json (git-ignored, owner-only permissions, never sent
 * to the page). Every request is a GET to ESPN's *read* API hosts; there is
 * no code path that writes to ESPN (no trades, adds, drops or lineup changes).
 */

export const ESPN_READ_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba'
export const ESPN_FAN_BASE = 'https://fan.api.espn.com/apis/v2/fans'
const DIR = 'espn'
const AUTH_FILE = 'auth.json'
const CACHE_DIR = 'cache'
const PRO_TTL_MS = 24 * 60 * 60 * 1000

export interface EspnAuth {
  swid: string | null
  espnS2: string | null
  leagueId: number | null
  /** ESPN season id (2027 = 2026–27). */
  season: number | null
}

export class EspnError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

function dir(root: string): string {
  const d = join(root, DIR)
  if (!existsSync(d)) mkdirSync(d, { recursive: true, mode: 0o700 })
  return d
}

export function readEspnAuth(root: string): EspnAuth {
  const file = join(root, DIR, AUTH_FILE)
  const empty: EspnAuth = { swid: null, espnS2: null, leagueId: null, season: null }
  if (!existsSync(file)) return empty
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as Partial<EspnAuth>
    return {
      swid: typeof j.swid === 'string' && j.swid.trim() ? j.swid.trim() : null,
      espnS2: typeof j.espnS2 === 'string' && j.espnS2.trim() ? j.espnS2.trim() : null,
      leagueId: typeof j.leagueId === 'number' ? j.leagueId : null,
      season: typeof j.season === 'number' ? j.season : null,
    }
  } catch {
    return empty
  }
}

/** Merge and save (owner-only file). Blank strings clear a field. */
export function writeEspnAuth(root: string, patch: Partial<EspnAuth>): EspnAuth {
  const next = { ...readEspnAuth(root), ...patch }
  if (next.swid != null && !next.swid.startsWith('{')) next.swid = `{${next.swid.replace(/[{}]/g, '')}}`
  const file = join(dir(root), AUTH_FILE)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 })
  renameSync(tmp, file)
  chmodSync(file, 0o600)
  return next
}

/** The only way this module talks to ESPN: a GET to a read-API URL. Anything else is refused before any network call. */
export async function espnRead(url: string, auth: EspnAuth, headers: Record<string, string> = {}): Promise<unknown> {
  if (!url.startsWith(`${ESPN_READ_BASE}/`) && !url.startsWith(`${ESPN_FAN_BASE}/`)) throw new EspnError('Refusing a request outside ESPN’s read-only API')
  if (!auth.swid || !auth.espnS2) throw new EspnError('ESPN cookies are not set')
  const res = await fetch(url, {
    method: 'GET',
    redirect: 'error',
    headers: { accept: 'application/json', cookie: `SWID=${auth.swid}; espn_s2=${auth.espnS2}`, ...headers },
  })
  if (res.status === 401 || res.status === 403) throw new EspnError('ESPN did not accept your cookies — they may have expired. Paste fresh SWID and espn_s2 values in Settings → ESPN.', res.status)
  if (res.status === 404) throw new EspnError('ESPN could not find that league for this season.', 404)
  if (!res.ok) throw new EspnError(`ESPN answered ${res.status}`, res.status)
  return res.json()
}

/** The user's fantasy basketball leagues for a season, from their ESPN profile. */
export async function findLeagues(auth: EspnAuth, season: number): Promise<{ id: number; name: string; teamName: string }[]> {
  const url = `${ESPN_FAN_BASE}/${encodeURIComponent(auth.swid ?? '')}?displayHiddenPrefs=true&context=fantasy&useCookieAuth=true&source=fantasyapp-ios`
  const j = (await espnRead(url, auth)) as { preferences?: { metaData?: { entry?: { abbrev?: string; seasonId?: number; entryMetadata?: { teamName?: string }; groups?: { groupId?: number; groupName?: string }[] } } }[] }
  const out: { id: number; name: string; teamName: string }[] = []
  for (const p of j.preferences ?? []) {
    const e = p.metaData?.entry
    if (e?.abbrev !== 'FBA' || e.seasonId !== season) continue
    for (const g of e.groups ?? []) if (g.groupId != null) out.push({ id: g.groupId, name: g.groupName ?? `League ${g.groupId}`, teamName: e.entryMetadata?.teamName ?? '' })
  }
  return out
}

async function proTeams(root: string, auth: EspnAuth, season: number): Promise<unknown> {
  const cache = join(dir(root), CACHE_DIR)
  mkdirSync(cache, { recursive: true })
  const file = join(cache, `pro-teams-${season}.json`)
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < PRO_TTL_MS) return JSON.parse(readFileSync(file, 'utf8'))
  const j = (await espnRead(`${ESPN_READ_BASE}/seasons/${season}?view=proTeamSchedules_wl`, auth)) as {
    settings?: { proTeams?: { id: number; abbrev: string; proGamesByScoringPeriod?: Record<string, { id: number; date: number; homeProTeamId: number; awayProTeamId: number }[]> }[] }
  }
  // Kept: team codes, and each game's start time (to tell which games had started when live totals were read).
  const teams = j.settings?.proTeams ?? []
  const games = new Map<number, { start: number; home: number; away: number }>()
  for (const t of teams) for (const list of Object.values(t.proGamesByScoringPeriod ?? {})) for (const g of list) games.set(g.id, { start: g.date, home: g.homeProTeamId, away: g.awayProTeamId })
  const slim = { settings: { proTeams: teams.map((t) => ({ id: t.id, abbrev: t.abbrev })) }, games: [...games.values()] }
  writeFileSync(file, JSON.stringify(slim), { mode: 0o600 })
  return slim
}

/** Names and pro teams of these ESPN players (drafted players since dropped), via the league's player list. */
async function playerNames(auth: EspnAuth, season: number, ids: number[]): Promise<Map<number, { name: string; proTeamId: number | null }>> {
  const out = new Map<number, { name: string; proTeamId: number | null }>()
  if (!ids.length) return out
  const filter = JSON.stringify({ players: { filterIds: { value: ids } } })
  const j = (await espnRead(`${ESPN_READ_BASE}/seasons/${season}/segments/0/leagues/${auth.leagueId}?view=kona_player_info`, auth, { 'x-fantasy-filter': filter })) as {
    players?: { id?: number; player?: { fullName?: string; proTeamId?: number } }[]
  }
  for (const p of j.players ?? []) if (p.id != null && p.player?.fullName) out.set(p.id, { name: p.player.fullName, proTeamId: p.player.proTeamId ?? null })
  return out
}

const FREE_AGENT_TTL_MS = 60 * 60 * 1000
/** How many free agents (by % rostered) to read stats for. */
const FREE_AGENT_LIMIT = 100

/**
 * The most-rostered free agents with their actual stats (this season, last 15 days, last season),
 * for stand-in lines when a player has no projection. Cached an hour; an error here never fails a sync.
 */
async function freeAgents(root: string, auth: EspnAuth, season: number): Promise<{ player?: unknown }[]> {
  const file = join(dir(root), CACHE_DIR, `free-agents-${auth.leagueId}-${season}.json`)
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < FREE_AGENT_TTL_MS) return JSON.parse(readFileSync(file, 'utf8'))
  const filter = JSON.stringify({
    players: {
      filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
      filterStatsForSourceIds: { value: [0] },
      filterStatsForSplitTypeIds: { value: [0, 2] },
      sortPercOwned: { sortPriority: 1, sortAsc: false },
      limit: FREE_AGENT_LIMIT,
    },
  })
  try {
    const j = (await espnRead(`${ESPN_READ_BASE}/seasons/${season}/segments/0/leagues/${auth.leagueId}?view=kona_player_info`, auth, { 'x-fantasy-filter': filter })) as {
      players?: { player?: { id?: number; fullName?: string; proTeamId?: number; eligibleSlots?: number[]; stats?: unknown } }[]
    }
    // Kept: identity, team, eligibility and stats.
    const slim = (j.players ?? []).map(({ player: p }) => ({ player: p && { id: p.id, fullName: p.fullName, proTeamId: p.proTeamId, eligibleSlots: p.eligibleSlots, stats: p.stats } }))
    mkdirSync(join(dir(root), CACHE_DIR), { recursive: true })
    writeFileSync(file, JSON.stringify(slim), { mode: 0o600 })
    return slim
  } catch {
    return []
  }
}

/** The season's NBA games from ESPN (cached a day), as 9dub's schedule. */
export async function fetchNbaSchedule(root: string, season: number, label: string): Promise<NbaSchedule> {
  const auth = readEspnAuth(root)
  if (!auth.swid || !auth.espnS2) throw new EspnError('ESPN cookies are not set')
  return nbaScheduleFromEspn(await proTeams(root, auth, season), label, new Date().toISOString())
}

/**
 * Read the league once (rosters, IR, team names, schedule, results) and convert it. Finds the league id on first use.
 * `withDraft` also returns the draft, looking up the names of drafted players no longer on a roster (first-time setup).
 */
export async function fetchEspnSnapshot(root: string, fallbackSeason: number, opts: { withDraft?: boolean } = {}): Promise<EspnSnapshot> {
  let auth = readEspnAuth(root)
  if (!auth.swid || !auth.espnS2) throw new EspnError('ESPN cookies are not set')
  const season = auth.season ?? fallbackSeason
  if (auth.leagueId == null) {
    const leagues = await findLeagues(auth, season)
    if (!leagues.length) throw new EspnError(`No ESPN fantasy basketball league found for ${season - 1}–${String(season).slice(2)} on this account.`)
    auth = writeEspnAuth(root, { leagueId: leagues[0].id, season })
  }
  // mLiveScoring adds each matchup side's live totals (cumulativeScoreLive); cumulativeScore alone lags by hours.
  const views = ['mTeam', 'mRoster', 'mSettings', 'mMatchup', 'mLiveScoring', 'mDraftDetail'].map((v) => `view=${v}`).join('&')
  const league = (await espnRead(`${ESPN_READ_BASE}/seasons/${season}/segments/0/leagues/${auth.leagueId}?${views}`, auth)) as {
    teams?: { roster?: { entries?: { playerId?: number }[] } }[]
    draftDetail?: { picks?: { playerId?: number }[] }
  }
  let players: Map<number, { name: string; proTeamId: number | null }> | undefined
  if (opts.withDraft) {
    const rostered = new Set((league.teams ?? []).flatMap((t) => (t.roster?.entries ?? []).map((e) => e.playerId)))
    const missing = [...new Set((league.draftDetail?.picks ?? []).map((p) => p.playerId).filter((id): id is number => id != null && id > 0 && !rostered.has(id)))]
    players = await playerNames(auth, season, missing)
  }
  const snap = snapshotFromEspn(league, await proTeams(root, auth, season), new Date().toISOString(), {
    swid: auth.swid,
    players,
    freeAgents: (await freeAgents(root, auth, season)) as SnapshotOptions['freeAgents'],
  })
  const cache = join(dir(root), CACHE_DIR)
  mkdirSync(cache, { recursive: true })
  writeFileSync(join(cache, 'latest.json'), JSON.stringify(snap), { mode: 0o600 })
  return snap
}
