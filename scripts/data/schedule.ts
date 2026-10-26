/**
 * Convert the official NBA "Regular Season Schedule By Date" PDF (downloaded
 * by the user) into the schedule file the in-season matchup views use.
 *
 *   npm run data:schedule -- --file ~/Downloads/2026-27-NBA-Regular-Season-Schedule-By-Date.pdf
 *
 * Reads the PDF's embedded text layer only (no network). Writes
 * .local-data/nba-schedule-<season>.json (git-ignored, served to the dev and
 * preview app only). The source PDF is never moved or modified.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { NbaScheduleSchema, parseNbaSchedulePdf, seasonLabel, unscheduledInfo, type NbaSchedule } from '../../src/data/schedule'
import { readPdf } from './ingest/readPdf'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const file = arg('file')
  if (!file) {
    console.error('Usage: npm run data:schedule -- --file <NBA schedule PDF> [--out .local-data]')
    process.exit(1)
  }
  const out = resolve(arg('out') ?? '.local-data')
  const path = resolve(file.replace(/^~(?=\/)/, process.env.HOME ?? '~'))
  const bytes = readFileSync(path)
  const { games, asOf, warnings } = parseNbaSchedulePdf(await readPdf(path))
  if (!games.length) throw new Error('No games found — is this the NBA "Schedule By Date" PDF?')
  const { unscheduled, tbdWindow } = unscheduledInfo(games)
  const schedule: NbaSchedule = NbaScheduleSchema.parse({
    kind: 'nba-schedule',
    season: seasonLabel(games),
    asOf,
    source: { file: basename(path), sha256: createHash('sha256').update(bytes).digest('hex') },
    createdAt: new Date().toISOString(),
    games,
    unscheduled,
    tbdWindow,
  })
  mkdirSync(out, { recursive: true })
  const target = join(out, `nba-schedule-${schedule.season}.json`)
  writeFileSync(target, JSON.stringify(schedule))

  const teams = new Map<string, number>()
  for (const g of games) for (const t of [g.away, g.home]) teams.set(t, (teams.get(t) ?? 0) + 1)
  const tbd = Object.values(unscheduled).reduce((a, b) => a + b, 0)
  console.log(`Schedule ${schedule.season} (as of ${asOf ?? 'unknown'}): ${games.length} games, ${teams.size} teams, ${games.filter((g) => g.cup).length} NBA Cup group games`)
  console.log(`Games per team: ${Math.min(...teams.values())}–${Math.max(...teams.values())}; still unscheduled: ${tbd / 2} games${tbdWindow ? ` (no games listed ${tbdWindow.start} → ${tbdWindow.end})` : ''}`)
  for (const w of warnings.slice(0, 20)) console.warn(`! ${w}`)
  if (warnings.length) console.warn(`${warnings.length} row(s) could not be read`)
  console.log(`Wrote ${target}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
