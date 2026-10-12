import {
  RECORDED_FAILURE_MESSAGE,
  RECORDED_RULE_KEYWORDS_FAILURE_MESSAGE,
  RECORDED_SEARCH_OPTIONS_FAILURE_MESSAGE,
  buildRecordedUploadVideoFormData,
  buildRecordedDetailRequestUrl,
  buildRuleKeywordRequestUrl,
} from './recordedRequests'
import { createRecordedActionMethods } from './api/createRecordedActionMethods'
import { fetchAction, fetchJson, fetchJsonWithInit, fetchText } from './api/recordedFetch'
import type {
  CreateFetchRecordedApiRepositoryOptions,
  RecordedApiRepository,
  RecordedSearchOptionItem,
} from './api/recordedApiTypes'
import {
  SEARCH_OPTION_GENRE_NAMES,
  adaptRecordedSearchOptions,
  adaptRecordedUploadCreatedResponse,
  adaptRuleDetail,
  adaptRuleKeywords,
  adaptVideoDuration,
} from './api/recordedSearchAdapters'
import {
  adaptChannelIndex,
  adaptRecordedItem,
  adaptRecordedResponse,
  adaptSearchOptionChannelIndex,
  createEndpointUrl,
  hydrateRecordedChannelName,
  hydrateRecordedResponseChannelNames,
  isRecord,
  joinEndpoint,
  resolveDefaultFetch,
} from './api/recordedAdapters'

export * from './api/recordedApiTypes'

export function createFetchRecordedApiRepository(
  options: CreateFetchRecordedApiRepositoryOptions = {},
): RecordedApiRepository {
  const fetcher = options.fetcher ?? resolveDefaultFetch()
  const basePath = options.basePath ?? './api'
  const channelIndexCache = new Map<boolean, Promise<Map<number, string>>>()
  let searchOptionChannelIndexCache: Promise<Map<number, RecordedSearchOptionItem>> | undefined
  const loadChannelIndex = async (isHalfWidth: boolean) => {
    const cached = channelIndexCache.get(isHalfWidth)
    if (cached !== undefined) {
      return cached
    }

    const next = fetchJson(fetcher, joinEndpoint(basePath, '/channels')).then((response) =>
      adaptChannelIndex(response, isHalfWidth),
    )
    channelIndexCache.set(isHalfWidth, next)

    return next
  }
  const loadSearchOptionChannelIndex = async () => {
    if (searchOptionChannelIndexCache !== undefined) {
      return searchOptionChannelIndexCache
    }

    searchOptionChannelIndexCache = fetchJson(fetcher, joinEndpoint(basePath, '/channels')).then(
      (response) => adaptSearchOptionChannelIndex(response),
    )

    return searchOptionChannelIndexCache
  }

  return {
    primeChannelIndex(channels) {
      // Accepts either the resolved channel list or an in-flight fetch of it, so a screen that
      // asks for channels while the shell's bootstrap fetch is still pending shares that same
      // request instead of starting a second one (Promise.resolve adopts an existing promise).
      const resolvedChannels = Promise.resolve(channels)
      channelIndexCache.set(
        false,
        resolvedChannels.then((value) => adaptChannelIndex(value, false)),
      )
      channelIndexCache.set(
        true,
        resolvedChannels.then((value) => adaptChannelIndex(value, true)),
      )
      searchOptionChannelIndexCache = resolvedChannels.then((value) =>
        adaptSearchOptionChannelIndex(value),
      )
    },

    async fetchRecorded(request) {
      const response = await fetchJson(fetcher, createEndpointUrl(basePath, request))
      const records = adaptRecordedResponse(response)

      if (records === null) {
        return {
          ok: false,
          error: 'recorded-fetch-failed',
          message: RECORDED_FAILURE_MESSAGE,
        }
      }

      const channelIndex = await loadChannelIndex(request.isHalfWidth)

      return {
        ok: true,
        value: hydrateRecordedResponseChannelNames(records, channelIndex),
      }
    },

    async fetchRecordedOptions() {
      const response = await fetchJson(fetcher, joinEndpoint(basePath, '/recorded/options'))
      const channelIndex = await loadSearchOptionChannelIndex()
      const options = adaptRecordedSearchOptions(response, channelIndex)

      if (options === null) {
        return {
          ok: false,
          error: 'recorded-options-failed',
          message: RECORDED_SEARCH_OPTIONS_FAILURE_MESSAGE,
        }
      }

      return { ok: true, value: options }
    },

    async fetchRecordedUploadOptions() {
      const channelIndex = await loadSearchOptionChannelIndex()

      return {
        ok: true,
        value: {
          channels: Array.from(channelIndex.values()),
          genres: Object.entries(SEARCH_OPTION_GENRE_NAMES).map(([id, name]) => ({
            id: Number(id),
            name,
          })),
        },
      }
    },

    async fetchRuleKeywords(keyword) {
      const response = await fetchJson(fetcher, buildRuleKeywordRequestUrl({ keyword, basePath }))
      const items = adaptRuleKeywords(response)

      if (items === null) {
        return {
          ok: false,
          error: 'rule-keywords-failed',
          message: RECORDED_RULE_KEYWORDS_FAILURE_MESSAGE,
        }
      }

      return { ok: true, value: items }
    },

    async fetchRule(ruleId) {
      const response = await fetchJson(fetcher, joinEndpoint(basePath, `/rules/${ruleId}`))
      const rule = adaptRuleDetail(response)

      if (rule === null) {
        return {
          ok: false,
          error: 'rule-fetch-failed',
          message: 'rule fetch failed',
        }
      }

      return { ok: true, value: rule }
    },

    async fetchRecordedDetail(request) {
      const response = await fetchJson(
        fetcher,
        buildRecordedDetailRequestUrl({ ...request, basePath }),
      )

      if (response === null || !isRecord(response) || typeof response.id !== 'number') {
        return {
          ok: false,
          error: 'recorded-fetch-failed',
          message: RECORDED_FAILURE_MESSAGE,
        }
      }

      const channelIndex = await loadChannelIndex(request.isHalfWidth)

      return {
        ok: true,
        value: hydrateRecordedChannelName(adaptRecordedItem(response), channelIndex),
      }
    },

    async fetchVideoDuration(videoFileId) {
      const response = await fetchJson(
        fetcher,
        joinEndpoint(basePath, `/videos/${videoFileId}/duration`),
      )
      const duration = adaptVideoDuration(response)

      if (duration === null) {
        return {
          ok: false,
          error: 'video-duration-fetch-failed',
          message: '動画長の取得に失敗しました',
        }
      }

      return { ok: true, value: duration }
    },

    async fetchDropLog(request) {
      const parameters = new URLSearchParams()
      parameters.set('maxsize', String(request.maxsize))
      const response = await fetchText(
        fetcher,
        `${joinEndpoint(basePath, `/dropLogs/${request.dropLogFileId}`)}?${parameters.toString()}`,
      )

      if (response === null) {
        return {
          ok: false,
          error: 'drop-log-fetch-failed',
          message: 'ログファイル取得に失敗しました',
        }
      }

      return { ok: true, value: response }
    },

    async createRecorded(body) {
      const response = await fetchJsonWithInit(fetcher, joinEndpoint(basePath, '/recorded'), {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
      const created = adaptRecordedUploadCreatedResponse(response)

      if (created === null) {
        return {
          ok: false,
          error: 'recorded-create-failed',
          message: 'アップロードに失敗',
        }
      }

      return { ok: true, value: created }
    },

    async uploadVideoFile(request) {
      const ok = await fetchAction(fetcher, joinEndpoint(basePath, '/videos/upload'), {
        body: buildRecordedUploadVideoFormData(request),
        method: 'POST',
      })

      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'video-upload-failed', message: 'アップロードに失敗' }
    },

    ...createRecordedActionMethods({ fetcher, basePath }),
  }
}
