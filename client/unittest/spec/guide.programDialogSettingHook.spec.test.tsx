import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProgramDialogSetting } from '@/features/guide/hooks/useProgramDialogSetting'

describe('useProgramDialogSetting edges', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('[AC 4.16] normalizes an empty encode value to TS when closing', () => {
    const onClose = vi.fn()
    const { result } = renderHook(() =>
      useProgramDialogSetting({
        open: true,
        programId: 601,
        detailSetting: { encode: '', isDeleteOriginalAfterEncode: false },
        onClose,
        onPersistSetting: vi.fn(),
      }),
    )

    act(() => {
      result.current.closeWithCurrentSetting()
    })

    expect(onClose).toHaveBeenCalledWith({ encode: 'TS', isDeleteOriginalAfterEncode: false })
  })

  it('[AC 4.16] [AC 4.20] persists the latest setting once when the dialog closes externally without calling closeWithCurrentSetting', () => {
    const onPersistSetting = vi.fn()
    const { rerender } = renderHook(
      (props: { open: boolean }) =>
        useProgramDialogSetting({
          open: props.open,
          programId: 602,
          detailSetting: { encode: 'TS', isDeleteOriginalAfterEncode: false },
          onClose: vi.fn(),
          onPersistSetting,
        }),
      { initialProps: { open: true } },
    )

    rerender({ open: false })

    expect(onPersistSetting).toHaveBeenCalledWith({
      encode: 'TS',
      isDeleteOriginalAfterEncode: false,
    })
  })

  it('[AC 4.16] [AC 4.20] re-arms the close-persist guard when the dialog reopens after closing', () => {
    const onPersistSetting = vi.fn()
    const { rerender } = renderHook(
      (props: { open: boolean }) =>
        useProgramDialogSetting({
          open: props.open,
          programId: 603,
          detailSetting: { encode: 'TS', isDeleteOriginalAfterEncode: false },
          onClose: vi.fn(),
          onPersistSetting,
        }),
      { initialProps: { open: true } },
    )

    rerender({ open: false })
    expect(onPersistSetting).toHaveBeenCalledTimes(1)

    rerender({ open: true })
    rerender({ open: false })
    expect(onPersistSetting).toHaveBeenCalledTimes(2)
  })

  it('[AC 4.20] clears a leftover unmount-close timer for the same program id when it opens again', () => {
    const onPersistSetting = vi.fn()
    const { unmount } = renderHook(() =>
      useProgramDialogSetting({
        open: true,
        programId: 604,
        detailSetting: { encode: 'TS', isDeleteOriginalAfterEncode: false },
        onClose: vi.fn(),
        onPersistSetting,
      }),
    )

    // Unmounting without an explicit close schedules a deferred persist for this program id.
    unmount()

    // Mounting again for the same program id before that timer fires clears the stale one.
    renderHook(() =>
      useProgramDialogSetting({
        open: true,
        programId: 604,
        detailSetting: { encode: 'TS', isDeleteOriginalAfterEncode: false },
        onClose: vi.fn(),
        onPersistSetting,
      }),
    )

    act(() => {
      vi.runAllTimers()
    })

    expect(onPersistSetting).not.toHaveBeenCalled()
  })
})
