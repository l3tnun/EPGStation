import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  SYNTHETIC_RECORDED_ID,
  SYNTHETIC_STREAMING_VIDEO_FILE_ID,
  installVideoPlaybackApiMocks,
  setSyntheticVideoDuration,
} from './support/videoPlaybackMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
})

test('opens live direct playback routes for M2TS, M2TS-LL, WebM, and MP4', async ({ page }) => {
  await installVideoPlaybackApiMocks(page)

  const directCases = [
    { type: 'm2ts', expectedUrl: './api/streams/live/301/m2ts?mode=0' },
    { type: 'm2tsll', expectedUrl: './api/streams/live/301/m2tsll?mode=0' },
    { type: 'webm', expectedUrl: './api/streams/live/301/webm?mode=0' },
    { type: 'mp4', expectedUrl: './api/streams/live/301/mp4?mode=0' },
  ] as const

  for (const item of directCases) {
    await page.goto(`/#/onair/watch?type=${item.type}&channel=301&mode=0`)

    const player = page.getByTestId('video-player-container')
    await expect(player).toHaveAttribute('data-playback-kind', 'live')
    await expect(player).toHaveAttribute('data-playback-source-kind', 'direct-stream')
    await expect(player).toHaveAttribute('data-playback-lifecycle-mode', 'direct-response')
    await expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
    if (item.type === 'm2tsll') {
      await expect
        .poll(() => player.getAttribute('data-playback-media-url'))
        .toContain(item.expectedUrl.slice(1))
    } else {
      await expect(player).toHaveAttribute('data-playback-media-url', item.expectedUrl)
    }
  }
})

test('keeps narrow viewport controls compact after media metadata arrives', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 740 })
  await installVideoPlaybackApiMocks(page)

  await page.goto(
    `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=mp4&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )

  const player = page.getByTestId('video-player-container')
  await setSyntheticVideoDuration(player)

  await expect(player).toHaveAttribute('data-playback-source-kind', 'direct-stream')
  await player.hover()
  await expect(page.getByTestId('playback-speed-controls')).toHaveCount(0)
  await expect(page.getByLabel('音量')).toHaveCount(0)
  await expect(
    page.getByTestId('playback-bottom-controls').getByRole('button', { name: '再生' }),
  ).toHaveCount(0)
  await expect(page.getByText('00:12/02:05')).toBeVisible()
})

test('hides subtitle controls for recorded MP4 and WebM direct streams', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('VideoPlayerSetting', JSON.stringify({ isShowSubtitle: true }))
  })
  await installVideoPlaybackApiMocks(page)

  await page.goto(
    `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=mp4&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )

  const player = page.getByTestId('video-player-container')
  await setSyntheticVideoDuration(player)
  await expect(player).toHaveAttribute('data-playback-source-kind', 'direct-stream')
  await expect(player).toHaveAttribute('data-subtitle-renderer-mounted', 'false')
  await player.hover()
  await expect(page.getByRole('button', { name: '字幕' })).toHaveCount(0)

  await page.goto(
    `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=webm&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )

  await expect(player).toHaveAttribute('data-playback-source-kind', 'direct-stream')
  await expect(player).toHaveAttribute('data-subtitle-renderer-mounted', 'false')
  await player.hover()
  await expect(page.getByRole('button', { name: '字幕' })).toHaveCount(0)
})

test('auto-hides playback controls after playback starts on pointer platforms', async ({
  page,
}, testInfo) => {
  await installVideoPlaybackApiMocks(page)

  await page.goto(
    `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=mp4&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )

  const player = page.getByTestId('video-player-container')
  await setSyntheticVideoDuration(player)
  await player.locator('video').evaluate((video) => {
    video.dispatchEvent(new Event('play', { bubbles: true }))
  })
  await player.hover()
  await page.waitForTimeout(3200)

  if (testInfo.project.name.startsWith('Desktop ') || testInfo.project.name === 'Android Chrome') {
    await expect(player).toHaveAttribute('data-controls-visible', 'false')
    await expect(player).toHaveAttribute('data-cursor-hidden', 'true')
  }
})
