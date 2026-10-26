import { FileUp } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Segmented, Select } from '@/components/ui/Controls'
import { FIELD_KEYS, FIELD_LABEL, type FieldKey } from '@/data/import/fields'
import { PRESET_LABEL, parseTableText, type ParsedTable } from '@/data/import/parseTable'
import { defaultOptionsFor, detectUnit, initialMapping, mapRows, planImport, type ImportMode, type ImportOptions, type Resolution } from '@/data/import/pipeline'
import { DatasetSnapshotSchema } from '@/data/schema'
import { cn } from '@/lib/cn'
import { useApp } from '@/store/appStore'

const today = () => new Date().toISOString().slice(0, 10)

export function ImportWizard() {
  const dataset = useApp((s) => s.dataset)
  const addDataset = useApp((s) => s.addDataset)
  const [source, setSource] = useState<'paste' | 'file'>('paste')
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const [table, setTable] = useState<ParsedTable | null>(null)
  const [mapping, setMapping] = useState<FieldKey[]>([])
  const [opts, setOpts] = useState<ImportOptions | null>(null)
  const [mode, setMode] = useState<ImportMode>('replace')
  const [resolutions, setResolutions] = useState<Record<number, Resolution>>({})
  const [showAll, setShowAll] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const parse = (raw: string, name: string | null) => {
    const trimmed = raw.trim()
    if (!trimmed) return toast.error('Nothing to import.')
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const json = JSON.parse(trimmed)
        const snap = DatasetSnapshotSchema.safeParse(json)
        if (snap.success) {
          void addDataset({ ...snap.data, createdAt: snap.data.createdAt }, true).then(() =>
            toast.success(`Imported snapshot "${snap.data.name}" (${snap.data.players.length} players) and made it active.`),
          )
          reset()
          return
        }
        if (json?.app === '9dub' && json?.kind === 'session') return toast.error('That is a session file — import it under Session.')
        return toast.error(`JSON is not a 9dub dataset snapshot: ${snap.error.issues[0]?.path.join('.')} ${snap.error.issues[0]?.message}`)
      } catch {
        return toast.error('Invalid JSON.')
      }
    }
    const t = parseTableText(trimmed)
    if (!t.headers.length || !t.rows.length) return toast.error('Could not find a header row and data rows.')
    const m = initialMapping(t)
    if (!m.includes('name')) toast.warning('No player-name column detected — map one below.')
    const o = defaultOptionsFor(t.preset, today())
    o.unit = t.preset === 'fantasypros' ? 'totals' : detectUnit(t, m)
    const statCols = m.filter((f) => ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'tov'].includes(f)).length
    setMode(statCols >= 7 ? 'replace' : 'merge')
    setTable(t)
    setMapping(m)
    setOpts(o)
    setResolutions({})
    setFileName(name)
  }

  const reset = () => {
    setTable(null)
    setText('')
    setFileName(null)
    setResolutions({})
  }

  const rows = useMemo(() => (table && opts ? mapRows(table, mapping, opts) : []), [table, mapping, opts])
  const plan = useMemo(() => (rows.length && opts ? planImport(rows, mode, dataset, opts, resolutions) : null), [rows, mode, dataset, opts, resolutions])

  if (!table || !opts) {
    return (
      <div className="space-y-3">
        <Segmented
          label="Import source"
          value={source}
          onChange={setSource}
          options={[
            { value: 'paste', label: 'Paste a table' },
            { value: 'file', label: 'Upload CSV / TSV / JSON' },
          ]}
        />
        {source === 'paste' ? (
          <>
            <textarea
              data-testid="import-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Paste rows copied from a projections or ADP table (including the header row), or CSV text.\nTabs, commas, pipes and semicolons are detected automatically.'}
              className="h-44 w-full resize-y rounded-md border border-seam bg-well p-3 font-mono text-[11.5px] leading-relaxed text-chalk placeholder:font-sans placeholder:text-chalk-4 focus:border-clock-line focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <Button variant="primary" onClick={() => parse(text, null)} disabled={!text.trim()}>
                Parse table
              </Button>
              <span className="text-[11.5px] text-chalk-3">Nothing changes until you confirm the preview.</span>
            </div>
          </>
        ) : (
          <div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-seam-strong bg-well text-[12.5px] text-chalk-3 hover:text-chalk"
            >
              <FileUp size={20} />
              Choose a .csv, .tsv, .txt or 9dub .json file
            </button>
            <input
              ref={fileRef}
              data-testid="import-file"
              type="file"
              accept=".csv,.tsv,.txt,.json,text/csv,text/plain,application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) parse(await f.text(), f.name)
              }}
            />
          </div>
        )}
        <p className="text-[11.5px] leading-relaxed text-chalk-3 text-pretty">
          Tip: on a projections site you are permitted to view, select the table (header included), copy, and paste it here. Hashtag-style "0.487 (7.2/14.8)"
          shooting cells, doubled names, two-row ADP headers and season-total tables are recognised. Download the{' '}
          <a className="text-clock underline-offset-2 hover:underline" href={`${import.meta.env.BASE_URL}data/template-projections.csv`} download>
            CSV template
          </a>{' '}
          for the cleanest format.
        </p>
      </div>
    )
  }

  const shown = showAll ? plan?.matches ?? [] : (plan?.matches ?? []).filter((m) => m.status !== 'new' && m.status !== 'matched').concat((plan?.matches ?? []).filter((m) => m.status === 'new' || m.status === 'matched').slice(0, 12))

  return (
    <div className="space-y-4" data-testid="import-preview">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="clock">{PRESET_LABEL[table.preset]}</Badge>
        <span className="text-[12px] text-chalk-3">
          {fileName ?? 'Pasted text'} · {table.rows.length} rows · {table.headers.length} columns
        </span>
        <Button size="xs" variant="ghost" className="ml-auto" onClick={reset}>
          Start over
        </Button>
      </div>
      {table.notes.map((n) => (
        <p key={n} className="text-[11.5px] text-chalk-3">
          · {n}
        </p>
      ))}

      <div>
        <div className="mb-1.5 label-caps">Column mapping</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
          {table.headers.map((h, i) => (
            <div key={i} className={cn('rounded-md border p-2', mapping[i] === 'ignore' ? 'border-seam' : 'border-seam-strong bg-stand')}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-[11.5px] font-semibold">{h || `col ${i + 1}`}</span>
              </div>
              <div className="mb-1 truncate font-mono text-[10.5px] text-chalk-4" title={table.rows.slice(0, 3).map((r) => r[i]).join(' | ')}>
                {table.rows
                  .slice(0, 2)
                  .map((r) => r[i])
                  .join(' · ') || '—'}
              </div>
              <Select
                aria-label={`Map column ${h}`}
                value={mapping[i]}
                onChange={(e) => {
                  const next = [...mapping]
                  const f = e.target.value as FieldKey
                  if (f !== 'ignore') for (let j = 0; j < next.length; j++) if (next[j] === f) next[j] = 'ignore'
                  next[i] = f
                  setMapping(next)
                }}
                className="h-7 w-full text-[11.5px]"
              >
                {FIELD_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {FIELD_LABEL[k]}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Field label="Values are">
          <Segmented
            label="Units"
            size="xs"
            value={opts.unit}
            onChange={(u) => setOpts({ ...opts, unit: u })}
            options={[
              { value: 'perGame', label: 'Per game' },
              { value: 'totals', label: 'Season totals (÷ GP)' },
            ]}
          />
        </Field>
        <Field label="Import mode" hint={mode === 'replace' ? 'New snapshot with only these rows.' : `Update matching players in "${dataset?.name}" with the mapped fields; other fields are kept.`}>
          <Segmented
            label="Import mode"
            size="xs"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'replace', label: 'Replace' },
              { value: 'merge', label: 'Merge into current' },
            ]}
          />
        </Field>
        <Field label="Season label" hint="Use e.g. “2025-26 actuals” for prior-season stats so they are never mistaken for projections.">
          <Input value={opts.season} onChange={(e) => setOpts({ ...opts, season: e.target.value })} />
        </Field>
        <Field label="Source name">
          <Input value={opts.sourceName} onChange={(e) => setOpts({ ...opts, sourceName: e.target.value })} />
        </Field>
        <Field label="Source URL (optional)">
          <Input value={opts.sourceUrl ?? ''} onChange={(e) => setOpts({ ...opts, sourceUrl: e.target.value || null })} />
        </Field>
        <Field label="Retrieved / source updated">
          <Input type="date" value={opts.retrievedAt.slice(0, 10)} onChange={(e) => setOpts({ ...opts, retrievedAt: e.target.value })} />
        </Field>
        {mapping.includes('otherAdp') ? (
          <Field label="Label for the non-ESPN ADP column">
            <Input value={opts.otherAdpLabel ?? ''} onChange={(e) => setOpts({ ...opts, otherAdpLabel: e.target.value || null })} />
          </Field>
        ) : null}
      </div>

      {plan ? (
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="label-caps">Preview</span>
            <Badge tone="good">{plan.counts.added} new</Badge>
            {mode === 'merge' ? <Badge tone="plus">{plan.counts.updated} updated</Badge> : null}
            {plan.counts.ambiguous ? <Badge tone="warn">{plan.counts.ambiguous} need review</Badge> : null}
            {plan.counts.invalid ? <Badge tone="bad">{plan.counts.invalid} invalid</Badge> : null}
            {plan.counts.skipped ? <Badge tone="outline">{plan.counts.skipped} skipped</Badge> : null}
            <button type="button" className="ml-auto text-[11.5px] text-chalk-3 hover:text-chalk" onClick={() => setShowAll((x) => !x)}>
              {showAll ? 'Show issues first' : `Show all ${plan.matches.length} rows`}
            </button>
          </div>
          <div className="max-h-[320px] overflow-auto rounded-md border border-seam">
            <table className="w-full text-[11.5px]">
              <thead className="sticky top-0 bg-floor">
                <tr className="text-left text-chalk-3">
                  <th className="h-7 px-2 font-medium">Row</th>
                  <th className="px-2 font-medium">Player</th>
                  <th className="px-2 font-medium">Status</th>
                  <th className="px-2 font-medium">PTS</th>
                  <th className="px-2 font-medium">FG (m/a)</th>
                  <th className="px-2 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((m) => (
                  <tr key={m.row.index} className="border-t border-seam align-top">
                    <td className="px-2 py-1 font-mono text-chalk-4">{m.row.index + 1}</td>
                    <td className="px-2 py-1">
                      {m.row.name || <span className="text-chalk-4">—</span>} <span className="text-chalk-4">{m.row.team}</span>
                    </td>
                    <td className="px-2 py-1">
                      <Badge tone={m.status === 'new' ? 'good' : m.status === 'matched' ? 'plus' : m.status === 'ambiguous' ? 'warn' : m.status === 'invalid' ? 'bad' : 'outline'}>{m.status}</Badge>
                    </td>
                    <td className="px-2 py-1 font-mono tnum">{m.row.fields.points?.toFixed(1) ?? '—'}</td>
                    <td className="px-2 py-1 font-mono tnum">
                      {m.row.fields.fieldGoalsAttempted != null ? `${m.row.fields.fieldGoalsMade?.toFixed(1)}/${m.row.fields.fieldGoalsAttempted.toFixed(1)}` : <span className="text-warn">no volume</span>}
                    </td>
                    <td className="px-2 py-1 text-chalk-3">
                      {m.status === 'ambiguous' && m.candidates ? (
                        <div className="flex flex-col gap-1">
                          <span>{m.message}</span>
                          <Select
                            aria-label={`Resolve row ${m.row.index + 1}`}
                            className="h-7 text-[11.5px]"
                            value=""
                            onChange={(e) => {
                              const v = e.target.value
                              setResolutions({ ...resolutions, [m.row.index]: v === 'skip' ? { action: 'skip' } : v === 'new' ? { action: 'new' } : { action: 'match', targetId: v } })
                            }}
                          >
                            <option value="">Resolve…</option>
                            {m.candidates.map((c) => (
                              <option key={c.id} value={c.id}>
                                Same as {c.name} ({c.team ?? '—'})
                              </option>
                            ))}
                            <option value="new">Different player — add new</option>
                            <option value="skip">Skip this row</option>
                          </Select>
                        </div>
                      ) : (
                        [m.message, ...m.row.warnings].filter(Boolean).join(' · ')
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.error ? <p className="mt-2 text-[12px] text-bad">{plan.error}</p> : null}
          <div className="mt-3 flex items-center gap-2">
            <Button
              variant="primary"
              disabled={!plan.snapshot}
              data-testid="import-confirm"
              onClick={async () => {
                if (!plan.snapshot) return
                await addDataset(plan.snapshot, true)
                toast.success(`Imported ${plan.snapshot.players.length} players. The previous snapshot is kept for rollback.`)
                reset()
              }}
            >
              {mode === 'replace' ? `Create snapshot with ${plan.counts.added} players` : `Apply ${plan.counts.updated + plan.counts.added} changes`}
            </Button>
            <span className="text-[11.5px] text-chalk-3">
              {plan.counts.ambiguous ? 'Unresolved ambiguous rows are left out.' : ''} Drafted players keep their ids when merging; a replace import may not match existing draft picks.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
