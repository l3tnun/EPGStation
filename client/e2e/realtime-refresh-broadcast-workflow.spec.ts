import { createRealtimeHarness, emitUntilTextAppears } from './support/realtimeHarness'
import { openReservesMenu } from './support/pointerInteractions'
import { expect, test, type Page } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import { selectMuiOption } from './support/muiSelect'
import { reserveDeleteTarget } from './support/reservesMocks'
import { installGuideOnAirRealtimeApiMocks } from './support/guideOnAirMocks'
import {
  installVideoPlaybackRealtimeApiMocks,
  SYNTHETIC_DIRECT_VIDEO_FILE_ID,
  SYNTHETIC_RECORDED_ID,
  SYNTHETIC_STREAMING_VIDEO_FILE_ID,
} from './support/videoPlaybackMocks'
import { expectAnnounced } from './support/notificationObservation'

test.describe.configure({ mode: 'serial' })

test('refreshes another client when a reserve delete emits a real Socket.IO updateStatus event', async ({
  page,
}) => {
  const realtime = await createRealtimeHarness(page)
  const otherPage = await page.context().newPage()
  let reserves = [reserveDeleteTarget]
  const installReserveMutationMocks = async (targetPage: Page) => {
    await targetPage.route('**/api/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())

      if (url.pathname.endsWith('/api/reserves') && request.method() === 'GET') {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({ reserves, total: reserves.length }),
        })
        return
      }

      if (/\/api\/reserves\/\d+$/.test(url.pathname) && request.method() === 'DELETE') {
        reserves = []
        realtime.emitUpdateStatus()
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({}),
        })
        return
      }

      await route.fallback()
    })
  }

  try {
    await installAppShellApiMocks(otherPage, { socketIOPort: realtime.socketIOPort })
    await installReserveMutationMocks(page)
    await installReserveMutationMocks(otherPage)

    await page.goto('/#/reserves')
    await otherPage.goto('/#/reserves')
    await expect(otherPage.getByText(reserveDeleteTarget.name)).toBeVisible()
    await realtime.waitForClientCount(2)

    await openReservesMenu(page, reserveDeleteTarget.name)
    await page.getByRole('menuitem', { name: 'delete' }).click()
    await page.getByRole('button', { name: '削除' }).click()

    await expect(otherPage.getByText(reserveDeleteTarget.name)).toHaveCount(0)
  } finally {
    await otherPage.close()
    await realtime.close()
  }
})

test('refreshes Guide reserve state from real Socket.IO updateStatus events', async ({ page }) => {
  const realtime = await createRealtimeHarness(page)

  try {
    const guideMocks = await installGuideOnAirRealtimeApiMocks(page)
    await page.goto('/#/guide?time=23111507')
    await expect(page.getByTestId('guide-program-4201')).toHaveClass(/reserve/)
    await realtime.waitForClient()

    await page.getByRole('button', { name: '時刻選択' }).click()
    const timeSelectorMenu = page.getByRole('menu').filter({ hasText: '表示' })
    await expect(timeSelectorMenu).toBeVisible()

    guideMocks.clearGuideReserveIndex()
    realtime.emitUpdateStatus()

    await expect(page.getByTestId('guide-program-4201')).not.toHaveClass(/reserve/)
    await expect(page.getByRole('button', { name: '時刻選択' })).toBeVisible()
    await expect(timeSelectorMenu).toBeVisible()
    await expect
      .poll(async () => {
        const box = await timeSelectorMenu.boundingBox()
        const viewport = page.viewportSize()

        return (
          box !== null &&
          viewport !== null &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= viewport.width + 1
        )
      })
      .toBe(true)

    const viewport = page.viewportSize()
    await page.mouse.click(20, (viewport?.height ?? 720) - 20)
    await expect(timeSelectorMenu).toHaveCount(0)
    await expect(page.locator('[class*="timeSelectorBackground"]')).toHaveCount(0)

    await page.getByTestId('guide-program-4101').click()
    await expect(page.getByRole('dialog', { name: 'Synthetic Morning News' })).toBeVisible()
  } finally {
    await realtime.close()
  }
})

test('refreshes another client when Guide reserve add/delete emits real Socket.IO updateStatus events', async ({
  page,
}) => {
  const realtime = await createRealtimeHarness(page)
  const otherPage = await page.context().newPage()

  try {
    await installAppShellApiMocks(otherPage, { socketIOPort: realtime.socketIOPort })
    await installGuideOnAirRealtimeApiMocks(page, {
      onReserveMutation: realtime.emitUpdateStatus,
    })
    await installGuideOnAirRealtimeApiMocks(otherPage, {
      onReserveMutation: realtime.emitUpdateStatus,
    })

    await page.goto('/#/guide?time=23111507')
    await otherPage.goto('/#/guide?time=23111507')
    await expect(otherPage.getByTestId('guide-program-4101')).not.toHaveClass(/reserve/)
    await realtime.waitForClientCount(2)

    await page.getByTestId('guide-program-4101').click()
    const addDialog = page.getByRole('dialog', { name: 'Synthetic Morning News' })
    await expect(addDialog).toBeVisible()
    await addDialog.getByRole('button', { name: '予約' }).click()
    await expectAnnounced(page, 'Synthetic Morning News 予約')
    await expect(otherPage.getByTestId('guide-program-4101')).toHaveClass(/reserve/)

    await page.getByTestId('guide-program-4101').click()
    const deleteDialog = page.getByRole('dialog', { name: 'Synthetic Morning News' })
    await expect(deleteDialog).toBeVisible()
    await deleteDialog.getByRole('button', { name: '削除' }).click()
    await expectAnnounced(page, 'Synthetic Morning News キャンセル')
    await expect(otherPage.getByTestId('guide-program-4101')).not.toHaveClass(/reserve/)
  } finally {
    await otherPage.close()
    await realtime.close()
  }
})

test('refreshes On Air list/watch and Recorded watch info from real Socket.IO updateStatus events', async ({
  page,
}, testInfo) => {
  const realtime = await createRealtimeHarness(page)

  try {
    const onAirMocks = await installGuideOnAirRealtimeApiMocks(page)
    await page.goto('/#/onair')
    await expect(page.getByTestId('onair-card-5101')).toContainText('Synthetic OnAir News')
    await realtime.waitForClient()

    onAirMocks.renameOnAirProgram('Synthetic OnAir News After Socket Update')
    await emitUntilTextAppears({
      emit: realtime.emitUpdateStatus,
      locator: page.getByTestId('onair-card-5101'),
      expected: 'Synthetic OnAir News After Socket Update',
    })

    await page.getByTestId('onair-card-body-5101').click()
    const dialog = page.getByRole('dialog', { name: 'ストリーム選択' })
    await expect(dialog).toBeVisible()
    await selectMuiOption({
      page,
      root: dialog,
      name: '配信方式',
      value: testInfo.project.name === 'iOS Safari' ? 'HLS' : 'WebM',
    })
    await dialog.getByRole('button', { name: '視聴' }).click()
    await expect(page).toHaveURL(/#\/onair\/watch\?/)
    await expect(page.getByTestId('onair-watch-info-card')).toContainText('Synthetic OnAir News')
    onAirMocks.renameLiveStream('Synthetic OnAir Watch After Socket Update')
    await emitUntilTextAppears({
      emit: realtime.emitUpdateStatus,
      locator: page.getByTestId('onair-watch-info-card'),
      expected: 'Synthetic OnAir Watch After Socket Update',
    })

    await page.unrouteAll()
    await installAppShellApiMocks(page, {
      socketIOPort: realtime.socketIOPort,
    })
    const recordedWatchMocks = await installVideoPlaybackRealtimeApiMocks(page)
    await page.goto(
      `/#/recorded/watch?videoId=${SYNTHETIC_DIRECT_VIDEO_FILE_ID}&recordedId=${SYNTHETIC_RECORDED_ID}`,
    )
    await expect(page.getByTestId('recorded-watch-info-card')).toContainText(
      'Synthetic Playback Program',
    )
    recordedWatchMocks.renameRecordedWatchProgram('Synthetic Recorded Watch After Socket Update')
    await emitUntilTextAppears({
      emit: realtime.emitUpdateStatus,
      locator: page.getByTestId('recorded-watch-info-card'),
      expected: 'Synthetic Recorded Watch After Socket Update',
    })

    recordedWatchMocks.renameRecordedWatchProgram(
      'Synthetic Recorded Streaming Watch After Socket Update',
    )
    await page.goto(
      `/#/recorded/streaming/${SYNTHETIC_STREAMING_VIDEO_FILE_ID}?streamingType=hls&fileType=encoded&mode=0&recordedId=${SYNTHETIC_RECORDED_ID}`,
    )
    await expect(page.getByTestId('recorded-watch-info-card')).toContainText(
      'Synthetic Recorded Watch After Socket Update',
    )
    await emitUntilTextAppears({
      emit: realtime.emitUpdateStatus,
      locator: page.getByTestId('recorded-watch-info-card'),
      expected: 'Synthetic Recorded Streaming Watch After Socket Update',
    })
  } finally {
    await realtime.close()
  }
})
