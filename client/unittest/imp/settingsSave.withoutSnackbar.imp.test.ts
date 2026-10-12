import { describe, expect, it } from 'vitest'
import { saveSettingsTmp } from '@/features/settings/settingsSave'

describe('Settings save without a snackbar callback', () => {
  it('returns a persistence failure without throwing when no snackbar callback is given', () => {
    const target = new EventTarget()
    let navigationRequests = 0
    target.addEventListener('epgstation:navigation-regeneration-request', () => {
      navigationRequests += 1
    })

    expect(
      saveSettingsTmp({ saveTmp: () => ({ ok: false }), navigationRegenerationTarget: target }),
    ).toStrictEqual({ ok: false })
    expect(navigationRequests).toBe(0)
  })
})
