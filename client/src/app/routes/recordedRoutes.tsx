import { Route } from 'react-router-dom'
import { RecordedDetailPage, RecordedPage } from '../../features/recorded/RecordedPage'
import { RecordedStreamingWatchPage, RecordedWatchPage } from '../../features/video/playback'
import {
  getIsRecordedEncodeEnabled,
  getRecordedDirectories,
  getRecordedDownloadUrlScheme,
  getRecordedEncodeModes,
  getRecordedKodiHosts,
  getRecordedViewUrlScheme,
  getStreamConfig,
} from '../lib/serverConfigSelectors'
import type { AppRouteProps } from './routeProps'

export function recordedRoutes({
  drawerLayout,
  activeServerConfig,
  dashboardSettings,
  viewportWidth,
  onNavigationClick,
  showSnackbar,
  recordedApiRepository,
}: AppRouteProps) {
  return (
    <>
      <Route
        path="/recorded"
        element={
          <RecordedPage
            isNavigationOpen={drawerLayout.isDrawerOpen}
            onNavigationClick={onNavigationClick}
            settings={dashboardSettings}
            viewportWidth={viewportWidth}
            apiRepository={recordedApiRepository}
            onFetchFailure={showSnackbar}
            isEncodeEnabled={getIsRecordedEncodeEnabled(activeServerConfig)}
            encodeModes={getRecordedEncodeModes(activeServerConfig)}
            recordedDirectories={getRecordedDirectories(activeServerConfig)}
            recordedViewUrlScheme={getRecordedViewUrlScheme(activeServerConfig)}
          />
        }
      />
      <Route
        path="/recorded/detail/:id"
        element={
          <RecordedDetailPage
            isNavigationOpen={drawerLayout.isDrawerOpen}
            onNavigationClick={onNavigationClick}
            settings={dashboardSettings}
            viewportWidth={viewportWidth}
            apiRepository={recordedApiRepository}
            onFetchFailure={showSnackbar}
            isEncodeEnabled={getIsRecordedEncodeEnabled(activeServerConfig)}
            encodeModes={getRecordedEncodeModes(activeServerConfig)}
            recordedDirectories={getRecordedDirectories(activeServerConfig)}
            kodiHosts={getRecordedKodiHosts(activeServerConfig)}
            streamConfig={getStreamConfig(activeServerConfig)}
            recordedViewUrlScheme={getRecordedViewUrlScheme(activeServerConfig)}
            recordedDownloadUrlScheme={getRecordedDownloadUrlScheme(activeServerConfig)}
          />
        }
      />
      <Route
        path="/recorded/watch"
        element={
          <RecordedWatchPage
            isNavigationOpen={drawerLayout.isDrawerOpen}
            onNavigationClick={onNavigationClick}
            title="視聴"
            isHalfWidthDisplayed={dashboardSettings.isHalfWidthDisplayed}
            isForceEnableSubtitleStroke={dashboardSettings.isForceEnableSubtitleStroke}
            viewportWidth={viewportWidth}
            apiRepository={recordedApiRepository}
            onSnackbar={showSnackbar}
          />
        }
      />
      <Route
        path="/recorded/streaming/:videoFileId"
        element={
          <RecordedStreamingWatchPage
            isNavigationOpen={drawerLayout.isDrawerOpen}
            onNavigationClick={onNavigationClick}
            title="視聴"
            isHalfWidthDisplayed={dashboardSettings.isHalfWidthDisplayed}
            isForceEnableSubtitleStroke={dashboardSettings.isForceEnableSubtitleStroke}
            viewportWidth={viewportWidth}
            apiRepository={recordedApiRepository}
            onSnackbar={showSnackbar}
            streamConfig={getStreamConfig(activeServerConfig)}
            isConfigLoaded={activeServerConfig.status === 'loaded'}
          />
        }
      />
    </>
  )
}
