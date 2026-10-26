import { Check, Download } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { navigate } from '@/app/router'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Controls'
import { cn } from '@/lib/cn'
import { useApp, type EspnLeague } from '@/store/appStore'

/**
 * First-run setup: a player list, the user's ESPN cookies, their league, then
 * one read of ESPN fills in the league size, lineup, team, draft, schedule and
 * standings. Shown once on a fresh install with ESPN sync available; Settings
 * links back here while no draft is recorded.
 */
export function SetupPage() {
  const dataset = useApp((s) => s.dataset)
  const espnState = useApp((s) => s.espnState)
  const picks = useApp((s) => s.draft.picks.length)
  const setPrefs = useApp((s) => s.setPrefs)
  const demo = dataset?.kind === 'demo'
  const espnOn = espnState === 'setup' || espnState === 'ready'
  const [leagueId, setLeagueId] = useState<number | null>(null)
  const [imported, setImported] = useState(false)
  const done = () => setPrefs({ setupDone: true })

  return (
    <div className="h-full overflow-y-auto" data-testid="setup-page">
      <div className="mx-auto max-w-[760px] px-5 py-8">
        <h1 className="font-display text-[30px] font-semibold tracking-tight">Set up 9dub</h1>
        <p className="mt-1 text-[14px] text-chalk-2">Connect your ESPN league and 9dub fills in the rest: teams, lineup, your draft, rosters, the schedule and standings.</p>

        <ol className="mt-6 space-y-3">
          <Step n={1} title="Player list" done={!demo && !!dataset}>
            {dataset ? (
              <p className="text-[13px] text-chalk-2">
                <span className="font-medium text-chalk">{dataset.name}</span> · {dataset.players.length} players
              </p>
            ) : null}
            {demo ? (
              <p className="mt-1 text-[13px] text-warn">These are made-up players for trying the app. To use your real league, import projections from a source you have (CSV or a pasted table).</p>
            ) : null}
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button size="sm" variant={demo ? 'primary' : 'subtle'} onClick={() => navigate('settings', 'data')}>
                Import projections
              </Button>
              <a href="data/template-projections.csv" download className="inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] text-chalk-2 hover:bg-stand hover:text-chalk">
                <Download size={13} /> CSV template
              </a>
            </div>
          </Step>

          {espnOn ? (
            <>
              <Step n={2} title="ESPN sign-in cookies" done={espnState === 'ready'}>
                <Cookies ready={espnState === 'ready'} />
              </Step>
              <Step n={3} title="Your league" done={leagueId != null}>
                {espnState === 'ready' ? <Leagues onChosen={setLeagueId} /> : <p className="text-[13px] text-chalk-3">Save your cookies first.</p>}
              </Step>
              <Step n={4} title="Import from ESPN" done={imported}>
                <Import
                  blocked={
                    demo
                      ? 'Import your projections first: ESPN’s players are matched to your player list.'
                      : picks
                        ? `This session already has ${picks} draft picks; setup starts from an empty draft.`
                        : espnState !== 'ready' || leagueId == null
                          ? 'Finish the steps above first.'
                          : null
                  }
                  onDone={() => {
                    done()
                    setImported(true)
                  }}
                />
              </Step>
            </>
          ) : (
            <Step n={2} title="ESPN league" done={false}>
              <p className="text-[13px] text-chalk-3">ESPN sync runs on the local dev server (<code className="font-mono text-[12px]">npm run dev</code>). On this server it is off, so set up your league by hand.</p>
            </Step>
          )}
        </ol>

        <div className={cn('mt-6 flex items-center gap-3 border-t border-seam pt-4', imported && 'hidden')}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              done()
              navigate('draft')
            }}
            data-testid="setup-skip"
          >
            Skip, set up by hand
          </Button>
          <span className="text-[12.5px] text-chalk-3">You can come back from Settings → League.</span>
        </div>
      </div>
    </div>
  )
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-4 rounded-lg border border-seam bg-floor px-4 py-3.5">
      <span
        className={cn(
          'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[12px] font-semibold',
          done ? 'bg-good/15 text-good' : 'bg-stand text-chalk-3',
        )}
        aria-label={done ? 'Done' : undefined}
      >
        {done ? <Check size={13} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="text-[14.5px] font-semibold">{title}</h2>
        <div className="mt-1">{children}</div>
      </div>
    </li>
  )
}

function Cookies({ ready }: { ready: boolean }) {
  const saveEspnAuth = useApp((s) => s.saveEspnAuth)
  const [swid, setSwid] = useState('')
  const [s2, setS2] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    const r = await saveEspnAuth({ swid: swid.trim(), espnS2: s2.trim() })
    setBusy(false)
    if (!r.ok) return toast.error(r.error)
    setSwid('')
    setS2('')
  }
  return (
    <>
      <p className="text-[13px] text-chalk-2">
        {ready ? 'Saved on this computer.' : 'ESPN needs your sign-in to read a private league.'} They stay in <code className="font-mono text-[12px]">.local-data/espn/auth.json</code>, are never shown again, and 9dub only ever reads from ESPN.
      </p>
      <details className="mt-1.5 text-[12.5px] text-chalk-3">
        <summary className="cursor-pointer hover:text-chalk">Where to find them</summary>
        <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
          <li>Sign in at espn.com in Chrome, Edge or Firefox.</li>
          <li>Open the developer tools (⌥⌘I on a Mac, F12 on Windows).</li>
          <li>Chrome / Edge: Application → Cookies → https://www.espn.com. Firefox: Storage → Cookies.</li>
          <li>Copy the values of SWID (looks like {'{…}'}) and espn_s2.</li>
        </ol>
      </details>
      {!ready ? (
        <div className="mt-2.5 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
          <Field label="SWID">
            <Input type="password" autoComplete="off" value={swid} onChange={(e) => setSwid(e.target.value)} placeholder="{…}" className="h-8" aria-label="SWID" />
          </Field>
          <Field label="espn_s2">
            <Input type="password" autoComplete="off" value={s2} onChange={(e) => setS2(e.target.value)} className="h-8" aria-label="espn_s2" />
          </Field>
          <Button size="sm" variant="primary" disabled={busy || !swid.trim() || !s2.trim()} onClick={() => void save()}>
            Save
          </Button>
        </div>
      ) : null}
    </>
  )
}

/** The account's leagues; one is chosen automatically, several get a choice. */
function Leagues({ onChosen }: { onChosen: (id: number | null) => void }) {
  const listEspnLeagues = useApp((s) => s.listEspnLeagues)
  const saveEspnAuth = useApp((s) => s.saveEspnAuth)
  const [leagues, setLeagues] = useState<EspnLeague[] | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void listEspnLeagues().then((r) => {
      if (!live) return
      if (!r.ok) return setError(r.error ?? 'Could not read your leagues')
      const list = r.leagues ?? []
      setLeagues(list)
      const pick = list.find((l) => l.id === r.selected)?.id ?? (list.length === 1 ? list[0].id : null)
      setSelected(pick)
      if (pick != null && pick !== r.selected) void saveEspnAuth({ leagueId: pick })
    })
    return () => {
      live = false
    }
  }, [listEspnLeagues, saveEspnAuth])
  useEffect(() => onChosen(selected), [selected, onChosen])
  if (error) return <p className="text-[13px] text-bad">{error}</p>
  if (!leagues) return <p className="text-[13px] text-chalk-3">Reading your leagues…</p>
  if (!leagues.length) return <p className="text-[13px] text-warn">No ESPN fantasy basketball league this season on this account.</p>
  return (
    <div className="space-y-1" role="radiogroup" aria-label="ESPN league" data-testid="espn-leagues">
      {leagues.map((l) => (
        <label key={l.id} className={cn('flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-[13px]', selected === l.id ? 'border-clock-line bg-clock-soft' : 'border-seam hover:bg-stand')}>
          <input
            type="radio"
            name="espn-league"
            className="accent-[var(--clock)]"
            checked={selected === l.id}
            onChange={() => {
              setSelected(l.id)
              void saveEspnAuth({ leagueId: l.id })
            }}
          />
          <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
          {l.teamName ? <span className="truncate text-chalk-3">{l.teamName}</span> : null}
        </label>
      ))}
    </div>
  )
}

function Import({ blocked, onDone }: { blocked: string | null; onDone: () => void }) {
  const setupFromEspn = useApp((s) => s.setupFromEspn)
  const syncing = useApp((s) => s.espnSyncing)
  const [summary, setSummary] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async () => {
    setError(null)
    const r = await setupFromEspn()
    setSummary(r.summary ?? null)
    if (!r.ok) return setError(r.error ?? 'Setup failed')
    onDone()
  }
  if (summary && !error)
    return (
      <div data-testid="setup-summary">
        <ul className="space-y-0.5 text-[13px] text-chalk-2">
          {summary.map((line) => (
            <li key={line} className="flex gap-2">
              <Check size={13} className="mt-1 shrink-0 text-good" /> {line}
            </li>
          ))}
        </ul>
        <Button className="mt-3" size="sm" variant="primary" onClick={() => navigate('league')}>
          Open My League
        </Button>
      </div>
    )
  return (
    <>
      <p className="text-[13px] text-chalk-2">One read of your league: size, rounds and lineup, your team, team names, the draft, rosters and IR, the matchup schedule, results so far and the NBA schedule.</p>
      {blocked ? <p className="mt-1 text-[12.5px] text-chalk-3">{blocked}</p> : null}
      {error ? <p className="mt-1 text-[12.5px] text-bad">{error}</p> : null}
      <Button className="mt-2.5" size="sm" variant="primary" disabled={!!blocked || syncing} onClick={() => void run()} data-testid="setup-import">
        {syncing ? 'Reading ESPN…' : 'Import league'}
      </Button>
    </>
  )
}
