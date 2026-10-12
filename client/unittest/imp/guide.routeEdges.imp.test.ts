import { describe, expect, it } from 'vitest'
import {
  buildGuideRouteWithTime,
  getJapanDateParts,
  parseGuideTime,
} from '@/features/guide/lib/guideRoute'

describe('getJapanDateParts', () => {
  it('falls back to 0 for a part missing from the Intl.DateTimeFormat output', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Intl.DateTimeFormat.prototype,
      'formatToParts',
    )
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'formatToParts', {
      configurable: true,
      value: () => [{ type: 'year', value: '2026' }],
    })

    try {
      expect(getJapanDateParts(0)).toStrictEqual({ year: 2026, month: 0, day: 0, hour: 0 })
    } finally {
      Object.defineProperty(Intl.DateTimeFormat.prototype, 'formatToParts', descriptor!)
    }
  })
})

describe('buildGuideRouteWithTime', () => {
  it('omits the type parameter when neither selectedType nor the current query has one', () => {
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')

    expect(
      buildGuideRouteWithTime({
        time: startAt,
        currentQuery: { mode: 'normal', startAt, isTimeQueryValid: true },
      }),
    ).toBe('/guide?time=26050509')
  })
})

describe('parseGuideTime', () => {
  it('marks the time invalid when the encoded hour is out of range', () => {
    expect(parseGuideTime('20260599')).toStrictEqual({
      startAt: Number.NaN,
      isValid: false,
    })
  })

  it('marks the time invalid when the encoded date does not round-trip (e.g. Feb 31)', () => {
    const result = parseGuideTime('26023112')

    expect(result?.isValid).toBe(false)
    expect(Number.isFinite(result?.startAt)).toBe(true)
  })
})
