import { navigate, useRoute } from '@/app/router'
import { Segmented } from '@/components/ui/Controls'
import { MatchupsView } from './MatchupsView'
import { RostersView } from './RostersView'

type Tab = 'matchups' | 'rosters'

export function SeasonPage() {
  const { sub } = useRoute()
  const tab: Tab = sub === 'rosters' ? 'rosters' : 'matchups'
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-seam bg-floor">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-3 px-5 py-3.5">
          <h1 className="font-display text-[24px] font-semibold tracking-tight">Season</h1>
          <Segmented<Tab>
            label="Season view"
            value={tab}
            onChange={(v) => navigate('season', v)}
            options={[
              { value: 'matchups', label: 'Matchups' },
              { value: 'rosters', label: 'Rosters' },
            ]}
          />
        </div>
      </div>
      <div className="mx-auto max-w-[1240px] px-5 py-4">{tab === 'matchups' ? <MatchupsView /> : <RostersView />}</div>
    </div>
  )
}
