import { expect, test, type Page } from '@playwright/test'
import {
  NEXT_PROGRAM_ID,
  NEXT_PROGRAM_NAME,
  ON_AIR_PROGRAM_NAME,
  SYNTHETIC_SERVICE,
} from './support/realServer'

/*
 * 通常の e2e は `page.route` + msw の合成の応答で流れる（応答の形が v3 の server と食い違っても通る）。ここでは
 * 同じ画面を本物の v3 server（compile した server が配る client の build、本物の API、本物の Socket.IO）に繋いで
 * 動かし、合成の応答で確かめている画面が本物の応答でも描かれることを確かめる。
 */

const origin = (): string => {
  const value = process.env.EPGSTATION_REAL_SERVER_ORIGIN
  if (value === undefined) throw new Error('The real server origin is not set by the global setup')
  return value
}

const consoleErrors = (page: Page): string[] => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  return errors
}

// 番組表の表示時刻（`YYMMDDHH`、Asia/Tokyo）。
const guideTime = (epochMs: number): string => {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epochMs))
  const part = (type: string): string => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}${part('month')}${part('day')}${part('hour')}`
}

const reserveIds = async (page: Page): Promise<number[]> => {
  const response = await page.request.get(`${origin()}/api/reserves?isHalfWidth=false`)
  expect(response.ok()).toBe(true)
  const body = (await response.json()) as { reserves: Array<{ id: number }> }
  return body.reserves.map((reserve) => reserve.id)
}

const deleteAllReserves = async (page: Page): Promise<void> => {
  for (const id of await reserveIds(page)) {
    const response = await page.request.delete(`${origin()}/api/reserves/${id}`)
    expect(response.ok()).toBe(true)
  }
}

test.afterEach(async ({ page }) => {
  await deleteAllReserves(page)
})

test('serves the client build from the v3 server and renders the dashboard from the real API', async ({
  page,
}) => {
  const errors = consoleErrors(page)
  await page.goto(`${origin()}/#/`)

  await expect(page.getByTestId('dashboard-page')).toBeVisible()
  await expect(page.getByTestId('title-bar')).toBeVisible()
  expect(errors).toEqual([])
})

test('renders the real schedule in the guide and reserves a program through the real API', async ({
  page,
}) => {
  const errors = consoleErrors(page)
  const detail = (await (
    await page.request.get(`${origin()}/api/schedules/detail/${NEXT_PROGRAM_ID}?isHalfWidth=false`)
  ).json()) as { startAt: number }

  await page.goto(`${origin()}/#/guide?type=GR&time=${guideTime(detail.startAt)}`)
  await expect(page.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')
  const cell = page.getByTestId(`guide-program-${NEXT_PROGRAM_ID}`)
  await expect(cell).toContainText(NEXT_PROGRAM_NAME)
  await expect(cell).not.toHaveClass(/reserve/)

  await cell.click()
  const dialog = page.getByRole('dialog', { name: NEXT_PROGRAM_NAME })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '予約' }).click()

  await expect(cell).toHaveClass(/reserve/)
  await expect.poll(() => reserveIds(page)).toHaveLength(1)
  await expect(page.getByText('番組表情報の取得に失敗しました')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('updates the reserves list through the real Socket.IO notification when another client adds a reservation', async ({
  page,
}) => {
  const errors = consoleErrors(page)
  await page.goto(`${origin()}/#/reserves`)
  await expect(page.getByTestId('reserves-page')).toBeVisible()
  await expect(page.getByText(NEXT_PROGRAM_NAME)).toHaveCount(0)

  // 画面の外（別の client）から本物の API で予約を足す。server の Socket.IO の通知で一覧が読み直される。
  const added = await page.request.post(`${origin()}/api/reserves`, {
    data: { programId: NEXT_PROGRAM_ID, allowEndLack: true },
  })
  expect(added.ok()).toBe(true)

  await expect(
    page.getByTestId('reserves-list-item').filter({ hasText: NEXT_PROGRAM_NAME }),
  ).toHaveCount(1, {
    timeout: 15_000,
  })
  expect(errors).toEqual([])
})

test('renders the on-air list, recorded, recording, encode, search rule, and storages screens from the real API', async ({
  page,
}) => {
  const errors = consoleErrors(page)

  await page.goto(`${origin()}/#/onair`)
  const onAirCard = page.getByRole('article').filter({ hasText: ON_AIR_PROGRAM_NAME })
  await expect(onAirCard).toContainText(SYNTHETIC_SERVICE.name)
  await expect(onAirCard.getByRole('progressbar', { name: '進行状況' })).toBeVisible()

  await page.goto(`${origin()}/#/recorded`)
  await expect(page.getByTestId('recorded-page')).toBeVisible()
  await expect(page.getByTestId('recorded-list-item')).toHaveCount(0)

  await page.goto(`${origin()}/#/recording`)
  await expect(page.getByTestId('title-bar').getByRole('heading', { name: '録画中' })).toBeVisible()

  await page.goto(`${origin()}/#/encode`)
  await expect(
    page.getByTestId('title-bar').getByRole('heading', { name: 'エンコード' }),
  ).toBeVisible()

  await page.goto(`${origin()}/#/rule`)
  await expect(page.getByTestId('title-bar').getByRole('heading', { name: 'ルール' })).toBeVisible()

  await page.goto(`${origin()}/#/storages`)
  await expect(page.getByTestId('storages-page')).toHaveAttribute('data-storages-count', '1')
  await expect(page.getByTestId('storages-page')).toContainText('synthetic-storage')
  expect(errors).toEqual([])
})

test('serves the client and API under the configured subDirectory and receives the real Socket.IO notification on the prefixed path', async ({
  page,
}) => {
  const errors = consoleErrors(page)
  const base = process.env.EPGSTATION_REAL_SERVER_SUBDIRECTORY_URL
  if (base === undefined) throw new Error('The subDirectory server is not set')
  const socketPaths: string[] = []
  const apiPaths: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.includes('/socket.io/')) socketPaths.push(path)
    if (path.includes('/api/')) apiPaths.push(path)
  })
  page.on('websocket', (socket) => socketPaths.push(new URL(socket.url()).pathname))

  await page.goto(`${base}/#/reserves`)
  await expect(page.getByTestId('reserves-page')).toBeVisible()

  const added = await page.request.post(`${base}/api/reserves`, {
    data: { programId: NEXT_PROGRAM_ID, allowEndLack: true },
  })
  expect(added.ok()).toBe(true)
  try {
    await expect(
      page.getByTestId('reserves-list-item').filter({ hasText: NEXT_PROGRAM_NAME }),
    ).toHaveCount(1, {
      timeout: 15_000,
    })
    expect(socketPaths.length).toBeGreaterThan(0)
    expect(socketPaths.every((path) => path.startsWith('/synthetic-epgstation/socket.io/'))).toBe(
      true,
    )
    expect(apiPaths.length).toBeGreaterThan(0)
    expect(apiPaths.every((path) => path.startsWith('/synthetic-epgstation/api/'))).toBe(true)
    expect(errors).toEqual([])
  } finally {
    const body = (await (
      await page.request.get(`${base}/api/reserves?isHalfWidth=false`)
    ).json()) as {
      reserves: Array<{ id: number }>
    }
    for (const reserve of body.reserves)
      await page.request.delete(`${base}/api/reserves/${reserve.id}`)
  }
})

test.describe('service worker served by the real server', () => {
  test.use({ serviceWorkers: 'allow' })

  test('registers the real service worker with the default PWA setting and keeps the app working under its control', async ({
    page,
  }) => {
    const errors = consoleErrors(page)
    await page.goto(`${origin()}/#/`)
    await expect(page.getByTestId('dashboard-page')).toBeVisible()

    const scriptUrl = await page.evaluate(
      async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? '',
    )
    expect(new URL(scriptUrl).pathname).toBe('/serviceWorker.js')
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1)

    await page.reload()
    await expect
      .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
      .toBe(true)
    await expect(page.getByTestId('dashboard-page')).toBeVisible()
    await page.goto(`${origin()}/#/reserves`)
    await expect(page.getByTestId('reserves-page')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('removes the manifest at the next start after PWA is turned off', async ({ page }) => {
    await page.goto(`${origin()}/#/settings`)
    await page.getByRole('switch', { name: '全般 PWA' }).click()
    await page.getByRole('button', { name: '保存' }).click()
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (JSON.parse(localStorage.getItem('settings') ?? '{}') as { isEnablePWA?: boolean })
              .isEnablePWA,
        ),
      )
      .toBe(false)

    await page.reload()
    await expect(page.getByTestId('title-bar')).toBeVisible()
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(0)
  })
})
