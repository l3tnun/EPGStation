import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useShellSnackbar } from '@/app/hooks/useShellSnackbar'

describe('useShellSnackbar close requests', () => {
  it('[AC 6.24] closes the active snackbar when the close names it', () => {
    const { result } = renderHook(() => useShellSnackbar(undefined))

    act(() => {
      result.current.showSnackbar({ text: 'first' })
    })
    const first = result.current.activeSnackbar
    act(() => {
      result.current.closeSnackbar(first)
    })

    expect(result.current.activeSnackbar).toBeUndefined()
  })

  it('[AC 6.24] ignores a close that names a snackbar that has been replaced', () => {
    const { result } = renderHook(() => useShellSnackbar(undefined))

    act(() => {
      result.current.showSnackbar({ text: 'first' })
    })
    const first = result.current.activeSnackbar
    // The first snackbar's timer runs after the second was set and before it rendered.
    act(() => {
      result.current.showSnackbar({ text: 'second' })
      result.current.closeSnackbar(first)
    })

    expect(result.current.activeSnackbar?.text).toBe('second')
  })

  it('[AC 6.7] closes whichever snackbar is active when the close names none', () => {
    const { result } = renderHook(() => useShellSnackbar(undefined))

    act(() => {
      result.current.showSnackbar({ text: 'first' })
      result.current.closeSnackbar()
    })

    expect(result.current.activeSnackbar).toBeUndefined()
  })
})
