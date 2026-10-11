import { describe, expect, it } from 'vitest'
import {
  SEARCH_OPTION_GENRE_NAMES,
  adaptRecordedSearchOptions,
  adaptRuleKeywords,
  adaptVideoDuration,
} from '@/features/recorded/api/recordedSearchAdapters'

describe('recorded search option adapters', () => {
  it('skips options that are not objects or have no numeric id', () => {
    expect(
      adaptRecordedSearchOptions({
        channels: [null, 'x', { channelId: 'x' }, { id: 'x' }, { channelId: 2, name: 'Two' }],
        genres: [null, 'x', { genre: 'text' }, { id: 'x' }, { genre: 3, name: 'Three' }],
      }),
    ).toStrictEqual({
      channels: [{ id: 2, name: 'Two' }],
      genres: [{ id: 3, name: 'Three' }],
    })
  })

  it('names genres from the fixed genre table when the server gives no name', () => {
    const ids = Array.from({ length: 16 }, (_, id) => id)
    const result = adaptRecordedSearchOptions({ genres: ids.map((id) => ({ id })) })

    expect(result?.genres.map((genre) => genre.name)).toStrictEqual(
      ids.map((id) => SEARCH_OPTION_GENRE_NAMES[id]),
    )
    expect(SEARCH_OPTION_GENRE_NAMES).toStrictEqual({
      0: 'ニュース・報道',
      1: 'スポーツ',
      2: '情報・ワイドショー',
      3: 'ドラマ',
      4: '音楽',
      5: 'バラエティ',
      6: '映画',
      7: 'アニメ・特撮',
      8: 'ドキュメンタリー・教養',
      9: '劇場・公演',
      10: '趣味・教育',
      11: '福祉',
      12: '予備',
      13: '予備',
      14: '拡張',
      15: 'その他',
    })
  })
})

describe('recorded rule keyword adapter', () => {
  it('skips items that are not objects, or lack a numeric id or a string keyword', () => {
    expect(
      adaptRuleKeywords([
        null,
        'x',
        { id: 'x', keyword: 'a' },
        { id: 1, keyword: 2 },
        { id: 3, keyword: 'ok' },
      ]),
    ).toStrictEqual([{ id: 3, keyword: 'ok' }])
  })
})

describe('video duration adapter', () => {
  it('accepts a finite number or an object with a finite duration and rejects everything else', () => {
    expect(adaptVideoDuration(12.5)).toBe(12.5)
    expect(adaptVideoDuration({ duration: 7 })).toBe(7)
    expect(adaptVideoDuration(Number.NaN)).toBeNull()
    expect(adaptVideoDuration(Number.POSITIVE_INFINITY)).toBeNull()
    expect(adaptVideoDuration({ duration: Number.POSITIVE_INFINITY })).toBeNull()
    expect(adaptVideoDuration({ duration: '7' })).toBeNull()
    expect(adaptVideoDuration('7')).toBeNull()
    expect(adaptVideoDuration(null)).toBeNull()
  })
})
