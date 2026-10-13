import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  pacedTransportStreamChunks,
  readSyntheticCaptionStream,
} from './support/syntheticCaptionStream'
import { installVideoPlaybackApiMocks } from './support/videoPlaybackMocks'

/*
 * ライブの M2TS-LL の再生で、本物の mpegts.js・aribb24.js・browser の `<video>` を通して字幕を描くことを確かめる。
 * media は合成の H.264・AAC の TS に合成の字幕を差し込んだもの（support/syntheticCaptionStream.ts）。mpegts.js は
 * live の遅延を追いかけるので、test の中の HTTP server から実時間の速さで流す。H.264・AAC を MSE で decode する
 * Chromium の project（Desktop Chromium・Android Chrome）だけで流す。
 */

let streamServer: Server | undefined
let streamOrigin = ''

test.beforeAll(async () => {
  const stream = await readSyntheticCaptionStream()
  streamServer = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'video/mp2t', 'Cache-Control': 'no-store' })
    const chunks = pacedTransportStreamChunks(stream)
    const startedAt = Date.now()
    let next = 0
    const timer = setInterval(() => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000
      while (next < chunks.length && chunks[next].mediaSeconds <= elapsedSeconds + 0.5) {
        response.write(chunks[next].bytes)
        next += 1
      }
      if (next >= chunks.length) {
        clearInterval(timer)
        response.end()
      }
    }, 50)
    request.once('close', () => clearInterval(timer))
  })
  await new Promise<void>((resolve) => streamServer?.listen(0, '127.0.0.1', resolve))
  streamOrigin = `http://127.0.0.1:${(streamServer.address() as AddressInfo).port}`
})

test.afterAll(async () => {
  streamServer?.closeAllConnections()
  await new Promise<void>((resolve) => streamServer?.close(() => resolve()))
})

test.beforeEach(async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'H.264・AAC を MSE で decode する Chromium だけで流す')
  await installAppShellApiMocks(page)
  await installVideoPlaybackApiMocks(page)
  await page.route(
    (url) => /\/api\/streams\/live\/\d+\/m2tsll$/.test(url.pathname),
    (route) => route.continue({ url: `${streamOrigin}/live.m2ts` }),
  )
})

const openLiveWithSubtitle = async (page: Page, isShowSubtitle: boolean): Promise<Locator> => {
  await page.addInitScript((visible) => {
    window.localStorage.setItem('VideoPlayerSetting', JSON.stringify({ isShowSubtitle: visible }))
  }, isShowSubtitle)
  await page.goto('/#/onair/watch?type=m2tsll&channel=301&mode=0')
  const player = page.getByTestId('video-player-container')
  await expect(player).toHaveAttribute('data-subtitle-renderer-mounted', 'true')
  // 再生が始まり（`play` が届き）、映像が進んでいる
  await expect
    .poll(() => player.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime), {
      timeout: 15_000,
    })
    .toBeGreaterThan(1)
  return player
}

/** 見えている字幕の canvas に描かれた（透明でない）画素の数。aribb24.js は非表示の canvas を `visibility: hidden` にする。 */
const paintedSubtitlePixels = (player: Locator): Promise<number> =>
  player.evaluate((element) => {
    let painted = 0
    for (const canvas of element.querySelectorAll('canvas')) {
      if (getComputedStyle(canvas).visibility !== 'visible') continue
      const context = canvas.getContext('2d')
      if (context === null || canvas.width === 0 || canvas.height === 0) continue
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      for (let index = 3; index < pixels.length; index += 4) {
        if (pixels[index] !== 0) painted += 1
      }
    }
    return painted
  })

const toggleSubtitle = async (page: Page, player: Locator): Promise<void> => {
  await player.hover()
  await page.getByRole('button', { name: '字幕' }).click()
}

test('[AC 4.4a] draws live M2TS-LL subtitles once they are turned on after playback resumed with them off', async ({
  page,
}) => {
  const player = await openLiveWithSubtitle(page, false)
  // off のまま一時停止して再開し、`play` を off の間に届ける。描画の loop が数 frame 回ってから on にする。
  await player.locator('video').evaluate(async (video: HTMLVideoElement) => {
    video.pause()
    await video.play()
    await new Promise((resolve) => setTimeout(resolve, 500))
  })
  expect(await paintedSubtitlePixels(player)).toBe(0)

  await toggleSubtitle(page, player)
  await expect(player).toHaveAttribute('data-subtitle-visible', 'true')
  await expect.poll(() => paintedSubtitlePixels(player), { timeout: 5_000 }).toBeGreaterThan(0)

  await toggleSubtitle(page, player)
  await expect(player).toHaveAttribute('data-subtitle-visible', 'false')
  await expect.poll(() => paintedSubtitlePixels(player), { timeout: 5_000 }).toBe(0)
})

test('draws live M2TS-LL subtitles from the start when they are on', async ({ page }) => {
  const player = await openLiveWithSubtitle(page, true)
  await expect.poll(() => paintedSubtitlePixels(player), { timeout: 5_000 }).toBeGreaterThan(0)
})
