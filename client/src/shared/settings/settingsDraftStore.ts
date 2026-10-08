import type { SettingsStorageRepository } from './settingsStorage'
import type {
  SettingsConsumerValue,
  SettingsSaveResult,
  ThemePreviewState,
  ThemeSettings,
} from './settingsTypes'

export class SettingsDraftStore {
  private saved: SettingsConsumerValue
  private tmp: SettingsConsumerValue
  private visibleThemeSettings: ThemeSettings
  private isTmpReset = false

  constructor(private readonly repository: SettingsStorageRepository) {
    this.saved = repository.load().value
    this.tmp = { ...this.saved }
    this.visibleThemeSettings = this.pickThemeSettings(this.saved)
  }

  getSaved(): SettingsConsumerValue {
    return { ...this.saved }
  }

  getTmp(): SettingsConsumerValue {
    return { ...this.tmp }
  }

  getThemePreviewState(): ThemePreviewState {
    return {
      tmp: this.pickThemeSettings(this.tmp),
      visible: { ...this.visibleThemeSettings },
    }
  }

  updateControl<Key extends keyof SettingsConsumerValue>(
    key: Key,
    value: SettingsConsumerValue[Key],
  ): void {
    this.tmp = {
      ...this.tmp,
      [key]: value,
    }
    if (this.isThemeControlKey(key)) {
      this.visibleThemeSettings = this.pickThemeSettings(this.tmp)
    }
  }

  updateTmp(nextValue: SettingsConsumerValue): void {
    this.tmp = { ...nextValue }
    this.visibleThemeSettings = this.pickThemeSettings(this.tmp)
  }

  save(): SettingsSaveResult {
    const persisted = this.repository.save(this.tmp, { discardStored: this.isTmpReset })
    if (persisted) {
      this.isTmpReset = false
      this.saved = { ...this.tmp }
      this.visibleThemeSettings = this.pickThemeSettings(this.saved)
    }
    return { ok: persisted }
  }

  resetTmp(): void {
    this.tmp = this.repository.createDefaultSettings()
    this.isTmpReset = true
    this.visibleThemeSettings = this.pickThemeSettings(this.saved)
  }

  restoreTmpFromSaved(): void {
    this.isTmpReset = false
    this.tmp = { ...this.saved }
    this.visibleThemeSettings = this.pickThemeSettings(this.saved)
  }

  private pickThemeSettings(value: SettingsConsumerValue): ThemeSettings {
    return {
      shouldUseOSColorTheme: value.shouldUseOSColorTheme,
      isForceDarkTheme: value.isForceDarkTheme,
    }
  }

  private isThemeControlKey(key: keyof SettingsConsumerValue): boolean {
    return key === 'shouldUseOSColorTheme' || key === 'isForceDarkTheme'
  }
}
