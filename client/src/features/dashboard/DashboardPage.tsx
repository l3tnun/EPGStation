import { Box } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SHELL_NAVIGATION_DRAWER_ID, type ShellSnackbarState } from '@/app/AppShell'
import { TitleBar, resolveDashboardTitle } from '@/app/titleBar'
import { useScrollHistory } from '@/app/scrollHistory'
import type { RecordedApiRepository, RecordedListItem } from '@/features/recorded/recordedApi'
import type { RecordingApiRepository } from '@/features/recording'
import { ReserveDeleteDialog, ReserveDialog } from '@/features/reserves'
import type {
  ReserveBroadcastWaveResolver,
  ReserveListItemModel,
  ReservesApiRepository,
} from '@/features/reserves'
import type { SettingsConsumerValue } from '@/shared/settings'
import { DashboardRecordsSection } from './components/DashboardRecordsSection'
import { DashboardReservesSection } from './components/DashboardReservesSection'
import type { DashboardApiRepository } from './dashboardApi'
import { DASHBOARD_QUERY_KEY, buildDashboardSummaryRequestSet } from './dashboardRequests'
import { useDashboardScrollHistory } from './hooks/useDashboardScrollHistory'
import { useDashboardSummaryQuery } from './hooks/useDashboardSummaryQuery'
import {
  buildDashboardConflictTarget,
  buildDashboardMoreTarget,
  preventIOSScrollChainAtBounds,
} from './lib/dashboardFormat'
import styles from './DashboardPage.module.css'

const EMPTY_SUMMARY_RESERVES: readonly ReserveListItemModel[] = []

interface DashboardPageProps {
  dashboardVersion: string | null
  isNavigationOpen: boolean
  onNavigationClick: () => void
  settings: SettingsConsumerValue
  apiRepository: DashboardApiRepository
  recordedApiRepository: RecordedApiRepository
  recordingApiRepository: RecordingApiRepository
  reservesApiRepository: ReservesApiRepository
  isEncodeEnabled?: boolean
  encodeModes?: readonly string[]
  recordedDirectories?: readonly string[]
  isEnableDisplayForEachBroadcastWave?: boolean
  shouldUseRealtimeFallbackPolling?: boolean
  onFetchFailure: (snackbar: ShellSnackbarState) => void
}

export function DashboardPage({
  dashboardVersion,
  isNavigationOpen,
  onNavigationClick,
  settings,
  apiRepository,
  recordedApiRepository,
  recordingApiRepository,
  reservesApiRepository,
  isEncodeEnabled = false,
  encodeModes = [],
  recordedDirectories = [],
  isEnableDisplayForEachBroadcastWave = false,
  shouldUseRealtimeFallbackPolling = false,
  onFetchFailure,
}: DashboardPageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const scrollHistory = useScrollHistory()
  const [enteredTransitionKey, setEnteredTransitionKey] = useState<string | null>(null)
  const [dialogReserve, setDialogReserve] = useState<ReserveListItemModel | null>(null)
  const [deleteReserve, setDeleteReserve] = useState<ReserveListItemModel | null>(null)
  const {
    recordingList,
    recordedList,
    reservesList,
    saveScrollDataForCurrentRoute,
    restoreSectionScrollFromHistory,
  } = useDashboardScrollHistory({
    scrollHistory,
    pathname: location.pathname,
    search: location.search,
  })
  const requestSet = useMemo(
    () =>
      buildDashboardSummaryRequestSet({
        settings,
        search: location.search,
      }),
    [location.search, settings],
  )
  const transitionKey = `${location.pathname}${location.search}`
  const query = useDashboardSummaryQuery({
    apiRepository,
    requestSet,
    pathname: location.pathname,
    search: location.search,
    shouldUseRealtimeFallbackPolling,
    onFetchFailure,
  })
  const summaryReserves = query.data?.reserves.reserves ?? EMPTY_SUMMARY_RESERVES
  const resolveDashboardBroadcastWave = useMemo<ReserveBroadcastWaveResolver>(
    () => (channelId) =>
      summaryReserves.find((reserve) => reserve.channelId === channelId)?.channelType,
    [summaryReserves],
  )
  const refetch = () => {
    void query.refetch()
  }
  const openRecordedDetail = (item: RecordedListItem) => {
    if (item.id !== undefined) {
      navigate(`/recorded/detail/${item.id}`)
    }
  }

  useEffect(() => {
    const cleanups = [recordingList.current, recordedList.current, reservesList.current]
      .filter((element): element is HTMLUListElement => element !== null)
      .map((element) => preventIOSScrollChainAtBounds(element))

    return () => {
      cleanups.forEach((cleanup) => cleanup())
    }
  }, [query.data, recordingList, recordedList, reservesList])

  useEffect(() => {
    void queryClient.invalidateQueries({
      queryKey: DASHBOARD_QUERY_KEY,
    })
  }, [location.pathname, location.search, queryClient])

  useEffect(() => {
    if (query.data === undefined) {
      return
    }

    const transitionFrame = requestAnimationFrame(() => {
      setEnteredTransitionKey(transitionKey)
    })
    scrollHistory.emitDoneGetData()
    restoreSectionScrollFromHistory()

    return () => {
      cancelAnimationFrame(transitionFrame)
    }
  }, [query.data, restoreSectionScrollFromHistory, scrollHistory, transitionKey])

  return (
    <>
      <TitleBar
        title={resolveDashboardTitle({ version: dashboardVersion })}
        isNavigationOpen={isNavigationOpen}
        navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
        onNavigationClick={onNavigationClick}
      />
      {query.data === undefined ? undefined : (
        <Box
          className={styles.dashboardPage}
          data-dashboard-transition={
            enteredTransitionKey === transitionKey ? 'entered' : 'entering'
          }
          data-testid="dashboard-page"
        >
          <div className={styles.sections}>
            <DashboardRecordsSection
              label="録画中"
              kind="recording"
              items={query.data.recording.records}
              total={query.data.recording.total}
              testId="dashboard-section-recording"
              listRef={recordingList}
              settings={settings}
              apiRepository={recordingApiRepository}
              isEncodeEnabled={isEncodeEnabled}
              encodeModes={encodeModes}
              recordedDirectories={recordedDirectories}
              onItemClick={openRecordedDetail}
              onMoreClick={() => navigate(buildDashboardMoreTarget('/recording'))}
              onSnackbar={onFetchFailure}
              onRefetchRequested={refetch}
              onScroll={saveScrollDataForCurrentRoute}
            />
            <DashboardRecordsSection
              label="録画済み"
              kind="recorded"
              items={query.data.recorded.records}
              total={query.data.recorded.total}
              testId="dashboard-section-recorded"
              listRef={recordedList}
              settings={settings}
              apiRepository={recordedApiRepository}
              isEncodeEnabled={isEncodeEnabled}
              encodeModes={encodeModes}
              recordedDirectories={recordedDirectories}
              onItemClick={openRecordedDetail}
              onMoreClick={() => navigate(buildDashboardMoreTarget('/recorded'))}
              onSnackbar={onFetchFailure}
              onRefetchRequested={refetch}
              onScroll={saveScrollDataForCurrentRoute}
            />
            <DashboardReservesSection
              label="予約"
              items={query.data.reserves.reserves}
              total={query.data.reserves.total}
              conflictCount={query.data.reserveCounts.conflicts}
              testId="dashboard-section-reserves"
              listRef={reservesList}
              apiRepository={reservesApiRepository}
              onDialogOpen={setDialogReserve}
              onConflictClick={() => navigate(buildDashboardConflictTarget())}
              onMoreClick={() => navigate(buildDashboardMoreTarget('/reserves'))}
              onDeleteRequest={setDeleteReserve}
              onSnackbar={onFetchFailure}
              onRefetchRequested={refetch}
              onScroll={saveScrollDataForCurrentRoute}
            />
          </div>
          <ReserveDialog
            open={dialogReserve !== null}
            reserve={dialogReserve}
            isEnableDisplayForEachBroadcastWave={isEnableDisplayForEachBroadcastWave}
            resolveBroadcastWave={resolveDashboardBroadcastWave}
            onClose={() => setDialogReserve(null)}
          />
          <ReserveDeleteDialog
            open={deleteReserve !== null}
            reserve={deleteReserve}
            apiRepository={reservesApiRepository}
            onClose={() => setDeleteReserve(null)}
            onDeleteSuccess={refetch}
            onSnackbar={onFetchFailure}
          />
        </Box>
      )}
    </>
  )
}
