import { describe, expect, it } from 'vitest'
import { RANGE_TIME_ITEMS, START_TIME_ITEMS } from '@/features/search/rule/lib/searchFormItems'

describe('search time select items', () => {
  it('lists start hours 0 to 23 labelled with the hour', () => {
    expect(START_TIME_ITEMS).toHaveLength(24)
    expect(START_TIME_ITEMS[0]).toStrictEqual({ label: '0時', value: 0 })
    expect(START_TIME_ITEMS[23]).toStrictEqual({ label: '23時', value: 23 })
    START_TIME_ITEMS.forEach((item, index) => {
      expect(item).toStrictEqual({ label: `${index}時`, value: index })
    })
  })

  it('lists ranges of 1 to 23 hours labelled with the length', () => {
    expect(RANGE_TIME_ITEMS).toHaveLength(23)
    expect(RANGE_TIME_ITEMS[0]).toStrictEqual({ label: '1時間', value: 1 })
    expect(RANGE_TIME_ITEMS[22]).toStrictEqual({ label: '23時間', value: 23 })
    RANGE_TIME_ITEMS.forEach((item, index) => {
      expect(item).toStrictEqual({ label: `${index + 1}時間`, value: index + 1 })
    })
  })
})
