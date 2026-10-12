import type { Page } from '@playwright/test'
import { HttpResponse, getResponse, http } from 'msw'
import { createMswRequest, fulfillMswResponse } from './appShellMocks'

export type StoragesUploadMode = 'success' | 'storage-empty' | 'storage-failure' | 'upload-failure'

const syntheticStorages = [
  {
    name: 'Synthetic archive storage',
    available: 1_024 * 1_024 * 512,
    used: 1_024 * 1_024 * 768,
    total: 1_024 * 1_024 * 1_280,
  },
  {
    name: 'Synthetic overflow storage with long display name',
    available: 1_024 * 256,
    used: 1_024 * 768,
    total: 1_024 * 1_024,
  },
  {
    name: 'Synthetic zero usage storage',
    available: 1_024 * 1_024,
    used: 0,
    total: 1_024 * 1_024,
  },
  {
    name: 'Synthetic nearly full storage',
    available: 1_024,
    used: 1_024 * 19,
    total: 1_024 * 20,
  },
  {
    name: 'Synthetic unknown total storage',
    available: 0,
    used: 512,
    total: 0,
  },
]

const uploadOptions = {
  channels: [
    {
      id: 34,
      name: 'Synthetic Upload Channel',
      halfWidthName: 'Synthetic Upload Channel HW',
    },
  ],
  genres: [{ id: 5, name: 'Synthetic Upload Genre' }],
}

const uploadRules = {
  items: [{ id: 12, keyword: 'Synthetic Upload Rule' }],
}

interface StoragesUploadMockState {
  deletedRecordedIds: number[]
}

export interface StoragesRealtimeMockController extends StoragesUploadMockState {
  getStoragesRequests: () => number
  clearStorages: () => void
}

async function waitForSyntheticUploadProgress(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 250)
  })
}

function hasNoSearchOrBody(request: Request): boolean {
  return new URL(request.url).search === '' && request.method === 'GET'
}

async function validateUploadFormData(request: Request): Promise<Response | null> {
  const formData = await request.formData()

  if (
    formData.get('recordedId') === null ||
    formData.get('parentDirectoryName') !== 'archive-root' ||
    formData.get('viewName') !== 'Synthetic Video File' ||
    formData.get('fileType') !== 'ts' ||
    formData.get('file') === null
  ) {
    return HttpResponse.json({ error: 'invalid-upload-form' }, { status: 400 })
  }

  return null
}

function createStoragesUploadHandlers(mode: StoragesUploadMode, state: StoragesUploadMockState) {
  let createdRecordedId = 901
  let didFailUpload = false

  return [
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/storages'),
      ({ request }) => {
        if (!hasNoSearchOrBody(request)) {
          return HttpResponse.json({ error: 'invalid-storages-request' }, { status: 400 })
        }

        if (mode === 'storage-failure') {
          return HttpResponse.json({ error: 'synthetic-storage-failure' }, { status: 503 })
        }

        return HttpResponse.json({ items: mode === 'storage-empty' ? [] : syntheticStorages })
      },
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/recorded/options'),
      () => HttpResponse.json(uploadOptions),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/channels'),
      () => HttpResponse.json(uploadOptions.channels),
    ),
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/rules/keyword'),
      ({ request }) => {
        const search = new URL(request.url).searchParams

        if (search.get('limit') !== '1000') {
          return HttpResponse.json({ error: 'invalid-limit' }, { status: 400 })
        }

        return HttpResponse.json(uploadRules)
      },
    ),
    http.post(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/recorded'),
      async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>

        if (
          body.channelId !== 34 ||
          typeof body.startAt !== 'number' ||
          typeof body.endAt !== 'number' ||
          body.name !== 'Synthetic Browser Upload'
        ) {
          return HttpResponse.json({ error: 'invalid-recorded-body' }, { status: 400 })
        }

        return HttpResponse.json({ recordedId: createdRecordedId++ })
      },
    ),
    http.post(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/videos/upload'),
      async ({ request }) => {
        const validationError = await validateUploadFormData(request)

        if (validationError !== null) {
          return validationError
        }

        if (mode === 'upload-failure' && !didFailUpload) {
          didFailUpload = true
          return HttpResponse.json({ error: 'synthetic-upload-failure' }, { status: 500 })
        }

        await waitForSyntheticUploadProgress()

        return HttpResponse.json({ code: 200, result: 'ok' })
      },
    ),
    http.delete(
      ({ request }) => /\/api\/recorded\/\d+$/.test(new URL(request.url).pathname),
      ({ request }) => {
        const id = Number(new URL(request.url).pathname.split('/').at(-1))

        if (Number.isFinite(id)) {
          state.deletedRecordedIds.push(id)
        }

        return HttpResponse.json({ result: 'ok' })
      },
    ),
  ]
}

export async function installStoragesUploadApiMocks(
  page: Page,
  mode: StoragesUploadMode = 'success',
): Promise<StoragesUploadMockState> {
  const state: StoragesUploadMockState = { deletedRecordedIds: [] }
  const handlers = createStoragesUploadHandlers(mode, state)

  await page.route('**/api/**', async (route) => {
    const response = await getResponse(handlers, await createMswRequest(route))

    if (response === undefined) {
      await route.fallback()
      return
    }

    await fulfillMswResponse(route, response)
  })

  return state
}

export async function installStoragesRealtimeApiMocks(
  page: Page,
): Promise<StoragesRealtimeMockController> {
  const state: StoragesUploadMockState = { deletedRecordedIds: [] }
  let isCleared = false
  let storagesRequests = 0
  const handlers = [
    http.get(
      ({ request }) => new URL(request.url).pathname.endsWith('/api/storages'),
      () => {
        storagesRequests += 1
        return HttpResponse.json({ items: isCleared ? [] : syntheticStorages })
      },
    ),
    ...createStoragesUploadHandlers('success', state),
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
    ...state,
    getStoragesRequests: () => storagesRequests,
    clearStorages: () => {
      isCleared = true
    },
  }
}
