import { describe, expect, it } from 'vitest'
import {
  formatRecordedDetailGenres,
  formatRecordedDetailTime,
  formatRecordedListTime,
  formatRecordedTableTime,
} from '@/features/recorded/lib/recordedFormat'

const GENRES = [
  'ニュース・報道',
  'スポーツ',
  '情報・ワイドショー',
  'ドラマ',
  '音楽',
  'バラエティ',
  '映画',
  'アニメ・特撮',
  'ドキュメンタリー・教養',
  '劇場・公演',
  '趣味・教育',
  '福祉',
  '予備',
  '予備',
  '拡張',
  'その他',
]

describe('Recorded detail genre text', () => {
  it('names every major genre', () => {
    GENRES.forEach((name, genre) => {
      expect(formatRecordedDetailGenres({ genre1: genre })).toStrictEqual([name])
    })
  })

  it('joins the sub genre name when it is known', () => {
    expect(formatRecordedDetailGenres({ genre1: 3, subGenre1: 0 })).toStrictEqual([
      'ドラマ / 国内ドラマ',
    ])
    expect(formatRecordedDetailGenres({ genre1: 12, subGenre1: 0 })).toStrictEqual(['予備'])
    expect(formatRecordedDetailGenres({ genre1: 3, subGenre1: 99 })).toStrictEqual(['ドラマ'])
    expect(formatRecordedDetailGenres({ genre1: 3 })).toStrictEqual(['ドラマ'])
  })

  it('ignores an unknown major genre', () => {
    expect(formatRecordedDetailGenres({ genre1: 99 })).toStrictEqual([])
    expect(formatRecordedDetailGenres({ genre1: 99, genre2: 4 })).toStrictEqual(['音楽'])
    expect(formatRecordedDetailGenres({ genre1: 99, genres: ['x', 'y'] })).toStrictEqual(['x'])
    expect(formatRecordedDetailGenres({ genre3: 99 })).toStrictEqual([])
    expect(formatRecordedDetailGenres({ genre3: 99, genres: ['x'] })).toStrictEqual(['x'])
  })

  it('uses the first genre that resolves, then the genres text', () => {
    expect(
      formatRecordedDetailGenres({ genre2: 5, subGenre2: 0, genre3: 6, genres: ['x'] }),
    ).toStrictEqual(['バラエティ / クイズ'])
    expect(formatRecordedDetailGenres({ genre3: 6, subGenre3: 0 })).toStrictEqual(['映画 / 洋画'])
    expect(formatRecordedDetailGenres({ genres: [] })).toStrictEqual([])
    expect(formatRecordedDetailGenres({})).toStrictEqual([])
  })
})

describe('Recorded time text', () => {
  const startAt = Date.UTC(2026, 0, 5, 3, 4)
  const endAt = Date.UTC(2026, 0, 5, 4, 34)

  it('formats the detail and list time range in JST with the duration in minutes', () => {
    expect(formatRecordedDetailTime({ startAt, endAt })).toBe('01/05(月) 12:04 ~ 13:34 (90 m)')
    expect(formatRecordedListTime({ startAt, endAt })).toBe('01/05(月) 12:04 ~ 13:34 (90 m)')
  })

  it('rounds the duration to the nearest minute and never goes negative', () => {
    expect(formatRecordedDetailTime({ startAt, endAt: startAt + 89_500 })).toBe(
      '01/05(月) 12:04 ~ 12:05 (1 m)',
    )
    expect(formatRecordedDetailTime({ startAt, endAt: startAt - 600_000 })).toBe(
      '01/05(月) 12:04 ~ 11:54 (0 m)',
    )
    expect(formatRecordedTableTime({ startAt, endAt: startAt - 600_000 })).toBe(
      '01/05(月) 12:04 (0 m)',
    )
  })

  it('is empty unless both ends exist', () => {
    expect(formatRecordedDetailTime({ startAt })).toBe('')
    expect(formatRecordedDetailTime({ endAt })).toBe('')
    expect(formatRecordedDetailTime({})).toBe('')
    expect(formatRecordedListTime({ startAt })).toBe('')
    expect(formatRecordedTableTime({ startAt, endAt })).toBe('01/05(月) 12:04 (90 m)')
    expect(formatRecordedTableTime({ startAt })).toBe('')
    expect(formatRecordedTableTime({ endAt })).toBe('')
  })
})
