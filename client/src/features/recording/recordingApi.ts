import type { FeatureResult, ServerApiFetch } from '@/app/serverApi'
import {
  type RecordedApiRepository,
  type RecordedListItem,
  type RecordedListResponse,
  createFetchRecordedApiRepository,
} from '@/features/recorded/recordedApi'
import {
  RECORDING_FAILURE_MESSAGE,
  type RecordingListRequest,
  buildRecordingListRequestUrlFromRequest,
} from './recordingRequests'

export interface RecordingApiRepository extends RecordedApiRepository {
  fetchRecording(
    request: RecordingListRequest,
  ): Promise<FeatureResult<RecordedListResponse, 'recording-fetch-failed'>>
}

export interface CreateFetchRecordingApiRepositoryOptions {
  fetcher?: ServerApiFetch
  basePath?: string
}

function resolveDefaultFetch(): ServerApiFetch {
  return globalThis.fetch.bind(globalThis)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function adaptVideoFile(value: unknown) {
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

function adaptDropLogFile(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.dropCnt !== 'number' ||
    typeof value.errorCnt !== 'number' ||
    typeof value.scramblingCnt !== 'number'
  ) {
    return undefined
  }

  return {
    id: typeof value.id === 'number' ? value.id : undefined,
    dropCnt: value.dropCnt,
    errorCnt: value.errorCnt,
    scramblingCnt: value.scramblingCnt,
  }
}

function adaptChannelIndex(value: unknown, isHalfWidth: boolean): Map<number, string> {
  const channels = new Map<number, string>()

  if (!Array.isArray(value)) {
    return channels
  }

  value.forEach((channel) => {
    if (!isRecord(channel) || typeof channel.id !== 'number') {
      return
    }

    const name =
      isHalfWidth && typeof channel.halfWidthName === 'string'
        ? channel.halfWidthName
        : typeof channel.name === 'string'
          ? channel.name
          : typeof channel.halfWidthName === 'string'
            ? channel.halfWidthName
            : undefined

    if (name !== undefined) {
      channels.set(channel.id, name)
    }
  })

  return channels
}

function adaptRecordingItem(value: unknown): RecordedListItem {
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
    dropLogFile: adaptDropLogFile(value.dropLogFile),
    videoFiles: Array.isArray(value.videoFiles) ? value.videoFiles.map(adaptVideoFile) : undefined,
  }
}

function hydrateRecordingChannelName(
  item: RecordedListItem,
  channelIndex: ReadonlyMap<number, string>,
): RecordedListItem {
  if (item.channelName !== undefined || item.channelId === undefined) {
    return item
  }

  const channelName = channelIndex.get(item.channelId)

  return channelName === undefined ? item : { ...item, channelName }
}

function hydrateRecordingResponseChannelNames(
  response: RecordedListResponse,
  channelIndex: ReadonlyMap<number, string>,
): RecordedListResponse {
  return {
    ...response,
    records: response.records.map((item) => hydrateRecordingChannelName(item, channelIndex)),
  }
}

function adaptRecordingResponse(value: unknown): RecordedListResponse | null {
  if (!isRecord(value) || !Array.isArray(value.records) || typeof value.total !== 'number') {
    return null
  }

  return {
    records: value.records.map(adaptRecordingItem),
    total: value.total,
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

export function createFetchRecordingApiRepository(
  options: CreateFetchRecordingApiRepositoryOptions = {},
): RecordingApiRepository {
  const fetcher = options.fetcher ?? resolveDefaultFetch()
  const basePath = options.basePath ?? './api'
  const recordedRepository = createFetchRecordedApiRepository({ fetcher, basePath })
  const channelIndexCache = new Map<boolean, Promise<Map<number, string>>>()

  const loadChannelIndex = (isHalfWidth: boolean): Promise<Map<number, string>> => {
    const cached = channelIndexCache.get(isHalfWidth)
    if (cached !== undefined) {
      return cached
    }

    const next = fetchJson(fetcher, `${basePath.replace(/\/$/, '')}/channels`).then((response) =>
      adaptChannelIndex(response, isHalfWidth),
    )
    channelIndexCache.set(isHalfWidth, next)

    return next
  }

  return {
    ...recordedRepository,
    async fetchRecording(request) {
      const response = await fetchJson(
        fetcher,
        buildRecordingListRequestUrlFromRequest({
          request,
          basePath,
        }),
      )
      const records = adaptRecordingResponse(response)

      if (records === null) {
        return {
          ok: false,
          error: 'recording-fetch-failed',
          message: RECORDING_FAILURE_MESSAGE,
        }
      }

      const channelIndex = await loadChannelIndex(request.isHalfWidth)

      return { ok: true, value: hydrateRecordingResponseChannelNames(records, channelIndex) }
    },
  }
}
