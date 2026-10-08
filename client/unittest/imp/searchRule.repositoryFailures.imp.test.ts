import { describe, expect, it, vi } from 'vitest'
import { createFetchSearchRuleApiRepository } from '@/features/search/rule/api'
import {
  fetchAction,
  fetchJson,
  postJson,
  resolveDefaultFetch,
} from '@/features/search/rule/api/http'
import type { SearchRulePayload } from '@/features/search/rule/query'

const payload: SearchRulePayload = {
  isTimeSpecification: false,
  searchOption: { keyword: 'k', times: [] },
  reserveOption: {
    enable: true,
    allowEndLack: true,
    avoidDuplicate: false,
    periodToAvoidDuplicate: null,
  },
  saveOption: { parentDirectoryName: null, directory: null, recordedFormat: null },
}

function repositoryWith(fetcher: (url: string, init?: RequestInit) => Promise<Response>) {
  return createFetchSearchRuleApiRepository({ fetcher: fetcher as never, basePath: '/api/' })
}

const failing = () => Promise.reject(new Error('offline'))
const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))
const notOk = () => Promise.resolve(new Response('', { status: 500 }))

describe('SearchRule repository failure paths', () => {
  it('reports every read failure with its message when the transport fails', async () => {
    const repository = repositoryWith(failing)
    expect(
      await repository.searchSchedules({ option: { times: [] }, isHalfWidth: true, limit: 1 }),
    ).toEqual({ ok: false, error: 'search-failed', message: '検索に失敗' })
    expect(await repository.fetchReserveIndex({ startAt: 1, endAt: 2 })).toEqual({
      ok: false,
      error: 'search-reserve-index-failed',
      message: '検索情報更新に失敗',
    })
    expect(await repository.addProgramReserve({ programId: 1, allowEndLack: true })).toEqual({
      ok: false,
      error: 'search-program-reserve-add-failed',
      message: '予約失敗',
    })
    expect(await repository.addRule(payload)).toEqual({
      ok: false,
      error: 'rule-add-failed',
      message: 'ルール追加に失敗',
    })
    expect(await repository.fetchRule(1, false)).toEqual({
      ok: false,
      error: 'rule-fetch-failed',
      message: '初期化失敗',
    })
    expect(await repository.fetchRuleReserves({ ruleId: 1, isHalfWidth: true })).toEqual({
      ok: false,
      error: 'rule-reserves-fetch-failed',
      message: '予約情報取得に失敗',
    })
    expect(
      await repository.fetchRules({ type: 'normal', offset: 0, limit: 1, isHalfWidth: true }),
    ).toEqual({ ok: false, error: 'rules-fetch-failed', message: 'ルールデータ取得に失敗' })
  })

  it('reports every action failure when the response is not ok or the transport fails', async () => {
    for (const fetcher of [failing, notOk]) {
      const repository = repositoryWith(fetcher)
      expect(await repository.deleteReserve(1)).toEqual({
        ok: false,
        error: 'search-reserve-delete-failed',
        message: 'キャンセル失敗',
      })
      expect(await repository.unlockSkipReserve(1)).toEqual({
        ok: false,
        error: 'search-reserve-unskip-failed',
        message: '除外解除失敗',
      })
      expect(await repository.unlockOverlapReserve(1)).toEqual({
        ok: false,
        error: 'search-reserve-unoverlap-failed',
        message: '重複解除失敗',
      })
      expect(await repository.updateRule(1, payload)).toEqual({
        ok: false,
        error: 'rule-update-failed',
        message: 'ルール更新に失敗',
      })
      expect(await repository.enableRule(1)).toEqual({
        ok: false,
        error: 'rule-enable-failed',
        message: 'ルールの有効化に失敗',
      })
      expect(await repository.disableRule(1)).toEqual({
        ok: false,
        error: 'rule-disable-failed',
        message: 'ルールの無効化に失敗',
      })
      expect(await repository.deleteRule(1)).toEqual({
        ok: false,
        error: 'rule-delete-failed',
        message: 'ルール削除に失敗',
      })
    }
  })

  it('reports malformed bodies as failures and adapts valid ones with the channel index', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/channels'))
        return new Response(JSON.stringify([{ id: 12, name: 'Twelve' }]), { status: 200 })
      if (url.includes('/reserves/lists')) return new Response('{"normal":"x"}', { status: 200 })
      if (url.includes('/reserves?'))
        return new Response(JSON.stringify({ reserves: [{ id: 1, channelId: 12 }] }), {
          status: 200,
        })
      if (url.endsWith('/reserves')) return new Response('{}', { status: 200 })
      if (url.includes('/rules?'))
        return new Response(
          JSON.stringify({
            rules: [{ id: 1, searchOption: { times: [], channelIds: [12] }, reserveOption: {} }],
          }),
          { status: 200 },
        )
      if (url.endsWith('/rules/1')) return new Response('{"id":"x"}', { status: 200 })
      if (url.endsWith('/rules')) return new Response('{}', { status: 200 })
      return new Response('"x"', { status: 200 })
    })
    const repository = repositoryWith(fetcher)
    expect(
      (await repository.searchSchedules({ option: { times: [] }, isHalfWidth: true, limit: 1 })).ok,
    ).toBe(false)
    expect((await repository.fetchReserveIndex({ startAt: 1, endAt: 2 })).ok).toBe(false)
    expect((await repository.addProgramReserve({ programId: 1, allowEndLack: true })).ok).toBe(
      false,
    )
    expect((await repository.addRule(payload)).ok).toBe(false)
    expect((await repository.fetchRule(1, false)).ok).toBe(false)
    const reserves = await repository.fetchRuleReserves({ ruleId: 1, isHalfWidth: true })
    expect(reserves).toEqual({ ok: true, value: [{ id: 1, channelId: 12, channelName: 'Twelve' }] })
    const rules = await repository.fetchRules({
      type: 'normal',
      offset: 0,
      limit: 1,
      isHalfWidth: true,
    })
    expect(rules.ok && rules.value.rules[0]?.searchOption.channelNames).toEqual(['Twelve'])
    expect(await repository.fetchSearchChannels?.(false)).toEqual({
      ok: true,
      value: [{ id: 12, name: 'Twelve' }],
    })
  })

  it('primes the channel index without fetching /channels', async () => {
    const fetcher = vi.fn(async () => new Response('[]', { status: 200 }))
    const repository = repositoryWith(fetcher)
    repository.primeChannelIndex?.([{ id: 5, name: 'Five' }])
    expect(await repository.fetchSearchChannels?.(false)).toEqual({
      ok: true,
      value: [{ id: 5, name: 'Five' }],
    })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('http helpers', () => {
  it('returns null bodies for non-ok posts, undefined bodies for 204, and null on transport errors', async () => {
    expect(await postJson(notOk as never, '/x', {})).toEqual({ status: 500, body: null })
    expect(await postJson(failing as never, '/x', {})).toBeNull()
    expect(
      await fetchJson((() => Promise.resolve(new Response(null, { status: 204 }))) as never, '/x'),
    ).toEqual({ status: 204, body: undefined })
    expect(await fetchJson(notOk as never, '/x')).toEqual({ status: 500, body: null })
    expect(await fetchJson(failing as never, '/x')).toBeNull()
    expect(await fetchAction(failing as never, '/x', {})).toBe(false)
    expect(await fetchAction((() => jsonResponse({})) as never, '/x', {})).toBe(true)
  })

  it('binds the global fetch as the default transport', () => {
    const original = globalThis.fetch
    const spy = vi.fn(async () => new Response('1'))
    globalThis.fetch = spy as never
    try {
      const fetcher = resolveDefaultFetch()
      void fetcher('/y')
      expect(spy).toHaveBeenCalledWith('/y')
    } finally {
      globalThis.fetch = original
    }
  })
})
