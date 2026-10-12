import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useManualReserveForm } from '@/features/reserves/hooks/useManualReserveForm'

describe('useManualReserveForm watch fallback defaults', () => {
  it('falls back to the documented defaults when react-hook-form reports an undefined watch value', () => {
    const { result } = renderHook(() => useManualReserveForm())

    act(() => {
      result.current.form.setValue('isTimeSpecification', undefined as never)
      result.current.form.setValue('reserveOption.allowEndLack', undefined as never)
      result.current.form.setValue('encodeOption.isDeleteOriginalAfterEncode', undefined as never)
    })

    expect(result.current.watchedFormState.isTimeSpecification).toBe(false)
    expect(result.current.watchedFormState.reserveOption.allowEndLack).toBe(true)
    expect(result.current.watchedFormState.encodeOption.isDeleteOriginalAfterEncode).toBe(false)
  })

  it('[AC 4.4] falls back save option sub-fields to null when replaceFormState receives an undefined field inside a defined save option', () => {
    const { result } = renderHook(() => useManualReserveForm())

    act(() => {
      result.current.replaceFormState({
        isTimeSpecification: false,
        timeSpecifiedOption: { name: null, channelId: null, startAt: null, endAt: null },
        reserveOption: { allowEndLack: true },
        saveOption: {
          parentDirectoryName: undefined as never,
          directory: undefined as never,
          recordedFormat: undefined as never,
        },
        encodeOption: { mode1: null, mode2: null, mode3: null, isDeleteOriginalAfterEncode: false },
      })
    })

    expect(result.current.watchedFormState.saveOption).toStrictEqual({
      parentDirectoryName: null,
      directory: null,
      recordedFormat: null,
    })
  })
})
