import type { RecommendResult } from '@/analytics/recommend'
import type { DraftDerived } from '@/store/draftLogic'
import type { LeagueSettings } from '@/store/schema'
import { teamLabel, type EngineData } from '@/store/derived'
import type { PlayerRow } from './PlayerTable'

/** Assemble table rows from engine + draft state. Pure; memoize at the call site. */
export function buildRows(
  engine: EngineData,
  opts: {
    d?: DraftDerived
    settings: LeagueSettings
    uncertain?: Set<string>
    rec?: RecommendResult | null
    shortlist: string[]
    roster?: Set<string>
  },
): PlayerRow[] {
  const star = new Set(opts.shortlist)
  const decisionRank = new Map<string, number>()
  opts.rec?.bestDecision.forEach((s, i) => decisionRank.set(s.id, i + 1))
  const current = opts.d?.currentPick ?? null
  return engine.players.map((info) => {
    const pick = opts.d?.draftedBy.get(info.id)
    const status: PlayerRow['status'] = opts.roster?.has(info.id)
      ? 'rostered'
      : pick
        ? 'drafted'
        : opts.uncertain?.has(info.id)
          ? 'uncertain'
          : 'available'
    return {
      id: info.id,
      info,
      v: engine.valuation.values.get(info.id) ?? null,
      status,
      draftedLabel: status === 'rostered' ? 'on this team' : pick ? `${teamLabel(opts.settings, pick.teamIndex)} #${pick.overall}` : undefined,
      score: opts.rec?.scores.get(info.id),
      decisionRank: decisionRank.get(info.id),
      adpGap: current != null && info.adp != null && !pick ? current - info.adp : null,
      starred: star.has(info.id),
    }
  })
}
