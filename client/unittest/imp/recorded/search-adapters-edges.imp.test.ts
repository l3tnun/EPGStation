import { describe, expect, it, vi } from 'vitest'
import {
  adaptRecordedSearchOptions,
  adaptRecordedUploadCreatedResponse,
  adaptRuleDetail,
  adaptRuleKeywords,
  adaptVideoDuration,
} from '@/features/recorded/api/recordedSearchAdapters'
import { createFetchRecordedApiRepository } from '@/features/recorded/recordedApi'

describe('recorded search option adapters: legacy and malformed payloads', () => {
  it('returns null for non-record payloads and empty lists for non-array members', () => {
    expect(adaptRecordedSearchOptions('x')).toBeNull()
    expect(adaptRecordedSearchOptions({ channels: 'x', genres: 5 })).toEqual({
      channels: [],
      genres: [],
    })
  })

  it('adapts channel options from every accepted shape', () => {
    const index = new Map([
      [3, { id: 3, name: 'indexed three', halfWidthName: 'indexed half three' }],
    ])
    const options = adaptRecordedSearchOptions(
      {
        channelItems: [
          'not a record',
          { name: 'no id' },
          { channelId: 1, channel: 'legacy channel', cnt: 2 },
          { id: 2, halfWidthName: 'half two' },
          { id: 3, cnt: 4 },
          { id: 4 },
          { id: 6, name: 'named channel' },
        ],
        genreItems: [
          'not a record',
          { name: 'no id' },
          { genre: 3, cnt: 1 },
          { id: 7, genre: 'legacy genre name' },
          { id: 99 },
          { id: 5, name: 'named' },
        ],
      },
      index,
    )

    expect(options).toEqual({
      channels: [
        { id: 1, name: 'legacy channel(2)' },
        { id: 2, name: '2', halfWidthName: 'half two' },
        { id: 3, name: 'indexed three(4)', halfWidthName: 'indexed half three(4)' },
        { id: 4, name: '4' },
        { id: 6, name: 'named channel' },
      ],
      genres: [
        { id: 3, name: 'ドラマ(1)' },
        { id: 7, name: 'legacy genre name' },
        { id: 99, name: '99' },
        { id: 5, name: 'named' },
      ],
    })
  })

  it('adapts rule keywords from bare arrays and item envelopes', () => {
    expect(adaptRuleKeywords({ items: [{ id: 1, keyword: 'a' }, { id: 'x' }, 'y'] })).toEqual([
      { id: 1, keyword: 'a' },
    ])
    expect(adaptRuleKeywords([{ id: 2, keyword: 'b' }])).toEqual([{ id: 2, keyword: 'b' }])
    expect(adaptRuleKeywords({ items: 'x' })).toBeNull()
    expect(adaptRuleKeywords(null)).toBeNull()
  })

  it('adapts rule details with top-level or search-option keywords', () => {
    expect(adaptRuleDetail({ id: 1, keyword: 'top' })).toEqual({ id: 1, keyword: 'top' })
    expect(adaptRuleDetail({ id: 1, searchOption: { keyword: 'nested' } })).toEqual({
      id: 1,
      keyword: 'nested',
    })
    expect(adaptRuleDetail({ id: 1, searchOption: 'x' })).toEqual({ id: 1, keyword: undefined })
    expect(adaptRuleDetail({ id: 'x' })).toBeNull()
  })

  it('adapts upload created responses and video durations', () => {
    expect(adaptRecordedUploadCreatedResponse({ recordedId: 1 })).toEqual({ recordedId: 1 })
    expect(adaptRecordedUploadCreatedResponse({})).toBeNull()
    expect(adaptVideoDuration(12.5)).toBe(12.5)
    expect(adaptVideoDuration({ duration: 3 })).toBe(3)
    expect(adaptVideoDuration({ duration: Number.NaN })).toBeNull()
    expect(adaptVideoDuration('x')).toBeNull()
  })
})

describe('recorded api repository: rule keyword lookup', () => {
  it('returns adapted rule keywords on success', async () => {
    const fetcher = vi.fn(async (...args: [RequestInfo | URL]) => {
      void args
      return new Response(JSON.stringify([{ id: 4, keyword: 'found' }, { keyword: 'no id' }]))
    })
    const repository = createFetchRecordedApiRepository({ fetcher, basePath: '/api' })

    await expect(repository.fetchRuleKeywords('fo')).resolves.toStrictEqual({
      ok: true,
      value: [{ id: 4, keyword: 'found' }],
    })
    expect(String(fetcher.mock.calls[0]?.[0])).toContain('/api/rules/keyword')
  })
})
