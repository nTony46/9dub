/** The NBA season under way (or next up) on a date: "2026-27" from August 2026 through July 2027. */
export function currentSeason(now: Date = new Date()): string {
  const y = now.getFullYear()
  const start = now.getMonth() >= 7 ? y : y - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

/** "2026-27" → "2026–27" (for reading). */
export const seasonText = (label: string): string => label.replace('-', '–')

/** The season before: "2026-27" → "2025-26". */
export function previousSeason(label: string): string {
  const start = Number(label.slice(0, 4)) - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

/** The row label ESPN prints over a season's projection: "2026-27" → "2027 PROJECTIONS". */
export const espnProjectionLabel = (label: string): string => `${Number(label.slice(0, 4)) + 1} PROJECTIONS`
