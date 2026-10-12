import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useGuideGenreVisibility } from '@/features/guide/hooks/useGuideGenreVisibility'

describe('useGuideGenreVisibility cross-tab storage sync', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('[AC 3.36] refreshes genre visibility only when another tab updates the GuideGenreSetting key', () => {
    const { result } = renderHook(() => useGuideGenreVisibility())

    expect(result.current[0][0]).toBe(true)

    localStorage.setItem('GuideGenreSetting', JSON.stringify({ 0: false }))
    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'SomeOtherKey', newValue: 'ignored' }),
      )
    })
    expect(result.current[0][0]).toBe(true)

    act(() => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'GuideGenreSetting', newValue: '{}' }),
      )
    })
    expect(result.current[0][0]).toBe(false)
  })
})
