import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'
import { EspnError, fetchEspnSnapshot, fetchNbaSchedule, findLeagues, readEspnAuth, writeEspnAuth } from './espn.ts'

/**
 * Serves the private, git-ignored `.local-data/` folder (built by
 * `npm run data:ingest`) at `/local-data/` from the dev and preview servers
 * only. It is never copied into `dist/`, so a static build or deployment
 * cannot leak the user's local sports data.
 */
export const SESSION_FILE = 'session-latest.json'
const SESSION_BACKUPS = 'session-backups'
const SESSION_MAX_BYTES = 20 * 1024 * 1024
const SESSION_DAILY_KEEP = 14

/**
 * Write the app's session (same format as Settings → Export session, without
 * the dataset) to .local-data/session-latest.json, plus one dated copy per day
 * in .local-data/session-backups/ (newest 14 kept). The app restores from it
 * when the browser has no saved state (cleared site data, another browser).
 */
export function saveSession(root: string, body: string): { ok: boolean; error?: string } {
  let parsed: { app?: unknown; kind?: unknown; state?: unknown; exportedAt?: unknown }
  try {
    parsed = JSON.parse(body)
  } catch {
    return { ok: false, error: 'invalid JSON' }
  }
  if (parsed.app !== '9dub' || parsed.kind !== 'session' || !parsed.state || typeof parsed.state !== 'object') return { ok: false, error: 'not a 9dub session' }
  mkdirSync(join(root, SESSION_BACKUPS), { recursive: true })
  const target = join(root, SESSION_FILE)
  const tmp = `${target}.tmp`
  writeFileSync(tmp, body)
  renameSync(tmp, target)
  const day = new Date().toISOString().slice(0, 10)
  writeFileSync(join(root, SESSION_BACKUPS, `session-${day}.json`), body)
  const old = readdirSync(join(root, SESSION_BACKUPS))
    .filter((f) => /^session-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
  for (const f of old.slice(0, Math.max(0, old.length - SESSION_DAILY_KEEP))) unlinkSync(join(root, SESSION_BACKUPS, f))
  return { ok: true }
}

const json = (res: ServerResponse, body: unknown, status = 200) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage, max = 64 * 1024): Promise<string | null> {
  return new Promise((done) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size <= max) chunks.push(c)
    })
    req.on('end', () => done(size > max ? null : Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => done(null))
  })
}

/** Only this machine's own pages may drive the ESPN endpoints (no cross-site requests). */
function sameMachine(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)
  } catch {
    return false
  }
}

const ESPN_MIN_INTERVAL_MS = 30_000

/**
 * ESPN endpoints (dev/preview server only; cookies never leave this process):
 *   GET  __espn/status   → { enabled, configured, leagueId, season }
 *   GET  __espn/leagues  → { ok, leagues } — the account's fantasy basketball leagues this season
 *   GET  __espn/schedule → { ok, schedule } — the season's NBA games, as 9dub's schedule
 *   POST __espn/sync     → { ok, snapshot } — one read of the league, at most every 30 s ({ withDraft } adds the draft)
 *   POST __espn/auth     → save SWID / espn_s2 / league id
 */
async function espnRoute(root: string, enabled: boolean, req: IncomingMessage, res: ServerResponse, action: string, last: { at: number; body: unknown }) {
  if (!enabled) return json(res, action === 'status' ? { enabled: false, configured: false } : { ok: false, error: 'ESPN sync is off on this server' })
  if (!sameMachine(req)) return json(res, { ok: false, error: 'forbidden' }, 403)
  if (action === 'status' && req.method === 'GET') {
    const a = readEspnAuth(root)
    return json(res, { enabled: true, configured: !!(a.swid && a.espnS2), leagueId: a.leagueId, season: a.season })
  }
  if ((action === 'leagues' || action === 'schedule') && req.method === 'GET') {
    const q = new URL(req.url ?? '', 'http://localhost').searchParams
    const season = Number(q.get('season')) || new Date().getFullYear() + 1
    try {
      const a = readEspnAuth(root)
      if (!a.swid || !a.espnS2) throw new EspnError('ESPN cookies are not set')
      if (action === 'leagues') return json(res, { ok: true, leagues: await findLeagues(a, a.season ?? season), selected: a.leagueId })
      return json(res, { ok: true, schedule: await fetchNbaSchedule(root, a.season ?? season, q.get('label') ?? `${season - 1}-${String(season).slice(2)}`) })
    } catch (e) {
      return json(res, { ok: false, error: e instanceof EspnError ? e.message : `ESPN read failed: ${(e as Error).message}` })
    }
  }
  if (req.method !== 'POST') return json(res, { ok: false, error: 'method' }, 405)
  const raw = await readBody(req)
  let body: Record<string, unknown>
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  } catch {
    return json(res, { ok: false, error: 'invalid JSON' }, 400)
  }
  if (action === 'auth') {
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() || null : undefined)
    const patch: Parameters<typeof writeEspnAuth>[1] = {}
    if (str(body.swid) !== undefined) patch.swid = str(body.swid)!
    if (str(body.espnS2) !== undefined) patch.espnS2 = str(body.espnS2)!
    if (body.leagueId !== undefined) patch.leagueId = Number(body.leagueId) > 0 ? Number(body.leagueId) : null
    const a = writeEspnAuth(root, patch)
    last.at = 0 // new cookies or another league: the next sync reads ESPN again
    last.body = null
    return json(res, { ok: true, configured: !!(a.swid && a.espnS2), leagueId: a.leagueId })
  }
  if (action === 'sync') {
    const withDraft = body.withDraft === true
    if (!withDraft && Date.now() - last.at < ESPN_MIN_INTERVAL_MS && last.body) return json(res, last.body)
    try {
      const snapshot = await fetchEspnSnapshot(root, typeof body.season === 'number' ? body.season : new Date().getFullYear() + 1, { withDraft })
      last.at = Date.now()
      last.body = { ok: true, snapshot }
      return json(res, last.body)
    } catch (e) {
      return json(res, { ok: false, error: e instanceof EspnError ? e.message : `ESPN sync failed: ${(e as Error).message}` })
    }
  }
  return json(res, { ok: false, error: 'unknown' }, 404)
}

export function localDataPlugin(opts: { dir?: string; enabled?: boolean; sessionSave?: boolean; espn?: boolean } = {}): Plugin {
  const root = resolve(opts.dir ?? '.local-data')
  const enabled = opts.enabled ?? true
  const sessionSave = enabled && (opts.sessionSave ?? true)
  const espn = enabled && (opts.espn ?? true)
  const lastSync = { at: 0, body: null as unknown }
  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!enabled) return next()
    const url = (req.url ?? '').split('?')[0]
    const espnAt = url.indexOf('/local-data/__espn/')
    if (espnAt >= 0) {
      void espnRoute(root, espn, req, res, url.slice(espnAt + '/local-data/__espn/'.length), lastSync)
      return
    }
    if (url.endsWith('/local-data/__session') && req.method === 'POST') {
      if (!sessionSave) {
        // Not an error for the page (no console noise): it just learns that disk saving is off here.
        res.setHeader('Content-Type', 'application/json')
        return res.end('{"ok":false,"error":"session save disabled"}')
      }
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size <= SESSION_MAX_BYTES) chunks.push(c)
      })
      req.on('end', () => {
        const r = size > SESSION_MAX_BYTES ? { ok: false, error: 'too large' } : saveSession(root, Buffer.concat(chunks).toString('utf8'))
        res.statusCode = r.ok ? 200 : 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(r))
      })
      return
    }
    const base = '/local-data/'
    const at = url.indexOf(base)
    if (at < 0) return next()
    const rel = decodeURIComponent(url.slice(at + base.length))
    // Only top-level JSON files: no directories, no traversal, no audit/history browsing.
    if (!/^[\w.-]+\.json$/.test(rel)) return next()
    // With session saving off (tests, throwaway servers) the saved session is neither written nor read;
    // "no saved session" answers null rather than 404 so the page's console stays clean.
    if (rel === SESSION_FILE && (!sessionSave || !existsSync(resolve(root, rel)))) {
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('Cache-Control', 'no-store')
      return res.end('null')
    }
    const file = resolve(root, rel)
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404
      res.setHeader('Content-Type', 'application/json')
      res.end('{"datasets":[]}')
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(readFileSync(file))
  }
  return {
    name: '9dub-local-data',
    configureServer(server) {
      server.middlewares.use(handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler)
    },
  }
}
