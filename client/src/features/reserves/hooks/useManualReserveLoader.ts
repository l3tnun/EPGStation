import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { useScrollHistory } from '@/app/scrollHistory'
import type { SettingsConsumerValue } from '@/shared/settings'
import {
  createFormStateFromPageInfo,
  createFormStateFromProgram,
  createFormStateFromReserve,
  createInitialFormState,
  createPageInfoFromFormState,
  normalizeFormState,
  type ManualReserveFormState,
} from '../lib/manualReserveForm'
import {
  resolveManualReservePageInfoForRoute,
  shouldSaveManualReservePageInfo,
} from '../lib/manualReservePayload'
import {
  MANUAL_PROGRAM_FETCH_FAILURE_MESSAGE,
  MANUAL_RESERVE_FETCH_FAILURE_MESSAGE,
  type ManualReserveMode,
  type ManualReservePageInfo,
} from '../lib/manualReserveTypes'
import type { ManualProgramDetail, ReservesApiRepository } from '../lib/reservesApiTypes'
import { openReserveSnackbar } from '../lib/reserveLabels'

export interface ManualReserveLoaderInput {
  mode: ManualReserveMode
  search: string
  apiRepository: ReservesApiRepository
  settings: SettingsConsumerValue
  scrollHistory: ReturnType<typeof useScrollHistory>
  onFetchFailure: (snackbar: ShellSnackbarState) => void
  replaceFormState: (nextFormState: ManualReserveFormState) => void
  watchedFormState: ManualReserveFormState
  submitInFlightRef: MutableRefObject<boolean>
  submitGenerationRef: MutableRefObject<number>
  clearSuccessBackTimer: () => void
  setSubmitting: (value: boolean) => void
}

/**
 * `scrollHistory.emitDoneGetData()` is intentionally NOT called here once this hook's own fetch
 * settles. `ManualReservePage` also loads `fetchManualServerOptions()` (channels/directories/encode
 * modes) in a separate effect, and that response gates whether the エンコード1/2/3 / ファイル削除
 * panels render at all (see `isEncodeModeEnabled`). Emitting "done" as soon as this hook's own
 * fetch settles -- before that second fetch resolves -- let route-level scroll restoration
 * (`useRouteScrollRestoration`) restore the saved scroll position too early: once the encode
 * panels mounted afterward, the added height shifted the scroll position away from the restored
 * value (observed as a `browser-back` scroll-restore regression on Desktop Firefox / iOS Safari
 * for `/reserves/manual`, verified in a real browser -- Chromium's fetch mock happened to settle
 * before the scroll-restoration effect ran, so it never surfaced there). `ManualReservePage` now
 * emits "done" once via `useScrollHistoryPageReady`, gated on both this hook's `isLoading` and its
 * own server-options-loaded state, so the page's height is stable before any scroll restore runs.
 */
export function useManualReserveLoader({
  mode,
  search,
  apiRepository,
  settings,
  scrollHistory,
  onFetchFailure,
  replaceFormState,
  watchedFormState,
  submitInFlightRef,
  submitGenerationRef,
  clearSuccessBackTimer,
  setSubmitting,
}: ManualReserveLoaderInput) {
  const modeRef = useRef(mode)
  const canSavePageInfoRef = useRef(false)
  const formStateRef = useRef<ManualReserveFormState>(createInitialFormState())
  const [programDetail, setProgramDetail] = useState<ManualProgramDetail | null>(null)
  const [isLoading, setLoading] = useState(false)

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    formStateRef.current = normalizeFormState(watchedFormState)
  }, [watchedFormState])

  useEffect(() => {
    let isCancelled = false
    const generation = submitGenerationRef.current + 1
    submitGenerationRef.current = generation

    const initialize = async () => {
      clearSuccessBackTimer()
      canSavePageInfoRef.current = false
      submitInFlightRef.current = false
      setSubmitting(false)
      setLoading(mode.kind !== 'add')
      setProgramDetail(null)
      replaceFormState(createInitialFormState())

      if (mode.kind === 'edit') {
        const reserveResult = await apiRepository.fetchManualReserve({
          reserveId: mode.reserveId,
          isHalfWidth: settings.isHalfWidthDisplayed,
        })

        if (isCancelled) {
          return
        }

        if (!reserveResult.ok) {
          openReserveSnackbar(onFetchFailure, MANUAL_RESERVE_FETCH_FAILURE_MESSAGE, 'error')
          setLoading(false)
          return
        }

        replaceFormState(createFormStateFromReserve(reserveResult.value))

        if (reserveResult.value.programId !== undefined) {
          const programResult = await apiRepository.fetchManualProgram({
            programId: reserveResult.value.programId,
            isHalfWidth: settings.isHalfWidthDisplayed,
          })
          if (!isCancelled && programResult.ok) {
            setProgramDetail(programResult.value)
          } else if (!isCancelled) {
            openReserveSnackbar(onFetchFailure, MANUAL_PROGRAM_FETCH_FAILURE_MESSAGE, 'error')
          }
        }

        if (!isCancelled) {
          setLoading(false)
        }
        return
      }

      if (mode.kind === 'program') {
        const programResult = await apiRepository.fetchManualProgram({
          programId: mode.programId,
          isHalfWidth: settings.isHalfWidthDisplayed,
        })

        if (isCancelled) {
          return
        }

        if (!programResult.ok) {
          openReserveSnackbar(onFetchFailure, MANUAL_PROGRAM_FETCH_FAILURE_MESSAGE, 'error')
          setLoading(false)
          return
        }

        setProgramDetail(programResult.value)
        const restored = resolveManualReservePageInfoForRoute({
          mode,
          shouldRestoreHistory: scrollHistory.isNeedRestoreHistory(),
          pageInfo: scrollHistory.getScrollData<ManualReservePageInfo>(),
        })
        replaceFormState(
          restored === null
            ? createFormStateFromProgram(programResult.value)
            : createFormStateFromPageInfo(restored),
        )
        scrollHistory.clearRestoreHistory()
        canSavePageInfoRef.current = true
      }

      if (mode.kind === 'add') {
        canSavePageInfoRef.current = true
      }
      setLoading(false)
    }

    void initialize()

    return () => {
      isCancelled = true
      submitGenerationRef.current += 1
      clearSuccessBackTimer()
      if (
        !canSavePageInfoRef.current ||
        !shouldSaveManualReservePageInfo({ mode: modeRef.current })
      ) {
        return
      }

      scrollHistory.saveScrollData(createPageInfoFromFormState(formStateRef.current))
    }
  }, [
    apiRepository,
    clearSuccessBackTimer,
    search,
    mode,
    onFetchFailure,
    replaceFormState,
    scrollHistory,
    setSubmitting,
    settings.isHalfWidthDisplayed,
    submitGenerationRef,
    submitInFlightRef,
  ])

  return { programDetail, isLoading }
}
