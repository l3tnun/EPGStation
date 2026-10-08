import type { Page } from '@playwright/test'
import { HttpResponse, getResponse, http } from 'msw'
import { createMswRequest, fulfillMswResponse } from './appShellMocks'
import { recordingItems, recordedItems, reserveItems, expandForOverflow } from './dashboardFixtures'

export type DashboardMockMode = 'success' | 'empty' | 'failure' | 'slow' | 'overflow'

export interface DashboardRequestLog {
  apiPaths: string[]
  methods: string[]
  bodies: unknown[]
}

export function createDashboardRequestLog(): DashboardRequestLog {
  return {
    apiPaths: [],
    methods: [],
    bodies: [],
  }
}

export { dashboardFixtureSecrecyText } from './dashboardFixtures'

function delayedResponse<T>(value: T, ms = 300): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms)
  })
}

function pathnameOf(request: Request): string {
  return new URL(request.url).pathname
}

function createDashboardHandlers(mode: DashboardMockMode, requestLog?: DashboardRequestLog) {
  const maybeSlow = <T>(response: T) => (mode === 'slow' ? delayedResponse(response) : response)
  const deletedReserveIds = new Set<number>()

  return [
    http.get(
      ({ request }) => pathnameOf(request).endsWith('/api/reserves/cnts'),
      () => {
        if (mode === 'failure') {
          return HttpResponse.json({ error: 'synthetic-dashboard-counts-failure' }, { status: 503 })
        }

        return maybeSlow(
          HttpResponse.json({
            normal: mode === 'empty' ? 0 : 2,
            conflicts: mode === 'empty' ? 0 : 2,
            skips: 0,
            overlaps: 0,
          }),
        )
      },
    ),
    http.get(
      ({ request }) => pathnameOf(request).endsWith('/api/recording'),
      () => {
        if (mode === 'failure') {
          return HttpResponse.json(
            { error: 'synthetic-dashboard-recording-failure' },
            { status: 503 },
          )
        }

        return maybeSlow(
          HttpResponse.json({
            records:
              mode === 'empty'
                ? []
                : mode === 'overflow'
                  ? expandForOverflow(recordingItems, 8)
                  : recordingItems,
            total: mode === 'empty' ? 0 : mode === 'overflow' ? 8 : 3,
          }),
        )
      },
    ),
    http.get(
      ({ request }) => pathnameOf(request).endsWith('/api/recorded'),
      () => {
        if (mode === 'failure') {
          return HttpResponse.json(
            { error: 'synthetic-dashboard-recorded-failure' },
            { status: 503 },
          )
        }

        return maybeSlow(
          HttpResponse.json({
            records:
              mode === 'empty'
                ? []
                : mode === 'overflow'
                  ? expandForOverflow(recordedItems, 8)
                  : recordedItems,
            total: mode === 'empty' ? 0 : mode === 'overflow' ? 8 : 3,
          }),
        )
      },
    ),
    http.get(
      ({ request }) => pathnameOf(request).endsWith('/api/reserves'),
      () => {
        if (mode === 'failure') {
          return HttpResponse.json(
            { error: 'synthetic-dashboard-reserves-failure' },
            { status: 503 },
          )
        }

        return maybeSlow(
          HttpResponse.json({
            reserves:
              mode === 'empty'
                ? []
                : (mode === 'overflow' ? expandForOverflow(reserveItems, 8) : reserveItems).filter(
                    (item) => !deletedReserveIds.has(item.id),
                  ),
            total:
              mode === 'empty'
                ? 0
                : mode === 'overflow'
                  ? Math.max(0, 8 - deletedReserveIds.size)
                  : Math.max(0, 3 - deletedReserveIds.size),
          }),
        )
      },
    ),
    http.put(
      ({ request }) => /\/api\/recorded\/\d+\/protect$/.test(pathnameOf(request)),
      () => HttpResponse.json({ result: 'ok' }),
    ),
    http.delete(
      ({ request }) =>
        /\/api\/recorded\/\d+\/encode$/.test(pathnameOf(request)) ||
        /\/api\/reserves\/\d+$/.test(pathnameOf(request)),
      ({ request }) => {
        const reserveMatch = pathnameOf(request).match(/\/api\/reserves\/(\d+)$/)
        if (reserveMatch !== null) {
          deletedReserveIds.add(Number(reserveMatch[1]))
        }

        return new HttpResponse(null, { status: 204 })
      },
    ),
    http.post(
      ({ request }) => pathnameOf(request).endsWith('/api/encode'),
      async ({ request }) => {
        requestLog?.bodies.push(await request.json())
        return HttpResponse.json({ result: 'ok' })
      },
    ),
  ]
}

export async function installDashboardWorkflowApiMocks(
  page: Page,
  {
    mode = 'success',
    requestLog,
  }: {
    mode?: DashboardMockMode
    requestLog?: DashboardRequestLog
  } = {},
): Promise<void> {
  const handlers = createDashboardHandlers(mode, requestLog)

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    requestLog?.apiPaths.push(`${url.pathname}${url.search}`)
    requestLog?.methods.push(`${route.request().method()} ${url.pathname}`)
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })
}

export async function installDashboardRealtimeApiMocks(
  page: Page,
  { requestLog }: { requestLog?: DashboardRequestLog } = {},
): Promise<{ clearSummaries: () => void }> {
  let isCleared = false

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const pathname = url.pathname
    requestLog?.apiPaths.push(`${url.pathname}${url.search}`)
    requestLog?.methods.push(`${route.request().method()} ${url.pathname}`)

    if (pathname.endsWith('/api/reserves/cnts')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          normal: isCleared ? 0 : 2,
          conflicts: 0,
          skips: 0,
          overlaps: 0,
        }),
      })
      return
    }

    if (pathname.endsWith('/api/recording')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          records: isCleared ? [] : recordingItems,
          total: isCleared ? 0 : 1,
        }),
      })
      return
    }

    if (pathname.endsWith('/api/recorded')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          records: isCleared ? [] : recordedItems,
          total: isCleared ? 0 : 2,
        }),
      })
      return
    }

    if (pathname.endsWith('/api/reserves')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          reserves: isCleared ? [] : reserveItems,
          total: isCleared ? 0 : 2,
        }),
      })
      return
    }

    await route.fallback()
  })

  return {
    clearSummaries: () => {
      isCleared = true
    },
  }
}
