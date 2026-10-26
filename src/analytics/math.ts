/** Small, dependency-free numeric helpers used by the engine. All pure. */

export function sum(xs: readonly number[]): number {
  let s = 0
  for (const x of xs) s += x
  return s
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : sum(xs) / xs.length
}

/**
 * Population standard deviation (divide by n). The reference pool *is* the
 * population we normalise against, so n (not n-1) is the stated convention.
 */
export function populationSd(xs: readonly number[]): number {
  if (xs.length === 0) return 0
  const m = mean(xs)
  let ss = 0
  for (const x of xs) ss += (x - m) * (x - m)
  return Math.sqrt(ss / xs.length)
}

export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length)
  if (n < 3) return 0
  const ma = mean(a.slice(0, n))
  const mb = mean(b.slice(0, n))
  let num = 0
  let da = 0
  let db = 0
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb)
    da += (a[i] - ma) ** 2
    db += (b[i] - mb) ** 2
  }
  return da === 0 || db === 0 ? 0 : num / Math.sqrt(da * db)
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

export function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

/**
 * Standard normal CDF via the Abramowitz–Stegun 7.1.26 erf approximation
 * (max abs error ~1.5e-7). Used only as a smooth, saturating utility curve
 * for diminishing returns — never displayed as a probability.
 */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * z)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z)
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y)
}

export function round(x: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(x * f) / f
}
