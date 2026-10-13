import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { replaceApiMocks } from './support/apiMockReplacement'
import { withRouteTimestamp } from './support/appShellWorkflow'
import { installBroadcastWorkflowMocks } from './support/broadcastWorkflow'
import { installGuideOnAirApiMocks } from './support/guideOnAirMocks'
import { selectMuiOption } from './support/muiSelect'
import {
  announcedNotification,
  announcementCount,
  expectAnnounced,
} from './support/notificationObservation'

test.beforeEach(async ({ page }) => {
  await installBroadcastWorkflowMocks(page)
})

test('opens On Air stream dialog and hands web playback to watch route', async ({
  page,
}, testInfo) => {
  await page.goto('/#/onair')

  await expect(page.getByTestId('onair-card-5101')).toBeVisible()
  await page.getByTestId('onair-card-body-5101').click()

  const dialog = page.getByRole('dialog', { name: 'ストリーム選択' })
  await expect(dialog).toBeVisible()
  const streamingLabel = testInfo.project.name === 'iOS Safari' ? 'HLS' : 'WebM'
  await selectMuiOption({ page, root: dialog, name: '配信方式', value: streamingLabel })
  await dialog.getByRole('button', { name: '視聴' }).click()

  await expect(page).toHaveURL(/#\/onair\/watch\?/)
  await expect
    .poll(() => new URLSearchParams(page.url().split('?')[1] ?? '').get('type'))
    .toBe(streamingLabel.toLowerCase())
  await expect
    .poll(() => new URLSearchParams(page.url().split('?')[1] ?? '').get('channel'))
    .toBe('301')
  await expect.poll(() => new URLSearchParams(page.url().split('?')[1] ?? '').get('mode')).toBe('0')
  await expect(page.getByTestId('onair-watch-info-card')).toContainText('Synthetic OnAir News')
})

test('keeps On Air card and stream dialog surfaces dark-theme aware', async ({ page }) => {
  await page.unrouteAll()
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true, forceDarkTheme: true })
  await installGuideOnAirApiMocks(page)

  await page.goto('/#/onair')

  await expect(page.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'dark')
  await expect(page.getByTestId('onair-list')).toHaveCSS('background-color', 'rgb(30, 30, 30)')
  await page.getByTestId('onair-card-body-5101').click()
  await expect(page.getByRole('dialog', { name: 'ストリーム選択' })).toBeVisible()
  await expect(page.locator('.MuiDialog-paper').first()).toHaveCSS(
    'background-color',
    'rgb(30, 30, 30)',
  )
})

test('shows synthetic empty and error states without leaking fixture content', async ({ page }) => {
  // timestamp の無い URL は、app が mount の後に timestamp を足した URL へ replace する。
  // 空の画面への assertion はその前に通り抜けるので、続く hash 移動をこの replace が
  // 上書きしうる。最初から timestamp を持つ URL へ移動して、この replace を起こさない。
  await page.unrouteAll()
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
  await installGuideOnAirApiMocks(page, { guide: 'empty', onAir: 'empty' })

  await page.goto(`/#${withRouteTimestamp('/guide?time=23111507')}`)
  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  await expect(page.getByTestId('guide-program-grid')).toHaveCount(0)
  await expect(page.getByText('Synthetic Morning News')).toHaveCount(0)

  await page.goto(`/#${withRouteTimestamp('/onair')}`)
  await expect(page.getByTestId('onair-page')).toHaveCount(0)
  await expect(page.getByText('Synthetic OnAir News')).toHaveCount(0)

  // 空の画面の取得が終わってから偽 API を入れ替える（replaceApiMocks）。入れ替えの時点で失敗の通知が
  // 記録されていないことと、各画面の失敗の通知がその画面へ移った後に記録されることを確かめる。
  await replaceApiMocks(page, async () => {
    await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
    await installGuideOnAirApiMocks(page, {
      guide: 'failure',
      onAir: 'failure',
      streams: 'failure',
    })
  })
  await expect(announcedNotification(page)).toHaveAttribute('data-announced-history', '[]')

  let since = await announcementCount(page)
  await page.goto(`/#${withRouteTimestamp('/guide?time=23111507')}`)
  await expectAnnounced(page, '番組表情報の取得に失敗しました', { since })

  since = await announcementCount(page)
  await page.goto(`/#${withRouteTimestamp('/onair')}`)
  await expectAnnounced(page, '番組情報取得に失敗', { since })

  since = await announcementCount(page)
  await page.goto(`/#${withRouteTimestamp('/onair/watch?type=hls&channel=301&mode=0')}`)
  await expectAnnounced(page, 'ストリーム情報取得に失敗', { since })
})
