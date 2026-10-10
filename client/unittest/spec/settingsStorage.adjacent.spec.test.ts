import { AdjacentStorageRegistry } from '@/shared/settings'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { SettingsStorageRepository } from '@/shared/settings/settingsStorage'
import { replaceURLSchemePlaceholders } from '@/shared/settings/urlScheme'
import {
  adjacentStorageFixtures,
  settingsStorageStateMatrix,
} from '@/shared/settings/__fixtures__/settingsStorageFixtures'

describe('Requirements 4.7, 4.8, 7.7, 7.8, 9.1-9.13 adjacent workflow storage contract', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('[AC 9.1] [AC 9.2] [AC 9.3] [AC 9.4] [AC 9.5] [AC 9.6] [AC 9.7] [AC 9.8] [AC 9.9] [AC 9.10] [AC 9.11] [AC 9.12] [AC 9.13] defines adjacent workflow keys, owners, and compatibility defaults outside the settings object', () => {
    const registry = new AdjacentStorageRegistry()

    expect(registry.list()).toStrictEqual([
      {
        key: 'OnAirSelectStreamSetting',
        owner: 'frontend-onair',
        defaultValue: { useURLScheme: false, type: 'M2TS', mode: 0 },
      },
      {
        key: 'RecordedSelectStreamSetting',
        owner: 'frontend-recorded',
        defaultValue: { type: 'WebM', mode: 0 },
      },
      {
        key: 'SendVideoFileSelectHostSetting',
        owner: 'frontend-recorded',
        defaultValue: { hostName: null },
      },
      {
        key: 'VideoPlayerSetting',
        owner: 'frontend-video-playback',
        defaultValue: { isShowSubtitle: false },
      },
      {
        key: 'GuideSizeSetting',
        owner: 'frontend-guide',
        defaultValue: null,
      },
      {
        key: 'GuideGenreSetting',
        owner: 'frontend-guide',
        defaultValue: null,
      },
      {
        key: 'GuideProgramDetailSetting',
        owner: 'frontend-guide',
        defaultValue: { encode: 'TS', isDeleteOriginalAfterEncode: false },
      },
      {
        key: 'AddEncodeSeting',
        owner: 'frontend-recorded',
        defaultValue: {
          encodeMode: null,
          parentDirectory: null,
          isSaveSameDirectory: false,
          removeOriginal: false,
        },
      },
    ])

    const settingsDefaults = new DefaultSettingsFactory().create()

    for (const adjacentKey of registry.list().map(({ key }) => key)) {
      expect(Object.hasOwn(settingsDefaults, adjacentKey)).toBe(false)
    }
  })

  it('[AC 9.1] keeps adjacent defaults out of persisted settings while preserving adjacent localStorage keys', () => {
    localStorage.setItem(
      'OnAirSelectStreamSetting',
      JSON.stringify({ useURLScheme: true, type: 'M2TS', mode: 1 }),
    )
    const repository = new SettingsStorageRepository(localStorage, new DefaultSettingsFactory())

    repository.load()

    const persistedSettings = JSON.parse(localStorage.getItem('settings') ?? '{}') as Record<
      string,
      unknown
    >
    expect(Object.hasOwn(persistedSettings, 'OnAirSelectStreamSetting')).toBe(false)
    expect(localStorage.getItem('OnAirSelectStreamSetting')).toBe(
      JSON.stringify({ useURLScheme: true, type: 'M2TS', mode: 1 }),
    )
  })

  it('[AC 4.7] [AC 4.8] [AC 7.8] replaces live and recorded URL scheme placeholders without environment-specific fixture values', () => {
    expect(
      replaceURLSchemePlaceholders('player://PROTOCOL/ADDRESS', {
        protocol: '<protocol>',
        address: '<address>',
        filename: '<filename>',
      }),
    ).toBe('player://<protocol>/<address>')

    expect(
      replaceURLSchemePlaceholders('player://PROTOCOL/ADDRESS/FILENAME', {
        protocol: '<protocol>',
        address: '<address>',
        filename: '<filename>',
      }),
    ).toBe('player://<protocol>/<address>/<filename>')
  })
})

describe('synthetic settings storage fixtures', () => {
  it('[AC 4.7] [AC 7.8] provides synthetic saved settings states that load unchanged without persisting runtime values', () => {
    expect(settingsStorageStateMatrix).toHaveLength(3)
    expect(settingsStorageStateMatrix.map((item) => item.platformVariant)).toStrictEqual([
      'desktop',
      'ios',
      'android',
    ])

    for (const fixture of settingsStorageStateMatrix) {
      localStorage.clear()
      localStorage.setItem('settings', JSON.stringify(fixture.savedSettings))

      const repository = new SettingsStorageRepository(
        localStorage,
        new DefaultSettingsFactory(),
        fixture.defaultSettingsInput,
      )

      expect(repository.load().value).toStrictEqual(fixture.savedSettings)
      expect(fixture.urlSchemeTemplate).toContain('PROTOCOL')
      expect(fixture.urlSchemeTemplate).toContain('ADDRESS')
      expect(fixture.urlSchemeTemplate).toContain('FILENAME')
    }
  })

  it('[AC 9.1] [AC 9.2] [AC 9.3] [AC 9.4] [AC 9.5] [AC 9.6] [AC 9.7] [AC 9.8] [AC 9.9] [AC 9.10] [AC 9.11] [AC 9.12] [AC 9.13] keeps adjacent storage fixtures aligned with registry defaults', () => {
    const registry = new AdjacentStorageRegistry()

    expect(adjacentStorageFixtures).toStrictEqual(registry.list())
  })
})
