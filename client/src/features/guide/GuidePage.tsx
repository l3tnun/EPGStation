import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SHELL_NAVIGATION_DRAWER_ID, type ShellSnackbarState } from '@/app/AppShell'
import { TitleBar } from '@/app/titleBar'
import type { BroadcastWave } from '@/app/navigation'
import type { LiveStreamConfig, ServerConfigNavigationState } from '@/app/serverApi'
import type { SettingsConsumerValue } from '@/shared/settings'
import { GuideGridHost } from './components/GuideGridHost'
import { GuideNavigationOverlays } from './components/GuideNavigationOverlays'
import { GuideProgramOverlays } from './components/GuideProgramOverlays'
import { GuideTitleActions } from './components/GuideTitleActions'
import type { GuideApiRepository } from './guideApi'
import {
  buildGuideRouteWithTime,
  readGuideProgramDetailSetting,
  resolveGuideTitle,
  writeGuideProgramDetailSetting,
  type GuideProgramDetailSetting,
} from './guideRequests'
import { GuideGridRenderer, type GuideGenreVisibility } from './GuideGridRenderer'
import { readGuideSizeSetting, type GuideSizeSetting } from './guideStorage'
import { useGuideDialogState } from './hooks/useGuideDialogState'
import { useGuideGenreVisibility } from './hooks/useGuideGenreVisibility'
import { useGuideRendererInput } from './hooks/useGuideRendererInput'
import { useGuideRouteCompletion } from './hooks/useGuideRouteCompletion'
import { useGuideRouteData } from './hooks/useGuideRouteData'
import { createGuideDateOptions } from './lib/guideDate'
import {
  EMPTY_INVALID_CHANNEL_IDS,
  createRouteHistoryUrl,
  createRouteKey,
  findGuideDialogProgram,
  firstScheduleChannelName,
  getBrowserLocalStorage,
  hasTimestampHistoryKey,
} from './lib/guidePageState'
import { createGuideSizeCssVariables } from './lib/guideSizeSettingForm'

export { GuideSettingPage, type GuideSettingPageProps } from './GuideSettingPage'

export interface GuidePageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  settings: SettingsConsumerValue
  enabledBroadcastWaves: readonly BroadcastWave[]
  encodeModes: readonly string[]
  streamConfig?: LiveStreamConfig
  urlscheme?: ServerConfigNavigationState['urlscheme']
  apiRepository: GuideApiRepository
  onFetchFailure: (snackbar: ShellSnackbarState) => void
  now?: number
}

export function GuidePage({
  isNavigationOpen,
  onNavigationClick,
  settings,
  enabledBroadcastWaves,
  encodeModes,
  streamConfig,
  urlscheme,
  apiRepository,
  onFetchFailure,
  now,
}: GuidePageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [renderer] = useState(() => new GuideGridRenderer())
  const routeKey = createRouteKey(location)
  const dialogs = useGuideDialogState(routeKey)
  const [programDetailSetting, setProgramDetailSetting] = useState<GuideProgramDetailSetting>(() =>
    readGuideProgramDetailSetting(getBrowserLocalStorage()),
  )
  const routeHistoryUrl = useMemo(() => createRouteHistoryUrl(location), [location])
  const canUseGridScrollHistory = hasTimestampHistoryKey(routeHistoryUrl)
  const [invalidChannelState, setInvalidChannelState] = useState<{
    routeKey: string
    ids: ReadonlySet<number>
  }>(() => ({
    routeKey: '',
    ids: EMPTY_INVALID_CHANNEL_IDS,
  }))
  const invalidChannelIds =
    invalidChannelState.routeKey === routeKey ? invalidChannelState.ids : EMPTY_INVALID_CHANNEL_IDS
  const routeData = useGuideRouteData({
    settings,
    search: location.search,
    now,
    invalidChannelIds,
    enabledBroadcastWaves,
    apiRepository,
  })
  const { requestSet, reserveIndexQuery, scheduleData, reserveIndex } = routeData
  const { hasResolvedSchedule, hasScheduleData, hasRouteData } = routeData
  const title = resolveGuideTitle(requestSet.guideQuery, firstScheduleChannelName(scheduleData), {
    showDate: hasResolvedSchedule,
  })
  const selectedProgram = useMemo(
    () => findGuideDialogProgram(scheduleData, dialogs.selectedProgramId),
    [scheduleData, dialogs.selectedProgramId],
  )
  const [rendererReadyRouteKey, setRendererReadyRouteKey] = useState<string | undefined>(undefined)
  const [genreVisibility, persistGenreVisibility] = useGuideGenreVisibility()
  const [guideSizeSetting] = useState<GuideSizeSetting>(() =>
    readGuideSizeSetting(getBrowserLocalStorage()),
  )
  const [dateOptionsBaseTimestamp, setDateOptionsBaseTimestamp] = useState(() => now ?? Date.now())
  const isRendererReady = !hasScheduleData || rendererReadyRouteKey === routeKey
  const canUseGuideChrome = hasRouteData && isRendererReady
  const onInvalidChannel = useCallback((invalidRouteKey: string, channelId: number) => {
    setInvalidChannelState({
      routeKey: invalidRouteKey,
      ids: new Set([channelId]),
    })
  }, [])
  const { isRestored } = useGuideRouteCompletion({
    renderer,
    routeKey,
    routeHistoryUrl,
    canUseGridScrollHistory,
    isRendererReady,
    routeData,
    onFetchFailure,
    onInvalidChannel,
  })
  const isVisible = hasRouteData && isRendererReady && isRestored
  const { setSelectedProgramId, setProgramDialogOpen, setStreamDialogChannel } = dialogs
  const onProgramClick = useCallback(
    (programId: number) => {
      setSelectedProgramId(programId)
      setProgramDialogOpen(true)
    },
    [setProgramDialogOpen, setSelectedProgramId],
  )
  const rendererInput = useGuideRendererInput({
    routeData,
    genreVisibility,
    guideMode: settings.guideMode,
    now,
    onProgramClick,
    onChannelClick: setStreamDialogChannel,
  })
  const dateOptions = useMemo(
    () => createGuideDateOptions(dateOptionsBaseTimestamp),
    [dateOptionsBaseTimestamp],
  )
  const sizeStyle = useMemo(() => createGuideSizeCssVariables(guideSizeSetting), [guideSizeSetting])
  const navigateToGuideTime = useCallback(
    (time: number, selectedType?: BroadcastWave) => {
      navigate(
        buildGuideRouteWithTime({
          time,
          currentQuery: requestSet.guideQuery,
          selectedType,
        }),
      )
    },
    [navigate, requestSet.guideQuery],
  )
  const runReserveUpdate = async () => {
    dialogs.closeMainMenu()
    const result = await apiRepository.triggerReserveUpdate()

    onFetchFailure(
      result.ok
        ? {
            text: '予約情報の更新開始',
            severity: 'success',
          }
        : {
            text: '予約情報の更新を開始できませんでした。',
            severity: 'error',
          },
    )
  }
  const saveGenreVisibility = (nextVisibility: GuideGenreVisibility) => {
    persistGenreVisibility(nextVisibility)
    dialogs.setGenreDialogOpen(false)
  }
  const closeProgramDialog = (setting: GuideProgramDetailSetting) => {
    writeGuideProgramDetailSetting(getBrowserLocalStorage(), setting)
    setProgramDetailSetting(setting)
    setProgramDialogOpen(false)
  }
  const refetchReserveIndexAfterSuccess = useCallback(
    async (ok: boolean) => {
      if (ok) {
        await reserveIndexQuery.refetch()
      }

      return ok
    },
    [reserveIndexQuery],
  )

  useEffect(() => {
    /* v8 ignore next 3 -- jsdom: this effect only runs once React has mounted, which needs `document` */
    if (typeof document === 'undefined') {
      return () => undefined
    }

    document.documentElement.classList.add('guide-shell-scroll-lock')

    return () => {
      document.documentElement.classList.remove('guide-shell-scroll-lock')
    }
  }, [])

  return (
    <>
      <TitleBar
        title={title}
        isNavigationOpen={isNavigationOpen}
        navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
        onNavigationClick={onNavigationClick}
        onTitleClick={() => {
          setDateOptionsBaseTimestamp(now ?? Date.now())
          dialogs.setDayDialogOpen(true)
        }}
        rightActions={
          <GuideTitleActions
            showTimeSelector={canUseGuideChrome}
            mainMenuAnchor={dialogs.mainMenuAnchor}
            onOpenTimeMenu={(anchor) => {
              setDateOptionsBaseTimestamp(now ?? Date.now())
              dialogs.setTimeMenuAnchor(anchor)
            }}
            onOpenMainMenu={dialogs.setMainMenuAnchor}
            onCloseMainMenu={dialogs.closeMainMenu}
            onReserveUpdate={() => void runReserveUpdate()}
            onOpenGenreDialog={dialogs.openGenreDialogAfterDelay}
            onOpenSetting={() => {
              dialogs.closeMainMenu()
              navigate('/guide/setting')
            }}
          />
        }
      />
      <GuideNavigationOverlays
        dialogs={dialogs}
        guideQuery={requestSet.guideQuery}
        dateOptions={dateOptions}
        enabledBroadcastWaves={enabledBroadcastWaves}
        showBroadcastSelect={settings.isEnableDisplayForEachBroadcastWave}
        genreVisibility={genreVisibility}
        onNavigateToTime={navigateToGuideTime}
        onSaveGenreVisibility={saveGenreVisibility}
      />
      <GuideProgramOverlays
        settings={settings}
        encodeModes={encodeModes}
        streamConfig={streamConfig}
        urlscheme={urlscheme}
        apiRepository={apiRepository}
        reserveIndex={reserveIndex}
        selectedProgramId={dialogs.selectedProgramId}
        selectedProgram={selectedProgram}
        programDialogOpen={dialogs.programDialogOpen}
        detailSetting={programDetailSetting}
        streamDialogChannel={dialogs.streamDialogChannel}
        onCloseProgramDialog={closeProgramDialog}
        onPersistSetting={(setting) =>
          writeGuideProgramDetailSetting(getBrowserLocalStorage(), setting)
        }
        onProgramDialogExited={() => {
          if (!dialogs.programDialogOpen) {
            setSelectedProgramId(undefined)
          }
        }}
        onCloseStreamDialog={() => setStreamDialogChannel(null)}
        onReserveResult={refetchReserveIndexAfterSuccess}
        onNavigate={navigate}
        onSnackbar={onFetchFailure}
      />
      <GuideGridHost
        visible={isVisible}
        isLoading={!isVisible}
        hasGrid={hasScheduleData}
        isGuideDarkColorDisabled={settings.isForceDisableDarkThemeForGuide}
        renderer={renderer}
        rendererInput={rendererInput}
        routeKey={routeKey}
        sizeStyle={sizeStyle}
        onReady={setRendererReadyRouteKey}
      />
    </>
  )
}
