import {
  countRecordedDetailRequests,
  countRequests,
  emitUntilRequestCountIncreases,
  createRealtimeHarness,
} from './support/realtimeHarness'
import { expect, test } from '@playwright/test'
import { installAppShellApiMocks } from './support/appShellMocks'
import {
  createRecordedRequestLog,
  installRecordedRealtimeApiMocks,
  SYNTHETIC_RECORDED_DETAIL_ID,
} from './support/recordedMocks'
import {
  createRecordingEncodeRequestLog,
  installRecordingEncodeRealtimeApiMocks,
} from './support/recordingEncodeMocks'
import { installReservesRealtimeApiMocks } from './support/reservesMocks'
import {
  createSearchRuleRequestLog,
  installSearchRuleRealtimeApiMocks,
} from './support/searchRuleMocks'
import { installStoragesRealtimeApiMocks } from './support/storagesUploadMocks'

test.describe.configure({ mode: 'serial' })

test('refreshes Recorded list and detail from real Socket.IO updateStatus events', async ({
  page,
}) => {
  const realtime = await createRealtimeHarness(page)

  try {
    const listLog = createRecordedRequestLog()
    const listMocks = await installRecordedRealtimeApiMocks(page, listLog)
    await page.goto('/#/recorded')
    await expect(page.getByText('Synthetic Recorded Matrix A')).toBeVisible()
    await realtime.waitForClient()

    const listRequestCountBeforeUpdate = listLog.apiPaths.filter((path) =>
      path.startsWith('/api/recorded?'),
    ).length

    listMocks.clearRecordedList()
    realtime.emitUpdateStatus()

    await expect(page.getByText('Synthetic Recorded Matrix A')).toHaveCount(0)
    // Provenance (A + D): v2 wires exactly this contract — Recorded.vue:113
    // (`socketIoModel.onUpdateState(this.onUpdateStatusCallback)`) and :90-92
    // (`onUpdateStatusCallback` awaits `recordedState.fetchData(...)`) refetch the list on every
    // `updateStatus` event (v2 reference: client/src/views/Recorded.vue). v3 refetches via
    // src/app/realtimeInvalidation.ts invalidating RECORDED_QUERY_KEY, which can fan out to more
    // than one active query instance, so "greater than" (not an exact +1) is the correct check.
    expect(
      listLog.apiPaths.filter((path) => path.startsWith('/api/recorded?')).length,
    ).toBeGreaterThan(listRequestCountBeforeUpdate)
  } finally {
    await realtime.close()
  }
})

test('refreshes Recorded detail info from a real Socket.IO updateStatus event', async ({
  page,
}) => {
  const realtime = await createRealtimeHarness(page)

  try {
    const requestLog = createRecordedRequestLog()
    const mocks = await installRecordedRealtimeApiMocks(page, requestLog)
    await page.goto(`/#/recorded/detail/${SYNTHETIC_RECORDED_DETAIL_ID}`)
    await expect(page.getByTestId('recorded-detail-page')).toContainText('Synthetic Detail Target')
    await realtime.waitForClient()

    const detailRequestCountBeforeUpdate = countRecordedDetailRequests(requestLog.apiPaths)

    mocks.renameRecordedDetail('Synthetic Detail Target After Socket Update')
    realtime.emitUpdateStatus()

    await expect(page.getByTestId('recorded-detail-page')).toContainText(
      'Synthetic Detail Target After Socket Update',
    )
    // Provenance (A + D): v2 client/src/views/RecordedDetail.vue:145
    // (`socketIoModel.onUpdateState(this.onUpdateStatusCallback)`) and :132-134
    // (`onUpdateStatusCallback` awaits `this.fetchData()`) refetch the detail view on every
    // `updateStatus` event. Same "greater than" reasoning as the list refresh test above (v3's
    // query invalidation can fan out to more than one request).
    expect(countRecordedDetailRequests(requestLog.apiPaths)).toBeGreaterThan(
      detailRequestCountBeforeUpdate,
    )
  } finally {
    await realtime.close()
  }
})

test('refreshes Recording and Encode pages from real Socket.IO events', async ({ page }) => {
  const realtime = await createRealtimeHarness(page)

  try {
    const requestLog = createRecordingEncodeRequestLog()
    const mocks = await installRecordingEncodeRealtimeApiMocks(page, requestLog)

    await page.goto('/#/recording')
    await expect(page.getByText('Synthetic Recording Alpha', { exact: true })).toBeVisible()
    await realtime.waitForClient()

    const recordingRequestCountBeforeUpdate = countRequests(
      requestLog.methods,
      'GET /api/recording',
    )
    mocks.clearRecording()
    realtime.emitUpdateStatus()

    await expect(page.getByText('Synthetic Recording Alpha')).toHaveCount(0)
    // Provenance (A + D): v2 client/src/views/Recording.vue:94
    // (`socketIoModel.onUpdateState(this.onUpdateStatusCallback)`) and :82-84
    // (`onUpdateStatusCallback` awaits `recordingState.fetchData(...)`) refetch this page on
    // every `updateStatus` event. Same "greater than" reasoning as the Recorded refresh checks
    // above.
    expect(countRequests(requestLog.methods, 'GET /api/recording')).toBeGreaterThan(
      recordingRequestCountBeforeUpdate,
    )

    await page.goto('/#/encode')
    await expect(page.getByText('Synthetic Encode Running')).toBeVisible()
    const encodeRequestCountBeforeUpdate = countRequests(requestLog.methods, 'GET /api/encode')

    mocks.clearEncode()

    await emitUntilRequestCountIncreases({
      emit: realtime.emitUpdateEncode,
      getRequestCount: () => countRequests(requestLog.methods, 'GET /api/encode'),
      previousCount: encodeRequestCountBeforeUpdate,
    })
    await expect(page.getByTestId('encode-page')).toHaveAttribute('data-running-count', '0', {
      timeout: 15_000,
    })
    await expect(page.getByTestId('encode-page')).toHaveAttribute('data-waiting-count', '0', {
      timeout: 15_000,
    })
    await expect(page.getByText('Synthetic Encode Running')).toHaveCount(0)
  } finally {
    await realtime.close()
  }
})

test('refreshes Reserves, Rule, Search, and Storages pages from real Socket.IO updateStatus events', async ({
  page,
}) => {
  const realtime = await createRealtimeHarness(page)

  try {
    const reserveMocks = await installReservesRealtimeApiMocks(page)
    await page.goto('/#/reserves')
    await expect(page.getByText('Synthetic Dialog Full Reserve')).toBeVisible()
    await realtime.waitForClient()

    reserveMocks.clearReserves()
    realtime.emitUpdateStatus()

    await expect(page.getByText('Synthetic Dialog Full Reserve')).toHaveCount(0)
    await expect(page.getByTestId('reserves-page')).toHaveAttribute('data-reserves-total', '0')

    await page.unrouteAll()
    await installAppShellApiMocks(page, {
      socketIOPort: realtime.socketIOPort,
    })
    const searchRuleLog = createSearchRuleRequestLog()
    const searchRuleMocks = await installSearchRuleRealtimeApiMocks(page, {
      requestLog: searchRuleLog,
    })

    await page.goto('/#/rule')
    await expect(page.getByText('Synthetic Rule Alpha')).toBeVisible()
    const ruleRequestCountBeforeUpdate = countRequests(searchRuleLog.methods, 'GET /api/rules')
    searchRuleMocks.clearRuleList()
    await emitUntilRequestCountIncreases({
      emit: realtime.emitUpdateStatus,
      getRequestCount: () => countRequests(searchRuleLog.methods, 'GET /api/rules'),
      previousCount: ruleRequestCountBeforeUpdate,
    })
    await expect(page.getByText('Synthetic Rule Alpha')).toHaveCount(0)

    await page.goto('/#/search')
    await page.getByTestId('search-rule-page').getByRole('button', { name: '検索' }).click()
    await expect(page.getByRole('region', { name: '検索結果' })).toContainText(
      'Synthetic Search Program Alpha',
    )
    const searchRequestCountBeforeUpdate = countRequests(
      searchRuleLog.methods,
      'POST /api/schedules/search',
    )
    searchRuleMocks.clearSearchPrograms()
    await emitUntilRequestCountIncreases({
      emit: realtime.emitUpdateStatus,
      getRequestCount: () => countRequests(searchRuleLog.methods, 'POST /api/schedules/search'),
      previousCount: searchRequestCountBeforeUpdate,
    })
    await expect(page.getByText('Synthetic Search Program Alpha')).toHaveCount(0)

    await page.unrouteAll()
    await installAppShellApiMocks(page, {
      socketIOPort: realtime.socketIOPort,
    })
    const storageMocks = await installStoragesRealtimeApiMocks(page)
    await page.goto('/#/storages')
    await expect(page.getByText('Synthetic archive storage - 1.3GB')).toBeVisible()
    await realtime.waitForClient()
    const storagesRequestCountBeforeUpdate = storageMocks.getStoragesRequests()
    storageMocks.clearStorages()
    await emitUntilRequestCountIncreases({
      emit: realtime.emitUpdateStatus,
      getRequestCount: storageMocks.getStoragesRequests,
      previousCount: storagesRequestCountBeforeUpdate,
    })
    await expect(page.getByText('Synthetic archive storage - 1.3GB')).toHaveCount(0)
  } finally {
    await realtime.close()
  }
})
