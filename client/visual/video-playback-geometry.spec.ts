import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { installAppShellApiMocks } from '../e2e/support/appShellMocks'
import {
  SYNTHETIC_RECORDED_ID,
  SYNTHETIC_STREAMING_VIDEO_FILE_ID,
  expectPlayerHasNoControlOverlap,
  installVideoPlaybackApiMocks,
  setSyntheticVideoDuration,
} from '../e2e/support/videoPlaybackMocks'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
  await installVideoPlaybackApiMocks(page)
})

async function expectChromiumScreenshot(
  locator: Locator,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  if (testInfo.project.name !== 'Desktop Chromium') {
    return
  }

  await expect(locator).toHaveScreenshot(name)
}

async function expectNoDocumentHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )

  // Source D: no v2 equivalent (v2 shipped no e2e/visual tests; 5cf2ea383 has
  // no playwright/visual suite to compare against). v3-introduced contract: the document must
  // never grow wider than the viewport, i.e. no horizontal scrollbar.
  expect(overflow).toBeLessThanOrEqual(0)
}

function streamingTypeForProject(testInfo: TestInfo): 'hls' | 'mp4' {
  return testInfo.project.name === 'iOS Safari' ? 'hls' : 'mp4'
}

async function ensurePlaybackControlsVisible(player: Locator, testInfo: TestInfo): Promise<void> {
  if ((await player.getAttribute('data-controls-visible')) !== 'true') {
    if (testInfo.project.name === 'iOS Safari' || testInfo.project.name === 'Android Chrome') {
      await player.tap()
    } else {
      await player.hover()
    }
  }

  await expect(player).toHaveAttribute('data-controls-visible', 'true')
  await expect(player.getByTestId('playback-bottom-controls')).toBeVisible()
  await expect(player.getByTestId('playback-center-controls')).toBeVisible()
}

test('keeps the player surface at 16:9 with controls inside the surface', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto(
    `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=${streamingTypeForProject(testInfo)}&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )

  const player = page.getByTestId('video-player-container')
  await setSyntheticVideoDuration(player)
  await ensurePlaybackControlsVisible(player, testInfo)

  const playerBox = await player.boundingBox()
  const videoBox = await player.locator('video').boundingBox()
  const bottomBox = await page.getByTestId('playback-bottom-controls').boundingBox()

  expect(playerBox).not.toBeNull()
  expect(videoBox).not.toBeNull()
  expect(bottomBox).not.toBeNull()
  expect((playerBox?.width ?? 0) / (playerBox?.height ?? 1)).toBeCloseTo(16 / 9, 1)
  // Source A: v2 5cf2ea383 client/src/components/video/VideoContainer.vue —
  // `.video-content{position:absolute;top:0;left:0;width:100%;height:100%}` and
  // `.video-wrap video{width:100%;height:100%}` fill the container exactly, matched by v3's
  // src/features/video/playback/PlaybackPage.module.css `.mediaElement{width:100%;height:100%}`
  // inside `.playerContainer{position:relative}`; toBeCloseTo(..., 0) allows ±0.5px rounding.
  expect(videoBox?.x).toBeCloseTo(playerBox?.x ?? 0, 0)
  expect(videoBox?.y).toBeCloseTo(playerBox?.y ?? 0, 0)
  expect(videoBox?.width).toBeCloseTo(playerBox?.width ?? 0, 0)
  expect(videoBox?.height).toBeCloseTo(playerBox?.height ?? 0, 0)
  expect(bottomBox?.y).toBeGreaterThan(playerBox?.y ?? 0)
  expect((bottomBox?.y ?? 0) + (bottomBox?.height ?? 0)).toBeLessThanOrEqual(
    (playerBox?.y ?? 0) + (playerBox?.height ?? 0),
  )
  await expectPlayerHasNoControlOverlap(player)
  await expectChromiumScreenshot(player, testInfo, 'video-playback-ready-controls.png')
})

test('keeps narrow viewport controls within the player width', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 740 })
  await page.goto(
    `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=${streamingTypeForProject(testInfo)}&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )

  const player = page.getByTestId('video-player-container')
  await setSyntheticVideoDuration(player)
  await ensurePlaybackControlsVisible(player, testInfo)

  const playerBox = await player.boundingBox()
  const bottomBox = await page.getByTestId('playback-bottom-controls').boundingBox()
  const centerBox = await page.getByTestId('playback-center-controls').boundingBox()

  expect(playerBox).not.toBeNull()
  expect(bottomBox).not.toBeNull()
  expect(centerBox).not.toBeNull()
  expect(bottomBox?.x).toBeGreaterThanOrEqual(playerBox?.x ?? 0)
  expect((bottomBox?.x ?? 0) + (bottomBox?.width ?? 0)).toBeLessThanOrEqual(
    (playerBox?.x ?? 0) + (playerBox?.width ?? 0),
  )
  // Source A: v2 5cf2ea383 client/src/components/video/VideoContainer.vue —
  // `.center-buttons{position:absolute;top:50%;left:50%;transform:translateY(-50%) translateX(-50%)}`,
  // matched by v3's src/features/video/playback/PlaybackPage.module.css `.centerControls`
  // (`left:50%;top:50%;transform:translate(-50%,-50%)`) inside `.playerContainer{position:relative;
  // overflow:hidden}` — centering guarantees containment as long as the controls are narrower
  // than the player, which holds here.
  expect(centerBox?.x).toBeGreaterThanOrEqual(playerBox?.x ?? 0)
  expect((centerBox?.x ?? 0) + (centerBox?.width ?? 0)).toBeLessThanOrEqual(
    (playerBox?.x ?? 0) + (playerBox?.width ?? 0),
  )
  await expect(page.getByTestId('playback-speed-controls')).toHaveCount(0)
})

test('uses fullscreen fallback geometry when the Fullscreen API is unavailable', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      value: undefined,
    })
    // requirements.md 6b: on iPhone (detectIPhonePlatform(), excludes iPad), toggleFullscreen
    // never consults container.requestFullscreen at all -- it always tries
    // HTMLVideoElement.webkitEnterFullscreen() first and only reaches the CSS-only fallback
    // state when that is also unavailable (usePlaybackFullscreen.ts
    // enterNativeVideoFullscreen()/toggleFullscreen()). Playwright's WebKit engine (the "iOS
    // Safari" project's device emulation) defines webkitEnterFullscreen on
    // HTMLVideoElement.prototype even though it is not real iOS hardware, so removing only
    // requestFullscreen above does not reach the CSS fallback on that project: it invokes
    // webkitEnterFullscreen() instead, which never dispatches a real webkitbeginfullscreen
    // event under browser automation, leaving isFullscreen/isFullscreenFallback stuck at their
    // initial false forever. Removing webkitEnterFullscreen too makes "no fullscreen API
    // available at all" true on every project, matching what this test's assertions check.
    Object.defineProperty(HTMLVideoElement.prototype, 'webkitEnterFullscreen', {
      configurable: true,
      value: undefined,
    })
  })
  await page.goto(
    `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=${streamingTypeForProject(testInfo)}&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )

  const player = page.getByTestId('video-player-container')
  await page.getByRole('button', { name: 'フルスクリーン' }).click()

  const playerBox = await player.boundingBox()
  const viewport = page.viewportSize()

  expect(viewport).not.toBeNull()
  await expect(player).toHaveAttribute('data-fullscreen-fallback', 'true')
  await expect(player).toHaveAttribute('data-fullscreen-state', 'fullscreen')
  // Source D: src/features/video/playback/PlaybackPage.module.css —
  // `.playerContainer[data-fullscreen-fallback='true']` sets `position: fixed; top: 0; left: 0;
  // width: 100vw; height: 100vh`, so the fallback surface is contracted to cover the viewport
  // from its origin; toBeCloseTo(..., 0) allows ±0.5px sub-pixel rounding.
  expect(playerBox?.x).toBeCloseTo(0, 0)
  expect(playerBox?.y).toBeCloseTo(0, 0)
  expect(playerBox?.width).toBeCloseTo(viewport?.width ?? 0, 0)
  expect(playerBox?.height).toBeCloseTo(viewport?.height ?? 0, 0)
})

test('enters native video fullscreen on iPhone instead of the CSS fallback', async ({
  page,
}, testInfo) => {
  if (testInfo.project.name !== 'iOS Safari') {
    return
  }

  // requirements.md 6b: iPhone must reach HTMLVideoElement.webkitEnterFullscreen() and must
  // never land on the CSS-only fallback while that native path is available -- this is the
  // counterpart to the fallback-geometry test above, which requires webkitEnterFullscreen to
  // be absent too before it can observe the fallback. leave requestFullscreen untouched here:
  // per usePlaybackFullscreen.ts toggleFullscreen(), iPhone does not consult it at all.
  await page.addInitScript(() => {
    const state = window as unknown as { __webkitEnterFullscreenCalls: number }
    state.__webkitEnterFullscreenCalls = 0
    Object.defineProperty(HTMLVideoElement.prototype, 'webkitEnterFullscreen', {
      configurable: true,
      value() {
        state.__webkitEnterFullscreenCalls += 1
      },
    })
  })
  await page.goto(
    `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=${streamingTypeForProject(testInfo)}&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )

  const player = page.getByTestId('video-player-container')
  await page.getByRole('button', { name: 'フルスクリーン' }).click()

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __webkitEnterFullscreenCalls: number })
            .__webkitEnterFullscreenCalls,
      ),
    )
    .toBeGreaterThan(0)
  await expect(player).toHaveAttribute('data-fullscreen-fallback', 'false')
})

test('centers the invalid-route controlled error panel in the content area', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto(
      `/#/recorded/streaming/synthetic-invalid?streamingType=hls&mode=0&fileType=ts&viewport=${viewport.width}`,
    )

    const controlledError = page.getByTestId('playback-controlled-error')
    await expect(controlledError).toContainText('ストリーム再生条件が不正です')
    await expectNoDocumentHorizontalOverflow(page)

    const geometry = await controlledError.evaluate((panel) => {
      const content = panel.parentElement
      const panelRect = panel.getBoundingClientRect()
      const contentRect = content?.getBoundingClientRect()

      return {
        panelCenter: panelRect.left + panelRect.width / 2,
        panelWidth: panelRect.width,
        contentCenter: contentRect === undefined ? 0 : contentRect.left + contentRect.width / 2,
        contentWidth: contentRect?.width ?? 0,
      }
    })

    // design.md: the panel (max width 960px) sits in the center of the content area; on a narrow
    // viewport it fills the content width.
    expect(geometry.panelWidth).toBeLessThanOrEqual(960)
    expect(Math.abs(geometry.panelCenter - geometry.contentCenter)).toBeLessThanOrEqual(1)
    if (geometry.contentWidth <= 960) {
      expect(geometry.panelWidth).toBeCloseTo(geometry.contentWidth, 0)
    } else {
      expect(geometry.panelWidth).toBe(960)
    }
  }
})

test.describe('Chromium visual screenshots', () => {
  test('captures controlled error dimensions without media leakage', async ({ page }, testInfo) => {
    if (testInfo.project.name !== 'Desktop Chromium') {
      return
    }

    await page.goto('/#/recorded/streaming/synthetic-invalid?streamingType=hls&mode=0&fileType=ts')

    const controlledError = page.getByTestId('playback-controlled-error')
    await expect(controlledError).toContainText('ストリーム再生条件が不正です')
    await expectNoDocumentHorizontalOverflow(page)
    await expect(controlledError).toHaveScreenshot('video-playback-controlled-error.png')
  })

  test('captures HLS loading indicator centered in the 16:9 surface', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name !== 'Desktop Chromium') {
      return
    }

    await page.unrouteAll()
    await installAppShellApiMocks(page)
    await installVideoPlaybackApiMocks(page, { hlsReadiness: 'pending' })

    await page.goto('/#/onair/watch?type=hls&channel=301&mode=0')

    const player = page.getByTestId('video-player-container')
    const loading = page.getByTestId('playback-loading-indicator')
    await expect(player).toHaveAttribute('data-playback-lifecycle-state', 'waiting')
    await expect(loading).toBeVisible()

    const playerBox = await player.boundingBox()
    const loadingBox = await loading.boundingBox()

    expect(playerBox).not.toBeNull()
    expect(loadingBox).not.toBeNull()
    expect((loadingBox?.x ?? 0) + (loadingBox?.width ?? 0) / 2).toBeCloseTo(
      (playerBox?.x ?? 0) + (playerBox?.width ?? 0) / 2,
      0,
    )
    expect((loadingBox?.y ?? 0) + (loadingBox?.height ?? 0) / 2).toBeCloseTo(
      (playerBox?.y ?? 0) + (playerBox?.height ?? 0) / 2,
      0,
    )
    await expect(player).toHaveScreenshot('video-playback-hls-loading.png')
  })

  test('captures subtitle controls without overlapping player overlays', async ({
    page,
  }, testInfo) => {
    if (testInfo.project.name !== 'Desktop Chromium') {
      return
    }

    await page.addInitScript(() => {
      window.localStorage.setItem('VideoPlayerSetting', JSON.stringify({ isShowSubtitle: true }))
    })
    await page.goto('/#/onair/watch?type=hls&channel=301&mode=0')

    const player = page.getByTestId('video-player-container')
    await expect(player).toHaveAttribute('data-subtitle-visible', 'true')
    await player.hover()
    await expect(player).toHaveAttribute('data-controls-visible', 'true')
    await expect(page.getByRole('button', { name: '字幕' })).toBeVisible()
    await expectPlayerHasNoControlOverlap(player)
    await expect(player).toHaveScreenshot('video-playback-subtitle-controls.png')
  })
})
