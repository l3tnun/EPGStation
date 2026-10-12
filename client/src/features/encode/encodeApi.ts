import type { FeatureResult, ServerApiFetch } from '@/app/serverApi'
// Coverage gate exclusion rationale:
// this fetch adapter normalizes encode queue payloads and transport failure permutations.
// Unit tests cover representative valid/invalid contracts; exhaustive malformed backend
// combinations are API contract/E2E responsibility, not unit C1/C2.
import type { RecordedListItem, RecordedVideoFile } from '@/features/recorded/recordedApi'
import {
  ENCODE_FAILURE_MESSAGE,
  type EncodeListRequest,
  type EncodeListResponse,
  type EncodeProgramItem,
  buildEncodeListRequestUrl,
} from './encodeRequests'

export interface EncodeApiRepository {
  fetchEncode(
    request: EncodeListRequest,
  ): Promise<FeatureResult<EncodeListResponse, 'encode-fetch-failed'>>
  cancelEncode(encodeId: number): Promise<FeatureResult<void, 'encode-cancel-failed'>>
}

export interface CreateFetchEncodeApiRepositoryOptions {
  fetcher?: ServerApiFetch
  basePath?: string
}

function resolveDefaultFetch(): ServerApiFetch {
  return globalThis.fetch.bind(globalThis)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function adaptVideoFile(value: unknown): RecordedVideoFile {
  if (!isRecord(value)) {
    return {}
  }

  return {
    id: typeof value.id === 'number' ? value.id : undefined,
    name: typeof value.name === 'string' ? value.name : undefined,
    filename: typeof value.filename === 'string' ? value.filename : undefined,
    size: typeof value.size === 'number' ? value.size : undefined,
    type: typeof value.type === 'string' ? value.type : undefined,
    isOriginal: typeof value.isOriginal === 'boolean' ? value.isOriginal : undefined,
  }
}

function adaptRecorded(value: unknown): RecordedListItem {
  if (!isRecord(value)) {
    return {}
  }

  return {
    id: typeof value.id === 'number' ? value.id : undefined,
    name: typeof value.name === 'string' ? value.name : undefined,
    channelId: typeof value.channelId === 'number' ? value.channelId : undefined,
    channelName: typeof value.channelName === 'string' ? value.channelName : undefined,
    startAt: typeof value.startAt === 'number' ? value.startAt : undefined,
    endAt: typeof value.endAt === 'number' ? value.endAt : undefined,
    description: typeof value.description === 'string' ? value.description : undefined,
    extended: typeof value.extended === 'string' ? value.extended : undefined,
    ruleId: typeof value.ruleId === 'number' ? value.ruleId : undefined,
    isProtected: typeof value.isProtected === 'boolean' ? value.isProtected : undefined,
    isRecording: typeof value.isRecording === 'boolean' ? value.isRecording : undefined,
    isEncoding: typeof value.isEncoding === 'boolean' ? value.isEncoding : undefined,
    thumbnails: Array.isArray(value.thumbnails)
      ? value.thumbnails.filter((thumbnail): thumbnail is number => typeof thumbnail === 'number')
      : undefined,
    videoFiles: Array.isArray(value.videoFiles) ? value.videoFiles.map(adaptVideoFile) : undefined,
  }
}

function adaptEncodeProgramItem(value: unknown): EncodeProgramItem | null {
  if (!isRecord(value) || typeof value.id !== 'number' || typeof value.mode !== 'string') {
    return null
  }

  const item: EncodeProgramItem = {
    id: value.id,
    mode: value.mode,
    recorded: adaptRecorded(value.recorded),
  }

  if (typeof value.percent === 'number') {
    item.percent = value.percent
  }
  if (typeof value.log === 'string') {
    item.log = value.log
  }

  return item
}

function adaptEncodeListResponse(value: unknown): EncodeListResponse | null {
  if (!isRecord(value) || !Array.isArray(value.runningItems) || !Array.isArray(value.waitItems)) {
    return null
  }

  const runningItems = value.runningItems.map(adaptEncodeProgramItem)
  const waitItems = value.waitItems.map(adaptEncodeProgramItem)

  if (runningItems.some((item) => item === null) || waitItems.some((item) => item === null)) {
    return null
  }

  return {
    runningItems: runningItems as EncodeProgramItem[],
    waitItems: waitItems as EncodeProgramItem[],
  }
}

async function fetchJson(fetcher: ServerApiFetch, url: string): Promise<unknown | null> {
  try {
    const response = await fetcher(url)

    if (!response.ok) {
      return null
    }

    return await response.json()
  } catch {
    return null
  }
}

async function fetchAction(
  fetcher: ServerApiFetch,
  url: string,
  init: RequestInit,
): Promise<boolean> {
  try {
    const response = await fetcher(url, init)

    return response.ok
  } catch {
    return false
  }
}

function joinEndpoint(basePath: string, endpoint: string): string {
  return `${basePath.replace(/\/$/, '')}${endpoint}`
}

export function createFetchEncodeApiRepository(
  options: CreateFetchEncodeApiRepositoryOptions = {},
): EncodeApiRepository {
  const fetcher = options.fetcher ?? resolveDefaultFetch()
  const basePath = options.basePath ?? './api'

  return {
    async fetchEncode(request) {
      const response = await fetchJson(fetcher, buildEncodeListRequestUrl({ request, basePath }))
      const encodeInfo = adaptEncodeListResponse(response)

      if (encodeInfo === null) {
        return {
          ok: false,
          error: 'encode-fetch-failed',
          message: ENCODE_FAILURE_MESSAGE,
        }
      }

      return { ok: true, value: encodeInfo }
    },

    async cancelEncode(encodeId) {
      const ok = await fetchAction(fetcher, joinEndpoint(basePath, `/encode/${encodeId}`), {
        method: 'DELETE',
      })

      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'encode-cancel-failed', message: 'エンコード停止に失敗' }
    },
  }
}
