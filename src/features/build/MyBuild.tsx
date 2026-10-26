import { useMemo } from 'react'
import { catRecord } from '@/analytics/categories'
import { fillLineup } from '@/analytics/positions'
import { categoryReadout } from '@/analytics/readout'
import { stageConfidence } from '@/analytics/team'
import { draftWithToast } from '@/app/actions'
import { Panel } from '@/components/ui/Panel'
import { useApp } from '@/store/appStore'
import { benchmarkOf, teamLabel, useDraft, useEngine, useLineupSlots, useLive } from '@/store/derived'
import { LiveBar } from '@/features/draft/LiveBar'
import { BuildLab } from './BuildLab'
import { CategoryStanding, ShootingImpact } from './CategoryStanding'
import { HeadToHead } from './HeadToHead'
import { RecLanes } from './RecLanes'
import { TeamSnapshot } from './TeamSnapshot'
import { WhatIf } from './WhatIf'

export function MyBuild() {
  const engine = useEngine()
  const live = useLive()
  const d = useDraft()
  const settings = useApp((s) => s.settings)
  const slots = useLineupSlots()
  const lock = useApp((s) => s.buildLock)
  const setBuildLock = useApp((s) => s.setBuildLock)

  // After the draft there are no build simulations; the readout falls back to margins alone (as on League Overview).
  const readout = useMemo(
    () =>
      live && engine
        ? categoryReadout(live.my.zSlot, benchmarkOf(live.opponents, live.typicalNow), engine.scale.sigma, live.my.count, live.postDraft ? undefined : live.builds, live.postDraft)
        : null,
    [live, engine],
  )
  const ranks = useMemo(() => {
    if (!live) return null
    return catRecord((c) => 1 + live.opponents.filter((o) => o[c] > live.my.zSlot[c] + 1e-9).length)
  }, [live])
  const exclude = useMemo(() => new Set(d.draftedBy.keys()), [d])

  if (!engine || !live || !readout) return <div className="p-8 text-chalk-3">No dataset loaded.</div>
  const lineup = fillLineup(
    live.my.playerIds.map((id) => ({ id, positions: engine.byId.get(id)?.positions ?? [] })),
    slots,
  )
  const post = live.postDraft
  const myIr = live.myTeam != null ? live.ir[live.myTeam] : []

  return (
    <div className="flex h-full flex-col">
      <LiveBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-[1500px] grid-cols-1 gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <Panel
              title={live.myTeam != null ? `Category standing · ${teamLabel(settings, live.myTeam)}` : 'Category standing'}
              subtitle={
                live.myTeam == null
                  ? 'Set your draft slot to analyse your roster.'
                  : post
                    ? undefined
                    : `${live.my.count} of ${settings.rounds} rostered · confidence ${stageConfidence(live.my.count, settings.rounds)}`
              }
            >
              <CategoryStanding
                profile={live.my}
                readout={readout}
                ranks={ranks ?? undefined}
                teamsCount={live.opponents.length + 1}
                benchmarkLabel="league average"
                dim={lock?.mode === 'hard' ? lock.punts : undefined}
              />
            </Panel>
            <div className="grid grid-cols-1 gap-3">
              <Panel title={post ? 'Roster & lineup' : 'Roster & open slots'}>
                <TeamSnapshot profile={live.my} readout={readout} engine={engine} confidence={stageConfidence(live.my.count, settings.rounds)} unvalued={live.myTeam != null ? live.unvalued[live.myTeam] : []} />
                {live.my.count ? (
                  <div className="mt-3 border-t border-seam pt-2">
                    <div className="mb-1.5 label-caps">Lineup</div>
                    <div className="grid grid-cols-2 gap-x-4 text-[13px]">
                      {slots.map((s, i) => (
                        <div key={s.id} className="flex h-7 items-center gap-2">
                          <span className="w-9 font-display font-semibold text-chalk-3">{s.label}</span>
                          <span className={lineup.assignment[i] ? 'truncate text-chalk-2' : 'text-chalk-4'}>
                            {lineup.assignment[i] ? engine.byId.get(lineup.assignment[i]!)?.name : 'open'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {myIr.length ? (
                  <div className="mt-2 border-t border-seam pt-2">
                    {myIr.map((id) => (
                      <div key={id} className="flex h-7 items-center gap-2 text-[13px]">
                        <span className="w-9 font-display font-semibold text-bad">IR</span>
                        <span className="truncate text-chalk-3">{engine.byId.get(id)?.name ?? id}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </Panel>
              {post ? null : (
                <Panel title="Shooting efficiency & volume">
                  <ShootingImpact profile={live.my} engine={engine} />
                </Panel>
              )}
            </div>
            {post ? null : (
              <Panel title="What if I take…">
                <WhatIf engine={engine} ctx={engine.ctx} roster={live.my.playerIds} utility={live.utility} exclude={exclude} rankLabel="league rank" />
              </Panel>
            )}
          </div>
          {post ? (
            <div className="flex min-w-0 flex-col gap-3">
              {live.myTeam != null ? (
                <Panel title="Head-to-head by category">
                  <HeadToHead profiles={live.profiles} me={live.myTeam} engine={engine} />
                </Panel>
              ) : null}
              <Panel title="Shooting efficiency & volume">
                <ShootingImpact profile={live.my} engine={engine} />
              </Panel>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-3">
              <Panel title="Build lab">
                <BuildLab builds={live.builds} engine={engine} lock={lock} onLock={setBuildLock} assumedSlot={live.buildsAssumedSlot} picksMade={live.my.count} />
              </Panel>
              <div>
                <RecLanes rec={live.rec} engine={engine} timing={live.timing} canDraft={d.isUserOnClock} onDraft={(id) => void draftWithToast(id)} showMode={false} />
                {lock ? <p className="mt-1.5 px-1 text-[12px] text-chalk-3">Fit reflects your locked build; player value is unchanged.</p> : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
