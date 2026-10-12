import { describe, expect, it, vi } from 'vitest'
import {
  formatManualProgramDate,
  manualProgramGenres,
} from '@/features/reserves/lib/manualProgramFormat'

describe('manualProgramFormat direct unit edges', () => {
  const baseProgram = {
    id: 1,
    name: 'Program',
    channelId: 1,
    startAt: Date.parse('2026-05-04T10:15:00+09:00'),
    endAt: Date.parse('2026-05-04T10:45:00+09:00'),
  }

  it('formats a Japan-time program date with Japanese weekday and duration in minutes', () => {
    expect(formatManualProgramDate(baseProgram)).toBe('05/04(月) 10:15 ~ 10:45 (30m)')
  })

  it('[AC 4.3] uses the explicit genres array when it is non-empty', () => {
    expect(manualProgramGenres({ ...baseProgram, genres: ['Synthetic genre'] })).toStrictEqual([
      'Synthetic genre',
    ])
  })

  it('[AC 4.3] falls back to legacy genre1-3 resolution when genres is absent or empty', () => {
    expect(manualProgramGenres({ ...baseProgram, genres: [] })).toStrictEqual([])
    expect(manualProgramGenres({ ...baseProgram, genre1: 0, subGenre1: 0 })).toStrictEqual([
      'ニュース・報道 / 定時・総合',
    ])
  })

  it('falls back to 00 and the Sunday label when Intl.DateTimeFormat omits parts', () => {
    const originalFormatToParts = Intl.DateTimeFormat.prototype.formatToParts
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, 'formatToParts')
      .mockImplementation(function (this: Intl.DateTimeFormat, ...args) {
        return originalFormatToParts
          .apply(this, args)
          .filter((part) => part.type !== 'weekday' && part.type !== 'hour')
      })

    try {
      expect(formatManualProgramDate(baseProgram)).toBe('05/04(日) 00:15 ~ 00:45 (30m)')
    } finally {
      spy.mockRestore()
    }
  })
})
