import { AdjacentStorageRegistry } from '../adjacentStorageRegistry'
import { DefaultSettingsFactory } from '../defaultSettings'
import type {
  AdjacentStorageDefinition,
  DefaultSettingsInput,
  SettingsConsumerValue,
  SettingsRawObject,
} from '../settingsTypes'

export type SettingsStoragePlatformVariant = 'desktop' | 'ios' | 'android'
export type SettingsStorageThemeVariant = 'light' | 'dark'
export type SettingsStorageThemePreviewState =
  'saved-derived' | 'tmp-preview' | 'reset-restored' | 'leave-restored'
export type SettingsStorageWriteFailureMode = 'none' | 'quotaExceeded' | 'unavailable'

export interface SettingsStorageStateFixture {
  platformVariant: SettingsStoragePlatformVariant
  defaultSettingsInput: DefaultSettingsInput
  osColorTheme: SettingsStorageThemeVariant
  savedSettings: SettingsConsumerValue
  tmpSettings: SettingsConsumerValue
  themePreviewState: SettingsStorageThemePreviewState
  writeFailureMode: SettingsStorageWriteFailureMode
  extraUnknownField: SettingsRawObject
  invalidExistingField: SettingsRawObject
  urlSchemeTemplate: string
}

const defaultSettingsFactory = new DefaultSettingsFactory()

const desktopDefaults = defaultSettingsFactory.create({ isIOS: false, isAndroid: false })
const iosDefaults = defaultSettingsFactory.create({ isIOS: true, isAndroid: false })
const androidDefaults = defaultSettingsFactory.create({ isIOS: false, isAndroid: true })

export const settingsStorageStateMatrix = [
  {
    platformVariant: 'desktop',
    defaultSettingsInput: { isIOS: false, isAndroid: false },
    osColorTheme: 'light',
    savedSettings: {
      ...desktopDefaults,
      guideLength: 12,
      onAirM2TSViewURLScheme: '<protocol-template>:PROTOCOL:ADDRESS',
      recordedViewURLScheme: '<view-template>:PROTOCOL:ADDRESS:FILENAME',
      recordedDownloadURLScheme: '<download-template>:PROTOCOL:ADDRESS:FILENAME',
    },
    tmpSettings: {
      ...desktopDefaults,
      guideLength: 6,
      isEnableDisplayForEachBroadcastWave: true,
    },
    themePreviewState: 'tmp-preview',
    writeFailureMode: 'none',
    extraUnknownField: {
      '<unknown-field>': '<synthetic-value>',
    },
    invalidExistingField: {
      guideMode: '<invalid-guide-mode>',
      guideLength: 999,
    },
    urlSchemeTemplate: '<scheme-template>:PROTOCOL:ADDRESS:FILENAME',
  },
  {
    platformVariant: 'ios',
    defaultSettingsInput: { isIOS: true, isAndroid: false },
    osColorTheme: 'dark',
    savedSettings: {
      ...iosDefaults,
      shouldUseOSColorTheme: false,
      isForceDarkTheme: true,
    },
    tmpSettings: {
      ...iosDefaults,
      shouldUseOSColorTheme: true,
      isForceDarkTheme: false,
      searchLength: 600,
    },
    themePreviewState: 'reset-restored',
    writeFailureMode: 'quotaExceeded',
    extraUnknownField: {
      '<ios-unknown-field>': '<synthetic-value>',
    },
    invalidExistingField: {
      isEnablePWA: '<invalid-boolean>',
      searchLength: 125,
    },
    urlSchemeTemplate: '<mobile-scheme-template>:PROTOCOL:ADDRESS:FILENAME',
  },
  {
    platformVariant: 'android',
    defaultSettingsInput: { isIOS: false, isAndroid: true },
    osColorTheme: 'light',
    savedSettings: {
      ...androidDefaults,
      recordedLength: 50,
      rulesLength: 50,
    },
    tmpSettings: {
      ...androidDefaults,
      recordedLength: 25,
      rulesLength: 25,
      deleteRecordedDefaultValue: true,
    },
    themePreviewState: 'leave-restored',
    writeFailureMode: 'unavailable',
    extraUnknownField: {
      '<android-unknown-field>': '<synthetic-value>',
    },
    invalidExistingField: {
      recordedLength: -1,
      recordedViewURLScheme: 100,
    },
    urlSchemeTemplate: '<handoff-template>:PROTOCOL:ADDRESS:FILENAME',
  },
] as const satisfies readonly SettingsStorageStateFixture[]

export const adjacentStorageFixtures = new AdjacentStorageRegistry().list()

const forbiddenFixturePatterns = [
  /https?:\/\//i,
  /\b(?:rtsp|rtsps|ws|wss):\/\//i,
  new RegExp(`\\b${'miraku'}${'run'}\\b`, 'i'),
  new RegExp(`\\b${'ffm'}${'peg'}\\b`, 'i'),
  new RegExp(`\\b${'ffp'}${'robe'}\\b`, 'i'),
  new RegExp(
    `\\b(?:${'pass'}${'word'}|${'pass'}${'wd'}|${'sec'}${'ret'}|${'cred'}${'ential'}|${'auth'}${'orization'}|${'bear'}${'er'}|${'cook'}${'ie'}|${'sess'}${'ion'})\\b`,
    'i',
  ),
  /(?:^|["'\s])(?:\/home\/|\/Users\/|\/usr\/|\/opt\/|[A-Za-z]:\\)/,
  new RegExp(`\\b(?:${'program'}-${'title'})\\b`, 'i'),
] as const

function assertSyntheticString(value: string): void {
  for (const pattern of forbiddenFixturePatterns) {
    if (pattern.test(value)) {
      throw new Error(`Synthetic fixture contains forbidden runtime value: ${value}`)
    }
  }
}

function assertSyntheticValue(value: unknown): void {
  if (typeof value === 'string') {
    assertSyntheticString(value)
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      assertSyntheticValue(item)
    }
    return
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      assertSyntheticString(key)
      assertSyntheticValue(item)
    }
  }
}

export function assertSyntheticSettingsFixture(
  fixture: SettingsStorageStateFixture | readonly AdjacentStorageDefinition[],
): void {
  assertSyntheticValue(fixture)
}
