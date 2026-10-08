import { describe, expect, it } from 'vitest'
import {
  formatGuideDate,
  isSafeHttpUrl,
  linkifyGuideProgramExtendedText,
  parseGuideProgramDetailSetting,
  transformReserveListsToIndex,
  writeGuideProgramDetailSetting,
} from '@/features/guide/lib/guideProgramText'
import { WEEKDAYS } from '@/features/guide/lib/guideRoute'

describe('isSafeHttpUrl', () => {
  it('returns false when the value cannot be parsed as a URL at all', () => {
    expect(isSafeHttpUrl('not a url')).toBe(false)
  })
})

describe('linkifyGuideProgramExtendedText additional edges', () => {
  it('does not emit a leading text token when the matched URL starts at index 0', () => {
    expect(linkifyGuideProgramExtendedText('https://example.test/path')).toStrictEqual([
      { type: 'link', text: 'https://example.test/path', href: 'https://example.test/path' },
    ])
  })

  it('treats a match with no reported index as starting at the beginning of the text', () => {
    const originalMatchAll = String.prototype.matchAll
    // RegExp match results always carry a numeric `index` in practice; this simulates the
    // defensive `match.index ?? 0` fallback for an iterator that omits it.
    String.prototype.matchAll = function (this: string) {
      const fakeMatch = Object.assign(['https://example.test/path'], {
        index: undefined,
        input: this,
      }) as unknown as RegExpMatchArray

      return [fakeMatch][Symbol.iterator]()
    } as unknown as typeof String.prototype.matchAll

    try {
      expect(linkifyGuideProgramExtendedText('https://example.test/path')).toStrictEqual([
        { type: 'link', text: 'https://example.test/path', href: 'https://example.test/path' },
      ])
    } finally {
      String.prototype.matchAll = originalMatchAll
    }
  })

  it('treats a syntactically matched but unparsable http(s) URL as plain text', () => {
    expect(linkifyGuideProgramExtendedText('see http://[invalid for details')).toStrictEqual([
      { type: 'text', text: 'see ' },
      { type: 'text', text: 'http://[invalid' },
      { type: 'text', text: ' for details' },
    ])
  })
})

describe('parseGuideProgramDetailSetting additional edges', () => {
  it('falls back to defaults when the parsed JSON value is not an object', () => {
    expect(parseGuideProgramDetailSetting('42')).toStrictEqual({
      encode: 'TS',
      isDeleteOriginalAfterEncode: false,
    })
    expect(parseGuideProgramDetailSetting('null')).toStrictEqual({
      encode: 'TS',
      isDeleteOriginalAfterEncode: false,
    })
  })

  it('falls back to defaults for missing/empty encode and non-boolean isDeleteOriginalAfterEncode', () => {
    expect(parseGuideProgramDetailSetting('{}')).toStrictEqual({
      encode: 'TS',
      isDeleteOriginalAfterEncode: false,
    })
    expect(
      parseGuideProgramDetailSetting(
        JSON.stringify({ encode: '', isDeleteOriginalAfterEncode: 'yes' }),
      ),
    ).toStrictEqual({
      encode: 'TS',
      isDeleteOriginalAfterEncode: false,
    })
  })

  it('falls back to defaults when the stored value is malformed JSON', () => {
    expect(parseGuideProgramDetailSetting('{not json')).toStrictEqual({
      encode: 'TS',
      isDeleteOriginalAfterEncode: false,
    })
  })
})

describe('writeGuideProgramDetailSetting', () => {
  it('normalizes an empty encode value to TS before persisting', () => {
    const values = new Map<string, string>()
    const storage = {
      setItem: (key: string, value: string) => {
        values.set(key, value)
      },
    }

    writeGuideProgramDetailSetting(storage, { encode: '', isDeleteOriginalAfterEncode: true })

    expect(JSON.parse(values.get('GuideProgramDetailSetting') ?? '{}')).toStrictEqual({
      encode: 'TS',
      isDeleteOriginalAfterEncode: true,
    })
  })
})

describe('formatGuideDate', () => {
  it('falls back to a UTC-derived weekday when the localized weekday label is unrecognized', () => {
    // `format` is an accessor on the prototype that returns a per-instance bound function,
    // so it must be replaced via its property descriptor rather than a plain method spy.
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      Intl.DateTimeFormat.prototype,
      'format',
    )
    expect(originalDescriptor?.get).toBeDefined()

    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', {
      configurable: true,
      get(this: Intl.DateTimeFormat) {
        if (this.resolvedOptions().weekday !== undefined) {
          return () => 'Unknown'
        }

        return originalDescriptor!.get!.call(this)
      },
    })

    try {
      const timestamp = Date.parse('2026-05-05T00:00:00+09:00')
      const expectedWeekday = WEEKDAYS[new Date(timestamp).getUTCDay()]

      expect(formatGuideDate(timestamp)).toBe(`05/05(${expectedWeekday})`)
    } finally {
      Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', originalDescriptor!)
    }
  })
})

describe('transformReserveListsToIndex', () => {
  it('skips a reserve item that has no programId', () => {
    expect(
      transformReserveListsToIndex({
        normal: [{ id: 1 }],
        conflicts: [],
        skips: [],
        overlaps: [],
      }),
    ).toStrictEqual({})
  })
})
