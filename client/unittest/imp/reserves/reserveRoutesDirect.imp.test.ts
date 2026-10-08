import { describe, expect, it, vi } from 'vitest'
import {
  formatReserveTimeRange,
  linkifyReserveExtendedText,
} from '@/features/reserves/lib/reserveRoutes'
import { getJapanDateParts } from '@/features/reserves/lib/reserveEndpoint'

describe('reserveRoutes direct unit edges', () => {
  it('[AC 2.9] formats an empty string when either boundary of the time range is missing', () => {
    expect(formatReserveTimeRange({})).toBe('')
    expect(formatReserveTimeRange({ startAt: 1_000 })).toBe('')
    expect(formatReserveTimeRange({ endAt: 2_000 })).toBe('')
  })

  it('[AC 2.9] formats a full Japan-time range with duration in minutes', () => {
    const startAt = Date.parse('2026-05-05T10:15:00+09:00')
    const endAt = Date.parse('2026-05-05T10:45:00+09:00')

    expect(formatReserveTimeRange({ startAt, endAt })).toBe('2026/05/05 10:15 - 10:45 (30分)')
  })

  it('[AC 2.9] treats a URL match that starts at index 0 as having no leading text token', () => {
    expect(
      linkifyReserveExtendedText('https://example.invalid/reserve-info trailing text'),
    ).toStrictEqual([
      {
        type: 'link',
        text: 'https://example.invalid/reserve-info',
        href: 'https://example.invalid/reserve-info',
      },
      { type: 'text', text: ' trailing text' },
    ])
  })

  it('[AC 2.9] treats a URL match that consumes the rest of the text as having no trailing text token', () => {
    expect(
      linkifyReserveExtendedText('leading text https://example.invalid/reserve-info'),
    ).toStrictEqual([
      { type: 'text', text: 'leading text ' },
      {
        type: 'link',
        text: 'https://example.invalid/reserve-info',
        href: 'https://example.invalid/reserve-info',
      },
    ])
  })

  it('[AC 2.9] falls back to a text token when the matched URL fails to parse', () => {
    expect(linkifyReserveExtendedText('broken https://[ link')).toStrictEqual([
      { type: 'text', text: 'broken ' },
      { type: 'text', text: 'https://[' },
      { type: 'text', text: ' link' },
    ])
  })

  it('falls back to index 0 when a matched URL reports no match index', () => {
    const fakeMatch = Object.assign(['https://example.invalid/reserve-info'], {
      index: undefined,
      input: 'https://example.invalid/reserve-info',
    }) as unknown as RegExpMatchArray

    const spy = vi
      .spyOn(String.prototype, 'matchAll')
      .mockReturnValueOnce(
        [fakeMatch][Symbol.iterator]() as unknown as ReturnType<typeof String.prototype.matchAll>,
      )

    try {
      expect(linkifyReserveExtendedText('https://example.invalid/reserve-info')).toStrictEqual([
        {
          type: 'link',
          text: 'https://example.invalid/reserve-info',
          href: 'https://example.invalid/reserve-info',
        },
      ])
    } finally {
      spy.mockRestore()
    }
  })

  it('[AC 2.9] stops a linkified URL before a trailing quote or angle bracket, unlike v2 which would include them', () => {
    expect(
      linkifyReserveExtendedText('see "https://example.invalid/reserve-info" for details'),
    ).toStrictEqual([
      { type: 'text', text: 'see "' },
      {
        type: 'link',
        text: 'https://example.invalid/reserve-info',
        href: 'https://example.invalid/reserve-info',
      },
      { type: 'text', text: '" for details' },
    ])

    expect(linkifyReserveExtendedText('<https://example.invalid/reserve-info>')).toStrictEqual([
      { type: 'text', text: '<' },
      {
        type: 'link',
        text: 'https://example.invalid/reserve-info',
        href: 'https://example.invalid/reserve-info',
      },
      { type: 'text', text: '>' },
    ])
  })

  it('falls back to 0 for a Japan-time date part missing from Intl.DateTimeFormat output', () => {
    const originalFormatToParts = Intl.DateTimeFormat.prototype.formatToParts
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
      .mockImplementation(function (this: Intl.DateTimeFormat, ...args) {
        return originalFormatToParts.apply(this, args).filter((part) => part.type !== 'hour')
      })

    try {
      expect(getJapanDateParts(Date.parse('2026-05-05T10:15:00+09:00'))).toStrictEqual({
        year: 2026,
        month: 5,
        day: 5,
        hour: 0,
        minute: 15,
      })
    } finally {
      spy.mockRestore()
    }
  })
})
