import { describe, expect, it } from 'vitest'
import {
  adaptChannelIndex,
  adaptRecordedItem,
  adaptRecordedResponse,
  adaptSearchOptionChannelIndex,
  createEndpointUrl,
  hydrateRecordedChannelName,
} from '@/features/recorded/api/recordedAdapters'

describe('recorded item adapter', () => {
  it('keeps every field of a fully valid item', () => {
    const item = {
      id: 1,
      name: 'n',
      channelId: 2,
      channelName: 'c',
      genres: ['g1', 'g2'],
      genre1: 3,
      subGenre1: 4,
      genre2: 5,
      subGenre2: 6,
      genre3: 7,
      subGenre3: 8,
      startAt: 9,
      endAt: 10,
      description: 'd',
      extended: 'e',
      ruleId: 11,
      isProtected: true,
      isRecording: false,
      isEncoding: true,
      thumbnails: [12, 13],
      dropLogFile: { id: 14, dropCnt: 1, errorCnt: 2, scramblingCnt: 3 },
      videoFiles: [{ id: 15, name: 'v', filename: 'f', size: 16, type: 'ts', isOriginal: true }],
    }

    expect(adaptRecordedItem(item)).toStrictEqual(item)
  })

  it('drops every field whose type is wrong', () => {
    expect(
      adaptRecordedItem({
        id: 'x',
        name: 1,
        channelId: 'x',
        channelName: 1,
        genres: 'x',
        genre1: 'x',
        subGenre1: 'x',
        genre2: 'x',
        subGenre2: 'x',
        genre3: 'x',
        subGenre3: 'x',
        startAt: 'x',
        endAt: 'x',
        description: 1,
        extended: 1,
        ruleId: 'x',
        isProtected: 'x',
        isRecording: 'x',
        isEncoding: 'x',
        thumbnails: 'x',
        dropLogFile: 'x',
        videoFiles: 'x',
      }),
    ).toStrictEqual({})
    expect(adaptRecordedItem(null)).toStrictEqual({})
    expect(adaptRecordedItem('x')).toStrictEqual({})
  })

  it('reads genres from a genres array of strings or from a single genre string', () => {
    expect(adaptRecordedItem({ genres: ['a', 1, 'b'] }).genres).toStrictEqual(['a', 'b'])
    expect(adaptRecordedItem({ genre: 'single' }).genres).toStrictEqual(['single'])
    expect(adaptRecordedItem({ genre: 1 }).genres).toBeUndefined()
  })

  it('keeps only numeric thumbnails and a drop log only when all counters are numbers', () => {
    expect(adaptRecordedItem({ thumbnails: [1, 'x', 2] }).thumbnails).toStrictEqual([1, 2])

    const dropLog = { dropCnt: 1, errorCnt: 2, scramblingCnt: 3 }
    expect(adaptRecordedItem({ dropLogFile: dropLog }).dropLogFile).toStrictEqual({
      id: undefined,
      ...dropLog,
    })
    expect(
      adaptRecordedItem({ dropLogFile: { ...dropLog, id: 'x' } }).dropLogFile?.id,
    ).toBeUndefined()
    for (const key of ['dropCnt', 'errorCnt', 'scramblingCnt']) {
      const item = adaptRecordedItem({ dropLogFile: { ...dropLog, [key]: 'x' } })
      expect('dropLogFile' in item).toBe(false)
    }
    expect('dropLogFile' in adaptRecordedItem({ dropLogFile: null })).toBe(false)
  })

  it('adapts video files field by field and turns a non-object video file into an empty one', () => {
    expect(
      adaptRecordedItem({
        videoFiles: [
          { id: 'x', name: 1, filename: 1, size: 'x', type: 1, isOriginal: 'x' },
          null,
          { id: 1, name: 'n', filename: 'f', size: 2, type: 't', isOriginal: false },
        ],
      }).videoFiles,
    ).toStrictEqual([
      {},
      {},
      { id: 1, name: 'n', filename: 'f', size: 2, type: 't', isOriginal: false },
    ])
  })
})

describe('recorded response adapter', () => {
  it('rejects a response that is not an object with a records array and a numeric total', () => {
    expect(adaptRecordedResponse(null)).toBeNull()
    expect(adaptRecordedResponse('x')).toBeNull()
    expect(adaptRecordedResponse({ records: 'x', total: 1 })).toBeNull()
    expect(adaptRecordedResponse({ records: [], total: '1' })).toBeNull()
    expect(adaptRecordedResponse({ records: [{ id: 1 }], total: 1 })).toStrictEqual({
      records: [{ id: 1 }],
      total: 1,
    })
  })
})

describe('recorded list request url', () => {
  it('skips page and keeps string, number and boolean parameters only', () => {
    expect(
      createEndpointUrl('/api/', {
        page: 3,
        isHalfWidth: false,
        offset: 0,
        limit: 24,
        keyword: 'k w',
        ruleId: undefined,
      } as never),
    ).toBe('/api/recorded?isHalfWidth=false&offset=0&limit=24&keyword=k+w')
  })
})

describe('recorded channel indexes', () => {
  it('prefers the half-width name only when asked and when it is a string', () => {
    const channels = [
      null,
      'x',
      { id: 'x', name: 'string id' },
      { id: 1, name: 'Full', halfWidthName: 'Half' },
      { id: 2, name: 'OnlyFull', halfWidthName: 5 },
      { id: 3, halfWidthName: 'OnlyHalf' },
      { id: 4, halfWidthName: 5 },
      { id: 5 },
    ]

    expect(adaptChannelIndex(channels, true)).toStrictEqual(
      new Map([
        [1, 'Half'],
        [2, 'OnlyFull'],
        [3, 'OnlyHalf'],
      ]),
    )
    expect(adaptChannelIndex(channels, false)).toStrictEqual(
      new Map([
        [1, 'Full'],
        [2, 'OnlyFull'],
        [3, 'OnlyHalf'],
      ]),
    )
  })

  it('builds the search option channels with the half-width name only when it is a string', () => {
    expect([
      ...adaptSearchOptionChannelIndex([
        null,
        { id: 'x', name: 'string id' },
        { id: 1, name: 'Full', halfWidthName: 'Half' },
        { id: 2, name: 'OnlyFull' },
        { id: 3, halfWidthName: 'OnlyHalf' },
        { id: 4, halfWidthName: 5 },
        { id: 5 },
      ]),
    ]).toStrictEqual([
      [1, { id: 1, name: 'Full', halfWidthName: 'Half' }],
      [2, { id: 2, name: 'OnlyFull' }],
      [3, { id: 3, name: 'OnlyHalf', halfWidthName: 'OnlyHalf' }],
    ])
  })

  it('names a record from the index but keeps a given name and leaves unknown channels as they are', () => {
    const index = new Map([[1, 'Indexed']])
    const given = { channelId: 1, channelName: 'Given' }
    const unknown = { channelId: 9 }

    expect(hydrateRecordedChannelName(given, index)).toBe(given)
    expect(hydrateRecordedChannelName(unknown, index)).toBe(unknown)
    expect(hydrateRecordedChannelName({}, index)).toStrictEqual({})
    expect(hydrateRecordedChannelName({ channelId: 1 }, index)).toStrictEqual({
      channelId: 1,
      channelName: 'Indexed',
    })
  })
})
