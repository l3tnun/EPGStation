import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  SYNTHETIC_DIRECT_VIDEO_FILE_ID,
  SYNTHETIC_HLS_STREAM_ID,
  SYNTHETIC_RECORDED_ID,
  SYNTHETIC_STREAMING_VIDEO_FILE_ID,
  createVideoPlaybackRequestLog,
  installVideoPlaybackApiMocks,
} from './support/videoPlaybackMocks'
import { expectAnnounced } from './support/notificationObservation'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
})

test('rejects a live watch channel that is not a finite integer', async ({ page }) => {
  const requestLog = createVideoPlaybackRequestLog()
  await installVideoPlaybackApiMocks(page, { hlsStart: 'failure', requestLog })

  await page.goto('/#/onair/watch?type=hls&channel=synthetic-invalid&mode=0')

  await expect(page.getByTestId('playback-controlled-error')).toContainText('再生条件が不正です')
  await expect(page.getByTestId('video-player-container')).toHaveCount(0)
  expect(requestLog.apiPaths.some((path) => path.includes('/streams/live/'))).toBe(false)
  expect(requestLog.apiPaths.some((path) => path.includes('/videos/'))).toBe(false)
})

test('starts HLS playback, resolves readiness, and exposes subtitle controls', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('VideoPlayerSetting', JSON.stringify({ isShowSubtitle: true }))
  })
  await installVideoPlaybackApiMocks(page)

  await page.goto('/#/onair/watch?type=hls&channel=301&mode=0')

  const player = page.getByTestId('video-player-container')
  await expect(player).toHaveAttribute('data-playback-lifecycle-mode', 'hls-api')
  await expect(page.getByTestId('playback-loading-indicator')).toBeVisible()
  await expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
  await expect(page.getByTestId('playback-loading-indicator')).toHaveCount(0)
  await expect(page.getByTestId('playback-legacy-loading-spinner')).toHaveCount(0)
  await expect(player).toHaveAttribute(
    'data-playback-playlist-url',
    `./streamfiles/stream${SYNTHETIC_HLS_STREAM_ID}.m3u8`,
  )
  await expect(player).toHaveAttribute('data-subtitle-renderer-mounted', 'true')
  await expect(player).toHaveAttribute('data-subtitle-visible', 'true')
  await player.hover()
  if (!testInfo.project.name.startsWith('Desktop ')) {
    return
  }
  await expect(page.getByRole('button', { name: '字幕' })).toBeVisible()

  await page.getByRole('button', { name: '字幕' }).click()

  await expect(player).toHaveAttribute('data-subtitle-visible', 'false')
})

test('reports controlled HLS start failure without leaking endpoint details', async ({ page }) => {
  await installVideoPlaybackApiMocks(page, { hlsStart: 'failure' })

  await page.goto('/#/onair/watch?type=hls&channel=301&mode=0')

  await expect(page.getByTestId('playback-lifecycle-error')).toContainText('ストリーム開始に失敗')
  await expectAnnounced(page, 'ストリーム開始に失敗')
  await expect(page.getByTestId('video-player-container')).not.toContainText('/api/streams')
})

test('starts recorded HLS streaming for encoded video files with duration metadata', async ({
  page,
}) => {
  await installVideoPlaybackApiMocks(page)

  await page.goto(
    `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=hls&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )

  const player = page.getByTestId('video-player-container')
  await expect(player).toHaveAttribute('data-playback-kind', 'recorded-streaming')
  await expect(player).toHaveAttribute('data-playback-source-kind', 'hls-stream')
  await expect(player).toHaveAttribute('data-playback-lifecycle-mode', 'hls-api')
  await expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
  await expect(player).toHaveAttribute(
    'data-playback-stream-start-url',
    `./api/streams/recorded/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}/hls?mode=0&ss=0`,
  )
  await expect(player).toHaveAttribute(
    'data-playback-playlist-url',
    `./streamfiles/stream${SYNTHETIC_HLS_STREAM_ID}.m3u8`,
  )
  await expect(page.getByTestId('playback-loading-indicator')).toHaveCount(0)
  await expect(player).toHaveAttribute('data-recorded-stream-duration', '125')
  await expect(page.getByTestId('recorded-watch-info-card')).toContainText(
    'Synthetic Playback Program',
  )
})

test('applies dark theme tokens to recorded streaming info card', async ({ page }) => {
  await page.addInitScript(() => {
    const savedSettings = JSON.parse(window.localStorage.getItem('settings') ?? '{}') as Record<
      string,
      unknown
    >
    window.localStorage.setItem(
      'settings',
      JSON.stringify({
        ...savedSettings,
        shouldUseOSColorTheme: false,
        isForceDarkTheme: true,
      }),
    )
  })
  await installVideoPlaybackApiMocks(page)

  await page.goto(
    `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=hls&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )

  const card = page.getByTestId('recorded-watch-info-card').locator('article')
  await expect(card).toContainText('Synthetic Playback Program')

  const styles = await card.evaluate((element) => {
    const cardStyle = getComputedStyle(element)
    const description = element.querySelector('[class*="infoCardDescription"]')
    const descriptionStyle = description === null ? undefined : getComputedStyle(description).color

    return {
      background: cardStyle.backgroundColor,
      color: cardStyle.color,
      descriptionColor: descriptionStyle,
    }
  })

  expect(styles.background).not.toBe('rgb(255, 255, 255)')
  expect(styles.color).not.toBe('rgb(0, 0, 0)')
  expect(styles.descriptionColor).not.toBe('rgb(0, 0, 0)')
})

test('applies recorded direct playback constraints on iOS Safari only', async ({
  page,
}, testInfo) => {
  const requestLog = createVideoPlaybackRequestLog()
  await installVideoPlaybackApiMocks(page, { requestLog })

  await page.goto(
    `/#/recorded/watch?videoId=${SYNTHETIC_DIRECT_VIDEO_FILE_ID}&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )

  const player = page.getByTestId('video-player-container')
  await expect(player).toHaveAttribute('data-playback-kind', 'recorded-direct')

  if (testInfo.project.name === 'iOS Safari') {
    // 要求 3-4 (.kiro/specs/frontend-video-playback/requirements.md:62): iOS Safari の recorded
    // direct playback は encode 生成 MP4 と raw TS (このテストの SYNTHETIC_DIRECT_VIDEO_FILE_ID は
    // videoPlaybackMocks.ts で type: 'ts', isOriginal: true の raw TS video file) のどちらも ready
    // として扱い、raw TS direct playback に controlled unsupported UI
    // (旧 `非対応ブラウザーです。` / UNSUPPORTED_BROWSER_MESSAGE) を表示してはならない。design.md:362-365
    // が定めるとおり、media element の decode/network error 判定に委ねる。
    // usePlaybackLifecycle の staticLifecycleSnapshot はもう kind==='recorded-direct' /
    // recordedFileType を分岐条件にせず、常に { state: 'ready' } を返す
    // (src/features/video/playback/hooks/usePlaybackLifecycle.ts)。
    await expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
    // controlled unsupported UI が表示されないこと (要求 3-4 後段)。
    await expect(page.getByTestId('playback-lifecycle-error')).toHaveCount(0)
    // ready 状態として real media URL が設定され、player が実際に raw TS を読み込もうとすること
    // (要求 3-4 前段: encode 生成 MP4 と同様に ready 扱いする)。
    await expect(player).toHaveAttribute(
      'data-playback-media-url',
      `./api/videos/${SYNTHETIC_DIRECT_VIDEO_FILE_ID}`,
    )
    // media element が実際に raw TS の取得を試み、decode/network error 判定を browser の
    // native な video element に委ねていること (要求 3-4 後段、design.md:362-365) を、video 要素が
    // その URL へ実際に fetch を発行することで確認する。
    await expect
      .poll(() => requestLog.apiPaths)
      .toContain(`/api/videos/${SYNTHETIC_DIRECT_VIDEO_FILE_ID}`)
    return
  }

  await expect(player).toHaveAttribute(
    'data-playback-media-url',
    `./api/videos/${SYNTHETIC_DIRECT_VIDEO_FILE_ID}`,
  )
})
