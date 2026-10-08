import { describe, expect, it, vi } from 'vitest'
import {
  adaptChannelIndex,
  adaptRecordedItem,
  adaptRecordedResponse,
  adaptSearchOptionChannelIndex,
  createEndpointUrl,
  hydrateRecordedChannelName,
  resolveDefaultFetch,
} from '@/features/recorded/api/recordedAdapters'
import {
  fetchAction,
  fetchJson,
  fetchJsonWithInit,
  fetchText,
} from '@/features/recorded/api/recordedFetch'

describe('recorded list adapters: malformed backend payloads', () => {
  it('drops non-scalar request values and the page key from the endpoint query', () => {
    const url = createEndpointUrl('./api/', {
      isHalfWidth: true,
      limit: 24,
      offset: 0,
      page: 2,
      keyword: undefined,
    })

    expect(url).toBe('./api/recorded?isHalfWidth=true&limit=24&offset=0')
  })

  it('binds the default fetcher to globalThis', async () => {
    const original = globalThis.fetch
    const fetchSpy = vi.fn(async () => new Response('{}'))
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    try {
      await resolveDefaultFetch()('./api/x')
      expect(fetchSpy).toHaveBeenCalledWith('./api/x')
    } finally {
      globalThis.fetch = original
    }
  })

  it('indexes channels by the available name variants and skips nameless entries', () => {
    const full = adaptChannelIndex(
      [
        { id: 1, halfWidthName: 'half-only' },
        { id: 2, name: 'full', halfWidthName: 'half' },
        { id: 3 },
        { id: 'x', name: 'invalid id' },
        null,
      ],
      false,
    )
    expect([...full.entries()]).toEqual([
      [1, 'half-only'],
      [2, 'full'],
    ])

    const half = adaptChannelIndex([{ id: 2, name: 'full', halfWidthName: 'half' }], true)
    expect(half.get(2)).toBe('half')
    expect(adaptChannelIndex('not an array', true).size).toBe(0)
  })

  it('indexes search option channels with a half-width fallback name', () => {
    const index = adaptSearchOptionChannelIndex([
      { id: 1, halfWidthName: 'half-only' },
      { id: 2, name: 'full' },
      { id: 3 },
      'not a record',
    ])

    expect([...index.entries()]).toEqual([
      [1, { id: 1, name: 'half-only', halfWidthName: 'half-only' }],
      [2, { id: 2, name: 'full' }],
    ])
    expect(adaptSearchOptionChannelIndex(undefined).size).toBe(0)
  })

  it('hydrates a channel name from the index only when the item lacks one', () => {
    const index = new Map([[9, 'indexed']])
    expect(hydrateRecordedChannelName({ id: 1, channelId: 9 }, index)).toEqual({
      id: 1,
      channelId: 9,
      channelName: 'indexed',
    })
    expect(hydrateRecordedChannelName({ id: 1, channelId: 8 }, index)).toEqual({
      id: 1,
      channelId: 8,
    })
    expect(hydrateRecordedChannelName({ id: 1, channelId: 9, channelName: 'own' }, index)).toEqual({
      id: 1,
      channelId: 9,
      channelName: 'own',
    })
  })

  it('adapts recorded items field by field and tolerates missing optional fields', () => {
    expect(adaptRecordedItem('not a record')).toEqual({})

    const item = adaptRecordedItem({
      id: 1,
      channelName: 'named channel',
      genre: 'single genre',
      dropLogFile: { dropCnt: 1, errorCnt: 0, scramblingCnt: 0 },
      videoFiles: [{}, 'not a record', { id: 5, isOriginal: true }],
      thumbnails: [1, 'x', 2],
    })

    expect(item).toEqual({
      id: 1,
      channelName: 'named channel',
      genres: ['single genre'],
      dropLogFile: { id: undefined, dropCnt: 1, errorCnt: 0, scramblingCnt: 0 },
      videoFiles: [{}, {}, { id: 5, isOriginal: true }],
      thumbnails: [1, 2],
    })
  })

  it('adapts a response whose records include non-record entries', () => {
    const response = adaptRecordedResponse({ records: [5, { id: 7 }], total: 2 })
    expect(response).toEqual({ records: [{}, { id: 7 }], total: 2 })
    expect(adaptRecordedResponse({ records: 'x', total: 1 })).toBeNull()
  })
})

describe('recorded fetch helpers: transport failures', () => {
  const throwing = vi.fn(async () => {
    throw new Error('network down')
  })

  it('return null or false when the fetcher throws', async () => {
    await expect(fetchJson(throwing, '/a')).resolves.toBeNull()
    await expect(fetchJsonWithInit(throwing, '/a', { method: 'POST' })).resolves.toBeNull()
    await expect(fetchText(throwing, '/a')).resolves.toBeNull()
    await expect(fetchAction(throwing, '/a', { method: 'DELETE' })).resolves.toBe(false)
  })

  it('return null on non-ok responses', async () => {
    const notOk = vi.fn(async () => new Response('x', { status: 500 }))
    await expect(fetchJsonWithInit(notOk, '/a', {})).resolves.toBeNull()
    await expect(fetchText(notOk, '/a')).resolves.toBeNull()
    await expect(fetchAction(notOk, '/a', {})).resolves.toBe(false)
  })
})
