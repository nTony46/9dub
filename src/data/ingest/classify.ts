import type { PdfPage } from './pdfLines'
import type { SourceRole } from './types'

/** Identify a PDF by what is printed on its first page — never by file name. */
export function classifyPdf(pages: readonly PdfPage[]): SourceRole {
  const text = (pages[0]?.items ?? []).map((i) => i.s).join(' ')
  if (/Live Draft Trends/.test(text) && /AVG PICK/.test(text)) return 'espn-live-draft'
  if (/Complete \d{4} Projections/.test(text) || (/Ranking & Projections/.test(text) && /PROJECTIONS/.test(text))) return 'espn-projections'
  if (/nbafantasyedge\.com/i.test(text) || (/Fantasy Basketball Rankings/.test(text) && /VALUE/.test(text))) return 'fantasyedge-pdf'
  return 'unknown'
}

/** Identify a CSV by its header row. */
export function classifyCsv(headers: readonly string[]): SourceRole {
  const h = headers.map((x) => x.trim().toUpperCase())
  const has = (...xs: string[]) => xs.every((x) => h.includes(x))
  if (has('9CAT_SOURCEVALUE') || has('FGM_FTM_DERIVATION')) return 'derived-9dub'
  if (has('PLAYER NAME', 'STD.DEV')) return 'fantasypros-ecr'
  if (has('PLAYER', 'YAHOO', 'ESPN', 'AVG')) return 'fantasypros-adp'
  if (has('#', 'PLAYER', 'PTS', 'FG%', 'FT%', 'TO', 'VALUE')) return 'fantasyedge-csv'
  return 'unknown'
}
