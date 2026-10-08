import { useEffect, useRef, useState } from 'react'
import type { ShellSnackbarState } from '@/app/AppShell'
import type { RecordedApiRepository } from '../../../recorded/recordedApi'
import {
  buildRecordedUploadMetadataBody,
  validateRecordedUploadForm,
} from '../../../recorded/recordedRequests'
import type { RecordedUploadFormState } from '../../../recorded/recordedRequests'
import { openSnackbar } from '../../../recorded/lib/recordedSnackbar'
import {
  createValidatedRequiredState,
  createValidatedVideoUploadRequests,
} from '../lib/uploadFormat'

const UPLOAD_DIALOG_REMOUNT_DELAY_MS = 100

const RECORDED_UPLOAD_PATH = '/recorded/upload'

export interface UseRecordedUploadRunInput {
  apiRepository: RecordedApiRepository
  onSnackbar: (snackbar: ShellSnackbarState) => void
  navigate: (path: string) => void
  suppressRouteSnackbarClose: (count: number) => void
}

export function useRecordedUploadRun({
  apiRepository,
  onSnackbar,
  navigate,
  suppressRouteSnackbarClose,
}: UseRecordedUploadRunInput) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUploadingDialogOpen, setIsUploadingDialogOpen] = useState(false)
  const [isUploadingDialogMounted, setIsUploadingDialogMounted] = useState(false)
  const uploadDialogCloseTimer = useRef<number | null>(null)
  const isSubmittingRef = useRef(false)
  const isMountedRef = useRef(true)
  const uploadRunId = useRef(0)

  useEffect(() => {
    isMountedRef.current = true

    return () => {
      isMountedRef.current = false
      uploadRunId.current += 1
      isSubmittingRef.current = false
      if (uploadDialogCloseTimer.current !== null) {
        window.clearTimeout(uploadDialogCloseTimer.current)
        uploadDialogCloseTimer.current = null
      }
    }
  }, [])

  const isActiveUploadRun = (runId: number) => isMountedRef.current && uploadRunId.current === runId

  // openUploadingDialog, closeUploadingDialog, and finishUploadRun are only called while the
  // current run is active: each call site checks isActiveUploadRun (or has just assigned the
  // run id) synchronously before calling in. The close-remount timer is cleared synchronously by
  // the transitions that could invalidate it (a new submit, or unmount).
  const openUploadingDialog = () => {
    if (uploadDialogCloseTimer.current !== null) {
      window.clearTimeout(uploadDialogCloseTimer.current)
      uploadDialogCloseTimer.current = null
    }
    setIsUploadingDialogMounted(true)
    setIsUploadingDialogOpen(true)
  }

  const closeUploadingDialog = () => {
    setIsUploadingDialogOpen(false)
    uploadDialogCloseTimer.current = window.setTimeout(() => {
      setIsUploadingDialogMounted(false)
      uploadDialogCloseTimer.current = null
    }, UPLOAD_DIALOG_REMOUNT_DELAY_MS)
  }

  const finishUploadRun = () => {
    isSubmittingRef.current = false
    setIsSubmitting(false)
    closeUploadingDialog()
  }

  const rollbackCreatedRecorded = async (recordedId: number) => {
    const rollbackResult = await apiRepository.deleteRecorded(recordedId)

    if (!rollbackResult.ok) {
      console.error(rollbackResult.message)
    }
  }

  const submit = async (nextFormState: RecordedUploadFormState) => {
    if (isSubmittingRef.current) {
      return
    }

    if (
      !validateRecordedUploadForm(nextFormState) ||
      !createValidatedRequiredState(nextFormState).success
    ) {
      openSnackbar(onSnackbar, '入力内容に問題があります。', 'error')
      return
    }

    const runId = uploadRunId.current + 1
    uploadRunId.current = runId
    isSubmittingRef.current = true
    setIsSubmitting(true)
    openUploadingDialog()

    const metadataResult = await apiRepository.createRecorded(
      buildRecordedUploadMetadataBody(nextFormState),
    )

    if (!metadataResult.ok) {
      if (!isActiveUploadRun(runId)) {
        return
      }
      finishUploadRun()
      openSnackbar(onSnackbar, 'アップロードに失敗', 'error')
      return
    }

    const recordedId = metadataResult.value.recordedId
    if (!isActiveUploadRun(runId)) {
      await rollbackCreatedRecorded(recordedId)
      return
    }

    const uploadRequests = createValidatedVideoUploadRequests({
      recordedId,
      videoBlocks: nextFormState.videoBlocks,
    })

    for (const request of uploadRequests) {
      const uploadResult = await apiRepository.uploadVideoFile(request)

      if (!isActiveUploadRun(runId)) {
        await rollbackCreatedRecorded(recordedId)
        return
      }

      if (!uploadResult.ok) {
        await rollbackCreatedRecorded(recordedId)
        if (!isActiveUploadRun(runId)) {
          return
        }
        finishUploadRun()
        openSnackbar(onSnackbar, 'アップロードに失敗', 'error')
        return
      }
    }

    finishUploadRun()
    openSnackbar(onSnackbar, 'アップロード完了', 'success')
    // Requirement 3.13: keep current form values but move the route to a fresh
    // `?timestamp=<number>`. This feature does not own timestamp assignment itself (see
    // frontend-storages-upload design.md's route boundary contract note) - dropping the query
    // here just clears the existing `timestamp`, and the frontend-app-shell route boundary
    // (AppShellContent) replaces it with a newly generated one on the next render.
    // `useRouteScrollRestoration` closes the active snackbar on every route-key change, which
    // would otherwise immediately dismiss the "アップロード完了" snackbar shown above; suppress
    // that one upcoming close the same way `useRealtimeConnection`'s reconnect-restore does.
    suppressRouteSnackbarClose(1)
    navigate(RECORDED_UPLOAD_PATH)
  }

  return { isSubmitting, isUploadingDialogOpen, isUploadingDialogMounted, submit }
}
