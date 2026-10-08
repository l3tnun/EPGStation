import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getBrowserHref,
  getBrowserOrigin,
  getBrowserStorage,
} from '@/features/recorded/lib/recordedBrowser'

describe('recorded browser accessors without a window', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fall back to placeholder values when no window exists', () => {
    vi.stubGlobal('window', undefined)

    expect(getBrowserOrigin()).toBe('https://example.invalid')
    expect(getBrowserHref()).toBe('https://example.invalid/')
    expect(getBrowserStorage()).toBeUndefined()
  })

  it('read the real window when it exists', () => {
    expect(getBrowserOrigin()).toBe(window.location.origin)
    expect(getBrowserHref()).toBe(window.location.href)
    expect(getBrowserStorage()).toBe(window.localStorage)
  })
})
