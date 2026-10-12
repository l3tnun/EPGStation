import { describe, expect, it } from 'vitest'
import {
  adaptChannelNameIndex,
  adaptLiveStreamItem,
  adaptLiveStreams,
  attachChannelNamesToLiveStreams,
} from '@/features/onair/lib/onairLiveStreamAdapters'

describe('onairLiveStreamAdapters malformed payload guards', () => {
  it('adaptLiveStreamItem rejects a non-record value and values missing numeric channelId/mode', () => {
    expect(adaptLiveStreamItem(null)).toBeNull()
    expect(adaptLiveStreamItem({ channelId: 'bad', mode: 0 })).toBeNull()
    expect(adaptLiveStreamItem({ channelId: 1, mode: 'bad' })).toBeNull()
  })

  it('adaptLiveStreamItem carries optional fields only when well typed', () => {
    expect(adaptLiveStreamItem({ channelId: 1, mode: 0 })).toStrictEqual({
      channelId: 1,
      mode: 0,
    })
    expect(
      adaptLiveStreamItem({
        channelId: 1,
        mode: 0,
        type: 'hls',
        name: 'n',
        description: 'd',
        startAt: 1,
        endAt: 2,
      }),
    ).toStrictEqual({
      channelId: 1,
      mode: 0,
      type: 'hls',
      name: 'n',
      description: 'd',
      startAt: 1,
      endAt: 2,
    })
    expect(
      adaptLiveStreamItem({
        channelId: 1,
        mode: 0,
        type: 2,
        name: 3,
        description: 4,
        startAt: '1',
        endAt: '2',
      }),
    ).toStrictEqual({ channelId: 1, mode: 0 })
  })

  it('adaptLiveStreams rejects a non-record payload or a payload without an items array', () => {
    expect(adaptLiveStreams(null)).toBeNull()
    expect(adaptLiveStreams({ items: 'not-an-array' })).toBeNull()
  })

  it('adaptLiveStreams rejects when any item fails to normalize', () => {
    expect(
      adaptLiveStreams({ items: [{ channelId: 1, mode: 0 }, { channelId: 'bad' }] }),
    ).toBeNull()
  })

  it('adaptLiveStreams returns normalized items on success', () => {
    expect(adaptLiveStreams({ items: [{ channelId: 1, mode: 0 }] })).toStrictEqual({
      items: [{ channelId: 1, mode: 0 }],
    })
  })

  it('adaptChannelNameIndex rejects a non-array payload', () => {
    expect(adaptChannelNameIndex('not-an-array', false)).toBeNull()
  })

  it('adaptChannelNameIndex skips entries missing a numeric id and entries without a usable name', () => {
    const index = adaptChannelNameIndex(
      [
        'not-a-record',
        { id: 'bad', name: 'ignored' },
        { id: 1, name: 2 },
        { id: 2, name: 'Only Full Width' },
      ],
      false,
    )

    expect(index).not.toBeNull()
    expect(index?.has(1)).toBe(false)
    expect(index?.get(2)).toBe('Only Full Width')
  })

  it('adaptChannelNameIndex prefers halfWidthName only when isHalfWidth is true and falls back to name otherwise', () => {
    const halfWidthIndex = adaptChannelNameIndex(
      [{ id: 1, name: 'Full', halfWidthName: 'Half' }],
      true,
    )
    expect(halfWidthIndex?.get(1)).toBe('Half')

    const fullWidthIndex = adaptChannelNameIndex(
      [{ id: 1, name: 'Full', halfWidthName: 'Half' }],
      false,
    )
    expect(fullWidthIndex?.get(1)).toBe('Full')

    const missingHalfWidthIndex = adaptChannelNameIndex([{ id: 1, name: 'Full' }], true)
    expect(missingHalfWidthIndex?.get(1)).toBe('Full')
  })

  it('attachChannelNamesToLiveStreams leaves an item unchanged when its channel has no known name', () => {
    const streams = {
      items: [
        { channelId: 1, mode: 0 },
        { channelId: 2, mode: 0 },
      ],
    }
    const channelNames = new Map([[1, 'Known Channel']])

    expect(attachChannelNamesToLiveStreams({ streams, channelNames })).toStrictEqual({
      items: [
        { channelId: 1, mode: 0, channelName: 'Known Channel' },
        { channelId: 2, mode: 0 },
      ],
    })
  })
})
