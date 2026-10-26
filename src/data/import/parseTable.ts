import Papa from 'papaparse'
import { normHeader } from './fields'

export interface ParsedTable {
  headers: string[]
  rows: string[][]
  delimiter: string
  /** Detected source layout, used to pre-fill mapping and labels. */
  preset: PresetId
  notes: string[]
}

export type PresetId = 'generic' | 'hashtag-projections' | 'hashtag-adp' | 'fantasypros' | 'bbref'

export const PRESET_LABEL: Record<PresetId, string> = {
  generic: 'Generic table',
  'hashtag-projections': 'Hashtag Basketball projections (pasted)',
  'hashtag-adp': 'Hashtag Basketball ADP (pasted)',
  fantasypros: 'FantasyPros projections (season totals)',
  bbref: 'Basketball-Reference per-game table',
}

/**
 * Some sites render "0.573" and "(10.5/18.3)" as separate inline blocks; a
 * browser copy can put a line break between them. Re-join those fragments.
 */
function rejoinComboBreaks(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]*(\(\s*[0-9.]+\s*\/\s*[0-9.]+\s*\))/g, ' $1')
}

function looksLikeHeader(row: string[]): boolean {
  const n = row.map(normHeader)
  return n.some((h) => h === 'player' || h === 'name' || h === 'playername') && n.filter(Boolean).length >= 2
}

/** Parse pasted text or CSV/TSV file content into headers + rows. */
export function parseTableText(input: string): ParsedTable {
  const text = rejoinComboBreaks(input).trim()
  const notes: string[] = []
  const res = Papa.parse<string[]>(text, { delimiter: '', skipEmptyLines: 'greedy' })
  let data = (res.data as string[][]).map((r) => r.map((c) => (c ?? '').trim()))
  const delimiter = res.meta.delimiter
  // Drop leading/trailing empty columns produced by "| a | b |" markdown-ish pipes.
  if (data.length && data.every((r) => r[0] === '')) data = data.map((r) => r.slice(1))
  if (data.length && data.every((r) => r[r.length - 1] === '')) data = data.map((r) => r.slice(0, -1))

  let hi = data.findIndex(looksLikeHeader)
  if (hi < 0) hi = 0
  let headers = data[hi] ?? []
  let body = data.slice(hi + 1)
  let preset: PresetId = 'generic'
  const nh = headers.map(normHeader)

  // Hashtag ADP: two-row header (platform names, then POS/ADP/ORDER).
  if (nh.includes('yahoo') && nh.includes('espn') && nh.some((h) => h.startsWith('blend'))) {
    const sub = body[0] ?? []
    if (sub.map(normHeader).includes('adp')) body = body.slice(1)
    headers = ['NAME', 'TEAM', 'YAHOO POS', 'YAHOO ADP', 'YAHOO ORDER', 'ESPN POS', 'ESPN ADP', 'ESPN ORDER', 'FANTRAX POS', 'FANTRAX ADP', 'FANTRAX ORDER', 'BLEND ADP', 'BLEND ORDER']
    preset = 'hashtag-adp'
    notes.push('Detected a two-row ADP header; ESPN ADP and blended ADP are kept as separate fields.')
  } else if (nh.includes('r#') && nh.includes('treb') && nh.includes('total')) {
    preset = 'hashtag-projections'
    notes.push("Detected Hashtag-style projections. FG%/FT% cells include makes/attempts. The site's TOTAL column is kept as raw source data only.")
  } else if (nh.includes('player') && nh.includes('fg%') && !nh.includes('fga') && body.some((r) => /\([A-Z]{2,4}\s*-\s*[A-Z/,]+\)/.test(r[nh.indexOf('player')] ?? ''))) {
    preset = 'fantasypros'
    notes.push('Detected FantasyPros-style rows: season totals without FGA/FTA (shooting volume will be missing).')
  } else if (nh.includes('player') && nh.includes('fga') && nh.includes('trb') && nh.includes('tov')) {
    preset = 'bbref'
    notes.push('Detected a Basketball-Reference-style table. Those are usually ACTUAL stats — label the season accordingly.')
  }

  // Remove repeated header rows inside long tables.
  const headerKey = headers.map(normHeader).join('|')
  const before = body.length
  body = body.filter((r) => r.map(normHeader).join('|') !== headerKey && !looksLikeHeader(r))
  if (body.length < before) notes.push(`Skipped ${before - body.length} repeated header row(s).`)

  return { headers, rows: body, delimiter, preset, notes }
}
