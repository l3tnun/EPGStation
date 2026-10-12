import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createInitialSettingsTmp,
  getNavigationRegenerationTarget,
  getReadableSettingsStorage,
  persistSettingsTmp,
} from '@/features/settings/lib/settingsStorageAccess'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('settingsStorageAccess without a window', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('falls back to an in-memory storage that implements every Storage member', () => {
    vi.stubGlobal('window', undefined)

    const storage = getReadableSettingsStorage()

    expect(storage.length).toBe(0)
    storage.setItem('a', '1')
    storage.setItem('b', '2')
    expect(storage.length).toBe(2)
    expect(storage.getItem('a')).toBe('1')
    expect(storage.getItem('missing')).toBeNull()
    expect(storage.key(0)).toBe('a')
    expect(storage.key(9)).toBeNull()
    storage.removeItem('a')
    expect(storage.getItem('a')).toBeNull()
    storage.clear()
    expect(storage.length).toBe(0)
  })

  it('loads default settings from memory storage when there is no window', () => {
    vi.stubGlobal('window', undefined)

    const tmp = createInitialSettingsTmp()

    expect(tmp).toMatchObject(new DefaultSettingsFactory().create())
  })

  it('reports a successful save against memory storage when there is no window', () => {
    vi.stubGlobal('window', undefined)

    const result = persistSettingsTmp(new DefaultSettingsFactory().create())

    expect(result).toStrictEqual({ ok: true })
  })

  it('creates a standalone navigation regeneration target when there is no window', () => {
    vi.stubGlobal('window', undefined)

    const target = getNavigationRegenerationTarget()
    const listener = vi.fn()
    target.addEventListener('synthetic', listener)
    target.dispatchEvent(new Event('synthetic'))

    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('settingsStorageAccess when localStorage access itself throws', () => {
  afterEach(() => {
    delete (window as { localStorage?: Storage }).localStorage
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: globalThis.localStorage,
      writable: true,
    })
  })

  it('reads through an in-memory fallback when the localStorage accessor throws', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })

    const storage = getReadableSettingsStorage()

    expect(storage.getItem('settings')).toBeNull()
  })

  it('reports a failed save when the localStorage accessor throws', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })

    const result = persistSettingsTmp(new DefaultSettingsFactory().create())

    expect(result).toStrictEqual({ ok: false })
  })
})
