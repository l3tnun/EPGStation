import { describe, expect, it } from 'vitest'
import { formatDayLabel } from '@/features/guide/lib/guideDate'

describe('getJapanDateParts fallback branches (via formatDayLabel)', () => {
  it('falls back to 0 for a missing Intl.DateTimeFormat part and 日 for an unrecognized weekday', () => {
    const spy = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'formatToParts')
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'formatToParts', {
      configurable: true,
      value: () => [{ type: 'weekday', value: 'Unknown' }],
    })

    try {
      expect(formatDayLabel(0)).toBe('00/00(日)')
    } finally {
      Object.defineProperty(Intl.DateTimeFormat.prototype, 'formatToParts', spy!)
    }
  })
})
