import type { Page } from '@playwright/test'
import { HttpResponse, getResponse, http } from 'msw'
import { createMswRequest, fulfillMswResponse } from './appShellMocks'
import { recordingItems, encodeRunningItems, encodeWaitItems } from './recordingEncodeFixtures'

export {
  SYNTHETIC_RECORDING_ID_A,
  SYNTHETIC_RECORDING_VIDEO_ID_A,
  SYNTHETIC_RECORDING_VIDEO_ID_B,
  SYNTHETIC_ENCODE_RUNNING_ID,
  SYNTHETIC_ENCODE_PERCENT_ONLY_ID,
  SYNTHETIC_ENCODE_WAITING_ID,
  recordingEncodeFixtureSecrecyText,
} from './recordingEncodeFixtures'

export type RecordingEncodeMockMode =
  'success' | 'recording-empty' | 'recording-failure' | 'encode-empty' | 'encode-failure'

export interface RecordingEncodeRequestLog {
  apiPaths: string[]
  methods: string[]
  bodies: unknown[]
}

export interface RecordingEncodeMockOptions {
  mode?: RecordingEncodeMockMode
  requestLog?: RecordingEncodeRequestLog
  failEncodeDeleteIds?: readonly number[]
  failVideoDeleteIds?: readonly number[]
}

export function createRecordingEncodeRequestLog(): RecordingEncodeRequestLog {
  return {
    apiPaths: [],
    methods: [],
    bodies: [],
  }
}

function createRecordingEncodeHandlers({
  mode = 'success',
  failEncodeDeleteIds = [],
  failVideoDeleteIds = [],
}: Required<Omit<RecordingEncodeMockOptions, 'requestLog'>>) {
  const failingEncodeIds = new Set(failEncodeDeleteIds)
  const failingVideoIds = new Set(failVideoDeleteIds)

  return [
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/recording'),
      () => {
        if (mode === 'recording-failure') {
          return HttpResponse.json({ error: 'synthetic-recording-failure' }, { status: 503 })
        }

        return HttpResponse.json({
          records: mode === 'recording-empty' ? [] : recordingItems,
          total: mode === 'recording-empty' ? 0 : recordingItems.length,
        })
      },
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/encode'),
      () => {
        if (mode === 'encode-failure') {
          return HttpResponse.json({ error: 'synthetic-encode-failure' }, { status: 503 })
        }

        return HttpResponse.json({
          runningItems: mode === 'encode-empty' ? [] : encodeRunningItems,
          waitItems: mode === 'encode-empty' ? [] : encodeWaitItems,
        })
      },
    ),
    http.get(
      ({ request }) => /\/api\/rules\/\d+$/.test(new URL(request.url).pathname),
      () => HttpResponse.json({ id: 8101, keyword: 'Synthetic Recording Rule' }),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/rules/keyword'),
      () => HttpResponse.json({ items: [{ id: 8101, keyword: 'Synthetic Recording Rule' }] }),
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
      ({ request }) => /\/api\/videos\/\d+$/.test(new URL(request.url).pathname),
      ({ request }) => {
        const id = Number(new URL(request.url).pathname.split('/').at(-1))
        if (failingVideoIds.has(id)) {
          return HttpResponse.json({ error: 'synthetic-video-delete-failure' }, { status: 503 })
        }

        return HttpResponse.json({ result: 'ok' })
      },
    ),
    http.delete(
      ({ request }) => /\/api\/recorded\/\d+$/.test(new URL(request.url).pathname),
      () => HttpResponse.json({ result: 'ok' }),
    ),
    http.delete(
      ({ request }) => /\/api\/encode\/\d+$/.test(new URL(request.url).pathname),
      ({ request }) => {
        const id = Number(new URL(request.url).pathname.split('/').at(-1))
        if (failingEncodeIds.has(id)) {
          return HttpResponse.json({ error: 'synthetic-encode-delete-failure' }, { status: 503 })
        }

        return HttpResponse.json({ result: 'ok' })
      },
    ),
    http.post(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/encode'),
      async ({ request }) => {
        return HttpResponse.json({ echo: await request.json() }, { status: 500 })
      },
    ),
  ]
}

export async function installRecordingEncodeApiMocks(
  page: Page,
  {
    mode = 'success',
    requestLog,
    failEncodeDeleteIds = [],
    failVideoDeleteIds = [],
  }: RecordingEncodeMockOptions = {},
): Promise<void> {
  const handlers = createRecordingEncodeHandlers({
    mode,
    failEncodeDeleteIds,
    failVideoDeleteIds,
  })

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    requestLog?.apiPaths.push(`${url.pathname}${url.search}`)
    requestLog?.methods.push(`${route.request().method()} ${url.pathname}`)

    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    const postData = route.request().postData()
    if (
      requestLog !== undefined &&
      route.request().method() !== 'GET' &&
      postData !== null &&
      route.request().headers()['content-type']?.includes('application/json') === true
    ) {
      requestLog.bodies.push(JSON.parse(postData))
    }

    await fulfillMswResponse(route, response)
  })
}

export interface RecordingEncodeRealtimeMockController {
  clearRecording: () => void
  clearEncode: () => void
}

export async function installRecordingEncodeRealtimeApiMocks(
  page: Page,
  requestLog?: RecordingEncodeRequestLog,
): Promise<RecordingEncodeRealtimeMockController> {
  let activeRecordingItems = recordingItems
  let activeEncodeRunningItems = encodeRunningItems
  let activeEncodeWaitItems = encodeWaitItems

  const handlers = [
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/recording'),
      () =>
        HttpResponse.json({
          records: activeRecordingItems,
          total: activeRecordingItems.length,
        }),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/encode'),
      () =>
        HttpResponse.json({
          runningItems: activeEncodeRunningItems,
          waitItems: activeEncodeWaitItems,
        }),
    ),
    ...createRecordingEncodeHandlers({
      mode: 'success',
      failEncodeDeleteIds: [],
      failVideoDeleteIds: [],
    }),
  ]

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

  return {
    clearRecording: () => {
      activeRecordingItems = []
    },
    clearEncode: () => {
      activeEncodeRunningItems = []
      activeEncodeWaitItems = []
    },
  }
}
