import { describe, expect, it, vi } from 'vitest'
import {
  formatReserveDate,
  formatReserveCardTimeRange,
  reserveGenreLabels,
  reserveLabel,
} from '@/features/reserves/lib/reserveLabels'

describe('reserveLabels direct unit edges', () => {
  it('[AC 2.6] prefers the reserve name when present', () => {
    expect(reserveLabel({ id: 1, name: 'Synthetic reserve' })).toBe('Synthetic reserve')
  })

  it('[AC 2.6] falls back to "#<id>" when the reserve has no name but has an id', () => {
    expect(reserveLabel({ id: 7 })).toBe('#7')
  })

  it('[AC 2.6] falls back to a 1-based index label when both name and id are absent', () => {
    expect(reserveLabel({} as never, 2)).toBe('#3')
    expect(reserveLabel({} as never)).toBe('#1')
  })

  it('[AC 2.6] resolves a legacy sub-genre label when the genre/sub-genre pair is in the lookup table', () => {
    expect(reserveGenreLabels({ id: 1, genre1: 7, subGenre1: 1 })).toStrictEqual([
      'アニメ・特撮 / 海外アニメ',
    ])
  })

  it('[AC 2.6] resolves the bare genre label when the sub-genre is not in the lookup table', () => {
    expect(reserveGenreLabels({ id: 1, genre1: 7, subGenre1: 99 })).toStrictEqual(['アニメ・特撮'])
  })

  it('[AC 2.6] resolves a sub-genre label for a genre that the reserve dialog previously had no entry for (genre 0)', () => {
    expect(reserveGenreLabels({ id: 1, genre1: 0, subGenre1: 1 })).toStrictEqual([
      'ニュース・報道 / 天気',
    ])
  })

  it('[AC 2.6] resolves sub-genre labels for every genre shared with the guide screen lookup table', () => {
    expect(reserveGenreLabels({ id: 1, genre1: 2, subGenre1: 5 })).toStrictEqual([
      '情報・ワイドショー / グルメ・料理',
    ])
    expect(reserveGenreLabels({ id: 1, genre1: 9, subGenre1: 2 })).toStrictEqual([
      '劇場・公演 / ダンス・バレエ',
    ])
    expect(reserveGenreLabels({ id: 1, genre1: 10, subGenre1: 11 })).toStrictEqual([
      '趣味・教育 / 生涯教育・資格',
    ])
    expect(reserveGenreLabels({ id: 1, genre1: 11, subGenre1: 5 })).toStrictEqual([
      '福祉 / 文字(字幕)',
    ])
  })

  it('formats an empty date and time-range string when the required timestamps are absent', () => {
    expect(formatReserveDate(undefined)).toBe('')
    expect(formatReserveCardTimeRange({ id: 1 })).toBe('')
  })

  it('falls back to an empty string for a date part missing from Intl.DateTimeFormat output', () => {
    const originalFormatToParts = Intl.DateTimeFormat.prototype.formatToParts
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
      .mockImplementation(function (this: Intl.DateTimeFormat, ...args) {
        return originalFormatToParts.apply(this, args).filter((part) => part.type !== 'month')
      })

    try {
      expect(formatReserveDate(Date.parse('2026-05-05T10:15:00+09:00'))).toBe('00/05(火)')
    } finally {
      spy.mockRestore()
    }
  })

  it('falls back to an empty day/time part inside the day-time range formatter as well', () => {
    const originalFormatToParts = Intl.DateTimeFormat.prototype.formatToParts
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
      .mockImplementation(function (this: Intl.DateTimeFormat, ...args) {
        return originalFormatToParts.apply(this, args).filter((part) => part.type !== 'weekday')
      })

    try {
      expect(
        formatReserveCardTimeRange({
          id: 1,
          startAt: Date.parse('2026-05-05T10:15:00+09:00'),
          endAt: Date.parse('2026-05-05T10:45:00+09:00'),
        }),
      ).toBe('05/05() 10:15 ~ 10:45 (30分)')
    } finally {
      spy.mockRestore()
    }
  })
})
