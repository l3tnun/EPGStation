import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useRecordedUploadRun } from '@/features/storages/upload/hooks/useRecordedUploadRun'
import type { RecordedApiRepository } from '@/features/recorded/recordedApi'
import type { RecordedUploadFormState } from '@/features/recorded/recordedRequests'

function createFormState(
  overrides: Partial<RecordedUploadFormState> = {},
): RecordedUploadFormState {
  return {
    channelId: 1,
    genre: null,
    subGenre: null,
    ruleId: null,
    startAt: 1_700_000_000_000,
    duration: 30,
    name: 'Synthetic name',
    description: null,
    extended: null,
    videoBlocks: [
      {
        id: 0,
        viewName: 'Main upload',
        fileType: 'ts',
        parentDirectoryName: 'archive-root',
        subDirectory: null,
        file: new File(['synthetic'], 'synthetic.ts'),
      },
    ],
    ...overrides,
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })

  return { promise, resolve }
}

function createRepository(): RecordedApiRepository {
  return {
    fetchRecordedOptions: vi.fn(),
    fetchRuleKeywords: vi.fn(),
    createRecorded: vi.fn(),
    uploadVideoFile: vi.fn(),
    deleteRecorded: vi.fn(),
  } as unknown as RecordedApiRepository
}

describe('useRecordedUploadRun implementation edges', () => {
  it('ignores a concurrent second submit call while the first one is still in flight', async () => {
    const apiRepository = createRepository()
    const metadataResult =
      createDeferred<Awaited<ReturnType<RecordedApiRepository['createRecorded']>>>()
    vi.mocked(apiRepository.createRecorded).mockReturnValueOnce(metadataResult.promise)
    vi.mocked(apiRepository.uploadVideoFile).mockResolvedValue({ ok: true, value: undefined })
    const onSnackbar = vi.fn()

    const { result } = renderHook(() =>
      useRecordedUploadRun({
        apiRepository,
        onSnackbar,
        navigate: vi.fn(),
        suppressRouteSnackbarClose: vi.fn(),
      }),
    )

    act(() => {
      void result.current.submit(createFormState())
      void result.current.submit(createFormState())
    })

    expect(apiRepository.createRecorded).toHaveBeenCalledTimes(1)

    await act(async () => {
      metadataResult.resolve({ ok: true, value: { recordedId: 1 } })
      await Promise.resolve()
    })
  })

  it('suppresses the route-change snackbar close before navigating to the upload route on a successful upload', async () => {
    const apiRepository = createRepository()
    vi.mocked(apiRepository.createRecorded).mockResolvedValue({
      ok: true,
      value: { recordedId: 1 },
    })
    vi.mocked(apiRepository.uploadVideoFile).mockResolvedValue({ ok: true, value: undefined })
    const onSnackbar = vi.fn()
    const navigate = vi.fn()
    const suppressRouteSnackbarClose = vi.fn()

    const { result } = renderHook(() =>
      useRecordedUploadRun({ apiRepository, onSnackbar, navigate, suppressRouteSnackbarClose }),
    )

    await act(async () => {
      await result.current.submit(createFormState())
    })

    expect(suppressRouteSnackbarClose).toHaveBeenCalledTimes(1)
    expect(suppressRouteSnackbarClose).toHaveBeenCalledWith(1)
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/recorded/upload')
    // suppressRouteSnackbarClose must take effect before navigate triggers the route-change
    // snackbar-close check, or the just-shown success snackbar would be closed immediately.
    expect(suppressRouteSnackbarClose.mock.invocationCallOrder[0]).toBeLessThan(
      navigate.mock.invocationCallOrder[0]!,
    )
  })

  it('clears a pending dialog remount timer when a new upload starts before it fires', async () => {
    vi.useFakeTimers()
    try {
      const apiRepository = createRepository()
      vi.mocked(apiRepository.createRecorded).mockResolvedValue({
        ok: true,
        value: { recordedId: 1 },
      })
      vi.mocked(apiRepository.uploadVideoFile).mockResolvedValue({ ok: true, value: undefined })
      const onSnackbar = vi.fn()

      const { result } = renderHook(() =>
        useRecordedUploadRun({
          apiRepository,
          onSnackbar,
          navigate: vi.fn(),
          suppressRouteSnackbarClose: vi.fn(),
        }),
      )

      await act(async () => {
        await result.current.submit(createFormState())
      })
      expect(result.current.isUploadingDialogOpen).toBe(false)
      expect(result.current.isUploadingDialogMounted).toBe(true)

      await act(async () => {
        await result.current.submit(createFormState())
      })
      expect(result.current.isUploadingDialogMounted).toBe(true)

      await act(async () => {
        vi.advanceTimersByTime(150)
      })
      expect(result.current.isUploadingDialogMounted).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('remounts the uploading dialog after the v2 Util.sleep(100) close-animation delay, not later', async () => {
    // Source: v2 5cf2ea383 client/src/components/recorded/upload/RecordedUploadingDialog.vue:40
    // await Util.sleep(100) before removing/remounting the dialog element.
    vi.useFakeTimers()
    try {
      const apiRepository = createRepository()
      vi.mocked(apiRepository.createRecorded).mockResolvedValue({
        ok: true,
        value: { recordedId: 1 },
      })
      vi.mocked(apiRepository.uploadVideoFile).mockResolvedValue({ ok: true, value: undefined })
      const onSnackbar = vi.fn()

      const { result } = renderHook(() =>
        useRecordedUploadRun({
          apiRepository,
          onSnackbar,
          navigate: vi.fn(),
          suppressRouteSnackbarClose: vi.fn(),
        }),
      )

      await act(async () => {
        await result.current.submit(createFormState())
      })
      expect(result.current.isUploadingDialogMounted).toBe(true)

      await act(async () => {
        vi.advanceTimersByTime(99)
      })
      expect(result.current.isUploadingDialogMounted).toBe(true)

      await act(async () => {
        vi.advanceTimersByTime(1)
      })
      expect(result.current.isUploadingDialogMounted).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not finish or notify when the component unmounts while metadata creation fails', async () => {
    const apiRepository = createRepository()
    const metadataResult =
      createDeferred<Awaited<ReturnType<RecordedApiRepository['createRecorded']>>>()
    vi.mocked(apiRepository.createRecorded).mockReturnValueOnce(metadataResult.promise)
    const onSnackbar = vi.fn()
    const navigate = vi.fn()
    const suppressRouteSnackbarClose = vi.fn()

    const { result, unmount } = renderHook(() =>
      useRecordedUploadRun({ apiRepository, onSnackbar, navigate, suppressRouteSnackbarClose }),
    )

    let submitPromise!: Promise<void>
    act(() => {
      submitPromise = result.current.submit(createFormState())
    })

    unmount()

    metadataResult.resolve({
      ok: false,
      error: 'recorded-create-failed',
      message: 'create failed',
    })
    await submitPromise

    expect(onSnackbar).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(suppressRouteSnackbarClose).not.toHaveBeenCalled()
  })

  it('does not finish or notify when the component unmounts while a failed upload is rolled back', async () => {
    const apiRepository = createRepository()
    vi.mocked(apiRepository.createRecorded).mockResolvedValueOnce({
      ok: true,
      value: { recordedId: 5 },
    })
    vi.mocked(apiRepository.uploadVideoFile).mockResolvedValueOnce({
      ok: false,
      error: 'video-upload-failed',
      message: 'upload failed',
    })
    const rollbackResult =
      createDeferred<Awaited<ReturnType<RecordedApiRepository['deleteRecorded']>>>()
    vi.mocked(apiRepository.deleteRecorded).mockReturnValueOnce(rollbackResult.promise)
    const onSnackbar = vi.fn()
    const navigate = vi.fn()
    const suppressRouteSnackbarClose = vi.fn()

    const { result, unmount } = renderHook(() =>
      useRecordedUploadRun({ apiRepository, onSnackbar, navigate, suppressRouteSnackbarClose }),
    )

    let submitPromise!: Promise<void>
    await act(async () => {
      submitPromise = result.current.submit(
        createFormState({
          videoBlocks: [
            {
              id: 0,
              viewName: 'Main upload',
              fileType: 'ts',
              parentDirectoryName: 'archive-root',
              subDirectory: null,
              file: new File(['synthetic'], 'synthetic.ts'),
            },
          ],
        }),
      )
      await waitFor(() => {
        expect(apiRepository.uploadVideoFile).toHaveBeenCalledTimes(1)
      })
    })

    unmount()

    rollbackResult.resolve({ ok: true, value: undefined })
    await submitPromise

    expect(onSnackbar).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(suppressRouteSnackbarClose).not.toHaveBeenCalled()
  })
})
