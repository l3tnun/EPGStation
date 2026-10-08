import type { Page, Route } from '@playwright/test'
import { HttpResponse, getResponse, http } from 'msw'
import { manualProgramDetail, manualReserveEdit } from './manualReserveFixtures'
import { reservesMixedList, reservesStateFilters } from './reservesFixtures'

export {
  RESERVES_SYNTHETIC_LINK,
  reserveDialogFull,
  reserveDeleteTarget,
  reservesMixedList,
  reservesStateFilters,
} from './reservesFixtures'
export type { SyntheticReserve } from './reservesFixtures'
export {
  manualReserveOptions,
  manualProgramDetail,
  manualReserveEdit,
} from './manualReserveFixtures'

export interface ReservesApiCall {
  method: string
  pathname: string
  search: string
  body?: unknown
}

export interface ReservesMockController {
  calls: ReservesApiCall[]
}

export interface ReservesRealtimeMockController extends ReservesMockController {
  clearReserves: () => void
}

async function fulfillMswResponse(route: Route, response: Response): Promise<void> {
  const headers = Object.fromEntries(response.headers.entries())

  await route.fulfill({
    status: response.status,
    headers,
    body: Buffer.from(await response.arrayBuffer()),
  })
}

async function createMswRequest(route: Route): Promise<Request> {
  const request = route.request()
  const method = request.method()
  const headers = new Headers(request.headers())

  if (method === 'GET' || method === 'HEAD') {
    return new Request(request.url(), { method, headers })
  }

  return new Request(request.url(), {
    method,
    headers,
    body: request.postData() ?? undefined,
  })
}

function pathnameOf(request: Request): string {
  return new URL(request.url).pathname
}

function recordCall(calls: ReservesApiCall[], request: Request, body?: unknown): void {
  const url = new URL(request.url)

  calls.push({
    method: request.method,
    pathname: url.pathname,
    search: url.search,
    ...(body === undefined ? {} : { body }),
  })
}

function reserveListForType(type: string | null) {
  const stateFilter = reservesStateFilters.find((filter) => filter.routeType === type)

  if (stateFilter !== undefined) {
    return stateFilter.reserves
  }

  return reservesMixedList
}

function createReservesHandlers(calls: ReservesApiCall[]) {
  return [
    http.get(
      ({ request }) => pathnameOf(request).endsWith('/api/reserves'),
      ({ request }) => {
        recordCall(calls, request)
        const parameters = new URL(request.url).searchParams
        const reserves = reserveListForType(parameters.get('type'))

        return HttpResponse.json({
          reserves,
          total: reserves.length,
        })
      },
    ),
    http.get(
      ({ request }) => pathnameOf(request).endsWith(`/api/reserves/${manualReserveEdit.id}`),
      ({ request }) => {
        recordCall(calls, request)

        return HttpResponse.json(manualReserveEdit)
      },
    ),
    http.get(
      ({ request }) =>
        pathnameOf(request).endsWith(`/api/schedules/detail/${manualProgramDetail.id}`),
      ({ request }) => {
        recordCall(calls, request)

        return HttpResponse.json(manualProgramDetail)
      },
    ),
    http.post(
      ({ request }) => pathnameOf(request).endsWith('/api/reserves/update'),
      ({ request }) => {
        recordCall(calls, request)

        return new HttpResponse(null, { status: 204 })
      },
    ),
    http.post(
      ({ request }) => pathnameOf(request).endsWith('/api/reserves'),
      async ({ request }) => {
        const body = await request.json()
        recordCall(calls, request, body)

        return HttpResponse.json({ reserveId: 8101 })
      },
    ),
    http.put(
      ({ request }) => pathnameOf(request).endsWith(`/api/reserves/${manualReserveEdit.id}`),
      async ({ request }) => {
        const body = await request.json()
        recordCall(calls, request, body)

        return HttpResponse.json({ code: 201, message: 'ok' }, { status: 201 })
      },
    ),
    http.delete(
      ({ request }) => /\/api\/reserves\/\d+(?:\/skip|\/overlap)?$/.test(pathnameOf(request)),
      ({ request }) => {
        recordCall(calls, request)

        return new HttpResponse(null, { status: 204 })
      },
    ),
  ]
}

export async function installReservesApiMocks(page: Page): Promise<ReservesMockController> {
  const calls: ReservesApiCall[] = []
  const handlers = createReservesHandlers(calls)

  await page.route('**/api/**', async (route) => {
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })

  return { calls }
}

export async function installReservesRealtimeApiMocks(
  page: Page,
): Promise<ReservesRealtimeMockController> {
  const calls: ReservesApiCall[] = []
  let isCleared = false
  const handlers = [
    http.get(
      ({ request }) => pathnameOf(request).endsWith('/api/reserves'),
      ({ request }) => {
        recordCall(calls, request)
        const parameters = new URL(request.url).searchParams
        const reserves = isCleared ? [] : reserveListForType(parameters.get('type'))

        return HttpResponse.json({
          reserves,
          total: reserves.length,
        })
      },
    ),
    ...createReservesHandlers(calls),
  ]

  await page.route('**/api/**', async (route) => {
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })

  return {
    calls,
    clearReserves: () => {
      isCleared = true
    },
  }
}
