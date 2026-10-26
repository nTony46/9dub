/**
 * Node-only PDF text extraction (pdfjs-dist). Returns the embedded text layer
 * with positions; no OCR. Pages whose text layer is empty are reported so the
 * caller can flag them instead of guessing.
 */
import { readFileSync } from 'node:fs'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PdfItem, PdfPage } from '../../../src/data/ingest/pdfLines'

interface TextItemLike {
  str: string
  transform: number[]
  width: number
}

export async function readPdf(path: string): Promise<PdfPage[]> {
  const data = new Uint8Array(readFileSync(path))
  const task = getDocument({ data, verbosity: 0, useSystemFonts: false })
  const doc = await task.promise
  const pages: PdfPage[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const vp = page.getViewport({ scale: 1 })
    const tc = await page.getTextContent()
    const items: PdfItem[] = []
    for (const raw of tc.items as unknown[]) {
      const it = raw as Partial<TextItemLike>
      if (typeof it.str !== 'string' || !it.transform) continue
      items.push({ s: it.str, x: +it.transform[4].toFixed(2), y: +(vp.height - it.transform[5]).toFixed(2), w: +(it.width ?? 0).toFixed(2) })
    }
    pages.push({ page: p, width: vp.width, height: vp.height, items })
    page.cleanup()
  }
  await task.destroy()
  return pages
}
