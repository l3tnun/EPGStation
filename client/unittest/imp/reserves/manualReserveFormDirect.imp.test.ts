import { describe, expect, it, vi } from 'vitest'
import {
  createFormStateFromPageInfo,
  createFormStateFromReserve,
  createPageInfoFromFormState,
  formatManualDateTimeInput,
  normalizeFormState,
  nullableString,
  parseManualDateTimeInput,
  parseNullableNumber,
} from '@/features/reserves/lib/manualReserveForm'

describe('manualReserveForm direct unit edges', () => {
  it('[AC 4.4] restores a form state from a saved page info snapshot, including an omitted save option', () => {
    const pageInfo = {
      isTimeSpecification: true,
      timeSpecifiedOption: { name: 'Restored', channelId: 1, startAt: 1_000, endAt: 2_000 },
      reserveOption: { allowEndLack: false },
      encodeOption: { mode1: null, mode2: null, mode3: null, isDeleteOriginalAfterEncode: false },
    }

    expect(createFormStateFromPageInfo(pageInfo)).toStrictEqual({
      ...pageInfo,
      saveOption: undefined,
    })
  })

  it('[AC 4.4] restores a form state from a saved page info snapshot that includes a save option', () => {
    const pageInfo = {
      isTimeSpecification: false,
      timeSpecifiedOption: { name: null, channelId: null, startAt: null, endAt: null },
      reserveOption: { allowEndLack: true },
      saveOption: { parentDirectoryName: 'p', directory: 'd', recordedFormat: 'mp4' },
      encodeOption: { mode1: null, mode2: null, mode3: null, isDeleteOriginalAfterEncode: false },
    }

    expect(createFormStateFromPageInfo(pageInfo)).toStrictEqual(pageInfo)
  })

  it('[AC 4.16] omits saveOption from page info when the form state has no save option', () => {
    const formState = {
      isTimeSpecification: false,
      timeSpecifiedOption: { name: null, channelId: null, startAt: null, endAt: null },
      reserveOption: { allowEndLack: true },
      encodeOption: { mode1: null, mode2: null, mode3: null, isDeleteOriginalAfterEncode: false },
    }

    expect(createPageInfoFromFormState(formState)).toStrictEqual({
      ...formState,
      saveOption: undefined,
    })
  })

  it('[AC 4.4] defaults every optional reserve field to null/false when the source reserve omits them', () => {
    expect(createFormStateFromReserve({ id: 1 })).toStrictEqual({
      isTimeSpecification: false,
      timeSpecifiedOption: { name: null, channelId: null, startAt: null, endAt: null },
      reserveOption: { allowEndLack: true },
      saveOption: { parentDirectoryName: null, directory: null, recordedFormat: null },
      encodeOption: {
        mode1: null,
        encodeParentDirectoryName1: null,
        directory1: null,
        mode2: null,
        encodeParentDirectoryName2: null,
        directory2: null,
        mode3: null,
        encodeParentDirectoryName3: null,
        directory3: null,
        isDeleteOriginalAfterEncode: false,
      },
    })
  })

  it('[AC 4.20] defaults allowEndLack to true when normalizing a form state with no reserve option', () => {
    expect(
      normalizeFormState({
        isTimeSpecification: false,
        timeSpecifiedOption: { name: null, channelId: null, startAt: null, endAt: null },
        reserveOption: undefined as never,
        encodeOption: { mode1: null, mode2: null, mode3: null, isDeleteOriginalAfterEncode: false },
      }),
    ).toMatchObject({ reserveOption: { allowEndLack: true } })
  })

  it('[AC 4.23] formats an empty string for a value that produces an invalid Date', () => {
    expect(formatManualDateTimeInput(Number.MAX_VALUE)).toBe('')
  })

  it('[AC 4.23] parses a valid "yyyy-MM-dd HH:mm" input into UTC milliseconds', () => {
    expect(parseManualDateTimeInput('2026-05-05 10:15')).toBe(
      Date.parse('2026-05-05T10:15:00+09:00'),
    )
    expect(parseManualDateTimeInput('2026-05-05T10:15')).toBe(
      Date.parse('2026-05-05T10:15:00+09:00'),
    )
  })

  it('returns null when a matched date/time input still resolves to an invalid timestamp', () => {
    const spy = vi.spyOn(Number, 'isNaN').mockReturnValueOnce(true)

    try {
      expect(parseManualDateTimeInput('2026-05-05 10:15')).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  it('[AC 4.23] treats an empty/whitespace input as no value for both parsers', () => {
    expect(parseManualDateTimeInput('')).toBeNull()
    expect(parseManualDateTimeInput('   ')).toBeNull()
    expect(parseNullableNumber('')).toBeNull()
  })

  it('[AC 4.23] rejects a non-matching date/time input instead of falling back to numeric parsing', () => {
    // A raw digit string (e.g. a UNIX millisecond value, or a partially typed
    // "yyyy-MM-dd HH:mm" string caught mid-keystroke) must not be silently reinterpreted as
    // milliseconds: doing so is what corrupted the field on every keystroke.
    expect(parseManualDateTimeInput('12345')).toBeNull()
    expect(parseManualDateTimeInput('2026-09-20 21:0')).toBeNull()
    expect(parseManualDateTimeInput('2')).toBeNull()
  })

  it('[AC 4.23] rejects a calendar date/time that would only become valid through Date.UTC rollover', () => {
    // A format-matching but out-of-range date/time must never be silently normalized by
    // Date.UTC's day/month/hour/minute rollover (e.g. "2026-02-31 25:99" rolling forward into a
    // completely different, later instant that the field never displayed).
    expect(parseManualDateTimeInput('2026-02-31 25:99')).toBeNull()
    expect(parseManualDateTimeInput('2026-13-01 10:00')).toBeNull()
    // 2026 is not a leap year: February only has 28 days.
    expect(parseManualDateTimeInput('2026-02-29 10:00')).toBeNull()
    // 2028 is a leap year: February 29 is a real date.
    expect(parseManualDateTimeInput('2028-02-29 10:00')).toBe(
      Date.parse('2028-02-29T10:00:00+09:00'),
    )
  })

  it('[AC 4.23] rejects a non-integer numeric string', () => {
    expect(parseNullableNumber('not-a-number')).toBeNull()
    expect(parseNullableNumber('1.5')).toBeNull()
  })

  it('[AC 4.25] converts an empty clearable field value to null, and keeps a non-empty value as-is', () => {
    expect(nullableString('')).toBeNull()
    expect(nullableString('kept')).toBe('kept')
  })

  it('falls back to 00 for a date/time part missing from Intl.DateTimeFormat output', () => {
    const originalFormatToParts = Intl.DateTimeFormat.prototype.formatToParts
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
      .mockImplementation(function (this: Intl.DateTimeFormat, ...args) {
        return originalFormatToParts.apply(this, args).filter((part) => part.type !== 'year')
      })

    try {
      expect(formatManualDateTimeInput(Date.parse('2026-05-05T10:15:00+09:00'))).toBe(
        '00-05-05 10:15',
      )
    } finally {
      spy.mockRestore()
    }
  })

  it('[AC 4.23] rejects a valid-looking date/time whose parsed timestamp does not round-trip back to the same text', () => {
    // Defense in depth for the explicit range checks: month/day/hour/minute can all be in range
    // and the round-trip through `formatManualDateTimeInput` can still disagree with what was
    // typed, for reasons the range checks above cannot see (they never look at the year).
    //
    // "0050-01-01 00:00": `Date.UTC` maps any two-digit-looking year 0-99 to 1900+year (a legacy
    // JS behavior shared with the `Date` constructor), so this actually parses as 1950, and
    // formatting it back produces "1950-01-01 00:00" instead of "0050-01-01 00:00".
    expect(parseManualDateTimeInput('0050-01-01 00:00')).toBeNull()

    // "1000-01-01 00:00": Asia/Tokyo's tzdata offset before Japan adopted standard time in 1888
    // is LMT (UTC+9:18:59), not the UTC+9:00 this parser assumes via `hour - 9`. Formatting the
    // parsed instant back through the real Asia/Tokyo zone therefore lands on
    // "1000-01-01 00:18", 19 minutes later than what was typed.
    expect(parseManualDateTimeInput('1000-01-01 00:00')).toBeNull()
  })
})
