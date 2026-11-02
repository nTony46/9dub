import { navigate, useRoute } from '@/app/router'
import { Segmented } from '@/components/ui/Controls'
import { cn } from '@/lib/cn'
import { useWirePlacement } from './model'
import { MatchupsView } from './MatchupsView'
import { RosterLab } from './RosterLab'
import { RostersView } from './RostersView'

type Tab = 'matchups' | 'rosters' | 'lab'

export function SeasonPage() {
  const { sub } = useRoute()
  const tab: Tab = sub === 'rosters' || sub === 'lab' ? sub : 'matchups'
  // A docked waiver wire takes its own column, so the page widens to use a wide window.
  const placement = useWirePlacement()
  const width = tab === 'matchups' && placement === 'dock' ? 'max-w-[2240px]' : 'max-w-[1240px]'
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-seam bg-floor">
        <div className={cn('mx-auto flex flex-wrap items-center gap-3 px-5 py-3.5', width)}>
          <h1 className="font-display text-[24px] font-semibold tracking-tight">Season</h1>
          <Segmented<Tab>
            label="Season view"
            value={tab}
            onChange={(v) => navigate('season', v)}
            options={[
              { value: 'matchups', label: 'Matchups' },
              { value: 'rosters', label: 'Rosters' },
              { value: 'lab', label: 'Roster Lab' },
            ]}
          />
        </div>
      </div>
      <div className={cn('mx-auto px-5 py-4', width)}>{tab === 'matchups' ? <MatchupsView /> : tab === 'rosters' ? <RostersView /> : <RosterLab />}</div>
    </div>
  )
}
