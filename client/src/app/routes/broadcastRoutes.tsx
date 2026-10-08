import { Route } from 'react-router-dom'
import { DashboardPage } from '../../features/dashboard/DashboardPage'
import { GuidePage, GuideSettingPage } from '../../features/guide/GuidePage'
import { OnAirPage, WatchOnAirPage } from '../../features/onair'
import {
  getEnabledBroadcastWaves,
  getIsRecordedEncodeEnabled,
  getRecordedDirectories,
  getRecordedEncodeModes,
  getStreamConfig,
  getUrlScheme,
  isIOSAddressBarFixTarget,
} from '../lib/serverConfigSelectors'
import type { AppRouteProps } from './routeProps'

export function broadcastRoutes({
  drawerLayout,
  activeServerConfig,
  activeDashboardVersion,
  dashboardSettings,
  viewportWidth,
  onNavigationClick,
  showSnackbar,
  dashboardApiRepository,
  guideApiRepository,
  onAirApiRepository,
  recordedApiRepository,
  recordingApiRepository,
  reservesApiRepository,
}: AppRouteProps) {
  return (
    <>
      <Route
        path="/"
        element={
          <DashboardPage
            dashboardVersion={activeDashboardVersion}
            isNavigationOpen={drawerLayout.isDrawerOpen}
            onNavigationClick={onNavigationClick}
            settings={dashboardSettings}
            apiRepository={dashboardApiRepository}
            recordedApiRepository={recordedApiRepository}
            recordingApiRepository={recordingApiRepository}
            reservesApiRepository={reservesApiRepository}
            isEncodeEnabled={getIsRecordedEncodeEnabled(activeServerConfig)}
            encodeModes={getRecordedEncodeModes(activeServerConfig)}
            recordedDirectories={getRecordedDirectories(activeServerConfig)}
            isEnableDisplayForEachBroadcastWave={
              dashboardSettings.isEnableDisplayForEachBroadcastWave
            }
            shouldUseRealtimeFallbackPolling={isIOSAddressBarFixTarget()}
            onFetchFailure={showSnackbar}
          />
        }
      />
      <Route
        path="/guide"
        element={
          <GuidePage
            isNavigationOpen={drawerLayout.isDrawerOpen}
            onNavigationClick={onNavigationClick}
            settings={dashboardSettings}
            enabledBroadcastWaves={getEnabledBroadcastWaves(activeServerConfig)}
            encodeModes={getRecordedEncodeModes(activeServerConfig)}
            streamConfig={getStreamConfig(activeServerConfig)}
            urlscheme={getUrlScheme(activeServerConfig)}
            apiRepository={guideApiRepository}
            onFetchFailure={showSnackbar}
          />
        }
      />
      <Route
        path="/guide/setting"
        element={
          <GuideSettingPage
            isNavigationOpen={drawerLayout.isDrawerOpen}
            onNavigationClick={onNavigationClick}
            onSnackbar={showSnackbar}
          />
        }
      />
      <Route
        path="/onair"
        element={
          <OnAirPage
            isNavigationOpen={drawerLayout.isDrawerOpen}
            onNavigationClick={onNavigationClick}
            settings={dashboardSettings}
            enabledBroadcastWaves={getEnabledBroadcastWaves(activeServerConfig)}
            encodeModes={getRecordedEncodeModes(activeServerConfig)}
            streamConfig={getStreamConfig(activeServerConfig)}
            urlscheme={getUrlScheme(activeServerConfig)}
            apiRepository={onAirApiRepository}
            onFetchFailure={showSnackbar}
          />
        }
      />
      <Route
        path="/onair/watch"
        element={
          <WatchOnAirPage
            isNavigationOpen={drawerLayout.isDrawerOpen}
            onNavigationClick={onNavigationClick}
            title="視聴"
            settings={dashboardSettings}
            viewportWidth={viewportWidth}
            streamConfig={getStreamConfig(activeServerConfig)}
            isConfigLoaded={activeServerConfig.status === 'loaded'}
            apiRepository={onAirApiRepository}
            onFetchFailure={showSnackbar}
          />
        }
      />
    </>
  )
}
