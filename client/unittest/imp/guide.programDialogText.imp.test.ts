import { describe, expect, it } from 'vitest'
import {
  formatLegacyProgramTime,
  pad2,
  programName,
  resolveLegacyComponentDetails,
  resolveLegacyGenre,
} from '@/features/guide/lib/programDialogText'

describe('programName', () => {
  it('falls back to a "番組 <id>" label when the program has no name', () => {
    expect(programName({ id: 42 })).toBe('番組 42')
  })
})

describe('pad2', () => {
  it('left-pads a single digit with a leading zero', () => {
    expect(pad2(5)).toBe('05')
  })
})

describe('formatLegacyProgramTime', () => {
  it('returns null when startAt or endAt is missing', () => {
    expect(formatLegacyProgramTime({ id: 1, endAt: 1_000 })).toBeNull()
    expect(formatLegacyProgramTime({ id: 1, startAt: 0 })).toBeNull()
  })

  it('falls back to "00" for a missing Intl.DateTimeFormat part', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Intl.DateTimeFormat.prototype,
      'formatToParts',
    )
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'formatToParts', {
      configurable: true,
      value: () => [],
    })

    try {
      expect(formatLegacyProgramTime({ id: 1, startAt: 0, endAt: 60_000 })).toBe(
        '00/00 00:00 ~ 00:00(1分)',
      )
    } finally {
      Object.defineProperty(Intl.DateTimeFormat.prototype, 'formatToParts', descriptor!)
    }
  })
})

describe('resolveLegacyGenre', () => {
  it('combines the genre and sub-genre labels when both are known', () => {
    expect(resolveLegacyGenre(0x1, 0x1)).toBe('スポーツ / 野球')
  })

  it('returns just the genre label when subGenre is undefined', () => {
    expect(resolveLegacyGenre(0x1, undefined)).toBe('スポーツ')
  })

  it('returns null when the genre itself is unknown', () => {
    expect(resolveLegacyGenre(999, undefined)).toBeNull()
  })
})

describe('resolveLegacyComponentDetails', () => {
  it('resolves known video/audio component and sampling-rate labels', () => {
    expect(
      resolveLegacyComponentDetails({
        videoComponentType: 0x01,
        audioComponentType: 0b00011,
        audioSamplingRate: 44100,
      }),
    ).toStrictEqual(['480i(525i), アスペクト比4:3', '2/0モード(ステレオ)', '44.1kHz'])
  })
})
