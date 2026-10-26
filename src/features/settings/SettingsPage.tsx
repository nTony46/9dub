import { Download, RotateCcw, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { DatasetSnapshotSchema } from '@/data/schema'
import { toast } from 'sonner'
import { CATEGORIES, CATEGORY_META } from '@/analytics/categories'
import { picksForSlot } from '@/analytics/draftOrder'
import { navigate, useRoute } from '@/app/router'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Segmented, Select, Switch } from '@/components/ui/Controls'
import { Panel } from '@/components/ui/Panel'
import { cn } from '@/lib/cn'
import { dateShort, num, pct, relTime, signed } from '@/lib/format'
import { useApp, type EspnLeague } from '@/store/appStore'
import { useDraft, useEngine, useLive } from '@/store/derived'
import { reportActivation } from '@/app/DataBanner'
import { download, stamp } from './files'
import { ImportWizard } from './ImportWizard'

const TABS = [
  { id: 'league', label: 'League' },
  { id: 'valuation', label: 'Valuation' },
  { id: 'data', label: 'Data & imports' },
  { id: 'session', label: 'Session & backups' },
  { id: 'diagnostics', label: 'Diagnostics' },
] as const
type Tab = (typeof TABS)[number]['id']

export function SettingsPage() {
  const { sub } = useRoute()
  const tab: Tab = (TABS.find((t) => t.id === sub)?.id ?? 'league') as Tab
  return (
    <div className="grid h-full grid-cols-[200px_minmax(0,1fr)]">
      <nav className="border-r border-seam bg-arena p-3" aria-label="Settings sections">
        <h1 className="mb-3 px-2 font-display text-[20px] font-semibold tracking-tight">Settings & Data</h1>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => navigate('settings', t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={cn('mb-0.5 flex w-full rounded-md px-2 py-1.5 text-left text-[13px]', tab === t.id ? 'bg-stand font-medium text-chalk' : 'text-chalk-3 hover:text-chalk')}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 overflow-y-auto">
        <div className="mx-auto max-w-[980px] space-y-4 px-6 py-5">
          {tab === 'league' ? <LeagueSettings /> : tab === 'valuation' ? <ValuationSettings /> : tab === 'data' ? <DataSettings /> : tab === 'session' ? <SessionSettings /> : <Diagnostics />}
        </div>
      </div>
    </div>
  )
}

/** Read-only ESPN league sync: cookies are sent to the local server once and never shown again. */
function EspnPanel() {
  const state = useApp((s) => s.espnState)
  const syncing = useApp((s) => s.espnSyncing)
  const error = useApp((s) => s.espnError)
  const espn = useApp((s) => s.season.espn)
  const saveEspnAuth = useApp((s) => s.saveEspnAuth)
  const syncEspn = useApp((s) => s.syncEspn)
  const listEspnLeagues = useApp((s) => s.listEspnLeagues)
  const picks = useApp((s) => s.draft.picks.length)
  const [swid, setSwid] = useState('')
  const [s2, setS2] = useState('')
  const [league, setLeague] = useState('')
  const [leagues, setLeagues] = useState<{ list: EspnLeague[]; selected: number | null } | null>(null)
  useEffect(() => {
    if (state !== 'ready') return
    let live = true
    void listEspnLeagues().then((r) => live && r.ok && setLeagues({ list: r.leagues ?? [], selected: r.selected ?? null }))
    return () => {
      live = false
    }
  }, [state, listEspnLeagues])
  if (state === 'off' || state === 'unknown') return null
  const chooseLeague = async (id: number) => {
    const r = await saveEspnAuth({ leagueId: id })
    if (!r.ok) return toast.error(r.error)
    setLeagues((l) => (l ? { ...l, selected: id } : l))
  }
  const save = async () => {
    const patch: Parameters<typeof saveEspnAuth>[0] = {}
    if (swid.trim()) patch.swid = swid.trim()
    if (s2.trim()) patch.espnS2 = s2.trim()
    if (league.trim()) patch.leagueId = Number(league.replace(/\D/g, '')) || null
    const r = await saveEspnAuth(patch)
    if (!r.ok) return toast.error(r.error)
    setSwid('')
    setS2('')
    setLeague('')
    toast.success('Saved')
  }
  const sync = async () => {
    const r = await syncEspn()
    if (!r.ok) toast.error(r.error)
    else toast.success(r.changes?.length ? `${r.changes.length} change${r.changes.length === 1 ? '' : 's'}` : 'Up to date')
  }
  return (
    <Panel
      title="ESPN league"
      actions={
        state === 'ready' ? (
          <Button size="xs" variant="subtle" disabled={syncing} onClick={() => void sync()}>
            {syncing ? 'Syncing…' : 'Sync now'}
          </Button>
        ) : null
      }
    >
      {espn ? (
        <div className="mb-3 text-[13px] text-chalk-2" data-testid="espn-status">
          <span className="font-medium text-chalk">{espn.leagueName}</span> · synced {relTime(espn.syncedAt)}
          {espn.changes.length ? (
            <ul className="mt-1.5 space-y-0.5 text-[12.5px] text-chalk-3">
              {espn.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : null}
          {espn.unmatched.length ? <div className="mt-1.5 text-[12.5px] text-warn">Not in 9dub&apos;s player list: {espn.unmatched.join(', ')}</div> : null}
        </div>
      ) : null}
      {error ? <div className="mb-3 text-[12.5px] text-bad">{error}</div> : null}
      {leagues && leagues.list.length > 1 ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-chalk-2">
          League
          <Select
            value={leagues.selected ?? ''}
            disabled={picks > 0}
            onChange={(e) => void chooseLeague(Number(e.target.value))}
            className="h-8 w-[320px] text-[13px]"
            aria-label="ESPN league"
            data-testid="espn-league-picker"
          >
            {leagues.selected == null ? <option value="">Choose a league…</option> : null}
            {leagues.list.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.teamName ? ` · ${l.teamName}` : ''}
              </option>
            ))}
          </Select>
          {picks > 0 ? <span className="text-[12px] text-chalk-3">To switch leagues, start a new draft first (Session &amp; backups).</span> : null}
        </div>
      ) : null}
      {!picks ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px] text-chalk-2">
          No draft recorded yet.
          <Button size="xs" variant="subtle" onClick={() => navigate('setup')}>
            Set up from ESPN
          </Button>
        </div>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-[1fr_2fr_1fr_auto] lg:items-end">
        <Field label="SWID">
          <Input type="password" autoComplete="off" value={swid} onChange={(e) => setSwid(e.target.value)} placeholder={state === 'ready' ? 'saved' : '{…}'} className="h-8" />
        </Field>
        <Field label="espn_s2">
          <Input type="password" autoComplete="off" value={s2} onChange={(e) => setS2(e.target.value)} placeholder={state === 'ready' ? 'saved' : ''} className="h-8" />
        </Field>
        <Field label="League ID">
          <Input inputMode="numeric" value={league} onChange={(e) => setLeague(e.target.value)} placeholder={espn ? String(espn.leagueId) : 'found automatically'} className="h-8" />
        </Field>
        <Button size="sm" onClick={() => void save()} disabled={!swid.trim() && !s2.trim() && !league.trim()}>
          Save
        </Button>
      </div>
    </Panel>
  )
}

function LeagueSettings() {
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const d = useDraft()
  const apply = (patch: Parameters<typeof setSettings>[0]) => {
    const r = setSettings(patch)
    if (!r.ok) toast.error(r.error)
  }
  const locked = d.draftedBy.size > 0
  return (
    <>
      <EspnPanel />
      <Panel title="League">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Field label="League name">
            <Input value={settings.leagueName} onChange={(e) => apply({ leagueName: e.target.value })} />
          </Field>
          <Field label="Teams" hint={locked ? 'Locked while picks are recorded.' : '8–16 supported.'}>
            <Select value={settings.teams} disabled={locked} onChange={(e) => apply({ teams: Number(e.target.value) })} aria-label="Number of teams">
              {Array.from({ length: 9 }, (_, i) => i + 8).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Rounds (roster size)" hint={`${settings.teams * settings.rounds} total picks`}>
            <Input type="number" min={1} max={30} value={settings.rounds} onChange={(e) => e.target.value && apply({ rounds: Number(e.target.value) })} />
          </Field>
          <Field label="IR slots">
            <Input type="number" min={0} max={5} value={settings.irSlots} onChange={(e) => e.target.value !== '' && apply({ irSlots: Number(e.target.value) })} aria-label="IR slots" />
          </Field>
          <Field label="Format">
            <div className="flex h-8 items-center text-[12.5px] text-chalk-2">FG% FT% 3PM PTS REB AST STL BLK TO</div>
          </Field>
          <Field label="Lineup" hint="From ESPN at each sync (ESPN's standard lineup until then).">
            <div className="flex min-h-8 flex-wrap items-center gap-1 font-mono text-[12px] text-chalk-2" data-testid="lineup-slots">
              {settings.lineupSlots.map((l, i) => (
                <span key={i} className={cn('rounded border px-1.5 py-0.5', l === 'BE' ? 'border-seam text-chalk-3' : 'border-seam-strong')}>
                  {l}
                </span>
              ))}
            </div>
          </Field>
        </div>
      </Panel>
      <Panel title="Your draft slot">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Draft slot">
          <button
            type="button"
            role="radio"
            aria-checked={settings.userSlot == null}
            onClick={() => apply({ userSlot: null })}
            className={cn('h-9 rounded-md border px-3 text-[12.5px]', settings.userSlot == null ? 'border-clock-line bg-clock-soft text-clock' : 'border-seam text-chalk-3 hover:bg-stand')}
          >
            Not known yet
          </button>
          {Array.from({ length: settings.teams }, (_, i) => i + 1).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={settings.userSlot === s}
              onClick={() => apply({ userSlot: s })}
              className={cn('h-9 w-10 rounded-md border font-mono text-[13px] tnum', settings.userSlot === s ? 'border-clock bg-clock text-clock-ink' : 'border-seam hover:bg-stand')}
            >
              {s}
            </button>
          ))}
        </div>
        {settings.userSlot != null ? (
          <p className="mt-2 font-mono text-[12px] tnum text-chalk-3" data-testid="my-picks">
            Your picks: {picksForSlot(settings.userSlot, settings.teams, settings.rounds).join(', ')}
          </p>
        ) : null}
      </Panel>
      <Panel title="Team names">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Array.from({ length: settings.teams }, (_, i) => (
            <label key={i} className="flex items-center gap-2 text-[12px]">
              <span className={cn('w-5 text-right font-mono tnum', settings.userSlot === i + 1 ? 'text-clock' : 'text-chalk-4')}>{i + 1}</span>
              <Input
                value={settings.teamNames[i] ?? ''}
                placeholder={`Team ${i + 1}`}
                onChange={(e) => {
                  const names = [...settings.teamNames]
                  names[i] = e.target.value
                  apply({ teamNames: names })
                }}
                className="h-7"
              />
            </label>
          ))}
        </div>
      </Panel>
      <Panel title="Draft-room behaviour">
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-4 text-[12.5px]">
            <span>
              Enforce roster size
              <span className="block text-[11.5px] text-chalk-3">Off by default: 9dub warns about roster/position balance but lets you record any pick.</span>
            </span>
            <Switch checked={settings.enforceRoster} onChange={(v) => apply({ enforceRoster: v })} label="Enforce roster size" />
          </label>
          <label className="flex items-center justify-between gap-4 text-[12.5px]">
            <span>
              Confirm before Enter-to-draft
              <span className="block text-[11.5px] text-chalk-3">Undo is always one keystroke away, so this is off by default.</span>
            </span>
            <Switch checked={settings.confirmOnEnter} onChange={(v) => apply({ confirmOnEnter: v })} label="Confirm on Enter" />
          </label>
        </div>
      </Panel>
    </>
  )
}

function ValuationSettings() {
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const apply = (patch: Parameters<typeof setSettings>[0]) => {
    const r = setSettings(patch)
    if (!r.ok) toast.error(r.error)
  }
  return (
    <>
      <Panel title="Valuation basis">
        <Segmented
          label="Valuation basis"
          value={settings.valuationBasis}
          onChange={(v) => apply({ valuationBasis: v })}
          options={[
            { value: 'perGame', label: 'Per game (healthy value)' },
            { value: 'gpAware', label: 'GP-aware (availability-adjusted)' },
          ]}
        />
        <p className="mt-2 text-[12px] leading-relaxed text-chalk-3 text-pretty">
          Per game ranks players by what they produce when they play — a sensible default for an active H2H manager. GP-aware blends each player's per-game value
          with replacement level for the games he is projected to miss (a = GP ÷ {settings.fullSeasonGames}). Both rankings are always shown; this choice drives
          recommendations and team totals. Units never mix: everything is per game.
        </p>
      </Panel>
      <ProjectionProfilePanel />
      <Panel title="Reference pool & replacement">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Reference pool size" hint="Top-N players (iteratively) used for means/SDs and shooting baselines. Frozen per dataset.">
            <Input type="number" min={60} max={400} value={settings.poolSize} onChange={(e) => e.target.value && apply({ poolSize: Number(e.target.value) })} />
          </Field>
          <Field label="Full-season games" hint="Denominator for GP-aware availability.">
            <Input type="number" min={60} max={82} value={settings.fullSeasonGames} onChange={(e) => e.target.value && apply({ fullSeasonGames: Number(e.target.value) })} />
          </Field>
          <Field label={`Soft-punt weight · ${settings.softPuntWeight.toFixed(2)}`} hint="Weight kept for a softly punted category (hard punt = 0).">
            <input type="range" min={0.05} max={0.8} step={0.05} value={settings.softPuntWeight} onChange={(e) => apply({ softPuntWeight: Number(e.target.value) })} className="h-8 accent-[var(--clock)]" />
          </Field>
        </div>
      </Panel>
    </>
  )
}

function ProjectionProfilePanel() {
  const dataset = useApp((s) => s.dataset)
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const engine = useEngine()
  if (!dataset) return null
  const profiles = dataset.profiles ?? []
  const incomplete = engine ? engine.players.filter((p) => p.valued && !p.complete).length : 0
  const estimated = engine ? engine.players.filter((p) => p.volume?.fg === 'estimated' || p.volume?.ft === 'estimated').length : 0
  const crossSource = engine ? engine.players.filter((p) => p.volume?.fg === 'cross-source').length : 0
  return (
    <Panel title="Projection source">
      {profiles.length ? (
        <>
          <Segmented
            label="Projection profile"
            value={settings.projectionProfile}
            onChange={(v) => setSettings({ projectionProfile: v })}
            options={[
              { value: 'default', label: `${profiles[0]?.label ?? 'Default'} (default)` },
              ...profiles.slice(1).map((p) => ({ value: p.id, label: p.label })),
            ]}
          />
          <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-chalk-3">
            {profiles.map((p) => (
              <li key={p.id}>
                <span className="text-chalk-2">{p.label}:</span> {p.description}
              </li>
            ))}
          </ul>
          {settings.projectionProfile !== 'default' && crossSource ? (
            <p className="mt-2 text-[12px] text-warn">
              {crossSource} players use attempts from another source with this profile's FG%/FT% (cross-source volume proxy, marked “x-src”).
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-[12px] text-chalk-3">This dataset carries a single projection per player.</p>
      )}
      <div className="mt-3 flex items-start gap-3 border-t border-seam pt-3">
        <Switch checked={settings.estimateMissingVolume} onChange={(v) => setSettings({ estimateMissingVolume: v })} label="Estimate missing shooting volume" />
        <div className="text-[12px] leading-relaxed text-chalk-3 text-pretty">
          <div className="text-chalk-2">Estimate missing FGA/FTA (off by default)</div>
          For lines with FG%/FT% but no attempts, estimate attempts from PTS = 2·FGM + 3PM + FTM with a typical FTA/FGA ratio for the player's position
          group (measured on the Fantasy Edge pool, where this reproduces FGA within ~5%; FTA is rougher). Estimated values are marked “est.” and are never
          described as projections.{' '}
          {settings.estimateMissingVolume ? `${estimated} players currently use an estimate.` : `${incomplete} players are currently incomplete and kept out of recommendations.`}
        </div>
      </div>
    </Panel>
  )
}

/** Counts that say how much of the active dataset is truly usable for 9-cat valuation. */
function DataCoverage() {
  const engine = useEngine()
  if (!engine) return null
  const ps = engine.players
  const count = (f: (p: (typeof ps)[number]) => boolean) => ps.filter(f).length
  const valued = count((p) => p.valued)
  const complete = count((p) => p.complete)
  const live = count((p) => p.adpSource === 'ESPN live')
  const fb = count((p) => p.adpSource === 'ESPN via FantasyPros')
  const capped = count((p) => !!p.adpNote)
  const gp = count((p) => p.valued && p.gp != null)
  const ecr = count((p) => !!p.rec.rankings?.fantasyProsEcr)
  const draftable = engine.valuation.settings.teams * engine.valuation.settings.rounds
  const topEcr = ps.filter((p) => p.rec.rankings?.fantasyProsEcr && p.rec.rankings.fantasyProsEcr.rank <= draftable)
  const cells: [string, number | string, string?][] = [
    ['Players in directory', ps.length],
    ['Valued (have a projection)', valued, `${ps.length - valued} directory-only: searchable and draftable, not valued`],
    ['Complete 9-cat lines', complete, `${valued - complete} incomplete (no FG/FT attempts) — ranked after complete players, not recommended`],
    ['ESPN Live ADP (usable)', live, `${capped} at ESPN's ~140 ceiling · ${fb} FantasyPros fallback`],
    ['Projected GP', gp, 'unknown GP is never treated as 0 or 82'],
    ['Expert consensus rank', ecr],
  ]
  if (topEcr.length) cells.push([`Complete in ECR top ${draftable}`, `${topEcr.filter((p) => p.complete).length}/${topEcr.length}`, 'how many draftable-range players are fully projected'])
  return (
    <Panel title="Data coverage">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 md:grid-cols-3" data-testid="data-coverage">
        {cells.map(([k, v, hint]) => (
          <div key={k}>
            <div className="text-[11px] text-chalk-3">{k}</div>
            <div className="font-mono text-[15px] font-semibold tnum">{v}</div>
            {hint ? <div className="text-[11px] leading-snug text-chalk-4">{hint}</div> : null}
          </div>
        ))}
      </div>
    </Panel>
  )
}

/** Private real-data snapshots found in .local-data/ (dev/preview server only). */
function LocalSnapshots() {
  const local = useApp((s) => s.localSnapshots)
  const refresh = useApp((s) => s.refreshLocalSnapshots)
  const activate = useApp((s) => s.activateLocalSnapshot)
  const activeId = useApp((s) => s.activeDatasetId)
  const [busy, setBusy] = useState<string | null>(null)
  return (
    <Panel
      title="Local real-data snapshots"
    >
      {local.length ? (
        <ul className="divide-y divide-seam" data-testid="local-snapshots">
          {local.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2 text-[12.5px]">
              <span className="min-w-0 flex-1 truncate">
                {e.name}{' '}
                <span className="text-chalk-3">
                  · {e.players} players{e.complete != null ? ` · ${e.complete} complete 9-cat` : ''}
                  {e.sourceUpdatedAt ? ` · sources ${e.sourceUpdatedAt}` : ''}
                </span>
              </span>
              {e.id === activeId ? (
                <Badge tone="clock">active</Badge>
              ) : (
                <Button
                  size="xs"
                  variant="primary"
                  disabled={busy === e.id}
                  onClick={async () => {
                    setBusy(e.id)
                    reportActivation(await activate(e.id), e.name)
                    setBusy(null)
                  }}
                >
                  {busy === e.id ? 'Loading…' : 'Activate'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-chalk-3">
          None found. Put your source files in <code className="font-mono">Fantasy Draft Data/</code>, run <code className="font-mono">npm run data:ingest</code>, then
          start the app with <code className="font-mono">npm run dev</code> (or <code className="font-mono">npm run preview</code>).
        </p>
      )}
      <Button size="xs" variant="ghost" className="mt-2" onClick={() => void refresh().then((l) => toast(`${l.length} local snapshot(s) found`))}>
        <RotateCcw size={11} /> Re-check
      </Button>
    </Panel>
  )
}

function DataSettings() {
  const dataset = useApp((s) => s.dataset)
  const datasets = useApp((s) => s.datasets)
  const activeId = useApp((s) => s.activeDatasetId)
  const activate = useApp((s) => s.activateDataset)
  const remove = useApp((s) => s.deleteDataset)
  const d = useDraft()
  if (!dataset) return null
  const orphaned = [...d.draftedBy.keys()].filter((id) => !dataset.players.some((p) => p.identity.id === id)).length
  return (
    <>
      <Panel title="Active dataset">
        <div className="flex flex-wrap items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[15px] font-semibold">{dataset.name}</span>
              {dataset.kind === 'demo' ? <Badge tone="warn">FICTIONAL DEMO</Badge> : <Badge tone="good">{dataset.kind}</Badge>}
            </div>
            <div className="mt-1 text-[12px] text-chalk-3">
              Season {dataset.season} · {dataset.players.length} players · created {dateShort(dataset.createdAt)} · source updated {dateShort(dataset.sourceUpdatedAt)}
            </div>
            {dataset.notes ? <p className="mt-1.5 text-[12px] text-chalk-2">{dataset.notes}</p> : null}
            <ul className="mt-2 space-y-1">
              {dataset.sources.map((s, i) => (
                <li key={i} className="text-[11.5px] text-chalk-3">
                  <span className="text-chalk-2">{s.name}</span>
                  {s.url ? (
                    <>
                      {' '}
                      ·{' '}
                      <a href={s.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                        {new URL(s.url).hostname}
                      </a>
                    </>
                  ) : null}{' '}
                  · retrieved {dateShort(s.retrievedAt)} · fields: {s.fields.slice(0, 12).join(', ')}
                  {s.fields.length > 12 ? '…' : ''}
                  {s.notes ? ` · ${s.notes}` : ''}
                </li>
              ))}
            </ul>
            {orphaned ? <p className="mt-2 text-[12px] text-warn">{orphaned} recorded draft pick(s) reference players that are not in this dataset.</p> : null}
          </div>
          <Button size="sm" variant="subtle" onClick={() => download(`9dub-dataset-${dataset.id}.json`, dataset)}>
            <Download size={12} /> Export snapshot JSON
          </Button>
        </div>
      </Panel>
      <DataCoverage />
      <LocalSnapshots />
      <Panel title="Import projections or ADP">
        <ImportWizard />
      </Panel>
      <Panel title="Snapshots">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left text-[11px] text-chalk-3">
              <th className="h-7 font-medium">Name</th>
              <th className="font-medium">Kind</th>
              <th className="font-medium">Season</th>
              <th className="font-medium">Players</th>
              <th className="font-medium">Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...datasets].reverse().map((m) => (
              <tr key={m.id} className="border-t border-seam">
                <td className="h-8 max-w-[320px] truncate pr-2">
                  {m.name}
                  {m.id === activeId ? <Badge tone="clock" className="ml-2">active</Badge> : null}
                  {m.id === dataset.parentId ? <Badge tone="outline" className="ml-2">parent</Badge> : null}
                </td>
                <td>{m.kind}</td>
                <td>{m.season}</td>
                <td className="font-mono tnum">{m.playerCount}</td>
                <td className="text-chalk-3">{dateShort(m.createdAt)}</td>
                <td className="text-right">
                  {m.id !== activeId ? (
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="subtle" onClick={() => activate(m.id).then((r) => reportActivation(r, m.name))}>
                        <RotateCcw size={11} /> Activate
                      </Button>
                      <Button size="xs" variant="ghost" onClick={() => window.confirm(`Delete snapshot "${m.name}"?`) && void remove(m.id)}>
                        Delete
                      </Button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <BundledDatasets />
      <Panel title="Where real data comes from">
        <div className="space-y-2 text-[12px] leading-relaxed text-chalk-2 text-pretty">
          <p>
            9dub does not scrape projections (the ESPN league sync reads only your own league). The full Hashtag Basketball projections are subscriber-only. Import data you can
            legitimately view or export: paste a projections table (with FGA/FTA if available), a FantasyPros CSV export (season totals, no shooting volume), or a
            Basketball-Reference CSV (prior-season <em>actuals</em> — label them as such). Then merge an ADP table (e.g. ESPN ADP) by name.
          </p>
          <p className="text-chalk-3">Republishing third-party projections publicly may require a licence. See docs/DATA_SOURCES.md.</p>
        </div>
      </Panel>
    </>
  )
}

interface ManifestEntry {
  id: string
  file: string
  name: string
  season: string
  kind: string
  players: number
  default?: boolean
}

/** Snapshots shipped in public/data (e.g. built with `npm run data:build`). */
function BundledDatasets() {
  const datasets = useApp((s) => s.datasets)
  const addDataset = useApp((s) => s.addDataset)
  const [entries, setEntries] = useState<ManifestEntry[] | null>(null)
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/manifest.json`)
      .then((r) => r.json())
      .then((m: { datasets: ManifestEntry[] }) => setEntries(m.datasets))
      .catch(() => setEntries([]))
  }, [])
  if (!entries?.length) return null
  return (
    <Panel title="Bundled snapshots">
      <ul className="divide-y divide-seam">
        {entries.map((e) => {
          const loaded = datasets.some((d) => d.id === e.id)
          return (
            <li key={e.id} className="flex items-center gap-3 py-2 text-[12.5px]">
              <span className="flex-1 truncate">
                {e.name} <span className="text-chalk-3">· {e.season} · {e.players} players · {e.file}</span>
              </span>
              {e.kind === 'demo' ? <Badge tone="warn">demo</Badge> : null}
              <Button
                size="xs"
                variant="subtle"
                onClick={async () => {
                  try {
                    const raw = await (await fetch(`${import.meta.env.BASE_URL}data/${e.file}`)).json()
                    const parsed = DatasetSnapshotSchema.safeParse(raw)
                    if (!parsed.success) return toast.error(`Invalid snapshot file: ${parsed.error.issues[0]?.message}`)
                    reportActivation(await addDataset(parsed.data, true), parsed.data.name)
                  } catch {
                    toast.error('Could not load that file.')
                  }
                }}
              >
                {loaded ? 'Reload & activate' : 'Load & activate'}
              </Button>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function SessionSettings() {
  const exportSession = useApp((s) => s.exportSession)
  const importSession = useApp((s) => s.importSession)
  const savedDrafts = useApp((s) => s.savedDrafts)
  const saveDraftAs = useApp((s) => s.saveDraftAs)
  const restoreDraft = useApp((s) => s.restoreDraft)
  const deleteSaved = useApp((s) => s.deleteSavedDraft)
  const resetDraft = useApp((s) => s.resetDraft)
  const draft = useApp((s) => s.draft)
  const diskSave = useApp((s) => s.diskSave)
  const diskSavedAt = useApp((s) => s.diskSavedAt)
  const [withData, setWithData] = useState(true)
  const [name, setName] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  return (
    <>
      <Panel title="Autosave">
        <p className="text-[12.5px] text-chalk-3">
          Live draft: {draft.picks.length} picks · last change {relTime(draft.updatedAt)}.
        </p>
        <p className="mt-1.5 text-[12.5px] text-chalk-3" data-testid="disk-save-status">
          {diskSave === 'on' && diskSavedAt
            ? `Also saved to disk: .local-data/session-latest.json (last ${relTime(diskSavedAt)}), with a daily copy in .local-data/session-backups/. If this browser's data is cleared, 9dub restores from it on the next start.`
            : diskSave === 'unavailable'
              ? 'Disk copy unavailable here (static build or local data off) — export a backup to keep a copy outside the browser.'
              : 'Checking the disk copy…'}
        </p>
      </Panel>
      <Panel title="Export / import session">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => download(`9dub-session-${stamp()}.json`, exportSession(withData))} data-testid="export-session">
            <Download size={13} /> Export session JSON
          </Button>
          <label className="flex items-center gap-2 text-[12px] text-chalk-2">
            <Switch checked={withData} onChange={setWithData} label="Include dataset" /> Include the active dataset (portable to another browser)
          </label>
          <Button variant="subtle" onClick={() => fileRef.current?.click()}>
            <Upload size={13} /> Import session
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="import-session"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              let json: unknown
              try {
                json = JSON.parse(await f.text())
              } catch {
                return toast.error('That file is not valid JSON.')
              }
              const r = await importSession(json)
              if (!r.ok) toast.error(`Import failed: ${r.error}`)
              else toast.success(r.warning ?? 'Session imported. Your previous draft is one undo away.')
            }}
          />
        </div>
      </Panel>
      <Panel title="Saved draft logs">
        <div className="mb-3 flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this draft log…" className="max-w-[280px]" />
          <Button
            variant="subtle"
            onClick={() => {
              saveDraftAs(name)
              setName('')
              toast('Draft log saved')
            }}
          >
            Save current log
          </Button>
          <Button
            variant="danger"
            className="ml-auto"
            onClick={() => {
              if (window.confirm('Start a new empty draft? The current log is saved first and can be restored.')) {
                resetDraft({ saveAs: `Before reset ${new Date().toLocaleString()}` })
                toast('Draft reset — previous log saved')
              }
            }}
          >
            Reset draft
          </Button>
        </div>
        {savedDrafts.length ? (
          <ul className="divide-y divide-seam">
            {savedDrafts.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2 text-[12.5px]">
                <span className="flex-1 truncate">{s.name}</span>
                <span className="text-[11.5px] text-chalk-3">
                  {s.session.picks.length} picks · {s.league.teams} teams · {relTime(s.savedAt)}
                </span>
                <Button size="xs" variant="subtle" onClick={() => (restoreDraft(s.id), toast(`Restored "${s.name}"`))}>
                  Restore
                </Button>
                <Button size="xs" variant="ghost" onClick={() => deleteSaved(s.id)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-chalk-3">No saved logs. Resetting the draft saves one automatically.</p>
        )}
      </Panel>
      <BackupsPanel />
      <Panel title="Change history (this draft)">
        <ol className="max-h-56 space-y-0.5 overflow-y-auto font-mono text-[11px] text-chalk-3">
          {[...draft.log].reverse().slice(0, 120).map((l, i) => (
            <li key={i}>
              <span className="text-chalk-4">{new Date(l.at).toLocaleTimeString()}</span> {l.kind.padEnd(7)} {l.text}
            </li>
          ))}
          {!draft.log.length ? <li>No changes yet.</li> : null}
        </ol>
      </Panel>
    </>
  )
}

function BackupsPanel() {
  const list = useApp((s) => s.listBackups)
  const restore = useApp((s) => s.restoreBackup)
  const backupNow = useApp((s) => s.backupNow)
  const activeId = useApp((s) => s.activeDatasetId)
  const [rows, setRows] = useState<Awaited<ReturnType<typeof list>> | null>(null)
  useEffect(() => {
    void list().then(setRows)
  }, [list, activeId])
  return (
    <Panel title="Automatic backups">
      <div className="mb-2 flex gap-2">
        <Button size="xs" variant="subtle" onClick={async () => (await backupNow('Manual backup'), setRows(await list()), toast('Backup saved'))}>
          Back up now
        </Button>
      </div>
      {rows?.length ? (
        <ul className="divide-y divide-seam" data-testid="backups">
          {rows.map((b) => (
            <li key={b.key} className="flex items-center gap-3 py-1.5 text-[12px]">
              <span className="flex-1 truncate">{b.reason}</span>
              <span className="text-[11.5px] text-chalk-3">
                {b.picks} picks · {relTime(b.at)}
              </span>
              <Button
                size="xs"
                variant="subtle"
                onClick={async () => {
                  if (!window.confirm('Restore this backup? Your current state is backed up first.')) return
                  const r = await restore(b.key)
                  if (r.ok) toast.success('Backup restored')
                  else toast.error(r.error ?? 'Restore failed')
                  setRows(await list())
                }}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-chalk-3">No backups yet.</p>
      )}
    </Panel>
  )
}

/** Players the engine cannot fully value, ordered by ESPN market position so draft-relevant gaps show first. */
function ExcludedPlayers() {
  const engine = useEngine()
  const openPreview = useApp((s) => s.openPreview)
  if (!engine) return null
  const rows = engine.players
    .filter((p) => !p.complete && (p.adp != null || p.rec.market?.espnLive || (p.rec.rankings?.fantasyProsEcr?.rank ?? 999) <= 250))
    .sort((a, b) => (a.rec.market?.espnLive?.rank ?? 900 + (a.rec.rankings?.fantasyProsEcr?.rank ?? 999)) - (b.rec.market?.espnLive?.rank ?? 900 + (b.rec.rankings?.fantasyProsEcr?.rank ?? 999)))
    .slice(0, 40)
  if (!rows.length) return null
  return (
    <Panel title="Not fully valued (market-relevant)">
      <table className="w-full text-[12px]" data-testid="excluded-players">
        <thead>
          <tr className="text-left text-[11px] text-chalk-3">
            <th className="h-7 font-medium">Player</th>
            <th className="font-medium">Why</th>
            <th className="text-right font-medium">ESPN live rank</th>
            <th className="text-right font-medium">AVG PICK</th>
            <th className="text-right font-medium">FP ECR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} className="border-t border-seam">
              <td className="h-7">
                <button type="button" className="hover:underline" onClick={() => openPreview(p.id)}>
                  {p.name}
                </button>{' '}
                <span className="text-chalk-4">{p.team ?? 'FA'}</span>
              </td>
              <td className="text-chalk-3">{!p.valued ? 'no projection in any source' : 'FG%/FT% without attempts'}</td>
              <td className="text-right font-mono tnum">{p.rec.market?.espnLive?.rank ?? '—'}</td>
              <td className="text-right font-mono tnum">{p.rec.market?.espnLive?.avgPick.toFixed(1) ?? '—'}</td>
              <td className="text-right font-mono tnum">{p.rec.rankings?.fantasyProsEcr?.rank ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

function Diagnostics() {
  const engine = useEngine()
  const live = useLive()
  if (!engine || !live) return null
  const { params, replacement } = engine.valuation
  const rec = live.rec
  return (
    <>
      <ExcludedPlayers />
      <Panel title="Reference pool">
        <div className="mb-3 grid grid-cols-4 gap-3 text-[12px]">
          {[
            ['Pool size', params.poolSize],
            ['Iterations', `${params.iterations}${params.converged ? ' (converged)' : ''}`],
            ['FG baseline', pct(params.fgBaseline)],
            ['FT baseline', pct(params.ftBaseline)],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-md border border-seam p-2">
              <div className="text-[11px] text-chalk-3">{k}</div>
              <div className="font-mono text-[14px] tnum">{v}</div>
            </div>
          ))}
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[11px] text-chalk-3">
              <th className="h-7 text-left font-medium">Category</th>
              <th className="text-right font-medium">Raw value</th>
              <th className="text-right font-medium">Mean</th>
              <th className="text-right font-medium">SD</th>
              <th className="text-right font-medium">n</th>
              <th className="text-right font-medium">Replacement z</th>
              <th className="text-right font-medium">Team σ</th>
              <th className="text-right font-medium">Scarcity ×</th>
              <th className="text-right font-medium">Fit weight</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((c) => (
              <tr key={c} className="border-t border-seam font-mono tnum">
                <td className="h-6 font-sans font-medium">{CATEGORY_META[c].label}</td>
                <td className="text-right font-sans text-chalk-3">{c === 'FG' || c === 'FT' ? 'impact (makes)' : c === 'TO' ? 'TO (inverted)' : 'per game'}</td>
                <td className="text-right">{num(params.mean[c], 3)}</td>
                <td className="text-right">{num(params.sd[c], 3)}</td>
                <td className="text-right">{params.n[c]}</td>
                <td className="text-right">{signed(replacement.z[c], 2)}</td>
                <td className="text-right">{num(engine.scale.sigma[c], 2)}</td>
                <td className="text-right">{num(rec.scarcity[c], 2)}</td>
                <td className="text-right">{num(rec.catWeights[c], 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11.5px] text-chalk-3">
          Replacement band: ranks {replacement.rankStart}–{replacement.rankEnd} (total {signed(replacement.total, 2)}). Players valued: {params.playerCount}.
        </p>
      </Panel>
      <Panel title="Recommendation internals (current state)">
        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <div>
            Blend weights: quality {rec.weights.q.toFixed(2)} · fit {rec.weights.f.toFixed(2)} · timing {rec.weights.t.toFixed(2)}
            <br />
            Value over replacement reference: {signed(rec.vorpRef, 2)}
            <br />
            Quality floor (decision / fit): {rec.floors.decision.toFixed(2)} / {rec.floors.fit.toFixed(2)}
          </div>
          <div>
            Category correlations (top): {engine.pairs.slice(0, 6).map((p) => `${CATEGORY_META[p.a].label}–${CATEGORY_META[p.b].label} ${p.r.toFixed(2)}`).join(' · ')}
          </div>
        </div>
        <table className="mt-3 w-full text-[11.5px]">
          <thead>
            <tr className="text-chalk-3">
              <th className="h-6 text-left font-medium">Top decisions</th>
              <th className="text-right font-medium">Value</th>
              <th className="text-right font-medium">VORP</th>
              <th className="text-right font-medium">q</th>
              <th className="text-right font-medium">fit</th>
              <th className="text-right font-medium">f</th>
              <th className="text-right font-medium">t</th>
              <th className="text-right font-medium">gone-before</th>
              <th className="text-right font-medium">decision</th>
            </tr>
          </thead>
          <tbody>
            {rec.bestDecision.slice(0, 10).map((s) => (
              <tr key={s.id} className="border-t border-seam font-mono tnum">
                <td className="h-6 font-sans">{engine.byId.get(s.id)?.name}</td>
                <td className="text-right">{signed(s.quality, 2)}</td>
                <td className="text-right">{signed(s.vorp, 2)}</td>
                <td className="text-right">{s.q.toFixed(2)}</td>
                <td className="text-right">{(s.fit * 100).toFixed(2)}</td>
                <td className="text-right">{s.f.toFixed(2)}</td>
                <td className="text-right">{s.t.toFixed(2)}</td>
                <td className="text-right">{s.goneBefore == null ? '—' : s.goneBefore.toFixed(2)}</td>
                <td className="text-right">{s.decision.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </>
  )
}
