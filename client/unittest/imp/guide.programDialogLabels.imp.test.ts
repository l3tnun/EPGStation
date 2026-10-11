import { describe, expect, it } from 'vitest'
import {
  actionSnackbarText,
  resolveLegacyComponentDetails,
  resolveLegacyGenre,
  resolveLegacyGenres,
} from '@/features/guide/lib/programDialogText'

describe('resolveLegacyGenre unknown values', () => {
  it('returns null when the genre is undefined, even with a sub-genre', () => {
    expect(resolveLegacyGenre(undefined, undefined)).toBeNull()
    expect(resolveLegacyGenre(undefined, 0x1)).toBeNull()
  })

  it('returns only the genre label for a sub-genre unknown to that genre', () => {
    expect(resolveLegacyGenre(0x1, 0x20)).toBe('スポーツ')
  })

  it('returns only the genre label for a reserved genre that has no sub-genre table', () => {
    expect(resolveLegacyGenre(12, 0x1)).toBe('予備')
    expect(resolveLegacyGenre(13, 0x0)).toBe('予備')
  })
})

describe('resolveLegacyGenres', () => {
  it('lists only the resolvable genres in order', () => {
    expect(
      resolveLegacyGenres({
        id: 1,
        genre1: 0x1,
        subGenre1: 0x1,
        genre3: 0x7,
        subGenre3: 0x2,
      }),
    ).toStrictEqual(['スポーツ / 野球', 'アニメ・特撮 / 特撮'])
  })

  it('is empty when no genre is set', () => {
    expect(resolveLegacyGenres({ id: 1 })).toStrictEqual([])
  })
})

describe('resolveLegacyComponentDetails partial input', () => {
  it('returns an empty list when nothing is set', () => {
    expect(resolveLegacyComponentDetails({})).toStrictEqual([])
  })

  it('returns only the labels that are set and known', () => {
    expect(resolveLegacyComponentDetails({ audioSamplingRate: 48000 })).toStrictEqual(['48kHz'])
    expect(resolveLegacyComponentDetails({ videoComponentType: 0xb3 })).toStrictEqual([
      '1080i(1125i), アスペクト比16:9 パンベクトルなし',
    ])
    expect(resolveLegacyComponentDetails({ audioComponentType: 0b00001 })).toStrictEqual([
      '1/0モード(シングルモノ)',
    ])
  })

  it('drops values without a label', () => {
    expect(
      resolveLegacyComponentDetails({
        videoComponentType: 0x99,
        audioComponentType: 0b100000,
        audioSamplingRate: 12345,
      }),
    ).toStrictEqual([])
  })
})

describe('actionSnackbarText', () => {
  it.each([
    ['add', true, '予約'],
    ['add', false, '予約失敗'],
    ['delete', true, 'キャンセル'],
    ['delete', false, 'キャンセル失敗'],
    ['exclude', true, 'キャンセル'],
    ['exclude', false, 'キャンセル失敗'],
    ['unskip', true, '除外解除'],
    ['unskip', false, '除外解除失敗'],
    ['unoverlap', true, '重複解除'],
    ['unoverlap', false, '重複解除失敗'],
  ] as const)('%s with ok=%s reads "%s"', (action, ok, suffix) => {
    expect(actionSnackbarText({ name: 'Program', action, ok })).toBe(`Program ${suffix}`)
  })
})
