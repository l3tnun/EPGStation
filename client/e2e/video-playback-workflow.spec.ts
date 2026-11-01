import { expect, test } from '@playwright/test'
import { createRealtimeHarness } from './support/realtimeHarness'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  SYNTHETIC_DIRECT_VIDEO_FILE_ID,
  SYNTHETIC_HLS_STREAM_ID,
  SYNTHETIC_RECORDED_ID,
  SYNTHETIC_STREAMING_VIDEO_FILE_ID,
  createVideoPlaybackRequestLog,
  installVideoPlaybackApiMocks,
  setSyntheticVideoDuration,
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

for (const kind of ['live', 'recorded'] as const) {
  test(`uses updateStatus to complete ${kind} HLS readiness and stops on navigation`, async ({
    page,
  }) => {
    const clockStart = Date.UTC(2026, 9, 31)
    await page.clock.install({ time: clockStart })
    await installVideoPlaybackApiMocks(page, { hlsReadiness: 'pending' })
    const realtime = await createRealtimeHarness(page)
    let enabled = false
    let checks = 0
    let completedChecks = 0
    let stops = 0
    await page.route(/\/api\/streams\?/, async (route) => {
      checks += 1
      await route.fulfill({
        json: { items: [{ streamId: SYNTHETIC_HLS_STREAM_ID, isEnabled: enabled }] },
      })
      completedChecks += 1
    })
    await page.route(`**/api/streams/${SYNTHETIC_HLS_STREAM_ID}`, async (route) => {
      if (route.request().method() === 'DELETE') {
        stops += 1
        await route.fulfill({ json: {} })
      } else {
        await route.fallback()
      }
    })

    try {
      const url =
        kind === 'live'
          ? '/#/onair/watch?type=hls&channel=301&mode=0'
          : `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=hls&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`
      await page.goto(url)
      const player = page.getByTestId('video-player-container')
      await expect(player).toHaveAttribute('data-playback-lifecycle-state', 'waiting')
      await realtime.waitForClient()
      await expect.poll(() => realtime.socketServer.of('/').sockets.size).toBe(1)
      // Advancing to the paused time can start a fallback check. Drain that request and any
      // already-queued page work before measuring the single updateStatus notification below.
      await page.clock.pauseAt(clockStart + 10_000)
      let stableChecks = -1
      await expect
        .poll(() => {
          if (completedChecks !== checks) {
            stableChecks = -1
            return false
          }
          if (stableChecks === checks) return true
          stableChecks = checks
          return false
        })
        .toBe(true)
      const previousChecks = checks
      enabled = true
      realtime.emitUpdateStatus()
      await expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
      // Live updateStatus also preserves the existing On Air watch-info refetch, which uses the
      // same streams endpoint. Recorded playback has only the readiness request on this endpoint.
      expect(checks).toBe(previousChecks + (kind === 'live' ? 2 : 1))
      await expect(player).toHaveAttribute(
        'data-playback-playlist-url',
        `./streamfiles/stream${SYNTHETIC_HLS_STREAM_ID}.m3u8`,
      )

      if (kind === 'recorded') {
        // A target outside the loaded segment must stop the old stream and start a new wait.
        enabled = false
        await setSyntheticVideoDuration(player, { currentTime: 0, duration: 10 })
        await player.getByRole('slider', { name: 'シーク' }).evaluate((element) => {
          const input = element as HTMLInputElement
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
            input,
            '60',
          )
          input.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await player.getByRole('slider', { name: 'シーク' }).dispatchEvent('keyup')
        await expect(player).toHaveAttribute('data-playback-lifecycle-state', 'waiting')
        await expect(player).toHaveAttribute(
          'data-playback-stream-start-url',
          `./api/streams/recorded/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}/hls?mode=0&ss=60`,
        )
        expect(stops).toBe(1)
        const restartChecks = checks
        enabled = true
        realtime.emitUpdateStatus()
        await expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
        expect(checks).toBe(restartChecks + 1)
      }

      await page.evaluate(() => {
        window.location.hash = '/recorded'
      })
      await expect(player).toHaveCount(0)
      await expect.poll(() => stops).toBe(kind === 'recorded' ? 2 : 1)
    } finally {
      await realtime.close()
    }
  })
}
