import { logistic } from './math'

/**
 * Pick-timing heuristics from a single ADP point estimate.
 *
 * With only one ADP number we cannot compute a real survival probability
 * (that needs a pick distribution or draft history). We therefore produce an
 * *urgency index* in [0, 1] and expose only coarse labels to the UI:
 *
 *   urgency = logistic((targetPick − ADP) / spread),  spread = 2 + 0.08 · ADP
 *
 * The spread widens later in drafts where ADP is noisier. The number is used
 * internally for ordering; the UI shows "likely gone / at risk / likely there".
 */
export type RiskLabel = 'likely-gone' | 'at-risk' | 'likely-there'

export function adpSpread(adp: number): number {
  return 2 + 0.08 * adp
}

export function goneByPickUrgency(adp: number | null | undefined, targetPick: number | null | undefined): number | null {
  if (adp == null || targetPick == null || !Number.isFinite(adp)) return null
  return logistic((targetPick - adp) / adpSpread(adp))
}

export function riskLabel(u: number | null): RiskLabel | null {
  if (u == null) return null
  if (u >= 0.7) return 'likely-gone'
  if (u >= 0.4) return 'at-risk'
  return 'likely-there'
}

export const RISK_TEXT: Record<RiskLabel, string> = {
  'likely-gone': 'Likely gone',
  'at-risk': 'At risk',
  'likely-there': 'Likely there',
}

/** Positive = player is still available past his ADP (potential value). */
export function adpGap(adp: number | null | undefined, currentPick: number): number | null {
  return adp == null ? null : currentPick - adp
}
