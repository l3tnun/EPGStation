import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded list actions', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.18] [AC 2.19] [AC 2.20] [AC 2.21] [AC 3.17] [AC 3.19] [AC 3.29] adds and stops encode with request body, storage save, snackbar, and refetch-driven update', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [
          {
            id: 101,
            name: 'Synthetic encode target',
            isProtected: false,
            isRecording: false,
            isEncoding: true,
            videoFiles: [{ id: 201, name: 'synthetic-video-one', size: 1024 }],
          },
        ],
        total: 1,
      },
    })
    localStorage.setItem(
      'AddEncodeSeting',
      JSON.stringify({
        encodeMode: 'stored-mode',
        parentDirectory: 'stored-parent',
        isSaveSameDirectory: true,
        removeOriginal: true,
      }),
    )

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
            encodeModes: ['stored-mode', 'next-mode'],
            isEncodeEnabled: true,
            recordedDirectories: ['stored-parent', 'next-parent'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByRole('heading', { name: 'Synthetic encode target' })
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Synthetic encode target' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'encode' }))
    expect(await screen.findByRole('combobox', { name: 'preset' })).toHaveTextContent('stored-mode')
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(recordedRepository.addEncode).toHaveBeenCalledWith({
      recordedId: 101,
      sourceVideoFileId: 201,
      mode: 'stored-mode',
      removeOriginal: true,
      isSaveSameDirectory: true,
    })
    expect(screen.getByText('エンコード追加')).toBeVisible()
    expect(JSON.parse(localStorage.getItem('AddEncodeSeting') ?? '{}')).toStrictEqual({
      encodeMode: 'stored-mode',
      parentDirectory: 'stored-parent',
      isSaveSameDirectory: true,
      removeOriginal: true,
    })
    // `onClose()` above starts the dialog's MUI exit transition under fake time; advance past
    // it before switching to real timers so the transition's onExited timeout isn't stranded.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    vi.useRealTimers()

    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Synthetic encode target' }))
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('menuitem', { name: 'stop' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('エンコード停止')).toBeVisible()
    vi.useRealTimers()
    await waitFor(() => {
      expect(recordedRepository.fetchRecorded).toHaveBeenCalledTimes(2)
    })

    vi.mocked(recordedRepository.stopEncode).mockResolvedValueOnce({
      ok: false,
      error: 'stop-encode-failed',
      message: 'エンコード停止に失敗',
    })
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Synthetic encode target' }))
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('menuitem', { name: 'stop' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('エンコード停止に失敗')).toBeVisible()
  })

  it('[AC 2.19] [AC 3.17] [AC 3.19] uses the first recorded directory for add encode when storage has no valid parent directory', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [
          {
            id: 101,
            name: 'Synthetic encode target',
            isProtected: false,
            isRecording: false,
            videoFiles: [{ id: 201, name: 'synthetic-video-one', size: 1024 }],
          },
        ],
        total: 1,
      },
    })

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
            encodeModes: ['default-mode'],
            isEncodeEnabled: true,
            recordedDirectories: ['archive-root', 'backup-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByRole('heading', { name: 'Synthetic encode target' })
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Synthetic encode target' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'encode' }))
    expect(await screen.findByRole('combobox', { name: 'recorded' })).toHaveTextContent(
      'archive-root',
    )
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '追加' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(recordedRepository.addEncode).toHaveBeenCalledWith({
      recordedId: 101,
      sourceVideoFileId: 201,
      mode: 'default-mode',
      removeOriginal: false,
      isSaveSameDirectory: false,
      parentDir: 'archive-root',
    })
    expect(screen.getByText('エンコード追加')).toBeVisible()
  })
})
