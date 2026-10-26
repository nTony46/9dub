/**
 * Diverging fill for category strength: blue (+) ↔ red (−) with a neutral
 * gray midpoint, mixed in OKLab against the surface so ink text on top stays
 * legible. Color always accompanies a number or label — never alone.
 */
export function divergingFill(value: number | null | undefined, scale = 2, max = 0.62): string {
  if (value == null || !Number.isFinite(value)) return 'transparent'
  const t = Math.max(-1, Math.min(1, value / scale))
  const a = Math.round(Math.pow(Math.abs(t), 0.85) * max * 100)
  if (a < 4) return 'var(--mid)'
  const pole = t > 0 ? 'var(--plus)' : 'var(--minus)'
  return `color-mix(in oklab, ${pole} ${a}%, var(--mid))`
}

/** Ink colour for a signed value (used sparingly for deltas next to numbers). */
export function signClass(x: number | null | undefined, eps = 0.05): string {
  if (x == null || Math.abs(x) < eps) return 'text-chalk-3'
  return x > 0 ? 'text-plus' : 'text-minus'
}
