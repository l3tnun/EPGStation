import type { SettingsConsumerValue } from '@/shared/settings'
import type { SETTINGS_SECTION_ORDER } from './settingsLayoutContract'

export type SettingsSectionName = (typeof SETTINGS_SECTION_ORDER)[number]
export type SettingsControlKey = keyof SettingsConsumerValue
export type SettingsControlType = 'switch' | 'select' | 'text'
export type SettingsPreviewTheme = 'light' | 'dark'
export type BooleanSettingsControlKey = {
  [Key in SettingsControlKey]: SettingsConsumerValue[Key] extends boolean ? Key : never
}[SettingsControlKey]
export type TextSettingsControlKey = {
  [Key in SettingsControlKey]: SettingsConsumerValue[Key] extends string | null ? Key : never
}[SettingsControlKey]
export type SelectSettingsControlKey = {
  [Key in SettingsControlKey]: SettingsConsumerValue[Key] extends string | number ? Key : never
}[SettingsControlKey]

export interface SettingsControlOption {
  label: string
  value: string | number
}

export interface SettingsControlRange {
  min: number
  max: number
  step: number
}

interface BaseSettingsControlDefinition<Key extends SettingsControlKey> {
  section: SettingsSectionName
  label: string
  subtitle?: string
  key: Key
  tmpTarget: Key
  visibleWhen?: 'mpegtsSupported'
  disabledWhen?: 'osColorThemeEnabled' | 'previewThemeLight'
}

export interface SwitchSettingsControlDefinition extends BaseSettingsControlDefinition<BooleanSettingsControlKey> {
  controlType: 'switch'
}

export interface TextSettingsControlDefinition extends BaseSettingsControlDefinition<TextSettingsControlKey> {
  controlType: 'text'
}

export interface SelectSettingsControlDefinition extends BaseSettingsControlDefinition<SelectSettingsControlKey> {
  controlType: 'select'
  options?: readonly SettingsControlOption[]
  range?: SettingsControlRange
}

export type SettingsControlDefinition =
  SwitchSettingsControlDefinition | TextSettingsControlDefinition | SelectSettingsControlDefinition

export interface SettingsControlResolutionContext {
  tmp: SettingsConsumerValue
  mpegtsSupported: boolean
  currentPreviewTheme: SettingsPreviewTheme
}

export type SettingsControlUpdate =
  | {
      key: BooleanSettingsControlKey
      value: boolean
    }
  | {
      key: TextSettingsControlKey
      value: string
    }
  | {
      key: SelectSettingsControlKey
      value: string | number
    }
