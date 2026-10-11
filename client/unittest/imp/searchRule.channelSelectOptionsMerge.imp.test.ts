import { describe, expect, it } from 'vitest'
import { mergeChannelSelectOptions } from '@/features/search/rule/lib/channelSelectOptions'
import type { SearchRuleDetail } from '@/features/search/rule/lib/searchTypes'

function detail(searchOption: Record<string, unknown>): SearchRuleDetail {
  return { searchOption } as unknown as SearchRuleDetail
}

describe('searchRule channel select options merge', () => {
  it('returns the channel options as-is when no channel id is selected', () => {
    const options = [{ id: 1, name: 'a' }] as never
    expect(
      mergeChannelSelectOptions({ channelIds: [], channelOptions: options, ruleDetail: null }),
    ).toBe(options)
  })

  it('adds only channel ids that are missing from the options, ahead of the options', () => {
    const result = mergeChannelSelectOptions({
      channelIds: [1, 3],
      channelOptions: [
        { id: 1, name: 'one' },
        { id: 2, name: 'two' },
      ] as never,
      ruleDetail: null,
    })

    expect(result).toEqual([
      { id: 3, name: '3' },
      { id: 1, name: 'one' },
      { id: 2, name: 'two' },
    ])
  })

  it('uses the stored channel name matching the id position in the rule', () => {
    const result = mergeChannelSelectOptions({
      channelIds: [5, 7],
      channelOptions: [] as never,
      ruleDetail: detail({ channelIds: [7, 5], channelNames: ['seven', 'five'] }),
    })

    expect(result).toEqual([
      { id: 5, name: 'five' },
      { id: 7, name: 'seven' },
    ])
  })

  it('falls back to the id text when the rule does not list the channel', () => {
    const result = mergeChannelSelectOptions({
      channelIds: [5],
      channelOptions: [] as never,
      ruleDetail: detail({ channelIds: [9], channelNames: ['nine'] }),
    })

    expect(result).toEqual([{ id: 5, name: '5' }])
  })

  it('falls back to the id text when the rule has no channel ids even if names exist', () => {
    const result = mergeChannelSelectOptions({
      channelIds: [5],
      channelOptions: [] as never,
      ruleDetail: detail({ channelNames: ['a', 'b'] }),
    })

    expect(result).toEqual([{ id: 5, name: '5' }])
  })

  it('falls back to the id text when the rule lists the id but has no names', () => {
    const result = mergeChannelSelectOptions({
      channelIds: [5],
      channelOptions: [] as never,
      ruleDetail: detail({ channelIds: [5] }),
    })

    expect(result).toEqual([{ id: 5, name: '5' }])
  })
})
