import { describe, expect, it } from 'vitest'
import {
  DEFAULT_GUIDE_SIZE_SETTING,
  readGuideGenreVisibility,
  readGuideSizeSetting,
  writeGuideGenreVisibility,
  writeGuideSizeSetting,
} from '@/features/guide/guideStorage'

describe('Guide adjacent storage adapters', () => {
  function createMemoryStorage(initial?: Record<string, string>) {
    const storage = new Map(Object.entries(initial ?? {}))

    return {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value)
      },
      storage,
    }
  }

  it('reads GuideGenreSetting as a 0-15 boolean map and writes only the owner key', () => {
    const localStorageLike = createMemoryStorage({
      GuideGenreSetting: JSON.stringify({ 1: false, 5: true, 20: false }),
    })

    expect(readGuideGenreVisibility(localStorageLike)).toMatchObject({
      0: true,
      1: false,
      5: true,
      15: true,
    })

    writeGuideGenreVisibility(localStorageLike, {
      0: false,
      2: false,
    })

    expect(JSON.parse(localStorageLike.storage.get('GuideGenreSetting') ?? '{}')).toStrictEqual({
      0: false,
      1: true,
      2: false,
      3: true,
      4: true,
      5: true,
      6: true,
      7: true,
      8: true,
      9: true,
      10: true,
      11: true,
      12: true,
      13: true,
      14: true,
      15: true,
    })
  })

  it('backfills, clamps, and persists GuideSizeSetting with normal and mobile defaults', () => {
    const localStorageLike = createMemoryStorage({
      GuideSizeSetting: JSON.stringify({
        tablet: {
          channelWidth: 610,
          programFontSize: 9,
        },
        mobile: {
          channelWidth: 0,
          programFontSize: 41,
        },
      }),
    })

    expect(DEFAULT_GUIDE_SIZE_SETTING).toStrictEqual({
      tablet: {
        channelHeight: 30,
        channelWidth: 140,
        channelFontsize: 14,
        timescaleHeight: 180,
        timescaleWidth: 30,
        timescaleFontsize: 16,
        programFontSize: 10,
      },
      mobile: {
        channelHeight: 20,
        channelWidth: 100,
        channelFontsize: 12,
        timescaleHeight: 120,
        timescaleWidth: 20,
        timescaleFontsize: 12,
        programFontSize: 7.5,
      },
    })
    expect(readGuideSizeSetting(localStorageLike)).toStrictEqual({
      tablet: {
        ...DEFAULT_GUIDE_SIZE_SETTING.tablet,
        channelWidth: 600,
        programFontSize: 9,
      },
      mobile: {
        ...DEFAULT_GUIDE_SIZE_SETTING.mobile,
        channelWidth: 0,
        programFontSize: 40,
      },
    })

    writeGuideSizeSetting(localStorageLike, {
      tablet: {
        ...DEFAULT_GUIDE_SIZE_SETTING.tablet,
        channelWidth: 153,
      },
      mobile: {
        ...DEFAULT_GUIDE_SIZE_SETTING.mobile,
        programFontSize: 8.7,
      },
    })

    expect(JSON.parse(localStorageLike.storage.get('GuideSizeSetting') ?? '{}')).toMatchObject({
      tablet: {
        channelWidth: 150,
        programFontSize: 10,
      },
      mobile: {
        channelWidth: 100,
        programFontSize: 8.5,
      },
    })
  })
})
