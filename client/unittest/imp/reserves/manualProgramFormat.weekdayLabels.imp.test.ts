import { describe, expect, it } from 'vitest'
import {
  formatManualProgramDate,
  manualProgramGenres,
} from '@/features/reserves/lib/manualProgramFormat'

const baseProgram = { id: 1, name: 'Program', channelId: 1 }

describe('manualProgramFormat weekday labels', () => {
  it.each([
    ['2026-05-03', '05/03(日)'],
    ['2026-05-04', '05/04(月)'],
    ['2026-05-05', '05/05(火)'],
    ['2026-05-06', '05/06(水)'],
    ['2026-05-07', '05/07(木)'],
    ['2026-05-08', '05/08(金)'],
    ['2026-05-09', '05/09(土)'],
  ])('labels %s in Japan time as %s', (date, label) => {
    expect(
      formatManualProgramDate({
        ...baseProgram,
        startAt: Date.parse(`${date}T10:15:00+09:00`),
        endAt: Date.parse(`${date}T11:00:00+09:00`),
      }),
    ).toBe(`${label} 10:15 ~ 11:00 (45m)`)
  })
})

describe('manualProgramGenres source selection', () => {
  const times = { startAt: 0, endAt: 60000 }

  it('prefers a non-empty genres array over the legacy genre fields', () => {
    expect(
      manualProgramGenres({
        ...baseProgram,
        ...times,
        genres: ['Synthetic'],
        genre1: 0,
        subGenre1: 0,
      }),
    ).toStrictEqual(['Synthetic'])
  })

  it('uses the legacy genre fields when genres is an empty array', () => {
    expect(
      manualProgramGenres({ ...baseProgram, ...times, genres: [], genre1: 0, subGenre1: 0 }),
    ).toStrictEqual(['ニュース・報道 / 定時・総合'])
  })
})
