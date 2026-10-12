import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SHELL_NAVIGATION_DRAWER_ID, type ShellSnackbarState } from '@/app/AppShell'
import type { BroadcastWave } from '@/app/navigation'
import type { LiveStreamConfig, ServerConfigNavigationState } from '@/app/serverApi'
import { useScrollHistoryPageReady } from '@/app/scrollHistory'
import { TitleBar } from '@/app/titleBar'
import { ProgramDialog, type GuideProgramDialogProgram } from '@/features/guide/ProgramDialog'
import {
  readGuideProgramDetailSetting,
  writeGuideProgramDetailSetting,
} from '@/features/guide/guideRequests'
import type { SettingsConsumerValue } from '@/shared/settings'
import { OnAirList } from './components/OnAirCard'
import { OnAirTabs } from './components/OnAirTabs'
import { useOnAirSchedules } from './hooks/useOnAirSchedules'
import { LiveStreamSelectDialog, type LiveStreamSelectChannel } from './LiveStreamSelectDialog'
import type { OnAirApiRepository, OnAirSchedule } from './onairApi'
import {
  adaptOnAirReserveIndexForProgramDialog,
  resolveEnabledOnAirTabs,
  type OnAirReserveIndex,
} from './onairRequests'

export interface OnAirPageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  settings: SettingsConsumerValue
  enabledBroadcastWaves: readonly BroadcastWave[]
  encodeModes: readonly string[]
  streamConfig?: LiveStreamConfig
  urlscheme?: ServerConfigNavigationState['urlscheme']
  apiRepository: OnAirApiRepository
  onFetchFailure: (snackbar: ShellSnackbarState) => void
}

function getBrowserLocalStorage(): Storage | undefined {
  /* v8 ignore next -- jsdom: window is always defined in the jsdom test environment */
  return typeof window === 'undefined' ? undefined : window.localStorage
}

function createProgramDialogReserveIndex(reserveIndex: OnAirReserveIndex, programId: number) {
  const reserve = reserveIndex[programId]

  return adaptOnAirReserveIndexForProgramDialog(
    reserve === undefined
      ? {}
      : {
          [programId]: reserve,
        },
  )
}

function filterSchedulesByTab(
  schedules: readonly OnAirSchedule[],
  selectedTab: BroadcastWave,
): readonly OnAirSchedule[] {
  return schedules.filter((schedule) => schedule.channel?.channelType === selectedTab)
}

export function OnAirPage({
  isNavigationOpen,
  onNavigationClick,
  settings,
  enabledBroadcastWaves,
  encodeModes,
  streamConfig,
  urlscheme,
  apiRepository,
  onFetchFailure,
}: OnAirPageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [programDialogOpen, setProgramDialogOpen] = useState(false)
  const [selectedProgram, setSelectedProgram] = useState<GuideProgramDialogProgram | null>(null)
  const [streamDialogChannel, setStreamDialogChannel] = useState<LiveStreamSelectChannel | null>(
    null,
  )
  const [programDetailSetting, setProgramDetailSetting] = useState(() =>
    readGuideProgramDetailSetting(getBrowserLocalStorage()),
  )
  const { now, query, schedules, reserveIndex, invalidateAfterAction } = useOnAirSchedules({
    isHalfWidth: settings.isHalfWidthDisplayed,
    routeKey: `${location.pathname}${location.search}`,
    apiRepository,
    onFetchFailure,
  })
  const tabs = useMemo(
    () => resolveEnabledOnAirTabs(enabledBroadcastWaves),
    [enabledBroadcastWaves],
  )
  const [selectedTab, setSelectedTab] = useState<BroadcastWave | undefined>(undefined)
  const shouldShowTabs = settings.isOnAirTabListView && schedules.length > 0
  useScrollHistoryPageReady(
    query.data !== undefined && !query.isFetching,
    `${location.pathname}${location.search}`,
  )

  const activeSelectedTab =
    selectedTab !== undefined && tabs.includes(selectedTab) ? selectedTab : tabs[0]
  const runReserveAction = async (action: Promise<{ ok: boolean }>) =>
    invalidateAfterAction((await action).ok)

  return (
    <>
      <TitleBar
        title="放映中"
        isNavigationOpen={isNavigationOpen}
        navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
        onNavigationClick={onNavigationClick}
        extension={
          shouldShowTabs && activeSelectedTab !== undefined ? (
            <OnAirTabs tabs={tabs} selectedTab={activeSelectedTab} onSelect={setSelectedTab} />
          ) : undefined
        }
      />
      {selectedProgram === null ? undefined : (
        <ProgramDialog
          key={selectedProgram.id}
          open={programDialogOpen}
          program={selectedProgram}
          reserveIndex={createProgramDialogReserveIndex(reserveIndex, selectedProgram.id)}
          settings={settings}
          detailSetting={programDetailSetting}
          encodeModes={encodeModes}
          onClose={(setting) => {
            writeGuideProgramDetailSetting(getBrowserLocalStorage(), setting)
            setProgramDetailSetting(setting)
            setProgramDialogOpen(false)
          }}
          onPersistSetting={(setting) =>
            writeGuideProgramDetailSetting(getBrowserLocalStorage(), setting)
          }
          onExited={() => {
            if (!programDialogOpen) {
              setSelectedProgram(null)
            }
          }}
          onNavigate={navigate}
          onSnackbar={onFetchFailure}
          onAddReserve={(payload) => runReserveAction(apiRepository.addProgramReserve(payload))}
          onDeleteReserve={(reserveId) => runReserveAction(apiRepository.deleteReserve(reserveId))}
          onUnlockSkipReserve={(reserveId) =>
            runReserveAction(apiRepository.unlockSkipReserve(reserveId))
          }
          onUnlockOverlapReserve={(reserveId) =>
            runReserveAction(apiRepository.unlockOverlapReserve(reserveId))
          }
        />
      )}
      {streamDialogChannel === null ? undefined : (
        <LiveStreamSelectDialog
          open
          channel={streamDialogChannel}
          settings={settings}
          streamConfig={streamConfig}
          urlscheme={urlscheme}
          onClose={() => setStreamDialogChannel(null)}
          onSnackbar={onFetchFailure}
        />
      )}
      {schedules.length === 0 ? undefined : (
        <OnAirList
          layout={settings.isOnAirTabListView ? 'tabs' : 'list'}
          now={now}
          onProgramDialogOpen={(program) => {
            setSelectedProgram(program)
            setProgramDialogOpen(true)
          }}
          onStreamDialogOpen={setStreamDialogChannel}
          schedules={
            shouldShowTabs && activeSelectedTab !== undefined
              ? filterSchedulesByTab(schedules, activeSelectedTab)
              : schedules
          }
        />
      )}
    </>
  )
}
