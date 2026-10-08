import { describe, expect, it } from 'vitest'
import { AdjacentStorageRegistry } from '@/shared/settings'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { SettingsValidator } from '@/shared/settings/settingsValidation'
import type { AdjacentStorageKey } from '@/shared/settings/settingsTypes'

describe('frontend-settings-storage SettingsValidator repair edges', () => {
  it('falls back to defaults when the stored candidate is not an object', () => {
    const defaults = new DefaultSettingsFactory().create()
    const validator = new SettingsValidator(defaults)

    expect(validator.repair('a string is not a storage object')).toStrictEqual({
      value: defaults,
      raw: defaults,
      repaired: true,
    })
    expect(validator.repair(42)).toMatchObject({ value: defaults })
    expect(validator.repair(['array', 'candidate'])).toMatchObject({ value: defaults })
    expect(validator.repair(null)).toMatchObject({ value: defaults })
  })

  it('backfills the default when a raw field value is neither a primitive nor a nested storage object', () => {
    const defaults = new DefaultSettingsFactory().create()
    const validator = new SettingsValidator(defaults)

    const result = validator.repair({
      isEnablePWA: () => undefined,
      guideLength: 5,
    })

    expect(result.repaired).toBe(true)
    expect(result.value.isEnablePWA).toBe(defaults.isEnablePWA)
    expect(result.value.guideLength).toBe(5)
  })
})

describe('frontend-app-shell AdjacentStorageRegistry unknown key handling', () => {
  it('throws for an adjacent storage key the registry does not define', () => {
    const registry = new AdjacentStorageRegistry()

    expect(() => registry.find('UnknownStorageKey' as AdjacentStorageKey)).toThrow(
      'Unknown adjacent storage key: UnknownStorageKey',
    )
  })
})
