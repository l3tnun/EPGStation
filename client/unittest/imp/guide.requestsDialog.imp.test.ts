import { describe, expect, it } from 'vitest'
import {
  buildGuideProgramAddReservePayload,
  buildGuideProgramSearchPath,
  linkifyGuideProgramExtendedText,
  readGuideProgramDetailSetting,
  writeGuideProgramDetailSetting,
} from '@/features/guide/guideRequests'
import {
  DEFAULT_GUIDE_SIZE_SETTING,
  isGuideGenreStorageKey,
  readGuideGenreVisibility,
  readGuideSizeSetting,
  writeGuideGenreVisibility,
  writeGuideSizeSetting,
} from '@/features/guide/guideStorage'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('Guide request builder implementation edges', () => {
  it('builds ProgramDialog search, recorded, and add-reserve contracts from settings and dialog state', () => {
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isIncludeChannelIdWhenSearching: true,
      isIncludeGenreWhenSearching: true,
    }

    expect(
      buildGuideProgramSearchPath({
        program: {
          id: 100,
          name: '  [字] Synthetic Keyword #12  ',
          channelId: 301,
          genre2: 7,
          subGenre2: 3,
        },
        settings,
      }),
    ).toBe('/search?keyword=Synthetic+Keyword&channelId=301&genre=7&subGenre=3')
    expect(
      buildGuideProgramSearchPath({
        program: {
          id: 100,
          name: 'Synthetic Keyword',
          channelId: 301,
          genre1: 7,
          subGenre1: 3,
        },
        settings: {
          ...settings,
          isIncludeChannelIdWhenSearching: false,
          isIncludeGenreWhenSearching: false,
        },
      }),
    ).toBe('/search?keyword=Synthetic+Keyword')
    expect(
      buildGuideProgramAddReservePayload({
        programId: 100,
        encode: 'TS',
        isDeleteOriginalAfterEncode: true,
      }),
    ).toStrictEqual({
      programId: 100,
      allowEndLack: true,
    })
    expect(
      buildGuideProgramAddReservePayload({
        programId: 100,
        encode: 'H.264',
        isDeleteOriginalAfterEncode: true,
      }),
    ).toStrictEqual({
      programId: 100,
      allowEndLack: true,
      encodeOption: {
        mode1: 'H.264',
        isDeleteOriginalAfterEncode: true,
      },
    })
  })

  it('linkifies only http and https ProgramDialog extended URLs and persists dialog detail settings', () => {
    expect(
      linkifyGuideProgramExtendedText(
        'safe https://example.test/path http://example.test/one ftp://example.test javascript:alert(1)',
      ),
    ).toStrictEqual([
      { type: 'text', text: 'safe ' },
      { type: 'link', text: 'https://example.test/path', href: 'https://example.test/path' },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'http://example.test/one', href: 'http://example.test/one' },
      { type: 'text', text: ' ftp://example.test javascript:alert(1)' },
    ])

    const localStorageLike = {
      values: new Map<string, string>(),
      getItem(key: string) {
        return this.values.get(key) ?? null
      },
      setItem(key: string, value: string) {
        this.values.set(key, value)
      },
    }

    expect(readGuideProgramDetailSetting(localStorageLike)).toStrictEqual({
      encode: 'TS',
      isDeleteOriginalAfterEncode: false,
    })
    writeGuideProgramDetailSetting(localStorageLike, {
      encode: 'H.264',
      isDeleteOriginalAfterEncode: true,
    })
    expect(readGuideProgramDetailSetting(localStorageLike)).toStrictEqual({
      encode: 'H.264',
      isDeleteOriginalAfterEncode: true,
    })
  })

  it('normalizes guide genre and size storage fallbacks and clamps stepped values', () => {
    const throwingStorage = {
      getItem() {
        throw new Error('storage failed')
      },
      setItem() {
        throw new Error('storage failed')
      },
    }

    expect(readGuideGenreVisibility(undefined)[0]).toBe(true)
    expect(readGuideGenreVisibility(throwingStorage)[0]).toBe(true)
    expect(
      readGuideGenreVisibility({ getItem: () => JSON.stringify({ 0: false, 1: 'bad' }) }),
    ).toMatchObject({
      0: false,
      1: true,
    })

    const writes = new Map<string, string>()
    const storage = {
      getItem: (key: string) => writes.get(key) ?? null,
      setItem: (key: string, value: string) => writes.set(key, value),
    }
    writeGuideGenreVisibility(storage, { 0: false })
    expect(readGuideGenreVisibility(storage)[0]).toBe(false)
    writeGuideGenreVisibility(undefined, { 0: false })
    expect(isGuideGenreStorageKey('GuideGenreSetting')).toBe(true)
    expect(isGuideGenreStorageKey(null)).toBe(false)

    expect(readGuideSizeSetting(undefined)).toStrictEqual(DEFAULT_GUIDE_SIZE_SETTING)
    expect(readGuideSizeSetting(throwingStorage)).toStrictEqual(DEFAULT_GUIDE_SIZE_SETTING)
    expect(
      readGuideSizeSetting({
        getItem: () =>
          JSON.stringify({
            tablet: {
              channelHeight: 9,
              channelWidth: 601,
              channelFontsize: Number.NaN,
              timescaleHeight: 27,
              timescaleWidth: 9,
              timescaleFontsize: 40.2,
              programFontSize: 7.6,
            },
            mobile: null,
          }),
      }),
    ).toStrictEqual({
      tablet: {
        channelHeight: 10,
        channelWidth: 600,
        channelFontsize: DEFAULT_GUIDE_SIZE_SETTING.tablet.channelFontsize,
        timescaleHeight: 30,
        timescaleWidth: 10,
        timescaleFontsize: 40,
        programFontSize: 7.5,
      },
      mobile: DEFAULT_GUIDE_SIZE_SETTING.mobile,
    })

    writeGuideSizeSetting(storage, {
      tablet: {
        ...DEFAULT_GUIDE_SIZE_SETTING.tablet,
        channelHeight: 11,
      },
      mobile: DEFAULT_GUIDE_SIZE_SETTING.mobile,
    })
    expect(readGuideSizeSetting(storage).tablet.channelHeight).toBe(10)
    writeGuideSizeSetting(undefined, DEFAULT_GUIDE_SIZE_SETTING)
  })
})
