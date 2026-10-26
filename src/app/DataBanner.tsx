import { Database, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { useApp, type ActivateResult } from '@/store/appStore'
import { navigate } from './router'

/** Toast summary after switching datasets: what was re-linked, what could not be, and that a backup exists. */
export function reportActivation(r: ActivateResult, name: string) {
  if (!r.ok) return void toast.error(r.error ?? 'Could not activate the snapshot')
  const parts = [`Now using "${name}".`]
  if (r.remapped) parts.push(`${r.remapped} player reference(s) re-linked by name.`)
  if (r.unmatched?.length) parts.push(`${r.unmatched.length} could not be matched (left as-is; see the Data screen).`)
  if (r.backupKey) parts.push('A backup of the previous state was saved (Settings → Session).')
  toast.success(parts.join(' '), { duration: 7000 })
}

/**
 * One-line prompt when a private real-data snapshot is available locally but
 * the fictional demo (or an older local snapshot) is active. Never switches
 * on its own once the user has saved state — the draft is never silently changed.
 */
export function DataBanner() {
  const dataset = useApp((s) => s.dataset)
  const local = useApp((s) => s.localSnapshots)
  const activate = useApp((s) => s.activateLocalSnapshot)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (!dataset || !local.length) return null
  const entry = local.find((d) => d.default) ?? local[0]
  const isDemo = dataset.kind === 'demo'
  const stale = dataset.kind === 'local' && dataset.id !== entry.id
  if ((!isDemo && !stale) || dismissed === entry.id) return null
  return (
    <div className="flex h-9 shrink-0 items-center gap-3 border-b border-clock-line bg-clock-soft px-4 text-[12.5px]" role="status" data-testid="data-banner">
      <Database size={14} className="text-clock" />
      <span className="min-w-0 truncate text-chalk">
        {isDemo ? 'Your real data is available on this machine' : 'An updated local snapshot is available'} —{' '}
        <span className="text-chalk-2">
          {entry.players} players{entry.complete != null ? `, ${entry.complete} with complete 9-cat projections` : ''}
          {entry.sourceUpdatedAt ? `, sources from ${entry.sourceUpdatedAt}` : ''}
        </span>
        {isDemo ? <span className="text-chalk-3"> · you are viewing the fictional demo pool</span> : null}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <Button
          size="xs"
          variant="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const r = await activate(entry.id)
            setBusy(false)
            reportActivation(r, entry.name)
          }}
        >
          {busy ? 'Loading…' : isDemo ? 'Use real data' : 'Activate update'}
        </Button>
        <Button size="xs" variant="ghost" onClick={() => navigate('settings', 'data')}>
          Details
        </Button>
        <button type="button" aria-label="Dismiss" className="rounded p-1 text-chalk-3 hover:bg-stand hover:text-chalk" onClick={() => setDismissed(entry.id)}>
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
