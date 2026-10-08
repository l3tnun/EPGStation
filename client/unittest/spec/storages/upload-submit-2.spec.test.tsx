import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import type { RecordedApiRepository } from '@/features/recorded/recordedApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { changeSettingsSelect, createShellRepository } from '../recorded/recordedSpecHelpers'
import { createRecordedRepository } from '../recorded/recordedSpecRepository'
import {
  createDeferred,
  uploadProgramNameInput,
  uploadVideoBlock,
  fillRequiredUploadFields,
  warmUpRecordedUploadAppRender,
} from './recordedUploadSpecSupport'

describe('Recorded upload route and form state', () => {
  beforeAll(async () => {
    await warmUpRecordedUploadAppRender()
  })

  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/upload')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.15] rolls back created metadata when leaving the route while video upload is pending', async () => {
    const recordedRepository = createRecordedRepository()
    const uploadResult =
      createDeferred<Awaited<ReturnType<RecordedApiRepository['uploadVideoFile']>>>()
    vi.mocked(recordedRepository.uploadVideoFile).mockReturnValueOnce(uploadResult.promise)

    render(
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

    await screen.findByTestId('recorded-upload-page')
    await fillRequiredUploadFields()
    fireEvent.click(screen.getByRole('button', { name: 'アップロード' }))
    await waitFor(() => {
      expect(recordedRepository.uploadVideoFile).toHaveBeenCalledTimes(1)
    })

    act(() => {
      window.location.hash = '#/'
    })
    await waitFor(() => {
      expect(screen.queryByTestId('recorded-upload-page')).not.toBeInTheDocument()
    })
    uploadResult.resolve({ ok: true, value: undefined })

    await waitFor(() => {
      expect(recordedRepository.deleteRecorded).toHaveBeenCalledWith(901)
    })
    expect(screen.queryByText('アップロード完了')).not.toBeInTheDocument()
    expect(screen.queryByText('アップロードに失敗')).not.toBeInTheDocument()
  })

  it('[AC 3.6] rolls back created recorded metadata when a video upload fails and reports the original upload failure', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.uploadVideoFile).mockResolvedValueOnce({
      ok: false,
      error: 'video-upload-failed',
      message: 'video failed',
    })
    vi.mocked(recordedRepository.deleteRecorded).mockResolvedValueOnce({
      ok: false,
      error: 'delete-failed',
      message: 'rollback failed',
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
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

    await screen.findByTestId('recorded-upload-page')
    await changeSettingsSelect(/放送局※?/, /Synthetic .*channel/)
    fireEvent.change(screen.getByLabelText('開始'), { target: { value: '2026-05-05T12:30' } })
    fireEvent.change(screen.getByLabelText('長さ(分)'), { target: { value: '30' } })
    fireEvent.change(uploadProgramNameInput(), { target: { value: 'Synthetic program' } })
    fireEvent.change(uploadVideoBlock(0).getByLabelText('name'), {
      target: { value: 'Main upload' },
    })
    await changeSettingsSelect(/file type/, 'ts', uploadVideoBlock(0))
    fireEvent.change(uploadVideoBlock(0).getByLabelText('video file'), {
      target: { files: [new File(['first'], 'main.ts')] },
    })

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'アップロード' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('アップロードに失敗')).toBeVisible()
    vi.useRealTimers()
    expect(recordedRepository.createRecorded).toHaveBeenCalledTimes(1)
    expect(recordedRepository.deleteRecorded).toHaveBeenCalledWith(901)
    expect(consoleError).toHaveBeenCalled()
    expect(screen.queryByText('rollback failed')).not.toBeInTheDocument()
  })
})
