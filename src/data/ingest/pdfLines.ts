/**
 * Positioned PDF text → lines and cells. The PDF reader itself (pdfjs) runs
 * only in the Node ingest script; everything here is pure so the source
 * parsers can be unit-tested with small synthetic layouts.
 */

/** One text run as reported by the PDF text layer. `y` grows downwards (top of page = 0). */
export interface PdfItem {
  s: string
  x: number
  y: number
  /** Advance width of the run. */
  w: number
}

export interface PdfPage {
  page: number
  width: number
  height: number
  items: PdfItem[]
}

/** A cell is one or more touching runs merged into a single string. */
export interface PdfCell {
  s: string
  x: number
  /** Right edge. */
  r: number
}

export interface PdfLine {
  page: number
  y: number
  cells: PdfCell[]
}

/**
 * Runs closer than this (in PDF points) are glued without a space. Accented
 * letters are often emitted as separate runs ("Joki" + "ć"); real column gaps
 * are tens of points.
 */
const GLUE_GAP = 1.2
/** A word space is ~2–3pt at these font sizes. */
const WORD_GAP = 3.5
const NON_ASCII_LETTER = /[\u00C0-\u024F]/

export function toLines(page: PdfPage, yTolerance = 2): PdfLine[] {
  // Whitespace-only runs are dropped: their advance widths can bridge whole columns.
  const items = page.items.filter((i) => i.s.trim() !== '').sort((a, b) => a.y - b.y || a.x - b.x)
  const groups: { y: number; items: PdfItem[] }[] = []
  for (const it of items) {
    const g = groups.find((l) => Math.abs(l.y - it.y) < yTolerance)
    if (g) g.items.push(it)
    else groups.push({ y: it.y, items: [it] })
  }
  return groups
    .sort((a, b) => a.y - b.y)
    .map((g) => ({ page: page.page, y: g.y, cells: mergeRuns(g.items) }))
}

export function mergeRuns(runs: readonly PdfItem[]): PdfCell[] {
  const sorted = [...runs].sort((a, b) => a.x - b.x)
  const cells: PdfCell[] = []
  for (const it of sorted) {
    const prev = cells[cells.length - 1]
    const gap = prev ? it.x - prev.r : Infinity
    // Touching runs glue; clearly overlapping runs (e.g. a sticky site header printed over a row) stay separate.
    if (prev && gap > -0.75 && gap < GLUE_GAP) {
      prev.s += it.s
      prev.r = Math.max(prev.r, it.x + it.w)
    } else if (prev && gap >= GLUE_GAP && gap < WORD_GAP && (NON_ASCII_LETTER.test(it.s[0]) || NON_ASCII_LETTER.test(prev.s[prev.s.length - 1]))) {
      // Glyphs outside the main font are emitted as their own runs; "Alperen" ␣ "Ş" "engün" is one word pair.
      prev.s += ` ${it.s}`
      prev.r = Math.max(prev.r, it.x + it.w)
    } else cells.push({ s: it.s, x: it.x, r: it.x + it.w })
  }
  for (const c of cells) c.s = c.s.replace(/\s+/g, ' ').trim()
  return cells.filter((c) => c.s !== '')
}

export const center = (c: PdfCell) => (c.x + c.r) / 2

/** All lines of a document in reading order, with a running index. */
export function documentLines(pages: readonly PdfPage[]): PdfLine[] {
  return pages.flatMap((p) => toLines(p))
}

export type CellAnchor = 'center' | 'right'
const anchorOf = (c: PdfCell, a: CellAnchor) => (a === 'right' ? c.r : center(c))

/** Header cells → column anchors (right edges suit right-aligned numeric tables). */
export function columnsFromHeader<K extends string>(
  header: readonly PdfCell[],
  keyOf: (label: string, index: number) => K | null,
  anchor: CellAnchor,
): { key: K; pos: number }[] {
  const out: { key: K; pos: number }[] = []
  header.forEach((c, i) => {
    const k = keyOf(c.s, i)
    if (k != null) out.push({ key: k, pos: anchorOf(c, anchor) })
  })
  return out
}

/**
 * Assign cells to the nearest column anchor. A cell further than `maxDistance`
 * from every anchor, or landing on an already-filled column, is returned as
 * `stray` so the caller can flag the row instead of guessing.
 */
export function assignToColumns<K extends string>(
  cells: readonly PdfCell[],
  columns: readonly { key: K; pos: number }[],
  maxDistance: number,
  anchor: CellAnchor,
): { values: Partial<Record<K, string>>; stray: PdfCell[] } {
  const values: Partial<Record<K, string>> = {}
  const stray: PdfCell[] = []
  for (const c of cells) {
    let best: { key: K; d: number } | null = null
    for (const col of columns) {
      const d = Math.abs(anchorOf(c, anchor) - col.pos)
      if (!best || d < best.d) best = { key: col.key, d }
    }
    if (!best || best.d > maxDistance || values[best.key] != null) stray.push(c)
    else values[best.key] = c.s
  }
  return { values, stray }
}

/** "10/17/26, 10:21 PM" (browser print header) → ISO local datetime "2026-10-17T22:21". */
export function parsePrintTimestamp(s: string): string | null {
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*([AP]M)?/i)
  if (!m) return null
  const [, mo, d, yRaw, hRaw, mi, ampm] = m
  const y = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw)
  let h = Number(hRaw)
  if (ampm) {
    const pm = ampm.toUpperCase() === 'PM'
    if (pm && h < 12) h += 12
    if (!pm && h === 12) h = 0
  }
  const pad = (n: number | string) => String(n).padStart(2, '0')
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${mi}`
}
