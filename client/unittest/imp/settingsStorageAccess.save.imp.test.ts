import { afterEach, describe, expect, it } from 'vitest'
import {
  createInitialSettingsTmp,
  persistSettingsTmp,
} from '@/features/settings/lib/settingsStorageAccess'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('settingsStorageAccess saving over a stored object with extra data', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('writes back unknown fields and mismatched values that the screen did not change', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnablePWA: 'synthetic-not-a-boolean',
        syntheticLegacyField: { nested: [1, 2, 3] },
      }),
    )

    const tmp = createInitialSettingsTmp()
    const result = persistSettingsTmp({ ...tmp, guideLength: 6 })

    expect(result).toStrictEqual({ ok: true })
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({
      guideLength: 6,
      isEnablePWA: 'synthetic-not-a-boolean',
      syntheticLegacyField: { nested: [1, 2, 3] },
    })
  })

  it('saves the given value when the stored JSON cannot be read as an object', () => {
    localStorage.setItem('settings', '["not", "an", "object"]')

    const result = persistSettingsTmp({ ...new DefaultSettingsFactory().create(), guideLength: 6 })

    expect(result).toStrictEqual({ ok: true })
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({ guideLength: 6 })
  })

  it('saves the given value when nothing is stored or the stored text is not JSON', () => {
    const value = { ...new DefaultSettingsFactory().create(), guideLength: 7 }

    expect(persistSettingsTmp(value)).toStrictEqual({ ok: true })
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({ guideLength: 7 })

    localStorage.setItem('settings', 'not json')

    expect(persistSettingsTmp(value)).toStrictEqual({ ok: true })
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toMatchObject({ guideLength: 7 })
  })

  it('writes only the given value when told to discard the stored object', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnablePWA: 'synthetic-not-a-boolean',
        syntheticLegacyField: { nested: [1, 2, 3] },
      }),
    )

    const value = { ...new DefaultSettingsFactory().create(), guideLength: 6 }
    const result = persistSettingsTmp(value, { discardStored: true })

    expect(result).toStrictEqual({ ok: true })
    expect(JSON.parse(localStorage.getItem('settings') ?? '{}')).toStrictEqual(value)
  })
})
