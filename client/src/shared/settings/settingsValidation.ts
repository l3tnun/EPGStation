import type {
  DefaultSettingsValue,
  SettingsRawObject,
  SettingsRawValue,
  SettingsValidationResult,
} from './settingsTypes'

const isStorageObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class SettingsValidator {
  constructor(private readonly defaults: DefaultSettingsValue) {}

  parse(rawValue: string | null): SettingsValidationResult {
    if (rawValue === null) {
      return this.fromDefaults()
    }

    try {
      return this.repair(JSON.parse(rawValue) as unknown)
    } catch {
      return this.fromDefaults()
    }
  }

  repair(candidate: unknown): SettingsValidationResult {
    if (!isStorageObject(candidate)) {
      return this.fromDefaults()
    }

    const raw = this.toRawObject(candidate)
    let repaired = false

    for (const [key, defaultValue] of Object.entries(this.defaults)) {
      if (!Object.hasOwn(raw, key) || raw[key] === undefined) {
        raw[key] = defaultValue
        repaired = true
      }
    }

    return {
      value: this.toConsumerValue(raw),
      raw,
      repaired,
    }
  }

  private fromDefaults(): SettingsValidationResult {
    return {
      value: { ...this.defaults },
      raw: { ...this.defaults },
      repaired: true,
    }
  }

  private toRawObject(candidate: Record<string, unknown>): SettingsRawObject {
    const raw: SettingsRawObject = {}

    for (const [key, value] of Object.entries(candidate)) {
      raw[key] = this.toRawValue(value)
    }

    return raw
  }

  private toRawValue(value: unknown): SettingsRawValue | undefined {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null ||
      Array.isArray(value)
    ) {
      return value
    }

    if (isStorageObject(value)) {
      return this.toRawObject(value)
    }

    return undefined
  }

  private toConsumerValue(raw: SettingsRawObject): DefaultSettingsValue {
    const value = { ...this.defaults }

    for (const [key, defaultValue] of Object.entries(this.defaults)) {
      const rawValue = raw[key]
      if (this.isCompatibleValue(key, rawValue, defaultValue)) {
        Object.assign(value, { [key]: rawValue })
      }
    }

    return value
  }

  /** Whether a stored value has the type its consumer value is read as (otherwise it reads as the default). */
  isStoredValueCompatible(key: string, rawValue: SettingsRawValue | undefined): boolean {
    return this.isCompatibleValue(
      key,
      rawValue,
      (this.defaults as unknown as SettingsRawObject)[key] as SettingsRawValue,
    )
  }

  private isCompatibleValue(
    key: string,
    rawValue: SettingsRawValue | undefined,
    defaultValue: SettingsRawValue,
  ): boolean {
    if (key === 'guideMode') {
      return typeof rawValue === 'string'
    }

    if (defaultValue === null) {
      return rawValue === null || typeof rawValue === 'string'
    }

    return typeof rawValue === typeof defaultValue
  }
}
