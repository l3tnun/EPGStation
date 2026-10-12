import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { SubmitHandler, UseFormSetError } from 'react-hook-form'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { ManualReserveFormState } from '../lib/manualReserveForm'
import {
  buildManualReserveAddPayload,
  buildManualReserveEditPayload,
} from '../lib/manualReservePayload'
import {
  MANUAL_RESERVE_ADD_FAILURE_MESSAGE,
  MANUAL_RESERVE_ADD_SUCCESS_MESSAGE,
  MANUAL_RESERVE_SUCCESS_BACK_DELAY_MS,
  MANUAL_RESERVE_UPDATE_FAILURE_MESSAGE,
  MANUAL_RESERVE_UPDATE_SUCCESS_MESSAGE,
  type ManualReserveMode,
  type ManualReservePayload,
} from '../lib/manualReserveTypes'
import type { ReservesApiRepository } from '../lib/reservesApiTypes'
import { openReserveSnackbar } from '../lib/reserveLabels'

function savePayload(
  apiRepository: ReservesApiRepository,
  mode: ManualReserveMode,
  payload: ManualReservePayload,
) {
  if (mode.kind === 'edit') {
    return apiRepository.updateManualReserve(mode.reserveId, payload)
  }

  return apiRepository.addManualReserve(payload)
}

export function useManualReserveSubmit({
  mode,
  apiRepository,
  onFetchFailure,
  setError,
  goBack,
}: {
  mode: ManualReserveMode
  apiRepository: ReservesApiRepository
  onFetchFailure: (snackbar: ShellSnackbarState) => void
  setError: UseFormSetError<ManualReserveFormState>
  goBack: () => void
}) {
  const submitInFlightRef: MutableRefObject<boolean> = useRef(false)
  const successBackTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const isMountedRef = useRef(true)
  const submitGenerationRef: MutableRefObject<number> = useRef(0)
  const isLoadingRef = useRef(false)
  const [isSubmitting, setSubmitting] = useState(false)
  const clearSuccessBackTimer = useCallback(() => {
    if (successBackTimerRef.current === undefined) {
      return
    }

    clearTimeout(successBackTimerRef.current)
    successBackTimerRef.current = undefined
  }, [])
  const isCurrentSubmitGeneration = useCallback((generation: number) => {
    return isMountedRef.current && generation === submitGenerationRef.current
  }, [])

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      clearSuccessBackTimer()
    }
  }, [clearSuccessBackTimer])

  const submitForm: SubmitHandler<ManualReserveFormState> = async (formState) => {
    if (isLoadingRef.current || submitInFlightRef.current) {
      return
    }

    clearSuccessBackTimer()
    submitInFlightRef.current = true
    setSubmitting(true)
    const submitGeneration = submitGenerationRef.current

    const payloadResult =
      mode.kind === 'edit'
        ? {
            ok: true as const,
            value: buildManualReserveEditPayload({
              reserveOption: formState.reserveOption,
              saveOption: formState.saveOption,
              encodeOption: formState.encodeOption,
            }),
          }
        : buildManualReserveAddPayload({
            mode,
            isTimeSpecification: formState.isTimeSpecification,
            timeSpecifiedOption: formState.timeSpecifiedOption,
            reserveOption: formState.reserveOption,
            saveOption: formState.saveOption,
            encodeOption: formState.encodeOption,
          })

    if (!payloadResult.ok) {
      setError('root', { message: payloadResult.message })
      openReserveSnackbar(onFetchFailure, MANUAL_RESERVE_ADD_FAILURE_MESSAGE, 'error')
      submitInFlightRef.current = false
      setSubmitting(false)
      return
    }

    const result = await savePayload(apiRepository, mode, payloadResult.value)
    if (!isCurrentSubmitGeneration(submitGeneration)) {
      return
    }

    if (!result.ok) {
      openReserveSnackbar(
        onFetchFailure,
        mode.kind === 'edit'
          ? MANUAL_RESERVE_UPDATE_FAILURE_MESSAGE
          : MANUAL_RESERVE_ADD_FAILURE_MESSAGE,
        'error',
      )
      submitInFlightRef.current = false
      setSubmitting(false)
      return
    }

    openReserveSnackbar(
      onFetchFailure,
      mode.kind === 'edit'
        ? MANUAL_RESERVE_UPDATE_SUCCESS_MESSAGE
        : MANUAL_RESERVE_ADD_SUCCESS_MESSAGE,
    )
    successBackTimerRef.current = setTimeout(() => {
      if (!isCurrentSubmitGeneration(submitGeneration)) {
        return
      }
      successBackTimerRef.current = undefined
      goBack()
    }, MANUAL_RESERVE_SUCCESS_BACK_DELAY_MS)
  }
  const cancel = () => {
    clearSuccessBackTimer()
    goBack()
  }

  return {
    isSubmitting,
    setSubmitting,
    submitInFlightRef,
    submitGenerationRef,
    isLoadingRef,
    clearSuccessBackTimer,
    submitForm,
    cancel,
  }
}
