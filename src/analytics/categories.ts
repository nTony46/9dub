/**
 * The nine head-to-head categories. Order here is the canonical display order.
 * FG and FT are percentage categories valued through *volume-weighted impact*,
 * never through raw percentages (see docs/SCORING_METHOD.md).
 */
export const CATEGORIES = ['FG', 'FT', '3PM', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO'] as const
export type Category = (typeof CATEGORIES)[number]

export interface CategoryMeta {
  key: Category
  /** Short label used in dense tables. */
  label: string
  /** Long, plain-language label. */
  name: string
  kind: 'pct' | 'count'
  /** False only for turnovers. Z-scores are already direction-corrected. */
  higherIsBetter: boolean
}

export const CATEGORY_META: Record<Category, CategoryMeta> = {
  FG: { key: 'FG', label: 'FG%', name: 'Field goal %', kind: 'pct', higherIsBetter: true },
  FT: { key: 'FT', label: 'FT%', name: 'Free throw %', kind: 'pct', higherIsBetter: true },
  '3PM': { key: '3PM', label: '3PM', name: 'Threes made', kind: 'count', higherIsBetter: true },
  PTS: { key: 'PTS', label: 'PTS', name: 'Points', kind: 'count', higherIsBetter: true },
  REB: { key: 'REB', label: 'REB', name: 'Rebounds', kind: 'count', higherIsBetter: true },
  AST: { key: 'AST', label: 'AST', name: 'Assists', kind: 'count', higherIsBetter: true },
  STL: { key: 'STL', label: 'STL', name: 'Steals', kind: 'count', higherIsBetter: true },
  BLK: { key: 'BLK', label: 'BLK', name: 'Blocks', kind: 'count', higherIsBetter: true },
  TO: { key: 'TO', label: 'TO', name: 'Turnovers', kind: 'count', higherIsBetter: false },
}

export type CatRecord<T> = Record<Category, T>

export function catRecord<T>(fn: (c: Category) => T): CatRecord<T> {
  const out = {} as CatRecord<T>
  for (const c of CATEGORIES) out[c] = fn(c)
  return out
}

export function catLabel(c: Category): string {
  return CATEGORY_META[c].label
}
