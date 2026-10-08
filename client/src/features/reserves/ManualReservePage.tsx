import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SHELL_NAVIGATION_DRAWER_ID, type ShellSnackbarState } from '@/app/AppShell'
import { useScrollHistory, useScrollHistoryPageReady } from '@/app/scrollHistory'
import { TitleBar } from '@/app/titleBar'
import type { SettingsConsumerValue } from '@/shared/settings'
import { useDeferredLoading } from '@/shared/useDeferredLoading'
import { ManualEncodePanel } from './components/ManualEncodePanel'
import { ManualOptionPanel } from './components/ManualOptionPanel'
import { ManualDirectoryPanel, ManualFileFormatPanel } from './components/ManualOptionPanels'
import { ManualProgramInfo } from './components/ManualProgramInfo'
import { ManualTimeSpecifiedFields } from './components/ManualTimeSpecifiedFields'
import { useManualReserveForm } from './hooks/useManualReserveForm'
import { useManualReserveLoader } from './hooks/useManualReserveLoader'
import { useManualReserveSubmit } from './hooks/useManualReserveSubmit'
import type { ManualOptionPanelIndex } from './lib/manualReserveForm'
import { parseManualReserveMode } from './lib/manualReservePayload'
import {
  EMPTY_SERVER_OPTIONS,
  fetchManualServerOptions,
  type ManualServerOptions,
} from './lib/manualReserveServerOptions'
import { MANUAL_RESERVE_OPEN_OPTION_PANELS } from './lib/manualReserveTypes'
import type { ReservesApiRepository } from './lib/reservesApiTypes'
import styles from './ReservesPage.module.css'

export interface ManualReservePageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  settings: SettingsConsumerValue
  apiRepository: ReservesApiRepository
  onFetchFailure: (snackbar: ShellSnackbarState) => void
}

export function ManualReservePage({
  isNavigationOpen,
  onNavigationClick,
  settings,
  apiRepository,
  onFetchFailure,
}: ManualReservePageProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const scrollHistory = useScrollHistory()
  const mode = useMemo(() => parseManualReserveMode(location.search), [location.search])
  const [serverOptions, setServerOptions] = useState<ManualServerOptions>(EMPTY_SERVER_OPTIONS)
  const [isServerOptionsLoaded, setServerOptionsLoaded] = useState(false)
  const [openOptionPanels, setOpenOptionPanels] = useState<Set<ManualOptionPanelIndex>>(
    () => new Set(MANUAL_RESERVE_OPEN_OPTION_PANELS),
  )
  const isEditMode = mode.kind === 'edit'
  const { form, watchedFormState, replaceFormState } = useManualReserveForm()
  const { handleSubmit, setError, setValue } = form
  const submit = useManualReserveSubmit({
    mode,
    apiRepository,
    onFetchFailure,
    setError,
    goBack: () => navigate(-1),
  })
  const { programDetail, isLoading } = useManualReserveLoader({
    mode,
    search: location.search,
    apiRepository,
    settings,
    scrollHistory,
    onFetchFailure,
    replaceFormState,
    watchedFormState,
    submitInFlightRef: submit.submitInFlightRef,
    submitGenerationRef: submit.submitGenerationRef,
    clearSuccessBackTimer: submit.clearSuccessBackTimer,
    setSubmitting: submit.setSubmitting,
  })
  const { isLoadingRef } = submit
  const isSubmitBlocked = isLoading || submit.isSubmitting
  // Display-only: submit blocking and scroll-ready gating above keep reading
  // the raw `isLoading` value; only the "読み込み中" text itself is delayed.
  const showLoadingIndicator = useDeferredLoading(isLoading)
  const showTimeSpecifiedFields = watchedFormState.isTimeSpecification
  const isEncodeModeEnabled = serverOptions.encodeModes.length > 0
  // The エンコード1/2/3 / ファイル削除 panels only render once `isEncodeModeEnabled` is known
  // (see below), so the page's rendered height can still grow after `isLoading` turns false.
  // Route-level scroll restoration must wait for both fetches, or a scroll restored while those
  // panels are still absent gets shifted once they mount (verified in a real browser on
  // Desktop Firefox / iOS Safari for `/reserves/manual` browser-back).
  useScrollHistoryPageReady(!isLoading && isServerOptionsLoaded, location.search)
  const openOptionPanelIds = useMemo(
    () => [...openOptionPanels].sort((a, b) => a - b).join(','),
    [openOptionPanels],
  )
  const isOptionPanelOpen = (index: ManualOptionPanelIndex) => openOptionPanels.has(index)
  const toggleOptionPanel = (index: ManualOptionPanelIndex) => {
    setOpenOptionPanels((current) => {
      const next = new Set(current)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  // Mirrors `isLoading` into the ref `submitForm` reads its own guard from. This must be a layout
  // effect, not a passive `useEffect`: passive effects are flushed on a separate scheduled task,
  // and the browser can dispatch an already-queued click in the gap between the DOM update that
  // re-enables the 保存 button and that task actually running. A click landing in that gap saw the
  // button enabled (this render's `isSubmitBlocked` was already `false`) while `submitForm` still
  // read the previous, stale `isLoading` from the ref and silently returned -- no request, no
  // snackbar. Layout effects flush synchronously right after the DOM update, before the browser
  // can process another event, which closes the gap. Confirmed with instrumentation on iOS Safari
  // under load: `isSubmitBlocked` was `false` on the render that enabled the button while
  // `isLoadingRef.current` inside that same click's `submitForm` call was still `true`.
  useLayoutEffect(() => {
    isLoadingRef.current = isLoading
  }, [isLoading, isLoadingRef])

  useEffect(() => {
    let isCancelled = false

    fetchManualServerOptions()
      .then((options) => {
        if (!isCancelled) {
          setServerOptions(options)
          setServerOptionsLoaded(true)
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setServerOptions(EMPTY_SERVER_OPTIONS)
          setServerOptionsLoaded(true)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [])

  const panelProps = {
    formState: watchedFormState,
    setValue,
    isOpen: isOptionPanelOpen,
    onToggle: toggleOptionPanel,
  }

  return (
    <>
      <TitleBar
        title="番組詳細予約"
        isNavigationOpen={isNavigationOpen}
        navigationControlsId={SHELL_NAVIGATION_DRAWER_ID}
        onNavigationClick={onNavigationClick}
      />
      <form
        className={styles.manualReservePage}
        data-testid="manual-reserve-page"
        data-manual-mode={mode.kind === 'edit' ? 'edit' : 'add'}
        data-time-specified={String(showTimeSpecifiedFields)}
        data-option-panels-open={openOptionPanelIds}
        onSubmit={(event) => {
          // button の disabled は isSubmitBlocked から描画されるが、submit 側の guard は
          // effect 経由で遅れて追従する。有効化された直後の click はその隙間に入り、要求が
          // 送られないまま何も起きない。描画と同じ値をここで見る。
          if (isSubmitBlocked) {
            event.preventDefault()
            return
          }

          void handleSubmit(submit.submitForm)(event)
        }}
      >
        {showLoadingIndicator ? (
          <div
            className={styles.state}
            data-testid="manual-reserve-loading"
            role="status"
            aria-live="polite"
          >
            読み込み中
          </div>
        ) : undefined}
        <FormControlLabel
          className={styles.manualTimeSwitch}
          control={
            <Switch
              checked={watchedFormState.isTimeSpecification}
              disabled={isEditMode}
              slotProps={{ input: { role: 'switch' } }}
              onChange={(event) => setValue('isTimeSpecification', event.target.checked)}
            />
          }
          label="時刻指定"
        />
        {programDetail === null || showTimeSpecifiedFields ? undefined : (
          <ManualProgramInfo program={programDetail} />
        )}
        {showTimeSpecifiedFields ? (
          <ManualTimeSpecifiedFields
            formState={watchedFormState}
            channels={serverOptions.channels}
            disabled={isEditMode}
            setValue={setValue}
          />
        ) : undefined}
        <div className={styles.manualSpacer} aria-hidden="true" />
        <div className={styles.manualOptionsCard}>
          <ManualOptionPanel
            index={0}
            title="オプション"
            isOpen={isOptionPanelOpen(0)}
            onToggle={toggleOptionPanel}
          >
            <FormControlLabel
              control={
                <Checkbox
                  checked={watchedFormState.reserveOption.allowEndLack}
                  onChange={(event) => setValue('reserveOption.allowEndLack', event.target.checked)}
                />
              }
              label="状況に応じて末尾がかけることを許可"
            />
          </ManualOptionPanel>
          <ManualDirectoryPanel {...panelProps} directories={serverOptions.directories} />
          <ManualFileFormatPanel {...panelProps} />
          {isEncodeModeEnabled
            ? ([1, 2, 3] as const).map((slot) => (
                <ManualEncodePanel
                  key={slot}
                  slot={slot}
                  {...panelProps}
                  directories={serverOptions.directories}
                  encodeModes={serverOptions.encodeModes}
                />
              ))
            : undefined}
          {isEncodeModeEnabled ? (
            <ManualOptionPanel
              index={6}
              title="ファイル削除"
              isOpen={isOptionPanelOpen(6)}
              onToggle={toggleOptionPanel}
            >
              <FormControlLabel
                control={
                  <Checkbox
                    checked={watchedFormState.encodeOption.isDeleteOriginalAfterEncode}
                    onChange={(event) =>
                      setValue('encodeOption.isDeleteOriginalAfterEncode', event.target.checked)
                    }
                  />
                }
                label="元ファイルの自動削除"
              />
            </ManualOptionPanel>
          ) : undefined}
          <div className={styles.manualActions}>
            <Button type="button" variant="text" color="error" onClick={submit.cancel}>
              キャンセル
            </Button>
            <Button type="submit" variant="text" aria-label="保存" disabled={isSubmitBlocked}>
              {isEditMode ? '更新' : '追加'}
            </Button>
          </div>
        </div>
      </form>
    </>
  )
}
