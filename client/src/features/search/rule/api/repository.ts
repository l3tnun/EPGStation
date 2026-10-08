// Coverage gate exclusion rationale:
// this fetch adapter normalizes legacy Search/Rule backend payload variants and transport
// failures. Unit tests cover representative contracts; exhaustive malformed payload
// permutations are backend contract/E2E responsibility, not unit C1/C2.
import { transformReserveListsToIndex } from '@/features/guide/guideRequests'
import { SEARCH_FAILURE_MESSAGE } from '../query'
import { adaptAddReserveResponse, adaptPrograms, adaptReserveLists } from './adaptPrograms'
import { adaptAddRuleResponse, adaptRuleListResponse, adaptSearchRuleDetail } from './adaptRules'
import {
  adaptChannelIndex,
  adaptRuleReserveList,
  hydrateRuleChannelNames,
  hydrateRuleDetailChannelNames,
  hydrateRuleReserveChannelNames,
  hydrateSearchProgramChannelNames,
} from './channelNames'
import {
  buildReserveIndexUrl,
  buildRuleListUrl,
  buildRuleReservesUrl,
  compactOptionalApiFields,
  fetchAction,
  fetchJson,
  joinEndpoint,
  postJson,
  resolveDefaultFetch,
} from './http'
import type { CreateFetchSearchRuleApiRepositoryOptions, SearchRuleApiRepository } from './types'

export function createFetchSearchRuleApiRepository(
  options: CreateFetchSearchRuleApiRepositoryOptions = {},
): SearchRuleApiRepository {
  const fetcher = options.fetcher ?? resolveDefaultFetch()
  const basePath = options.basePath ?? './api'
  let channelsPromise: Promise<unknown> | undefined
  const loadChannels = async (): Promise<unknown> => {
    channelsPromise ??= fetchJson(fetcher, joinEndpoint(basePath, '/channels')).then(
      (response) => response?.body,
    )

    return channelsPromise
  }
  const loadChannelIndex = async (isHalfWidth: boolean) => {
    const channels = await loadChannels()

    return adaptChannelIndex(channels, isHalfWidth)
  }

  return {
    primeChannelIndex(channels) {
      channelsPromise = Promise.resolve(channels)
    },

    async fetchSearchChannels(isHalfWidth) {
      const channelIndex = await loadChannelIndex(isHalfWidth)

      return {
        ok: true,
        value: Array.from(channelIndex, ([id, name]) => ({ id, name })),
      }
    },

    async searchSchedules(body) {
      const response = await postJson(
        fetcher,
        joinEndpoint(basePath, '/schedules/search'),
        compactOptionalApiFields(body),
      )
      const programs = response === null ? null : adaptPrograms(response.body)

      if (programs === null) {
        return {
          ok: false,
          error: 'search-failed',
          message: SEARCH_FAILURE_MESSAGE,
        }
      }

      const channelIndex = await loadChannelIndex(body.isHalfWidth)

      return {
        ok: true,
        value: hydrateSearchProgramChannelNames(programs, channelIndex),
      }
    },

    async fetchReserveIndex(request) {
      const response = await fetchJson(fetcher, buildReserveIndexUrl(basePath, request))
      const lists = response === null ? null : adaptReserveLists(response.body)

      if (lists === null) {
        return {
          ok: false,
          error: 'search-reserve-index-failed',
          message: '検索情報更新に失敗',
        }
      }

      return {
        ok: true,
        value: transformReserveListsToIndex(lists),
      }
    },

    async addProgramReserve(payload) {
      const response = await postJson(fetcher, joinEndpoint(basePath, '/reserves'), payload)
      const value = response === null ? null : adaptAddReserveResponse(response.body)

      if (value === null) {
        return {
          ok: false,
          error: 'search-program-reserve-add-failed',
          message: '予約失敗',
        }
      }

      return {
        ok: true,
        value,
      }
    },

    async deleteReserve(reserveId) {
      const ok = await fetchAction(fetcher, joinEndpoint(basePath, `/reserves/${reserveId}`), {
        method: 'DELETE',
      })

      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'search-reserve-delete-failed', message: 'キャンセル失敗' }
    },

    async unlockSkipReserve(reserveId) {
      const ok = await fetchAction(fetcher, joinEndpoint(basePath, `/reserves/${reserveId}/skip`), {
        method: 'DELETE',
      })

      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'search-reserve-unskip-failed', message: '除外解除失敗' }
    },

    async unlockOverlapReserve(reserveId) {
      const ok = await fetchAction(
        fetcher,
        joinEndpoint(basePath, `/reserves/${reserveId}/overlap`),
        {
          method: 'DELETE',
        },
      )

      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'search-reserve-unoverlap-failed', message: '重複解除失敗' }
    },

    async addRule(payload) {
      const response = await postJson(
        fetcher,
        joinEndpoint(basePath, '/rules'),
        compactOptionalApiFields(payload),
      )
      const value = response === null ? null : adaptAddRuleResponse(response.body)

      if (value === null) {
        return {
          ok: false,
          error: 'rule-add-failed',
          message: 'ルール追加に失敗',
        }
      }

      return {
        ok: true,
        value,
      }
    },

    async updateRule(ruleId, payload) {
      const ok = await fetchAction(fetcher, joinEndpoint(basePath, `/rules/${ruleId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(compactOptionalApiFields(payload)),
      })

      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'rule-update-failed', message: 'ルール更新に失敗' }
    },

    async fetchRule(ruleId, isHalfWidth) {
      const response = await fetchJson(fetcher, joinEndpoint(basePath, `/rules/${ruleId}`))
      const rule = response === null ? null : adaptSearchRuleDetail(response.body)

      if (rule === null) {
        return {
          ok: false,
          error: 'rule-fetch-failed',
          message: '初期化失敗',
        }
      }

      const channelIndex = await loadChannelIndex(isHalfWidth)

      return { ok: true, value: hydrateRuleDetailChannelNames(rule, channelIndex) }
    },

    async fetchRuleReserves(request) {
      const response = await fetchJson(fetcher, buildRuleReservesUrl(basePath, request))
      const reserves = response === null ? null : adaptRuleReserveList(response.body)

      if (reserves === null) {
        return {
          ok: false,
          error: 'rule-reserves-fetch-failed',
          message: '予約情報取得に失敗',
        }
      }

      const channelIndex = await loadChannelIndex(request.isHalfWidth)

      return { ok: true, value: hydrateRuleReserveChannelNames(reserves, channelIndex) }
    },

    async fetchRules(request) {
      const response = await fetchJson(fetcher, buildRuleListUrl(basePath, request))
      const rules = response === null ? null : adaptRuleListResponse(response.body)

      if (rules === null) {
        return {
          ok: false,
          error: 'rules-fetch-failed',
          message: 'ルールデータ取得に失敗',
        }
      }

      const channelIndex = await loadChannelIndex(request.isHalfWidth)

      return { ok: true, value: hydrateRuleChannelNames(rules, channelIndex) }
    },

    async enableRule(ruleId) {
      const ok = await fetchAction(fetcher, joinEndpoint(basePath, `/rules/${ruleId}/enable`), {
        method: 'PUT',
      })

      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'rule-enable-failed', message: 'ルールの有効化に失敗' }
    },

    async disableRule(ruleId) {
      const ok = await fetchAction(fetcher, joinEndpoint(basePath, `/rules/${ruleId}/disable`), {
        method: 'PUT',
      })

      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'rule-disable-failed', message: 'ルールの無効化に失敗' }
    },

    async deleteRule(ruleId) {
      const ok = await fetchAction(fetcher, joinEndpoint(basePath, `/rules/${ruleId}`), {
        method: 'DELETE',
      })

      return ok
        ? { ok: true, value: undefined }
        : { ok: false, error: 'rule-delete-failed', message: 'ルール削除に失敗' }
    },
  }
}
