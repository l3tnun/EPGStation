import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import type { RecordedApiRepository } from '@/features/recorded/recordedApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository } from '../recorded/recordedSpecHelpers'
import { createRecordedRepository } from '../recorded/recordedSpecRepository'
import {
  createDeferred,
  fillRequiredUploadFields,
  warmUpRecordedUploadAppRender,
} from './recordedUploadSpecSupport'

function renderUploadPage(recordedRepository: RecordedApiRepository) {
  return render(
    <App
      settings={new DefaultSettingsFactory().create()}
      apiRepository={createShellRepository()}
      recordedApiRepository={recordedRepository}
      navigationConfig={
        {
          status: 'loaded',
          liveStreamEnabled: false,
          enabledBroadcastWaves: [],
          recordedDirectories: ['archive-root'],
        } as ServerConfigNavigationState
      }
      osPrefersDark={false}
      viewportWidth={1440}
      initialDrawerState="none"
    />,
  )
}

// Flushes the microtask queue a few times so mocked (already-resolved) repository promises
// awaited inside submit() settle, without relying on real-time polling helpers that do not
// mix with fake timers.
async function flushMicrotasks(times = 4) {
  await act(async () => {
    for (let i = 0; i < times; i += 1) {
      await Promise.resolve()
    }
  })
}

describe('useRecordedUploadRun timing and race guards', () => {
  beforeAll(async () => {
    await warmUpRecordedUploadAppRender()
  })

  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/upload')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // [AC 3.12] (below) drives two full submit cycles and is this file's most expensive test.
  // Whichever test runs first in a freshly loaded test file absorbs a one-time environment
  // warm-up cost (first jsdom/module/App render in this worker) on top of its own intrinsic
  // cost; measured standalone this added roughly 1-1.5s regardless of which test paid it. AC
  // 3.14 below is a single-submit-cycle test with much more margin to spare, so it is ordered
  // first to absorb that one-time cost instead of AC 3.12 - this does not change what either
  // test verifies, only which one happens to run first.
  it('[AC 3.14] does not warn or throw when the close-remount timer fires after the page unmounts', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const recordedRepository = createRecordedRepository()
    const { unmount } = renderUploadPage(recordedRepository)

    await screen.findByTestId('recorded-upload-page')
    await fillRequiredUploadFields()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      fireEvent.click(screen.getByRole('button', { name: 'アップロード' }))
      // Flush enough microtask ticks for the whole submit sequence (metadata create, then the
      // single video upload) to settle so finishUploadRun schedules the close-remount timer
      // before the page unmounts.
      await flushMicrotasks(10)
      expect(recordedRepository.uploadVideoFile).toHaveBeenCalledTimes(1)

      unmount()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(150)
      })
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('[AC 3.12] cancels the pending close-remount timer when a new upload starts before it fires', async () => {
    const recordedRepository = createRecordedRepository()
    renderUploadPage(recordedRepository)

    await screen.findByTestId('recorded-upload-page')
    await fillRequiredUploadFields()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      fireEvent.click(screen.getByRole('button', { name: 'アップロード' }))
      await flushMicrotasks()
      expect(screen.getByRole('dialog', { name: 'アップロード中' })).toBeInTheDocument()

      // Restart the upload while the first run's close-remount timer is still pending: this
      // must clear the stale timer instead of letting it tear down the freshly reopened dialog.
      fireEvent.click(screen.getByRole('button', { name: 'アップロード', hidden: true }))
      await flushMicrotasks()
      expect(recordedRepository.createRecorded).toHaveBeenCalledTimes(2)
      expect(screen.getByRole('dialog', { name: 'アップロード中' })).toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(150)
      })
      expect(screen.queryByRole('dialog', { name: 'アップロード中' })).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('[AC 3.1] ignores a second synchronous form submission while the first is still in flight', async () => {
    const recordedRepository = createRecordedRepository()
    const metadataResult =
      createDeferred<Awaited<ReturnType<RecordedApiRepository['createRecorded']>>>()
    vi.mocked(recordedRepository.createRecorded).mockReturnValueOnce(metadataResult.promise)
    renderUploadPage(recordedRepository)

    await screen.findByTestId('recorded-upload-page')
    await fillRequiredUploadFields()
    const form = screen.getByTestId('recorded-upload-page')

    act(() => {
      fireEvent.submit(form)
      fireEvent.submit(form)
    })

    metadataResult.resolve({ ok: true, value: { recordedId: 903 } })
    await waitFor(() => {
      expect(screen.queryByText('アップロード完了')).toBeVisible()
    })
    expect(recordedRepository.createRecorded).toHaveBeenCalledTimes(1)
  })

  it('[AC 3.14] skips rollback and does not warn when the page unmounts before a failed metadata create resolves', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const recordedRepository = createRecordedRepository()
    const metadataResult =
      createDeferred<Awaited<ReturnType<RecordedApiRepository['createRecorded']>>>()
    vi.mocked(recordedRepository.createRecorded).mockReturnValueOnce(metadataResult.promise)
    const { unmount } = renderUploadPage(recordedRepository)

    await screen.findByTestId('recorded-upload-page')
    await fillRequiredUploadFields()
    fireEvent.click(screen.getByRole('button', { name: 'アップロード' }))
    await waitFor(() => {
      expect(recordedRepository.createRecorded).toHaveBeenCalledTimes(1)
    })

    unmount()
    await act(async () => {
      metadataResult.resolve({
        ok: false,
        error: 'recorded-create-failed',
        message: 'metadata failed',
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(recordedRepository.deleteRecorded).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('[AC 3.14] skips the post-rollback UI update when the page unmounts while an upload-failure rollback is pending', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.uploadVideoFile).mockResolvedValueOnce({
      ok: false,
      error: 'video-upload-failed',
      message: 'video failed',
    })
    const rollbackResult =
      createDeferred<Awaited<ReturnType<RecordedApiRepository['deleteRecorded']>>>()
    vi.mocked(recordedRepository.deleteRecorded).mockReturnValueOnce(rollbackResult.promise)
    const { unmount } = renderUploadPage(recordedRepository)

    await screen.findByTestId('recorded-upload-page')
    await fillRequiredUploadFields()
    fireEvent.click(screen.getByRole('button', { name: 'アップロード' }))
    await waitFor(() => {
      expect(recordedRepository.uploadVideoFile).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(recordedRepository.deleteRecorded).toHaveBeenCalledTimes(1)
    })

    unmount()
    await act(async () => {
      rollbackResult.resolve({ ok: true, value: undefined })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(consoleError).not.toHaveBeenCalled()
  })
})
