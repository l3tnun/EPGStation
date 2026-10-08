import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { SettingsDraftStore } from '@/shared/settings/settingsDraftStore'
import { SettingsStorageRepository } from '@/shared/settings/settingsStorage'

describe('Requirements 2.1-2.8 settings draft transitions', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('[AC 2.2] [AC 2.3] keeps control changes in tmp until save persists them', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnablePWA: false,
      }),
    )
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())
    const store = new SettingsDraftStore(repository)

    store.updateControl('isEnablePWA', true)

    expect(store.getSaved().isEnablePWA).toBe(false)
    expect(store.getTmp().isEnablePWA).toBe(true)
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: false,
    })

    const saveResult = store.save()

    expect(saveResult.ok).toBe(true)
    expect(store.getSaved().isEnablePWA).toBe(true)
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: true,
    })
  })

  it('[AC 2.4] resets tmp to repository-owned platform defaults without persisting until save', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create({ isIOS: true }),
        guideMode: 'minimum',
      }),
    )
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory(), {
      isIOS: true,
      isAndroid: false,
    })
    const store = new SettingsDraftStore(repository)

    store.resetTmp()

    expect(store.getTmp().guideMode).toBe('all')
    expect(store.getSaved().guideMode).toBe('minimum')
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      guideMode: 'minimum',
    })
  })

  it('[AC 2.5] restores unsaved tmp from saved settings when leaving the Settings screen', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        guideLength: 12,
      }),
    )
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())
    const store = new SettingsDraftStore(repository)

    store.updateControl('guideLength', 6)
    store.restoreTmpFromSaved()

    expect(store.getTmp().guideLength).toBe(12)
    expect(store.getSaved().guideLength).toBe(12)
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      guideLength: 12,
    })
  })

  it('[AC 2.8] previews theme from tmp but reset and leave restore visible theme from saved settings', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        shouldUseOSColorTheme: false,
        isForceDarkTheme: true,
      }),
    )
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())
    const store = new SettingsDraftStore(repository)

    store.updateControl('shouldUseOSColorTheme', true)
    store.updateControl('isForceDarkTheme', false)

    expect(store.getThemePreviewState()).toStrictEqual({
      tmp: {
        shouldUseOSColorTheme: true,
        isForceDarkTheme: false,
      },
      visible: {
        shouldUseOSColorTheme: true,
        isForceDarkTheme: false,
      },
    })

    store.resetTmp()

    expect(store.getTmp()).toMatchObject({
      shouldUseOSColorTheme: true,
      isForceDarkTheme: false,
    })
    expect(store.getThemePreviewState().visible).toStrictEqual({
      shouldUseOSColorTheme: false,
      isForceDarkTheme: true,
    })

    store.updateControl('guideLength', 6)

    expect(store.getThemePreviewState()).toStrictEqual({
      tmp: {
        shouldUseOSColorTheme: true,
        isForceDarkTheme: false,
      },
      visible: {
        shouldUseOSColorTheme: false,
        isForceDarkTheme: true,
      },
    })

    store.updateControl('shouldUseOSColorTheme', true)

    expect(store.getThemePreviewState()).toStrictEqual({
      tmp: {
        shouldUseOSColorTheme: true,
        isForceDarkTheme: false,
      },
      visible: {
        shouldUseOSColorTheme: true,
        isForceDarkTheme: false,
      },
    })

    store.restoreTmpFromSaved()

    expect(store.getThemePreviewState()).toStrictEqual({
      tmp: {
        shouldUseOSColorTheme: false,
        isForceDarkTheme: true,
      },
      visible: {
        shouldUseOSColorTheme: false,
        isForceDarkTheme: true,
      },
    })
  })

  it('[AC 1.7] [AC 1.10] keeps unknown fields and mismatched stored values when saving other changes', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnablePWA: 'synthetic-not-a-boolean',
        guideLength: 12,
        syntheticLegacyField: { nested: [1, 2, 3] },
        syntheticLegacyFlag: true,
      }),
    )
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())
    const store = new SettingsDraftStore(repository)

    store.updateControl('guideLength', 6)
    expect(store.save().ok).toBe(true)

    const stored = JSON.parse(localStorage.getItem('settings') ?? '{}') as Record<string, unknown>
    expect(stored.guideLength).toBe(6)
    expect(stored.syntheticLegacyField).toStrictEqual({ nested: [1, 2, 3] })
    expect(stored.syntheticLegacyFlag).toBe(true)
    expect(stored.isEnablePWA).toBe('synthetic-not-a-boolean')
  })

  it('[AC 1.10] overwrites a mismatched stored value once the control is changed', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnablePWA: 'synthetic-not-a-boolean',
      }),
    )
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())
    const store = new SettingsDraftStore(repository)

    store.updateControl('isEnablePWA', false)
    expect(store.save().ok).toBe(true)

    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      isEnablePWA: false,
    })
  })

  it('[AC 2.4] writes only the default-based tmp when saving after a reset, dropping unknown fields and mismatched stored values', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnablePWA: 'synthetic-not-a-boolean',
        guideLength: 12,
        syntheticLegacyField: { nested: [1, 2, 3] },
      }),
    )
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())
    const store = new SettingsDraftStore(repository)

    store.resetTmp()
    // Nothing is persisted until the save action runs.
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}').syntheticLegacyField).toStrictEqual(
      {
        nested: [1, 2, 3],
      },
    )
    store.updateControl('reservesLength', 7)
    expect(store.save().ok).toBe(true)

    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toStrictEqual({
      ...new DefaultSettingsFactory().create(),
      reservesLength: 7,
    })
  })

  it('[AC 1.10] goes back to keeping stored extras when the next save follows a restore from saved', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        syntheticLegacyField: 'kept',
      }),
    )
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())
    const store = new SettingsDraftStore(repository)

    store.resetTmp()
    store.restoreTmpFromSaved()
    store.updateControl('guideLength', 5)
    expect(store.save().ok).toBe(true)

    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      guideLength: 5,
      syntheticLegacyField: 'kept',
    })
  })
})
