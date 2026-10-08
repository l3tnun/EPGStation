import type { MouseEvent } from 'react'
import { describe, expect, it } from 'vitest'
import { DefaultSettingsFactory } from '@/shared/settings'
import {
  formatRecordedDetailGenres,
  formatRecordedDropInfo,
  formatRecordedTableTime,
  hasRecordedDropError,
  isInteractiveItemClick,
  itemLabel,
  itemSecondaryText,
} from '@/features/recorded/lib/recordedFormat'
import {
  parseOptionalNumber,
  parseRecordedDetailRouteId,
} from '@/features/recorded/lib/recordedRoute'

const settings = new DefaultSettingsFactory().create()

describe('recorded formatting: labels, drop info and genres', () => {
  it('labels items by name, id, or list position', () => {
    expect(itemLabel({ name: 'named' }, 0)).toBe('named')
    expect(itemLabel({ id: 7 }, 0)).toBe('#7')
    expect(itemLabel({}, 2)).toBe('#3')
  })

  it('treats a click whose target is not an element as non-interactive', () => {
    const event = { target: document } as unknown as MouseEvent<HTMLElement>
    expect(isInteractiveItemClick(event)).toBe(false)
  })

  it('always shows the drop size suffix, using 0.0B when no file size is known', () => {
    const dropSettings = { ...settings, isShowDropInfoInsteadOfDescription: true }
    const item = { dropLogFile: { dropCnt: 1, errorCnt: 2, scramblingCnt: 3 } }

    expect(itemSecondaryText(item, dropSettings)).toBe('1/2/3 0.0B')
    expect(itemSecondaryText({ ...item, videoFiles: [{}] }, dropSettings)).toBe('1/2/3 0.0B')
    expect(itemSecondaryText({ ...item, isRecording: true }, dropSettings)).toBe('')
    expect(formatRecordedDropInfo(item)).toBe('drop: 1, error: 2, scrambling: 3 0.0B')
    expect(formatRecordedDropInfo({ ...item, videoFiles: [{}] })).toBe(
      'drop: 1, error: 2, scrambling: 3 0.0B',
    )
  })

  it('flags drop errors only when at least one counter is positive', () => {
    expect(
      hasRecordedDropError({ dropLogFile: { dropCnt: 0, errorCnt: 0, scramblingCnt: 1 } }),
    ).toBe(true)
    expect(
      hasRecordedDropError({ dropLogFile: { dropCnt: 0, errorCnt: 0, scramblingCnt: 0 } }),
    ).toBe(false)
  })

  it('resolves detail genres from numeric ids, then from the genre name list', () => {
    expect(formatRecordedDetailGenres({ genre1: 99 })).toEqual([])
    expect(formatRecordedDetailGenres({ genre1: 3 })).toEqual(['ドラマ'])
    expect(formatRecordedDetailGenres({ genre1: 3, subGenre1: 99 })).toEqual(['ドラマ'])
    expect(formatRecordedDetailGenres({ genres: ['listed'] })).toEqual(['listed'])
    expect(formatRecordedDetailGenres({ genres: [] })).toEqual([])
  })

  it('formats table times only when both ends are known', () => {
    expect(formatRecordedTableTime({ startAt: 1_700_000_000_000 })).toBe('')
    expect(formatRecordedTableTime({ endAt: 1_700_000_000_000 })).toBe('')
    expect(
      formatRecordedTableTime({ startAt: 1_700_000_000_000, endAt: 1_700_000_600_000 }),
    ).toMatch(/^\d{2}\/\d{2}\(.\) \d{2}:\d{2} \(10 m\)$/)
  })
})

describe('recorded route parsing', () => {
  it('rejects non-integer and unsafe ids', () => {
    expect(parseOptionalNumber('1.5')).toBeNull()
    expect(parseOptionalNumber('12')).toBe(12)
    expect(parseRecordedDetailRouteId('99999999999999999999')).toBeNull()
    expect(parseRecordedDetailRouteId('12')).toBe(12)
  })
})
