import type { BroadcastWave } from '@/app/navigation'
import type { GuideGenreVisibility } from '../GuideGridRenderer'
import type { GuideQuery } from '../guideRequests'
import type { useGuideDialogState } from '../hooks/useGuideDialogState'
import { formatGuideRouteDay, type GuideDateOption } from '../lib/guideDate'
import { GuideDaySelectDialog } from './GuideDaySelectDialog'
import { GuideGenreSettingDialog } from './GuideGenreSettingDialog'
import { GuideTimeSelectorMenu } from './GuideTimeSelectorMenu'

export interface GuideNavigationOverlaysProps {
  dialogs: ReturnType<typeof useGuideDialogState>
  guideQuery: GuideQuery
  dateOptions: readonly GuideDateOption[]
  enabledBroadcastWaves: readonly BroadcastWave[]
  showBroadcastSelect: boolean
  genreVisibility: GuideGenreVisibility
  onNavigateToTime: (time: number, type?: BroadcastWave) => void
  onSaveGenreVisibility: (visibility: GuideGenreVisibility) => void
}

/** Day selector, time selector, and genre visibility overlays of the Guide title bar. */
export function GuideNavigationOverlays({
  dialogs,
  guideQuery,
  dateOptions,
  enabledBroadcastWaves,
  showBroadcastSelect,
  genreVisibility,
  onNavigateToTime,
  onSaveGenreVisibility,
}: GuideNavigationOverlaysProps) {
  return (
    <>
      <GuideDaySelectDialog
        open={dialogs.dayDialogOpen}
        options={dateOptions}
        selectedRouteDay={formatGuideRouteDay(guideQuery.startAt)}
        onClose={() => dialogs.setDayDialogOpen(false)}
        onSelect={(time) => {
          dialogs.setDayDialogOpen(false)
          onNavigateToTime(time)
        }}
      />
      <GuideTimeSelectorMenu
        key={
          dialogs.timeMenuAnchor !== null
            ? `time-open-${guideQuery.startAt}-${guideQuery.type ?? 'all'}`
            : 'time-closed'
        }
        anchorEl={dialogs.timeMenuAnchor}
        open={dialogs.timeMenuAnchor !== null}
        options={dateOptions}
        currentStartAt={guideQuery.startAt}
        currentType={guideQuery.type}
        enabledBroadcastWaves={enabledBroadcastWaves}
        showBroadcastSelect={showBroadcastSelect}
        onClose={() => dialogs.setTimeMenuAnchor(null)}
        onDisplay={(time, type) => {
          dialogs.setTimeMenuAnchor(null)
          onNavigateToTime(time, type)
        }}
      />
      <GuideGenreSettingDialog
        key={
          dialogs.genreDialogOpen ? `genre-open-${JSON.stringify(genreVisibility)}` : 'genre-closed'
        }
        open={dialogs.genreDialogOpen}
        visibility={genreVisibility}
        onClose={() => dialogs.setGenreDialogOpen(false)}
        onSave={onSaveGenreVisibility}
      />
    </>
  )
}
