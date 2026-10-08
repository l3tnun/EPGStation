import { type Locator, type Page } from '@playwright/test'
import { installAppShellApiMocks, installDashboardApiMocks } from './appShellMocks'
import { installGuideOnAirApiMocks } from './guideOnAirMocks'
import { SYNTHETIC_RECORDED_DETAIL_ID, installRecordedApiMocks } from './recordedMocks'
import { installRecordingEncodeApiMocks } from './recordingEncodeMocks'
import { installReservesApiMocks } from './reservesMocks'
import { installSearchRuleWorkflowApiMocks } from './searchRuleMocks'
import { installStoragesUploadApiMocks } from './storagesUploadMocks'
import {
  SYNTHETIC_DIRECT_VIDEO_FILE_ID,
  SYNTHETIC_RECORDED_ID,
  SYNTHETIC_STREAMING_VIDEO_FILE_ID,
  installVideoPlaybackApiMocks,
} from './videoPlaybackMocks'

export async function installRouteScrollRestoreMocks(page: Page) {
  await installAppShellApiMocks(page)
  await installDashboardApiMocks(page)
  await installGuideOnAirApiMocks(page)
  await installRecordingEncodeApiMocks(page)
  await installRecordedApiMocks(page)
  await installReservesApiMocks(page)
  await installSearchRuleWorkflowApiMocks(page)
  await installStoragesUploadApiMocks(page)
  await installVideoPlaybackApiMocks(page)
}

// 初期 URL に timestamp が無い画面は、app が mount の後に timestamp を足した URL へ replace する。
// その location の更新で iOS の address bar 補正 class が付け直され、scroll 位置が 0 に戻る。
// 補った後の URL で始めれば、test が scroll を置いた後にこの更新は起きない。
export function withRouteTimestamp(route: string): string {
  if (route === '/') {
    return route
  }

  return `${route}${route.includes('?') ? '&' : '?'}timestamp=1700000000000`
}

// renderedLocator は、画面の data の描画が済んだ後にだけ現れる要素。描画で scroll 位置より上の
// 高さが変わる route だけが持つ。その高さの変化で browser の scroll anchoring が scrollTop を
// 動かすので、scroll を置く前にこの要素が見えるまで待つ。
export interface RouteScrollRestoreCase {
  route: string
  testId: string
  detourNavigationItemId: string
  detourTestId: string
  renderedLocator?: (page: Page) => Locator
}

export const routeScrollRestoreCases: readonly RouteScrollRestoreCase[] = [
  {
    route: '/',
    testId: 'dashboard-page',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
  },
  {
    route: '/guide?type=GR&time=1700000000000',
    testId: 'guide-page',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
  },
  {
    route: '/guide/setting',
    testId: 'guide-setting-page',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
  },
  {
    route: '/onair?type=GR',
    testId: 'onair-page',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
  },
  {
    route: '/onair/watch?type=hls&channel=301&mode=0',
    testId: 'onair-watch-info-card',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
  },
  {
    route: '/recording',
    testId: 'recording-page',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
  },
  {
    route: '/encode',
    testId: 'encode-page',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
    renderedLocator: (page) => page.getByText('Synthetic Encode Running'),
  },
  {
    route: '/recorded',
    testId: 'recorded-page',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
    renderedLocator: (page) => page.getByText('Synthetic Recorded Matrix A').first(),
  },
  {
    route: `/recorded/detail/${SYNTHETIC_RECORDED_DETAIL_ID}`,
    testId: 'recorded-detail-page',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
  },
  {
    route: `/recorded/watch?videoId=${SYNTHETIC_DIRECT_VIDEO_FILE_ID}&recordedId=${SYNTHETIC_RECORDED_ID}`,
    testId: 'recorded-watch-info-card',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
  },
  {
    route: `/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=hls&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
    testId: 'recorded-watch-info-card',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
  },
  {
    route: '/recorded/upload',
    testId: 'recorded-upload-page',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
  },
  {
    route: '/reserves?type=normal',
    testId: 'reserves-page',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
  },
  {
    route: '/reserves/manual',
    testId: 'manual-reserve-page',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
    renderedLocator: (page) => page.getByRole('heading', { name: 'エンコード1' }),
  },
  {
    route: '/search',
    testId: 'search-rule-page',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
  },
  {
    route: '/rule',
    testId: 'rule-page',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
    renderedLocator: (page) => page.getByText('Synthetic Rule Alpha'),
  },
  {
    route: '/storages',
    testId: 'storages-page',
    detourNavigationItemId: 'navigation-item-settings',
    detourTestId: 'settings-screen',
  },
  {
    route: '/settings',
    testId: 'settings-screen',
    detourNavigationItemId: 'navigation-item-rule',
    detourTestId: 'rule-page',
  },
]
