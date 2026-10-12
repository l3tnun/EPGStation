import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { SettingsStorageRepository } from '@/shared/settings/settingsStorage'

describe('Requirements 1.1-1.10 settings storage contract', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('[AC 1.1] [AC 1.2] [AC 1.4] writes default settings to localStorage key settings when storage is missing', () => {
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())

    const result = repository.load()

    expect(result.value.isEnablePWA).toBe(true)
    expect(result.value.guideMode).toBe('sequential')
    expect(result.value.isForceEnableSubtitleStroke).toBe(true)
    expect(result.repaired).toBe(true)
    expect(result.persisted).toBe(true)
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: true,
      isForceEnableSubtitleStroke: true,
    })
  })

  it('[AC 1.5] [AC 1.6] [AC 1.7] preserves existing fields and additional fields while backfilling missing defaults', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        isEnablePWA: false,
        extraWorkflowField: 'kept',
      }),
    )
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())

    const result = repository.load()

    expect(result.value.isEnablePWA).toBe(false)
    expect(result.value.shouldUseOSColorTheme).toBe(true)
    expect(result.raw.extraWorkflowField).toBe('kept')
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: false,
      shouldUseOSColorTheme: true,
      extraWorkflowField: 'kept',
    })
  })
})

describe('Requirements 3.1-8.9 default settings consumer contract', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('[AC 3.1] [AC 3.2] [AC 3.3] [AC 3.4] [AC 4.1] [AC 4.2] [AC 4.3] [AC 5.1] [AC 5.2] [AC 5.3] [AC 5.4] [AC 5.5] [AC 5.6] [AC 5.7] [AC 6.1] [AC 6.3] [AC 6.4] [AC 6.5] [AC 7.1] [AC 7.2] [AC 7.3] [AC 7.4] [AC 7.5] [AC 8.1] [AC 8.2] [AC 8.3] [AC 8.4] [AC 8.5] [AC 8.10] defines every user-visible default for general, playback, guide, list, recorded, search, rule, and video settings', () => {
    const defaults = new DefaultSettingsFactory().create()

    expect(defaults).toStrictEqual({
      isEnablePWA: true,
      shouldUseOSColorTheme: true,
      isForceDarkTheme: false,
      isHalfWidthDisplayed: true,
      isOnAirTabListView: true,
      isPreferredPlayingLiveM2TSOnWeb: true,
      onAirM2TSViewURLScheme: null,
      guideMode: 'sequential',
      guideLength: 24,
      isForceDisableDarkThemeForGuide: false,
      isShowOnlyFreePrograms: false,
      isEnableDisplayForEachBroadcastWave: false,
      isIncludeChannelIdWhenSearching: true,
      isIncludeGenreWhenSearching: true,
      reservesLength: 24,
      recordingLength: 24,
      recordedLength: 24,
      isShowTableMode: false,
      isPreferredPlayingOnWeb: true,
      isShowDropInfoInsteadOfDescription: false,
      deleteRecordedDefaultValue: false,
      shouldUseRecordedViewURLScheme: true,
      recordedViewURLScheme: null,
      shouldUseRecordedDownloadURLScheme: true,
      recordedDownloadURLScheme: null,
      searchLength: 300,
      isEnableAutoScrollWhenEditingRule: true,
      isEnableCopyKeywordToDirectory: false,
      isCheckAvoidDuplicate: false,
      isEnableEncodingSettingWhenCreateRule: false,
      isCheckDeleteOriginalAfterEncode: false,
      rulesLength: 24,
      isEnableExtendedPagination: false,
      isForceEnableSubtitleStroke: true,
    })
  })

  it('[AC 8.10] defaults isEnableExtendedPagination to false and backfills only that field into saved settings that lack it', () => {
    expect(new DefaultSettingsFactory().create().isEnableExtendedPagination).toBe(false)
    expect(
      new DefaultSettingsFactory().create({ isIOS: true, isAndroid: false })
        .isEnableExtendedPagination,
    ).toBe(false)

    localStorage.setItem('settings', JSON.stringify({ rulesLength: 10, isEnablePWA: false }))
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())

    const result = repository.load()

    expect(result.value.isEnableExtendedPagination).toBe(false)
    expect(result.value.rulesLength).toBe(10)
    expect(result.value.isEnablePWA).toBe(false)
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      rulesLength: 10,
      isEnablePWA: false,
      isEnableExtendedPagination: false,
    })
  })

  it('[AC 8.10][AC 8.11] keeps a saved isEnableExtendedPagination=true across load', () => {
    localStorage.setItem('settings', JSON.stringify({ isEnableExtendedPagination: true }))
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())

    expect(repository.load().value.isEnableExtendedPagination).toBe(true)
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnableExtendedPagination: true,
    })
  })

  it('[AC 1.4] [AC 5.1] [AC 7.1] persists and returns iOS defaults through repository load when storage is missing', () => {
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory(), {
      isIOS: true,
      isAndroid: false,
    })

    const result = repository.load()

    expect(result.value).toMatchObject({
      guideMode: 'all',
      isPreferredPlayingOnWeb: false,
    })
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      guideMode: 'all',
      isPreferredPlayingOnWeb: false,
    })
  })

  it('[AC 1.5] [AC 7.1] backfills missing Android platform defaults while keeping existing values', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        isEnablePWA: false,
        guideMode: 'minimum',
      }),
    )
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory(), {
      isIOS: false,
      isAndroid: true,
    })

    const result = repository.load()

    expect(result.value).toMatchObject({
      isEnablePWA: false,
      guideMode: 'minimum',
      isPreferredPlayingOnWeb: false,
    })
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: false,
      guideMode: 'minimum',
      isPreferredPlayingOnWeb: false,
    })
  })

  it('[AC 5.1] [AC 7.1] keeps desktop defaults through repository load when explicit platform flags are false', () => {
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory(), {
      isIOS: false,
      isAndroid: false,
    })

    const result = repository.load()

    expect(result.value).toMatchObject({
      guideMode: 'sequential',
      isPreferredPlayingOnWeb: true,
    })
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      guideMode: 'sequential',
      isPreferredPlayingOnWeb: true,
    })
  })
})
