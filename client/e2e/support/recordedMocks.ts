import type { Page } from '@playwright/test'
import { HttpResponse, getResponse, http } from 'msw'
import { createMswRequest, fulfillMswResponse } from './appShellMocks'
import {
  SYNTHETIC_RECORDED_RECORDING_DETAIL_ID,
  SYNTHETIC_RECORDED_ZERO_DROP_DETAIL_ID,
  longRecordedListItems,
  recordedDetail,
  recordedListItems,
  recordedOptions,
  recordedRecordingDetail,
  recordedZeroDropDetail,
  ruleKeywords,
} from './recordedFixtures'

export {
  SYNTHETIC_RECORDED_LIST_ID,
  SYNTHETIC_RECORDED_DETAIL_ID,
  SYNTHETIC_RECORDED_ZERO_DROP_DETAIL_ID,
  SYNTHETIC_RECORDED_RECORDING_DETAIL_ID,
  SYNTHETIC_RECORDED_ORIGINAL_VIDEO_ID,
  SYNTHETIC_RECORDED_ENCODED_VIDEO_ID,
  recordedFixtureSecrecyText,
} from './recordedFixtures'

export type RecordedMockMode =
  'success' | 'empty' | 'list-failure' | 'detail-failure' | 'slow-list' | 'long-list'

export interface RecordedRequestLog {
  apiPaths: string[]
  bodies: unknown[]
}

export function createRecordedRequestLog(): RecordedRequestLog {
  return { apiPaths: [], bodies: [] }
}

function delayedResponse<T>(value: T, ms = 300): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms)
  })
}

function createRecordedHandlers(mode: RecordedMockMode, log?: RecordedRequestLog) {
  return [
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/recorded'),
      async () => {
        if (mode === 'list-failure') {
          return HttpResponse.json({ error: 'synthetic-recorded-list-failure' }, { status: 503 })
        }

        const records =
          mode === 'empty' ? [] : mode === 'long-list' ? longRecordedListItems : recordedListItems
        const response = HttpResponse.json({
          records,
          total: records.length,
        })

        return mode === 'slow-list' ? delayedResponse(response) : response
      },
    ),
    http.get(
      ({ request }) => /\/api\/recorded\/\d+$/.test(new URL(request.url).pathname),
      ({ request }) => {
        if (mode === 'detail-failure') {
          return HttpResponse.json({ error: 'synthetic-recorded-detail-failure' }, { status: 503 })
        }

        const id = Number(new URL(request.url).pathname.split('/').at(-1))

        if (id === SYNTHETIC_RECORDED_ZERO_DROP_DETAIL_ID) {
          return HttpResponse.json(recordedZeroDropDetail)
        }
        if (id === SYNTHETIC_RECORDED_RECORDING_DETAIL_ID) {
          return HttpResponse.json(recordedRecordingDetail)
        }

        return HttpResponse.json(recordedDetail)
      },
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/recorded/options'),
      () => HttpResponse.json(recordedOptions),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/rules/keyword'),
      () => HttpResponse.json(ruleKeywords),
    ),
    http.get(
      ({ request }) => /\/api\/rules\/\d+$/.test(new URL(request.url).pathname),
      () => HttpResponse.json({ id: 5101, keyword: 'Synthetic Recorded Rule' }),
    ),
    http.get(
      ({ request }) => /\/api\/dropLogs\/\d+$/.test(new URL(request.url).pathname),
      () => HttpResponse.text('Synthetic drop log content'),
    ),
    http.get(
      ({ request }) => /\/api\/thumbnails\/\d+$/.test(new URL(request.url).pathname),
      () =>
        HttpResponse.arrayBuffer(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer, {
          headers: { 'content-type': 'image/png' },
        }),
    ),
    http.post(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/recorded/cleanup'),
      async () => {
        await delayedResponse(undefined, 50)
        return HttpResponse.json({ result: 'ok' })
      },
    ),
    http.post(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/thumbnails/cleanup'),
      () => HttpResponse.json({ result: 'ok' }),
    ),
    http.post(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/encode'),
      async ({ request }) => {
        log?.bodies.push(await request.json())
        return HttpResponse.json({ result: 'ok' })
      },
    ),
    http.post(
      ({ request }) => /\/api\/videos\/\d+\/kodi$/.test(new URL(request.url).pathname),
      async ({ request }) => {
        log?.bodies.push(await request.json())
        return HttpResponse.json({ result: 'ok' })
      },
    ),
    http.put(
      ({ request }) => /\/api\/recorded\/\d+\/protect$/.test(new URL(request.url).pathname),
      () => HttpResponse.json({ result: 'ok' }),
    ),
    http.put(
      ({ request }) => /\/api\/recorded\/\d+\/unprotect$/.test(new URL(request.url).pathname),
      () => HttpResponse.json({ result: 'ok' }),
    ),
    http.delete(
      ({ request }) =>
        /\/api\/recorded\/\d+$/.test(new URL(request.url).pathname) ||
        /\/api\/recorded\/\d+\/encode$/.test(new URL(request.url).pathname) ||
        /\/api\/videos\/\d+$/.test(new URL(request.url).pathname),
      () => HttpResponse.json({ result: 'ok' }),
    ),
  ]
}

export async function installRecordedApiMocks(
  page: Page,
  mode: RecordedMockMode = 'success',
  requestLog?: RecordedRequestLog,
): Promise<void> {
  const handlers = createRecordedHandlers(mode, requestLog)

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    requestLog?.apiPaths.push(`${url.pathname}${url.search}`)
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })
}

export interface RecordedRealtimeMockController {
  clearRecordedList: () => void
  renameRecordedDetail: (name: string) => void
}

export async function installRecordedRealtimeApiMocks(
  page: Page,
  requestLog?: RecordedRequestLog,
): Promise<RecordedRealtimeMockController> {
  let records = recordedListItems
  let detail = recordedDetail

  const handlers = [
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/recorded'),
      () =>
        HttpResponse.json({
          records,
          total: records.length,
        }),
    ),
    http.get(
      ({ request }) => /\/api\/recorded\/\d+$/.test(new URL(request.url).pathname),
      () => HttpResponse.json(detail),
    ),
    ...createRecordedHandlers('success', requestLog),
  ]

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    requestLog?.apiPaths.push(`${url.pathname}${url.search}`)
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })

  return {
    clearRecordedList: () => {
      records = []
    },
    renameRecordedDetail: (name) => {
      detail = {
        ...detail,
        name,
      }
    },
  }
}
