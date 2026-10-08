import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
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

  it('[AC 2.16] [AC 2.17] [AC 2.21] runs protect and unprotect actions without direct list refetch after success', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [
          {
            id: 101,
            name: 'Synthetic unlocked',
            isProtected: false,
            isRecording: false,
            videoFiles: [{ id: 201, name: 'synthetic-video-one', size: 1024 }],
          },
          {
            id: 102,
            name: 'Synthetic locked',
            isProtected: true,
            isRecording: false,
            videoFiles: [{ id: 202, name: 'synthetic-video-two', size: 1024 }],
          },
        ],
        total: 2,
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByRole('heading', { name: 'Synthetic unlocked' })
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Synthetic unlocked' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'protect' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('保護に成功')).toBeVisible()
    expect(recordedRepository.protectRecorded).toHaveBeenCalledWith(101)
    expect(recordedRepository.fetchRecorded).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Synthetic locked' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'unprotect' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('保護解除に成功')).toBeVisible()
    expect(recordedRepository.unprotectRecorded).toHaveBeenCalledWith(102)
    expect(recordedRepository.fetchRecorded).toHaveBeenCalledTimes(1)

    vi.mocked(recordedRepository.protectRecorded).mockResolvedValueOnce({
      ok: false,
      error: 'protect-failed',
      message: '保護に失敗',
    })
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Synthetic unlocked' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'protect' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('保護に失敗')).toBeVisible()
    expect(recordedRepository.fetchRecorded).toHaveBeenCalledTimes(1)
  })

  it('[AC 2.23] [AC 2.24] [AC 2.25] [AC 2.26] [AC 2.27] [AC 2.28] deletes recorded items by all files or partial video files and skips zero selection without snackbar', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [
          {
            id: 101,
            name: 'Synthetic delete target',
            isProtected: false,
            isRecording: false,
            videoFiles: [
              { id: 201, name: 'synthetic-video-one', size: 1024 },
              { id: 202, name: 'synthetic-video-two', size: 2048 },
            ],
          },
        ],
        total: 1,
      },
    })

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          deleteRecordedDefaultValue: false,
        }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByRole('heading', { name: 'Synthetic delete target' })
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Synthetic delete target' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }))
    expect(await screen.findByRole('dialog', { name: '録画削除' })).toBeVisible()

    const firstFile = await screen.findByRole('checkbox', { name: 'synthetic-video-one (1.0KB)' })
    expect(firstFile).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(recordedRepository.deleteRecorded).not.toHaveBeenCalled()
    expect(recordedRepository.deleteVideoFile).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Synthetic delete target' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'synthetic-video-one (1.0KB)' }))
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Synthetic delete target を削除')).toBeVisible()
    expect(recordedRepository.deleteVideoFile).toHaveBeenCalledWith(201)
    // The dialog's MUI exit transition starts while fake timers are still active (it was
    // triggered inside the click above); advance past it here so switching to real timers
    // below does not strand its pending onExited timeout.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    vi.useRealTimers()

    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Synthetic delete target' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'synthetic-video-one (1.0KB)' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'synthetic-video-two (2.0KB)' }))
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Synthetic delete target を削除')).toBeVisible()
    expect(recordedRepository.deleteRecorded).toHaveBeenCalledWith(101)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    vi.useRealTimers()

    vi.mocked(recordedRepository.deleteRecorded).mockResolvedValueOnce({
      ok: false,
      error: 'delete-failed',
      message: '削除に失敗',
    })
    fireEvent.click(screen.getByRole('button', { name: '録画メニュー: Synthetic delete target' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'synthetic-video-one (1.0KB)' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'synthetic-video-two (2.0KB)' }))
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Synthetic delete target を削除に失敗')).toBeVisible()
  })

  it('[AC 2.6] [AC 2.7] [AC 2.10] [AC 2.11] [AC 2.12] [AC 2.13] supports edit mode selection and bulk delete feedback', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-page')
    fireEvent.click(screen.getByRole('button', { name: '録画済みメニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択 (0.0B)')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('番組を選択してください。')).toBeVisible()
    vi.useRealTimers()

    fireEvent.click(screen.getAllByTestId('recorded-list-item')[0])
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択 (1.0KB)')
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('2 件選択 (1.0KB)')
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択 (0.0B)')
    fireEvent.click(screen.getAllByTestId('recorded-list-item')[0])
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択 (1.0KB)')
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    expect(await screen.findByText('全て')).toBeVisible()
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('選択した番組を削除しました。')).toBeVisible()
    // v2 parity (5cf2ea383 RecordedState.ts:176-212): the `All` option deletes
    // by video file id via deleteVideoFile, never by calling deleteRecorded for the item.
    expect(recordedRepository.deleteVideoFile).toHaveBeenCalledWith(201)
    expect(recordedRepository.deleteRecorded).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    vi.useRealTimers()

    // Mocking deleteRecorded to fail cannot reproduce a bulk-delete failure here: `All`
    // never calls it. Left as deleteRecorded, the mock would simply never be invoked and the
    // delete would silently succeed, turning this into a false-positive passing test.
    vi.mocked(recordedRepository.deleteVideoFile).mockResolvedValueOnce({
      ok: false,
      error: 'delete-failed',
      message: '削除に失敗',
    })
    fireEvent.click(screen.getByRole('button', { name: '録画済みメニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: '編集' }))
    fireEvent.click(screen.getAllByTestId('recorded-list-item')[0])
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    const confirmBulkDeleteButton = await screen.findByRole('button', { name: '削除' })
    vi.useFakeTimers()
    fireEvent.click(confirmBulkDeleteButton)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('一部番組の削除に失敗しました。')).toBeVisible()
  })

  it('[AC 2.8] [AC 2.30] [AC 2.31] [AC 2.33] runs cleanup in order with minimum one second progress and skips thumbnails on recorded failure', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-page')
    fireEvent.click(screen.getByRole('button', { name: '録画済みメニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'クリーンアップ' }))
    const firstCleanupExecuteButton = await screen.findByRole('button', { name: '実行' })
    const firstCleanupStartedAt = Date.now()
    vi.useFakeTimers()
    fireEvent.click(firstCleanupExecuteButton)
    expect(screen.getByText('クリーンアップ中')).toBeVisible()
    expect(recordedRepository.cleanupRecorded).toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(recordedRepository.cleanupThumbnails).toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.getByText('クリーンアップ完了')).toBeVisible()
    expect(Date.now() - firstCleanupStartedAt).toBeGreaterThanOrEqual(1000)
    // `execute()` calls `onClose()` in this same tick, starting the dialog's MUI exit
    // transition under fake time; advance past it before switching to real timers so the
    // transition's onExited timeout isn't stranded.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250)
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    vi.useRealTimers()

    vi.mocked(recordedRepository.cleanupRecorded).mockResolvedValueOnce({
      ok: false,
      error: 'cleanup-failed',
      message: 'クリーンアップに失敗',
    })
    vi.mocked(recordedRepository.cleanupThumbnails).mockClear()
    fireEvent.click(screen.getByRole('button', { name: '録画済みメニュー' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'クリーンアップ' }))
    const secondCleanupExecuteButton = await screen.findByRole('button', { name: '実行' })
    vi.useFakeTimers()
    fireEvent.click(secondCleanupExecuteButton)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(recordedRepository.cleanupThumbnails).not.toHaveBeenCalled()
    expect(screen.getByText('クリーンアップに失敗')).toBeVisible()
  })
})
