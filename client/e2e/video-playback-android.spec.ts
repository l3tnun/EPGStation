import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { selectMuiOption } from './support/muiSelect'
import {
  SYNTHETIC_RECORDED_ID,
  SYNTHETIC_STREAMING_VIDEO_FILE_ID,
  installVideoPlaybackApiMocks,
  setSyntheticVideoDuration,
} from './support/videoPlaybackMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
})

test('keeps Android HLS watch loading-only until the media element reports data', async ({
  page,
}) => {
  await installVideoPlaybackApiMocks(page, { hlsPlaylist: 'pending' })

  await page.goto('/#/onair/watch?type=hls&channel=301&mode=0')

  const player = page.getByTestId('video-player-container')
  await expect(player).toHaveAttribute('data-playback-lifecycle-mode', 'hls-api')
  await expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')
  await player.tap()

  await expect(page.getByTestId('playback-loading-indicator')).toBeVisible()
  await expect(page.getByTestId('playback-legacy-loading-spinner')).toBeVisible()
  await expect(page.getByTestId('playback-bottom-controls')).toHaveCount(0)
  await expect(page.getByTestId('playback-center-controls')).toHaveCount(0)

  await player.locator('video').evaluate((video) => {
    video.dispatchEvent(new Event('loadeddata', { bubbles: true }))
  })
  await player.tap()

  await expect(page.getByTestId('playback-loading-indicator')).toHaveCount(0)
  await expect(page.getByTestId('playback-bottom-controls')).toBeVisible()
})

test('shows Android live watch rotation after native fullscreen locks landscape', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as unknown as {
      __fullscreenRequests: FullscreenOptions[]
      __orientationLocks: OrientationLockType[]
    }
    state.__fullscreenRequests = []
    state.__orientationLocks = []
    const orientation = {
      type: 'portrait-primary',
      lock(lockType: OrientationLockType) {
        state.__orientationLocks.push(lockType)
        orientation.type = lockType === 'landscape' ? 'landscape-primary' : 'portrait-primary'
        window.dispatchEvent(new Event('orientationchange'))
        return Promise.resolve()
      },
    }
    Object.defineProperty(screen, 'orientation', {
      configurable: true,
      value: orientation,
    })
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value(options?: FullscreenOptions) {
        state.__fullscreenRequests.push(options ?? {})
        Object.defineProperty(document, 'fullscreenElement', {
          configurable: true,
          value: this,
        })
        document.dispatchEvent(new Event('fullscreenchange'))
        return Promise.resolve()
      },
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value() {
        Object.defineProperty(document, 'fullscreenElement', {
          configurable: true,
          value: null,
        })
        document.dispatchEvent(new Event('fullscreenchange'))
        return Promise.resolve()
      },
    })
  })
  await installVideoPlaybackApiMocks(page)

  await page.goto('/#/onair/watch?type=hls&channel=301&mode=0')

  const player = page.getByTestId('video-player-container')
  await expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')

  await page.evaluate(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 844 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 390 })
    window.dispatchEvent(new Event('resize'))
  })
  await player.locator('video').evaluate((video) => {
    video.dispatchEvent(new Event('loadeddata', { bubbles: true }))
  })
  await player.tap()

  const fullscreenButton = page.getByRole('button', { name: 'フルスクリーン' })
  await fullscreenButton.click()

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __fullscreenRequests: FullscreenOptions[] }).__fullscreenRequests,
      ),
    )
    .toEqual([{ navigationUI: 'hide' }])
  const rotateButton = page.getByRole('button', { name: '画面回転' })
  await expect(rotateButton).toBeVisible()
  const playerBox = await player.boundingBox()
  const rotateButtonBox = await rotateButton.boundingBox()
  expect(playerBox).not.toBeNull()
  expect(rotateButtonBox).not.toBeNull()
  if (playerBox === null || rotateButtonBox === null) {
    return
  }
  // Source A/D: v2 client/src/components/video/VideoContainer.vue:938-941 pins the rotate button
  // with `.rotation-button { position: absolute; top: 8px; right: 16px }`; v3 uses
  // `.rotationButton { position: absolute; right: 8px; top: 8px }`
  // (src/features/video/playback/PlaybackPage.module.css:142-158). The top inset is the v2 value
  // (A); the right inset is v3's own 8px, not v2's 16px (D). Both 8px offsets below mirror the v3
  // CSS exactly; the extra +1/-1 only tolerates sub-pixel rounding.
  expect(rotateButtonBox.x + rotateButtonBox.width).toBeLessThanOrEqual(
    playerBox.x + playerBox.width - 8 + 1,
  )
  expect(rotateButtonBox.x).toBeGreaterThan(playerBox.x + playerBox.width / 2)
  expect(rotateButtonBox.y).toBeGreaterThanOrEqual(playerBox.y + 8 - 1)

  await rotateButton.click()

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __orientationLocks: OrientationLockType[] }).__orientationLocks,
      ),
    )
    .toEqual(['landscape', 'portrait'])
})

test('resumes Android recorded WebM streaming from detail after an out-of-segment seek', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const state = window as unknown as { __playCalls: number }
    state.__playCalls = 0
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value() {
        state.__playCalls += 1
        this.dispatchEvent(new Event('play', { bubbles: true }))
        return Promise.resolve()
      },
    })
  })
  await installVideoPlaybackApiMocks(page)

  await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_ID}`)

  await page.getByRole('button', { name: 'streaming' }).click()
  await page.getByRole('button', { name: 'Synthetic Encoded' }).click()

  const streamDialog = page.getByRole('dialog', { name: 'ストリーム選択' })
  await expect(streamDialog).toBeVisible()
  await selectMuiOption({ page, root: streamDialog, name: '配信方式', value: 'WebM' })
  await streamDialog.getByRole('button', { name: '視聴' }).click()
  await expect(page).toHaveURL(
    new RegExp(`/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}\\?.*streamingType=webm`),
  )

  const player = page.getByTestId('video-player-container')
  await expect(player).toHaveAttribute(
    'data-playback-media-url',
    `./api/streams/recorded/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}/webm?mode=0&ss=0`,
  )
  await setSyntheticVideoDuration(player, { currentTime: 12, duration: 30 })
  await player.locator('video').evaluate((video) => {
    video.dispatchEvent(new Event('play', { bubbles: true }))
  })
  await player.tap()
  await page.getByLabel('シーク').evaluate((input) => {
    const range = input as HTMLInputElement
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    valueSetter?.call(range, '120')
    range.dispatchEvent(new Event('input', { bubbles: true }))
    range.dispatchEvent(new Event('change', { bubbles: true }))
    range.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }))
  })

  await expect(player).toHaveAttribute(
    'data-playback-media-url',
    `./api/streams/recorded/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}/webm?mode=0&ss=120`,
  )
  await player.locator('video').evaluate((video) => {
    video.dispatchEvent(new Event('loadeddata', { bubbles: true }))
  })
  // Provenance (D): confirms the media element's play() was actually invoked again after the
  // out-of-segment seek reloads the source; not tied to a specific call count, only that resume
  // happened at least once. No v2 source (v2 has no equivalent Playwright harness for this hook).
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __playCalls: number }).__playCalls))
    .toBeGreaterThan(0)
})
