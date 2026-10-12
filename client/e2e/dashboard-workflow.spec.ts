import { expect, test } from '@playwright/test'
import { createServer } from 'node:http'
import { Server as SocketIOServer } from 'socket.io'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  createDashboardRequestLog,
  dashboardFixtureSecrecyText,
  installDashboardRealtimeApiMocks,
  installDashboardWorkflowApiMocks,
} from './support/dashboardMocks'
import { clickWithoutPointerStabilityWait } from './support/pointerInteractions'
import { expectAnnounced } from './support/notificationObservation'

test.beforeEach(async ({ page }) => {
  await installAppShellApiMocks(page, { enableBroadcastWaveNavigation: true })
})

test('uses only synthetic Dashboard fixture values', () => {
  const forbiddenFixturePatterns = [
    /kodi:\/\/|synthetic-view:\/\/|synthetic-download:\/\//i,
    /user(name)?|password|token|secret|authorization/i,
    /\/Users\/|\/home\/[^/]+\/|[A-Z]:\\/,
    /ffmpeg|ffprobe|encoder(command|path)|command/i,
  ]

  for (const pattern of forbiddenFixturePatterns) {
    expect(dashboardFixtureSecrecyText).not.toMatch(pattern)
  }
})

test('drives Dashboard loading, summary actions, and delegated entrypoints', async ({ page }) => {
  const requestLog = createDashboardRequestLog()
  await installDashboardWorkflowApiMocks(page, { mode: 'slow', requestLog })

  await page.goto('/')
  await expect(page.getByTestId('dashboard-page')).toHaveCount(0)
  await expect(page.getByTestId('dashboard-page')).toBeVisible()
  await expect(page.getByRole('heading', { name: '録画中 1/3' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '録画済み 2/3' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '予約 2/3' })).toBeVisible()
  await expect(page.getByRole('button', { name: '競合 2 件' })).toBeVisible()
  const recordingCard = page.getByTestId('dashboard-recording-summary-item')
  await expect(recordingCard).toContainText('Synthetic Dashboard Recording Alpha')
  await expect(recordingCard).toContainText('Synthetic Dashboard Channel A')
  await expect(recordingCard.getByRole('img')).toHaveCount(0)
  // v3 contract: only the recorded-section row gets an explicit height (DashboardPage.module.css
  // `.section[data-testid='dashboard-section-recorded'] .item { height: 100px }`); the recording
  // row renders no thumbnail (see DashboardRecordsSection.tsx) and sizes to its text content, so it
  // must stay under that 100px row height. v2 (Dashboard.vue/RecordedSmallCard.vue `.recorded-small-card`)
  // fixed both rows at height:100px regardless of thumbnail, so this shorter-row behavior has no v2 source.
  await expect
    .poll(() => recordingCard.evaluate((element) => element.getBoundingClientRect().height))
    .toBeLessThan(100)
  const recordedNoImage = page.getByTestId('dashboard-recorded-no-image').first()
  await expect(recordedNoImage).toBeVisible()
  await expect(recordedNoImage).toHaveAttribute('src', /img\/noimg\.png$/)
  await expect(recordedNoImage).toHaveCSS('max-width', '200px')
  await expect(recordedNoImage).toHaveCSS('height', '100px')
  expect(requestLog.apiPaths).toContain('/api/recording?isHalfWidth=true&offset=0&limit=24')
  expect(requestLog.apiPaths).toContain('/api/recorded?isHalfWidth=true&offset=0&limit=24')
  expect(requestLog.apiPaths).toContain(
    '/api/reserves?type=normal&isHalfWidth=true&offset=0&limit=24',
  )

  await expect(page.getByRole('button', { name: 'MORE' })).toHaveCount(3)
  await page
    .getByTestId('dashboard-section-recorded-list')
    .getByRole('button', { name: 'MORE' })
    .click()
  await expect(page).toHaveURL(/#\/recorded\?page=2&timestamp=\d+$/)

  await page.goto('/')
  await page.getByRole('button', { name: '競合 2 件' }).click()
  await expect(page).toHaveURL(/#\/reserves\?type=conflict&timestamp=\d+$/)

  await page.goto('/')
  await page
    .getByTestId('dashboard-section-recorded-list')
    .getByRole('button', { name: 'Synthetic Dashboard Recorded Alpha', exact: true })
    .click()
  await expect(page).toHaveURL(/#\/recorded\/detail\/7201\?timestamp=\d+$/)

  await page.goto('/')
  await page
    .getByTestId('dashboard-section-reserves-list')
    .getByRole('button', { name: 'Synthetic Dashboard Reserve Alpha', exact: true })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Synthetic Dashboard Reserve Alpha' })
  await expect(dialog).toBeVisible()
  await expect
    .poll(async () =>
      dialog.evaluate((element) => {
        const root = element.closest('.MuiDialog-root')
        const backdrop = root?.querySelector('.MuiBackdrop-root')
        const container = root?.querySelector('.MuiDialog-container')
        const durations = [root, backdrop, container, element]
          .filter((node): node is Element => node !== null)
          .map((node) => getComputedStyle(node).transitionDuration)

        return durations.some((duration) => !/^0(?:s|ms)(?:, 0(?:s|ms))*$/.test(duration))
      }),
    )
    .toBe(true)
  await expect(
    dialog.getByRole('link', { name: 'https://example.invalid/dashboard-reserve' }),
  ).toBeVisible()
  await dialog.getByRole('button', { name: /05\/05\(火\) 10:15/ }).click()
  await expect(page).toHaveURL(/#\/guide\?time=26050510&type=GR&timestamp=\d+$/)

  await page.goto('/')
  await page
    .getByRole('button', { name: '録画メニュー: Synthetic Dashboard Recorded Alpha' })
    .click()
  await page.getByRole('menuitem', { name: 'search' }).click()
  await expect(page).toHaveURL(/#\/recorded\?ruleId=8201&timestamp=\d+$/)

  await page.goto('/')
  await page
    .getByRole('button', { name: '録画メニュー: Synthetic Dashboard Recorded Title Search' })
    .click()
  await page.getByRole('menuitem', { name: 'search' }).click()
  await expect(page).toHaveURL(
    /#\/recorded\?keyword=Synthetic\+Dashboard\+Recorded\+Title\+Search&timestamp=\d+$/,
  )

  await page.goto('/')
  await page
    .getByRole('button', { name: '録画メニュー: Synthetic Dashboard Recorded Alpha' })
    .click()
  await page.getByRole('menuitem', { name: 'protect' }).click()
  await expect.poll(() => requestLog.methods).toContain('PUT /api/recorded/7201/protect')
  await expectAnnounced(page, '保護に成功')

  await clickWithoutPointerStabilityWait(
    page.getByRole('button', { name: '予約メニュー: Synthetic Dashboard Reserve Delete' }),
  )
  await clickWithoutPointerStabilityWait(page.getByRole('menuitem', { name: 'delete' }))
  await expect(page.getByRole('dialog', { name: '予約削除' })).toBeVisible()
  await clickWithoutPointerStabilityWait(page.getByRole('button', { name: '削除' }))
  await expect.poll(() => requestLog.methods).toContain('DELETE /api/reserves/7302')
  await expect(
    page
      .getByTestId('dashboard-section-reserves-list')
      .getByText('Synthetic Dashboard Reserve Delete'),
  ).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '予約 1/2' })).toBeVisible()
})

test('renders Dashboard empty and failure states without empty copy', async ({ page }) => {
  await installDashboardWorkflowApiMocks(page, { mode: 'empty' })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '録画中 0/0' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '録画済み 0/0' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '予約 0/0' })).toBeVisible()
  await expect(page.getByText(/empty/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'MORE' })).toHaveCount(0)

  await page.unrouteAll()
  await installAppShellApiMocks(page)
  await installDashboardWorkflowApiMocks(page, { mode: 'failure' })
  await page.goto('/?timestamp=failure')

  await expect(page.getByRole('heading', { name: '録画中 0/0' })).toBeVisible()
  await expectAnnounced(page, '予約データ取得に失敗')
})

test('refreshes visible Dashboard summaries from a real Socket.IO updateStatus event', async ({
  page,
}) => {
  const httpServer = createServer()
  const socketServer = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
    path: '/socket.io',
  })

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve)
  })

  const address = httpServer.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Socket.IO test server did not bind to a TCP port')
  }

  try {
    const requestLog = createDashboardRequestLog()
    await page.unrouteAll()
    await installAppShellApiMocks(page, { socketIOPort: address.port })
    const realtimeMocks = await installDashboardRealtimeApiMocks(page, { requestLog })

    await page.goto('/')
    await expect(page.getByRole('heading', { name: '録画中 1/1' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '録画済み 2/2' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '予約 2/2' })).toBeVisible()
    await expect(page.getByText('Synthetic Dashboard Recording Alpha')).toBeVisible()

    // v3 realtime contract: a real Socket.IO server/client pair is used here (no mock), so this
    // just confirms the browser's socket has actually connected before the updateStatus event is
    // emitted below; there is no v2 source for a specific client count.
    await expect
      .poll(() => socketServer.engine.clientsCount, { timeout: 10_000 })
      .toBeGreaterThan(0)

    const recordingRequestCountBeforeUpdate = requestLog.methods.filter(
      (method) => method === 'GET /api/recording',
    ).length

    realtimeMocks.clearSummaries()
    socketServer.emit('updateStatus')

    await expect(page.getByRole('heading', { name: '録画中 0/0' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '録画済み 0/0' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '予約 0/0' })).toBeVisible()
    await expect(page.getByText('Synthetic Dashboard Recording Alpha')).toHaveCount(0)
    // v3 realtime contract: a `updateStatus` Socket.IO event must trigger a fresh GET /api/recording
    // refetch, mirroring v2's onUpdateStatusCallback (views/Dashboard.vue:111-115), which re-fetches
    // recording/recorded/reserves state on the same event; no v2 source for a specific request count.
    expect(
      requestLog.methods.filter((method) => method === 'GET /api/recording').length,
    ).toBeGreaterThan(recordingRequestCountBeforeUpdate)
  } finally {
    await new Promise<void>((resolve) => {
      socketServer.close(() => {
        httpServer.close(() => resolve())
      })
    })
  }
})
