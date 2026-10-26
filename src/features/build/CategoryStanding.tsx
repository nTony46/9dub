import { CATEGORIES, CATEGORY_META, type CatRecord, type Category } from '@/analytics/categories'
import { STANDING_TEXT, type CategoryReadout } from '@/analytics/readout'
import type { TeamProfile } from '@/analytics/team'
import { CategoryBars } from '@/components/CategoryBars'
import { cn } from '@/lib/cn'
import { num, pct, signed } from '@/lib/format'
import type { EngineData } from '@/store/derived'

const INTERPRET: Record<string, (c: Category) => string> = {
  strength: (c) => `You are well ahead in ${CATEGORY_META[c].label}; extra ${CATEGORY_META[c].label} has diminishing value.`,
  solid: (c) => `Ahead in ${CATEGORY_META[c].label} — keep it from slipping.`,
  neutral: (c) => `${CATEGORY_META[c].label} is contested; targeted gains here are valuable.`,
  recoverable: (c) => `Behind in ${CATEGORY_META[c].label}, but within reach — not a punt yet.`,
  'punt-candidate': (c) =>
    `Far behind in ${CATEGORY_META[c].label}: either a top build punts it or your roster construction has effectively sacrificed it. Consider punting — nothing is locked.`,
}

/** Diverging category bars: slot-adjusted standing vs. a benchmark, with full detail on hover. */
export function CategoryStanding({
  profile,
  readout,
  ranks,
  teamsCount,
  benchmarkLabel,
  dim,
}: {
  profile: TeamProfile
  readout: CategoryReadout
  ranks?: CatRecord<number>
  teamsCount?: number
  benchmarkLabel: string
  dim?: Category[]
}) {
  const t = profile.totals
  const raw = (c: Category) =>
    c === 'FG'
      ? `${pct(t.fgPct)} (${num(t.fgm)}/${num(t.fga)} per game)`
      : c === 'FT'
        ? `${pct(t.ftPct)} (${num(t.ftm)}/${num(t.fta)} per game)`
        : `${num({ '3PM': t.tpm, PTS: t.pts, REB: t.reb, AST: t.ast, STL: t.stl, BLK: t.blk, TO: t.tov }[c as Exclude<Category, 'FG' | 'FT'>], 1)} per game`
  return (
    <div data-testid="category-standing">
      <CategoryBars
        values={readout.margin}
        scale={1.5}
        dim={dim}
        tooltip={(c) => (
          <div className="space-y-0.5">
            <div className="font-medium text-chalk">{CATEGORY_META[c].name}</div>
            <div>Rostered production: {raw(c)}</div>
            {c === 'FG' && t.fgMissing ? <div className="text-warn">{t.fgMissing} player(s) lack FG attempts — excluded from FG%.</div> : null}
            {c === 'FT' && t.ftMissing ? <div className="text-warn">{t.ftMissing} player(s) lack FT attempts — excluded from FT%.</div> : null}
            <div>
              Category score {signed(profile.zSum[c], 2)} z (slot-adjusted {signed(profile.zSlot[c], 2)})
            </div>
            <div>
              vs {benchmarkLabel}: {signed(readout.margin[c], 2)} σ{ranks ? ` · rank ${ranks[c]} of ${teamsCount}` : ''}
            </div>
            <div className="pt-1 text-chalk-2">{INTERPRET[readout.standing[c]](c)}</div>
          </div>
        )}
        annotations={(c) => (
          <span className="inline-flex items-center gap-1.5">
            {ranks ? <span className="font-mono tnum text-chalk-2">#{ranks[c]}</span> : null}
            <span
              className={cn(
                'w-[128px] whitespace-nowrap text-left',
                readout.standing[c] === 'strength' || readout.standing[c] === 'solid'
                  ? 'text-plus'
                  : readout.standing[c] === 'punt-candidate'
                    ? 'text-warn'
                    : readout.standing[c] === 'recoverable'
                      ? 'text-minus'
                      : 'text-chalk-3',
              )}
            >
              {STANDING_TEXT[readout.standing[c]]}
            </span>
          </span>
        )}
      />
    </div>
  )
}

/** Each rostered player's effect on team FG% / FT%, including volume. */
export function ShootingImpact({ profile, engine }: { profile: TeamProfile; engine: EngineData }) {
  const params = engine.valuation.params
  const rows = profile.playerIds.map((id) => {
    const info = engine.byId.get(id)!
    const v = engine.valuation.values.get(id)!
    return { id, name: info.name, info, fg: v.raw.FG, ft: v.raw.FT }
  })
  if (!rows.length) return <p className="text-[12px] text-chalk-3">No players yet.</p>
  const tot = profile.totals
  return (
    <div>
      <table className="w-full whitespace-nowrap text-[13px]">
        <thead>
          <tr className="text-[12px] text-chalk-3">
            <th className="h-7 text-left font-medium">Player</th>
            <th className="text-right font-medium">FG% · FGA</th>
            <th className="text-right font-medium" title={`Makes above ${pct(params.fgBaseline)} baseline × attempts`}>
              FG impact
            </th>
            <th className="text-right font-medium">FT% · FTA</th>
            <th className="text-right font-medium" title={`Makes above ${pct(params.ftBaseline)} baseline × attempts`}>
              FT impact
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-seam">
              <td className="h-6 max-w-[150px] truncate">{r.name}</td>
              <td className="text-right font-mono tnum text-chalk-2">
                {pct(r.info.fgPct)} · {num(r.info.line?.fga ?? null)}
                {r.info.volume?.fg === 'estimated' || r.info.volume?.fg === 'cross-source' ? <span className="text-warn">*</span> : null}
              </td>
              <td className={cn('text-right font-mono tnum', r.fg == null ? 'text-warn' : r.fg >= 0 ? 'text-plus' : 'text-minus')}>{r.fg == null ? 'n/a' : signed(r.fg, 2)}</td>
              <td className="text-right font-mono tnum text-chalk-2">
                {pct(r.info.ftPct)} · {num(r.info.line?.fta ?? null)}
                {r.info.volume?.ft === 'estimated' || r.info.volume?.ft === 'cross-source' ? <span className="text-warn">*</span> : null}
              </td>
              <td className={cn('text-right font-mono tnum', r.ft == null ? 'text-warn' : r.ft >= 0 ? 'text-plus' : 'text-minus')}>{r.ft == null ? 'n/a' : signed(r.ft, 2)}</td>
            </tr>
          ))}
          <tr className="border-t border-seam-strong font-semibold">
            <td className="h-7">Team</td>
            <td className="text-right font-mono tnum">
              {pct(tot.fgPct)} · {num(tot.fga)}
            </td>
            <td className="text-right font-mono tnum">{signed(rows.reduce((s, r) => s + (r.fg ?? 0), 0), 2)}</td>
            <td className="text-right font-mono tnum">
              {pct(tot.ftPct)} · {num(tot.fta)}
            </td>
            <td className="text-right font-mono tnum">{signed(rows.reduce((s, r) => s + (r.ft ?? 0), 0), 2)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export const ALL_CATS = CATEGORIES
