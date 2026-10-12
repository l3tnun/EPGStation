import type { Page, Route } from '@playwright/test'
import { recordedListItems } from './recordedFixtures'
import { recordingItems } from './recordingEncodeFixtures'
import { reservesMixedList } from './reservesFixtures'

/** Screens that page a list and so switch between the current and the extended pagination. */
export type PagedListScreen = 'recorded' | 'recording' | 'reserves'

/** 1,125 synthetic items at the default 24 per page: 47 pages, more than the widest row shows. */
export const PAGED_LIST_TOTAL = 1125
export const PAGED_LIST_PAGE_SIZE = 24
export const PAGED_LIST_LAST_PAGE = Math.ceil(PAGED_LIST_TOTAL / PAGED_LIST_PAGE_SIZE)

/** The name of the item at `position` (0-based) of the whole list; it tells which page it came from. */
export function pagedItemName(position: number): string {
  return `Synthetic Paged Item ${10000 + position}`
}

/** The position of the first item shown on `listPage` (1-based). */
export function firstPositionOf(listPage: number): number {
  return (listPage - 1) * PAGED_LIST_PAGE_SIZE
}

function windowOf(route: Route): { offset: number; count: number } {
  const parameters = new URL(route.request().url()).searchParams
  const limit = Number(parameters.get('limit') ?? PAGED_LIST_PAGE_SIZE)
  const offset = Number(parameters.get('offset') ?? 0)

  return { offset, count: Math.max(0, Math.min(limit, PAGED_LIST_TOTAL - offset)) }
}

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
}

/**
 * Serves the list endpoints of the recorded, recording and reserves screens as one long list
 * each, cut by the `limit` and `offset` the app asks for. Other endpoints (and the detail
 * endpoints) fall through to the mocks installed earlier. Install it after them.
 */
export async function installPagedListApiMocks(page: Page): Promise<void> {
  await page.route(
    (url) => /\/api\/(recorded|recording|reserves)$/.test(url.pathname),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()
        return
      }
      const { offset, count } = windowOf(route)
      const pathname = new URL(route.request().url()).pathname

      if (pathname.endsWith('/recorded')) {
        await fulfillJson(route, {
          records: Array.from({ length: count }, (_, index) => ({
            ...recordedListItems[index % recordedListItems.length],
            id: 20000 + offset + index,
            name: pagedItemName(offset + index),
          })),
          total: PAGED_LIST_TOTAL,
        })
      } else if (pathname.endsWith('/recording')) {
        await fulfillJson(route, {
          records: Array.from({ length: count }, (_, index) => ({
            ...recordingItems[index % recordingItems.length],
            id: 30000 + offset + index,
            name: pagedItemName(offset + index),
          })),
          total: PAGED_LIST_TOTAL,
        })
      } else {
        await fulfillJson(route, {
          reserves: Array.from({ length: count }, (_, index) => ({
            ...reservesMixedList[index % reservesMixedList.length],
            id: 40000 + offset + index,
            reserveId: 40000 + offset + index,
            name: pagedItemName(offset + index),
          })),
          total: PAGED_LIST_TOTAL,
        })
      }
    },
  )
}
