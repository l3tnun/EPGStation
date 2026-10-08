import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  installVideoPlaybackApiMocks,
  SYNTHETIC_HLS_STREAM_ID,
  SYNTHETIC_RECORDED_ID,
  SYNTHETIC_STREAMING_VIDEO_FILE_ID,
} from './support/videoPlaybackMocks'

/*
 * 動画の再生の e2e は、空の playlist を返し、`<video>` の duration と event を `evaluate` で偽造している（decode しない）。
 * ここでは同じ画面に本物の media を返し、本物の browser の `<video>`・hls.js が decode して、読み込み・再生・seek・
 * 終了まで進むことを確かめる。media は ffmpeg の lavfi（testsrc・sine）だけから作った合成の file（support/media）:
 *   ffmpeg -f lavfi -i testsrc=duration=3:size=160x90:rate=15 -f lavfi -i sine=frequency=440:duration=3 \
 *     -c:v libvpx -b:v 100k -c:a libopus -b:a 32k synthetic-playback.webm
 *   ffmpeg -f lavfi -i testsrc=duration=6:size=160x90:rate=15 -f lavfi -i sine=frequency=440:duration=6 \
 *     -c:v libvpx-vp9 -b:v 100k -g 30 -c:a libopus -b:a 32k -f hls -hls_time 2 -hls_segment_type fmp4 \
 *     -hls_playlist_type vod -hls_fmp4_init_filename init.mp4 -hls_segment_filename 'seg%d.m4s' playlist.m3u8
 * Playwright の Chromium は H.264・AAC を decode しないので、本番の codec ではなく VP8/VP9・Opus にしている。
 */

const mediaRoot = join(dirname(fileURLToPath(import.meta.url)), 'support', 'media')
const media = (name: string): Promise<Buffer> => readFile(join(mediaRoot, name))

const HLS_PLAYLIST = [
  '#EXTM3U',
  '#EXT-X-VERSION:7',
  '#EXT-X-TARGETDURATION:2',
  '#EXT-X-MEDIA-SEQUENCE:0',
  '#EXT-X-PLAYLIST-TYPE:VOD',
  '#EXT-X-MAP:URI="init.mp4"',
  '#EXTINF:2.000000,',
  'seg0.m4s',
  '#EXTINF:2.000000,',
  'seg1.m4s',
  '#EXTINF:2.000000,',
  'seg2.m4s',
  '#EXT-X-ENDLIST',
  '',
].join('\n')

const videoState = (video: Locator) =>
  video.evaluate((element) => {
    const media = element as HTMLVideoElement
    return {
      currentTime: media.currentTime,
      duration: media.duration,
      ended: media.ended,
      error: media.error?.code ?? null,
      readyState: media.readyState,
      videoWidth: media.videoWidth,
    }
  })

const playMuted = (video: Locator) =>
  video.evaluate(async (element) => {
    const media = element as HTMLVideoElement
    media.muted = true
    await media.play()
  })

const collectPageErrors = (page: Page): string[] => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page)
})

test('decodes, plays, and ends a real WebM recorded direct stream', async ({ page }) => {
  const errors = collectPageErrors(page)
  await installVideoPlaybackApiMocks(page)
  const webm = await media('synthetic-playback.webm')
  await page.route(
    (url) => /\/api\/streams\/recorded\/\d+\/webm$/.test(url.pathname),
    (route) => route.fulfill({ status: 200, contentType: 'video/webm', body: webm }),
  )

  await page.goto(
    `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=webm&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )
  const player = page.getByTestId('video-player-container')
  const video = player.locator('video')
  await expect(player).toHaveAttribute('data-playback-source-kind', 'direct-stream')

  // 偽物は duration と event を書き換える。本物の browser は media を読んで metadata を得る。
  await expect.poll(async () => (await videoState(video)).readyState).toBeGreaterThanOrEqual(2)
  const loaded = await videoState(video)
  expect(loaded.duration).toBeGreaterThan(2.5)
  expect(loaded.duration).toBeLessThan(3.5)
  expect(loaded.videoWidth).toBe(160)
  expect(loaded.error).toBeNull()

  await playMuted(video)
  await expect.poll(async () => (await videoState(video)).ended, { timeout: 15_000 }).toBe(true)
  await expect(player).not.toHaveAttribute('data-playback-lifecycle-state', 'error')
  expect(errors).toEqual([])
})

test('loads, buffers, and plays real HLS segments through hls.js for a recorded HLS stream', async ({
  page,
}) => {
  const errors = collectPageErrors(page)
  await installVideoPlaybackApiMocks(page)
  const segments = new Map<string, Buffer>()
  for (const name of ['init.mp4', 'seg0.m4s', 'seg1.m4s', 'seg2.m4s'])
    segments.set(name, await media(name))
  const requested: string[] = []
  await page.route('**/streamfiles/**', async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? ''
    requested.push(name)
    if (name === `stream${SYNTHETIC_HLS_STREAM_ID}.m3u8`) {
      await route.fulfill({
        status: 200,
        contentType: 'application/vnd.apple.mpegurl',
        body: HLS_PLAYLIST,
      })
      return
    }
    const body = segments.get(name)
    await route.fulfill(
      body === undefined
        ? { status: 404, body: '' }
        : { status: 200, contentType: 'video/mp4', body },
    )
  })

  await page.goto(
    `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=hls&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )
  const player = page.getByTestId('video-player-container')
  const video = player.locator('video')
  await expect(player).toHaveAttribute('data-playback-source-kind', 'hls-stream')
  await expect(player).toHaveAttribute('data-playback-lifecycle-state', 'ready')

  await expect
    .poll(async () => (await videoState(video)).readyState, { timeout: 15_000 })
    .toBeGreaterThanOrEqual(2)
  expect(requested).toEqual(
    expect.arrayContaining([`stream${SYNTHETIC_HLS_STREAM_ID}.m3u8`, 'init.mp4', 'seg0.m4s']),
  )
  expect((await videoState(video)).videoWidth).toBe(160)

  await playMuted(video)
  await expect
    .poll(async () => (await videoState(video)).currentTime, { timeout: 15_000 })
    .toBeGreaterThan(1)
  expect((await videoState(video)).error).toBeNull()
  expect(errors).toEqual([])
})

test('enters and leaves the real browser fullscreen from the player control', async ({ page }) => {
  await installVideoPlaybackApiMocks(page)
  const webm = await media('synthetic-playback.webm')
  await page.route(
    (url) => /\/api\/streams\/recorded\/\d+\/webm$/.test(url.pathname),
    (route) => route.fulfill({ status: 200, contentType: 'video/webm', body: webm }),
  )
  await page.goto(
    `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=webm&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
  )
  const player = page.getByTestId('video-player-container')
  const video = player.locator('video')
  await expect.poll(async () => (await videoState(video)).readyState).toBeGreaterThanOrEqual(2)

  // 偽物の test は requestFullscreen と fullscreenElement を書き換える。ここでは browser の Fullscreen API を使う。
  await player.hover()
  await page.getByRole('button', { name: 'フルスクリーン' }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
  await expect(page.getByRole('button', { name: 'フルスクリーン終了' })).toBeVisible()

  await player.hover()
  await page.getByRole('button', { name: 'フルスクリーン終了' }).click()
  await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull()
  await expect(page.getByRole('button', { name: 'フルスクリーン' })).toBeVisible()
})
