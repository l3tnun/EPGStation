import { SettingsValidator } from './settingsValidation'
import {
  SETTINGS_STORAGE_KEY,
  type DefaultSettingsInput,
  type SettingsConsumerValue,
  type SettingsLoadResult,
  type SettingsRawValue,
} from './settingsTypes'
import type { DefaultSettingsFactory } from './defaultSettings'

export class SettingsStorageRepository {
  constructor(
    private readonly storage: Storage,
    private readonly defaultSettingsFactory: DefaultSettingsFactory,
    private readonly defaultSettingsInput: DefaultSettingsInput = {},
  ) {}

  load(): SettingsLoadResult {
    const validator = new SettingsValidator(this.createDefaultSettings())
    const validation = validator.parse(this.readRawSettings())

    if (!validation.repaired) {
      return {
        ...validation,
        persisted: false,
      }
    }

    return {
      ...validation,
      persisted: this.persistRaw(validation.raw),
    }
  }

  /**
   * Persists `value` over the stored object: fields the stored JSON has but the defaults do not
   * (unknown fields) are written back untouched, and a stored value whose type does not match its
   * default (read as the default by consumers) is kept while `value` still holds that default.
   * With `discardStored` (a save after a reset) only `value` is written.
   */
  save(value: SettingsConsumerValue, options: { discardStored?: boolean } = {}): boolean {
    if (options.discardStored === true) {
      return this.persistRaw(value)
    }

    const stored = this.readStoredObject()
    const defaults = this.createDefaultSettings()
    const validator = new SettingsValidator(defaults)
    const merged: Record<string, unknown> = { ...stored }

    for (const [key, next] of Object.entries(value)) {
      const keepsMismatchedStoredValue =
        Object.hasOwn(stored, key) &&
        !validator.isStoredValueCompatible(key, stored[key] as SettingsRawValue | undefined) &&
        JSON.stringify(next) ===
          JSON.stringify((defaults as unknown as Record<string, unknown>)[key])

      if (!keepsMismatchedStoredValue) {
        merged[key] = next
      }
    }

    return this.persistRaw(merged)
  }

  createDefaultSettings(): SettingsConsumerValue {
    return this.defaultSettingsFactory.create(this.defaultSettingsInput)
  }

  private readRawSettings(): string | null {
    try {
      return this.storage.getItem(SETTINGS_STORAGE_KEY)
    } catch {
      return null
    }
  }

  private readStoredObject(): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(this.readRawSettings() ?? 'null')

      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }

  private persistRaw(value: object): boolean {
    try {
      this.storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(value))
      return true
    } catch {
      return false
    }
  }
}
