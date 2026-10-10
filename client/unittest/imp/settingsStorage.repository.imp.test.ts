import { SETTINGS_UI_CONTRACT } from '@/shared/settings'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { SettingsStorageRepository } from '@/shared/settings/settingsStorage'
import { createDefaultSettingsInputFromNavigator } from '@/shared/settings/platformDefaultSettings'
import { ThrowingStorage, WriteFailingStorage } from './support/settingsStorageFixtures'

describe('SettingsStorageRepository implementation edges', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('falls back to persisted defaults when the settings JSON cannot be parsed', () => {
    localStorage.setItem('settings', '{broken')
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())

    const result = repository.load()

    expect(result.value).toMatchObject({
      isEnablePWA: true,
      shouldUseOSColorTheme: true,
    })
    expect(result.repaired).toBe(true)
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: true,
    })
  })

  it('preserves invalid existing fields in raw storage while exposing typed defaults', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        isEnablePWA: 'legacy-invalid-value',
      }),
    )
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())

    const result = repository.load()

    expect(result.value.isEnablePWA).toBe(true)
    expect(result.raw.isEnablePWA).toBe('legacy-invalid-value')
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: 'legacy-invalid-value',
      shouldUseOSColorTheme: true,
    })
  })

  it('preserves unknown additional fields in raw storage and persisted repair output', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        isEnablePWA: false,
        '<additional-field>': '<synthetic-value>',
        '<additional-object>': {
          '<nested-field>': '<nested-synthetic-value>',
        },
      }),
    )
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())

    const result = repository.load()

    expect(result.repaired).toBe(true)
    expect(result.raw).toMatchObject({
      isEnablePWA: false,
      shouldUseOSColorTheme: true,
      '<additional-field>': '<synthetic-value>',
      '<additional-object>': {
        '<nested-field>': '<nested-synthetic-value>',
      },
    })
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: false,
      shouldUseOSColorTheme: true,
      '<additional-field>': '<synthetic-value>',
      '<additional-object>': {
        '<nested-field>': '<nested-synthetic-value>',
      },
    })
  })

  it('falls back to defaults without throwing when reading storage fails', () => {
    const repository = new SettingsStorageRepository(
      new ThrowingStorage(),
      new DefaultSettingsFactory(),
    )

    const result = repository.load()

    expect(result.value.isEnablePWA).toBe(true)
    expect(result.raw.isEnablePWA).toBe(true)
    expect(result.repaired).toBe(true)
    expect(result.persisted).toBe(false)
  })

  it('creates deterministic platform defaults from explicit iOS and Android inputs', () => {
    const factory = new DefaultSettingsFactory()

    expect(factory.create({ isIOS: true, isAndroid: false })).toMatchObject({
      guideMode: 'all',
      isPreferredPlayingOnWeb: false,
    })
    expect(factory.create({ isIOS: false, isAndroid: true })).toMatchObject({
      guideMode: 'sequential',
      isPreferredPlayingOnWeb: false,
    })
    expect(factory.create({ isIOS: false, isAndroid: false })).toMatchObject({
      guideMode: 'sequential',
      isPreferredPlayingOnWeb: true,
    })
  })

  it('derives platform default settings input from iOS and Android navigator values', () => {
    expect(
      createDefaultSettingsInputFromNavigator({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        platform: 'iPhone',
        maxTouchPoints: 5,
      }),
    ).toStrictEqual({ isIOS: true, isAndroid: false })
    expect(
      createDefaultSettingsInputFromNavigator({
        userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8)',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
      }),
    ).toStrictEqual({ isIOS: false, isAndroid: true })
    expect(
      createDefaultSettingsInputFromNavigator({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      }),
    ).toStrictEqual({ isIOS: false, isAndroid: false })
  })

  it('exports Settings screen allowed values as a typed consumer contract', () => {
    expect(SETTINGS_UI_CONTRACT).toStrictEqual({
      guideLength: { min: 1, max: 24 },
      reservesLength: { min: 1, max: 100 },
      recordingLength: { min: 1, max: 100 },
      recordedLength: { min: 1, max: 100 },
      rulesLength: { min: 1, max: 100 },
      searchLength: {
        values: [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600],
      },
      guideMode: {
        values: ['sequential', 'minimum', 'all'],
      },
    })
  })

  it('does not correct existing out-of-range numeric settings during storage load', () => {
    const legacySettings = {
      ...new DefaultSettingsFactory().create(),
      guideLength: 99,
      reservesLength: 0,
      recordingLength: 101,
      recordedLength: -1,
      rulesLength: 1000,
      searchLength: 125,
    }
    localStorage.setItem('settings', JSON.stringify(legacySettings))
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())

    const result = repository.load()

    expect(result.value).toMatchObject({
      guideLength: 99,
      reservesLength: 0,
      recordingLength: 101,
      recordedLength: -1,
      rulesLength: 1000,
      searchLength: 125,
    })
    expect(result.repaired).toBe(false)
    expect(result.persisted).toBe(false)
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      guideLength: 99,
      reservesLength: 0,
      recordingLength: 101,
      recordedLength: -1,
      rulesLength: 1000,
      searchLength: 125,
    })
  })

  it('returns save failure to the caller without throwing or replacing the stored settings', () => {
    const storage = new WriteFailingStorage()
    storage.seed(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnablePWA: false,
      }),
    )
    const repository = new SettingsStorageRepository(storage, new DefaultSettingsFactory())

    const result = repository.save({ ...repository.load().value, isEnablePWA: true })

    expect(result).toBe(false)
    expect(JSON.parse(storage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: false,
    })
  })
})
