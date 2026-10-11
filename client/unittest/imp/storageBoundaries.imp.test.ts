import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createInitialSettingsTmp,
  persistSettingsTmp,
} from '@/features/settings/lib/settingsStorageAccess'
import {
  normalizeGuideSizeSetting,
  DEFAULT_GUIDE_SIZE_SETTING,
  readGuideGenreVisibility,
  readGuideSizeSetting,
  writeGuideGenreVisibility,
  writeGuideSizeSetting,
} from '@/features/guide/guideStorage'
import {
  readAddEncodeSetting,
  type RecordedLocalStorageLike,
} from '@/features/recorded/requests/settingsStorage'
import { DefaultSettingsFactory, SettingsStorageRepository } from '@/shared/settings'

function memoryStorage(initial?: string): Storage {
  const values = new Map<string, string>()
  if (initial !== undefined) {
    values.set('settings', initial)
  }
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  }
}

describe('add-encode setting storage', () => {
  const storageOf = (value: unknown): RecordedLocalStorageLike => ({
    getItem: () => JSON.stringify(value),
    setItem: () => undefined,
  })

  it('keeps a stored encode mode and parent directory when they are strings or null', () => {
    expect(
      readAddEncodeSetting(
        storageOf({
          encodeMode: 'm',
          parentDirectory: 'dir',
          isSaveSameDirectory: true,
          removeOriginal: true,
        }),
      ),
    ).toStrictEqual({
      encodeMode: 'm',
      parentDirectory: 'dir',
      isSaveSameDirectory: true,
      removeOriginal: true,
    })
    expect(
      readAddEncodeSetting(storageOf({ encodeMode: null, parentDirectory: null })),
    ).toMatchObject({ encodeMode: null, parentDirectory: null })
  })

  it('falls back to null for a stored encode mode or parent directory of another type', () => {
    expect(readAddEncodeSetting(storageOf({ encodeMode: 1, parentDirectory: 2 }))).toMatchObject({
      encodeMode: null,
      parentDirectory: null,
    })
  })
})

describe('guide size setting normalization', () => {
  const fallback = DEFAULT_GUIDE_SIZE_SETTING.tablet

  it('uses the default for a value that is not a finite number', () => {
    const normalized = normalizeGuideSizeSetting({
      tablet: {
        ...fallback,
        channelHeight: '50' as unknown as number,
        channelWidth: Number.POSITIVE_INFINITY,
        channelFontsize: Number.NaN,
      },
      mobile: DEFAULT_GUIDE_SIZE_SETTING.mobile,
    })

    expect(normalized.tablet.channelHeight).toBe(fallback.channelHeight)
    expect(normalized.tablet.channelWidth).toBe(fallback.channelWidth)
    expect(normalized.tablet.channelFontsize).toBe(fallback.channelFontsize)
  })

  it('clamps to the limits and rounds to the step', () => {
    const normalized = normalizeGuideSizeSetting({
      tablet: { ...fallback, channelHeight: 1000, channelWidth: -5, channelFontsize: 1.2 },
      mobile: { ...DEFAULT_GUIDE_SIZE_SETTING.mobile, channelHeight: 33 },
    })

    expect(normalized.tablet.channelHeight).toBe(100)
    expect(normalized.tablet.channelWidth).toBe(0)
    expect(normalized.tablet.channelFontsize).toBe(1)
    expect(normalized.mobile.channelHeight).toBe(30)
  })
})

describe('guide storage constant tables', () => {
  const limits = {
    channelHeight: [10, 100],
    channelWidth: [0, 600],
    channelFontsize: [0.5, 40],
    timescaleHeight: [10, 400],
    timescaleWidth: [10, 100],
    timescaleFontsize: [0.5, 40],
    programFontSize: [0.5, 40],
  } as const

  it('holds the default sizes of the tablet and mobile layouts', () => {
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
  })

  it('clamps every size field to its own minimum and maximum', () => {
    const tooLarge = Object.fromEntries(Object.keys(limits).map((key) => [key, 100000]))
    const tooSmall = Object.fromEntries(Object.keys(limits).map((key) => [key, -100000]))
    const normalized = normalizeGuideSizeSetting({ tablet: tooLarge, mobile: tooSmall } as never)

    for (const [key, [min, max]] of Object.entries(limits)) {
      expect((normalized.tablet as unknown as Record<string, number>)[key]).toBe(max)
      expect((normalized.mobile as unknown as Record<string, number>)[key]).toBe(min)
    }
  })

  it('stores the genre visibility and sizes under their own keys for all 16 genres', () => {
    const written = new Map<string, string>()
    const storage = {
      getItem: (key: string) => written.get(key) ?? null,
      setItem: (key: string, value: string) => void written.set(key, value),
    }

    writeGuideGenreVisibility(storage, { 3: false })
    writeGuideSizeSetting(storage, DEFAULT_GUIDE_SIZE_SETTING)

    const genres = JSON.parse(written.get('GuideGenreSetting') ?? '{}') as Record<string, boolean>
    expect(Object.keys(genres)).toHaveLength(16)
    expect(genres['3']).toBe(false)
    expect(genres['15']).toBe(true)
    expect(JSON.parse(written.get('GuideSizeSetting') ?? '{}')).toStrictEqual(
      DEFAULT_GUIDE_SIZE_SETTING,
    )
    expect(readGuideGenreVisibility(storage)[3]).toBe(false)
    expect(readGuideSizeSetting(storage)).toStrictEqual(DEFAULT_GUIDE_SIZE_SETTING)
  })
})

describe('settings repository save over a stored value', () => {
  const factory = new DefaultSettingsFactory()

  it('writes every setting when the stored object lacks some of them', () => {
    const storage = memoryStorage('{"guideLength":3}')
    const repository = new SettingsStorageRepository(storage, factory)
    const defaults = repository.createDefaultSettings()

    expect(repository.save(defaults)).toBe(true)
    expect(Object.keys(JSON.parse(storage.getItem('settings') ?? '{}')).sort()).toStrictEqual(
      Object.keys(defaults).sort(),
    )
  })

  it('does not spread a stored string into the saved object', () => {
    const storage = memoryStorage('"ab"')
    const repository = new SettingsStorageRepository(storage, factory)

    expect(repository.save(repository.createDefaultSettings())).toBe(true)
    expect(Object.keys(JSON.parse(storage.getItem('settings') ?? '{}'))).not.toContain('0')
  })
})

describe('settings storage access follows the browser platform', () => {
  const iosUserAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'

  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('starts from the platform default settings', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(iosUserAgent)

    expect(createInitialSettingsTmp().guideMode).toBe('all')
  })

  it('keeps a stored value of the wrong type that matches the platform default', () => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(iosUserAgent)
    const defaults = new DefaultSettingsFactory().create({ isIOS: true, isAndroid: false })
    localStorage.setItem('settings', JSON.stringify({ ...defaults, guideMode: 123 }))

    expect(persistSettingsTmp({ ...defaults, guideMode: 'all' })).toStrictEqual({ ok: true })
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}').guideMode).toBe(123)
  })
})
