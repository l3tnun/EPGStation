import { describe, expect, it, vi } from 'vitest'
import {
  formatGuideDate,
  isSafeHttpUrl,
  linkifyGuideProgramExtendedText,
  readGuideProgramDetailSetting,
  resolveGuideTitle,
  transformReserveListsToIndex,
  writeGuideProgramDetailSetting,
} from '@/features/guide/lib/guideProgramText'
import type { GuideQuery } from '@/features/guide/lib/guideRequestTypes'

describe('isSafeHttpUrl schemes', () => {
  it('accepts only http and https URLs', () => {
    expect(isSafeHttpUrl('http://example.test/')).toBe(true)
    expect(isSafeHttpUrl('https://example.test/')).toBe(true)
    expect(isSafeHttpUrl('ftp://example.test/')).toBe(false)
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('linkifyGuideProgramExtendedText empty input', () => {
  it('returns no tokens for undefined and empty text', () => {
    expect(linkifyGuideProgramExtendedText(undefined)).toStrictEqual([])
    expect(linkifyGuideProgramExtendedText('')).toStrictEqual([])
  })

  it('returns a single text token for text without URLs', () => {
    expect(linkifyGuideProgramExtendedText('plain')).toStrictEqual([
      { type: 'text', text: 'plain' },
    ])
  })
})

describe('program detail setting storage', () => {
  it('reads the stored value under the program detail key', () => {
    const getItem = vi.fn(() =>
      JSON.stringify({ encode: 'MP4', isDeleteOriginalAfterEncode: true }),
    )

    expect(readGuideProgramDetailSetting({ getItem })).toStrictEqual({
      encode: 'MP4',
      isDeleteOriginalAfterEncode: true,
    })
    expect(getItem).toHaveBeenCalledTimes(1)
    expect(getItem).toHaveBeenCalledWith('GuideProgramDetailSetting')
  })

  it('reads the defaults when no storage or no stored value exists', () => {
    const defaults = { encode: 'TS', isDeleteOriginalAfterEncode: false }

    expect(readGuideProgramDetailSetting(undefined)).toStrictEqual(defaults)
    expect(readGuideProgramDetailSetting({ getItem: () => null })).toStrictEqual(defaults)
  })

  it('writes the setting under the program detail key and tolerates missing storage', () => {
    const setItem = vi.fn()

    writeGuideProgramDetailSetting(
      { setItem },
      { encode: 'MP4', isDeleteOriginalAfterEncode: false },
    )

    expect(setItem).toHaveBeenCalledTimes(1)
    expect(setItem).toHaveBeenCalledWith(
      'GuideProgramDetailSetting',
      JSON.stringify({ encode: 'MP4', isDeleteOriginalAfterEncode: false }),
    )
    expect(() =>
      writeGuideProgramDetailSetting(undefined, {
        encode: 'TS',
        isDeleteOriginalAfterEncode: true,
      }),
    ).not.toThrow()
  })
})

describe('formatGuideDate weekdays', () => {
  it('uses the Japan-time weekday for every day of the week', () => {
    // 02:00 JST is still the previous day in UTC, so a UTC-derived weekday would be off by one.
    const labels = Array.from({ length: 7 }, (_, index) =>
      formatGuideDate(Date.parse('2026-05-03T02:00:00+09:00') + index * 24 * 3600000),
    )

    expect(labels).toStrictEqual([
      '05/03(日)',
      '05/04(月)',
      '05/05(火)',
      '05/06(水)',
      '05/07(木)',
      '05/08(金)',
      '05/09(土)',
    ])
  })
})

describe('resolveGuideTitle', () => {
  const startAt = Date.parse('2026-05-05T02:00:00+09:00')
  const query = (partial: Partial<GuideQuery>): GuideQuery =>
    ({ mode: 'normal', startAt, ...partial }) as GuideQuery

  it('appends the date by default and omits it when showDate is false', () => {
    expect(resolveGuideTitle(query({ type: 'GR' }))).toBe('番組表GR 05/05(火)')
    expect(resolveGuideTitle(query({ type: 'GR' }), undefined, { showDate: true })).toBe(
      '番組表GR 05/05(火)',
    )
    expect(resolveGuideTitle(query({ type: 'GR' }), undefined, { showDate: false })).toBe(
      '番組表GR',
    )
    expect(resolveGuideTitle(query({}), undefined, { showDate: false })).toBe('番組表')
  })

  it('uses the channel name for a single-channel guide', () => {
    expect(resolveGuideTitle(query({ mode: 'singleChannel' }), 'Channel A')).toBe('Channel A')
  })
})

describe('transformReserveListsToIndex states', () => {
  it('labels each list with its own state and lets later lists win for the same program', () => {
    const index = transformReserveListsToIndex({
      normal: [
        { id: 1, programId: 10 },
        { id: 2, programId: 11 },
      ],
      conflicts: [{ id: 3, programId: 11 }],
      skips: [{ id: 4, programId: 12 }],
      overlaps: [
        { id: 5, programId: 13 },
        { id: 6, programId: 12 },
      ],
    })

    expect(index).toStrictEqual({
      10: { type: 'reserve', item: { id: 1, programId: 10 } },
      11: { type: 'conflict', item: { id: 3, programId: 11 } },
      12: { type: 'overlap', item: { id: 6, programId: 12 } },
      13: { type: 'overlap', item: { id: 5, programId: 13 } },
    })
  })

  it('labels a skipped program as skip', () => {
    expect(
      transformReserveListsToIndex({
        normal: [],
        conflicts: [],
        skips: [{ id: 4, programId: 12 }],
        overlaps: [],
      }),
    ).toStrictEqual({ 12: { type: 'skip', item: { id: 4, programId: 12 } } })
  })
})
