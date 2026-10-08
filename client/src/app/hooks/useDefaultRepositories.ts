import { useState } from 'react'
import type { AppProps, RoutedApiRepositories } from '../appProps'
import { createBrowserScrollPosition } from '../lib/routeScroll'
import { createSessionScrollHistory, type ScrollHistoryState } from '../scrollHistory'
import { createFetchDashboardApiRepository } from '../../features/dashboard/dashboardApi'
import { createFetchEncodeApiRepository } from '../../features/encode'
import { createFetchGuideApiRepository } from '../../features/guide/guideApi'
import { createFetchOnAirApiRepository } from '../../features/onair'
import { createFetchRecordedApiRepository } from '../../features/recorded/recordedApi'
import { createFetchRecordingApiRepository } from '../../features/recording'
import { createFetchReservesApiRepository } from '../../features/reserves/reservesApi'
import { createFetchSearchRuleApiRepository } from '../../features/search/rule'
import { createFetchStoragesApiRepository } from '../../features/storages/storagesApi'

function createDefaultScrollHistory(): ScrollHistoryState {
  /* v8 ignore start -- jsdom: React requires `window` to mount, so this SSR fallback is unreachable in jsdom */
  if (typeof window === 'undefined') {
    const noopStorage = { getItem: () => null, setItem: () => undefined }
    return createSessionScrollHistory({
      storage: noopStorage,
      locationProvider: () => '',
      scrollPositionProvider: () => ({ x: 0, y: 0 }),
    })
  }
  /* v8 ignore stop */

  return createSessionScrollHistory({
    storage: window.sessionStorage,
    locationProvider: () => window.location.href,
    scrollPositionProvider: createBrowserScrollPosition,
  })
}

/** Resolves the feature repositories and scroll history, creating browser defaults once per mount. */
export function useDefaultRepositories(
  props: AppProps,
): RoutedApiRepositories & { scrollHistory: ScrollHistoryState } {
  const [defaultDashboardApiRepository] = useState(() => createFetchDashboardApiRepository())
  const [defaultGuideApiRepository] = useState(() => createFetchGuideApiRepository())
  const [defaultOnAirApiRepository] = useState(() => createFetchOnAirApiRepository())
  const [defaultRecordedApiRepository] = useState(() => createFetchRecordedApiRepository())
  const [defaultRecordingApiRepository] = useState(() => createFetchRecordingApiRepository())
  const [defaultEncodeApiRepository] = useState(() => createFetchEncodeApiRepository())
  const [defaultReservesApiRepository] = useState(() => createFetchReservesApiRepository())
  const [defaultSearchRuleApiRepository] = useState(() => createFetchSearchRuleApiRepository())
  const [defaultStoragesApiRepository] = useState(() => createFetchStoragesApiRepository())
  const [defaultScrollHistory] = useState(createDefaultScrollHistory)

  return {
    apiRepository: props.apiRepository,
    dashboardApiRepository: props.dashboardApiRepository ?? defaultDashboardApiRepository,
    guideApiRepository: props.guideApiRepository ?? defaultGuideApiRepository,
    onAirApiRepository: props.onAirApiRepository ?? defaultOnAirApiRepository,
    recordedApiRepository: props.recordedApiRepository ?? defaultRecordedApiRepository,
    recordingApiRepository: props.recordingApiRepository ?? defaultRecordingApiRepository,
    encodeApiRepository: props.encodeApiRepository ?? defaultEncodeApiRepository,
    reservesApiRepository: props.reservesApiRepository ?? defaultReservesApiRepository,
    searchRuleApiRepository: props.searchRuleApiRepository ?? defaultSearchRuleApiRepository,
    storagesApiRepository: props.storagesApiRepository ?? defaultStoragesApiRepository,
    scrollHistory: props.scrollHistory ?? defaultScrollHistory,
  }
}
