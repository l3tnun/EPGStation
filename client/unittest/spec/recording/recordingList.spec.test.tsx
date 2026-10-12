import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createScrollHistory } from '@/app/scrollHistory'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import {
  SyntheticRealtimeConnection,
  createShellRepository,
  createRecordingRepository,
  findRecordingMenu,
} from './recordingTestKit'

describe('Recording list route lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recording?page=3&timestamp=999')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 1.1] [AC 1.13] renders the recording title and fetches with route settings', async () => {
    const recordingRepository = createRecordingRepository()
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
      recordingLength: 12,
    }

    render(
      <App
        settings={settings}
        apiRepository={createShellRepository()}
        recordingApiRepository={recordingRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(screen.getByTestId('title-bar')).toHaveTextContent('録画中')
    expect(screen.queryByText('読み込み中')).not.toBeInTheDocument()

    const page = await screen.findByTestId('recording-page')
    expect(page).toHaveAttribute('data-recording-total', '50')
    expect(recordingRepository.fetchRecording).toHaveBeenCalledWith({
      isHalfWidth: false,
      limit: 12,
      offset: 24,
      page: 3,
    })
    expect(screen.getByText('Synthetic recording one')).toBeVisible()
    expect(screen.getAllByTestId('recording-list-item')).toHaveLength(2)
  })

  it('[AC 1.32] [AC 1.20] [AC 1.24] navigates to recorded detail on normal item click without menu click propagation', async () => {
    const recordingRepository = createRecordingRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordingRepository}
        recordingApiRepository={recordingRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recording-page')
    fireEvent.click(await findRecordingMenu('Synthetic recording one'))
    expect(screen.getByRole('menuitem', { name: 'rule' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'search' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'protect' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'delete' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'encode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'stop' })).not.toBeInTheDocument()
    expect(window.location.hash).toBe('#/recording?page=3&timestamp=999')

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Synthetic recording one'))
    expectHashRoute('#/recorded/detail/101')
  })

  it('[AC 1.5] [AC 1.7] [AC 1.8] [AC 1.9] [AC 1.10] [AC 1.15] [AC 1.19] supports edit mode selection, select-all toggle, zero-selection snackbar, and bulk video file deletion', async () => {
    const recordingRepository = createRecordingRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordingRepository}
        recordingApiRepository={recordingRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recording-page')
    fireEvent.click(screen.getByRole('button', { name: '録画中を編集' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択')
    expect(screen.queryByRole('button', { name: /録画メニュー:/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /を選択/ })).not.toBeInTheDocument()

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('番組を選択してください。')).toBeVisible()
    vi.useRealTimers()

    fireEvent.click(screen.getByText('Synthetic recording one'))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('2 件選択')
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('0 件選択')

    fireEvent.click(screen.getByText('Synthetic recording one'))
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    expect(await screen.findByRole('dialog')).toBeVisible()
    expect(screen.queryByRole('listbox', { name: '削除対象' })).not.toBeInTheDocument()
    expect(screen.getByText('選択した 1 件の番組を削除しますか。')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await waitFor(() => {
      expect(recordingRepository.deleteVideoFile).toHaveBeenCalledTimes(2)
    })
    expect(recordingRepository.deleteRecorded).not.toHaveBeenCalled()
    expect(recordingRepository.deleteVideoFile).toHaveBeenNthCalledWith(1, 201)
    expect(recordingRepository.deleteVideoFile).toHaveBeenNthCalledWith(2, 202)
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('選択した番組を削除しました。')).toBeVisible()
    vi.useRealTimers()
  })

  it('[AC 1.9] [AC 1.10] continues bulk video file deletion after a failed DELETE and reports partial failure', async () => {
    const recordingRepository = createRecordingRepository()
    vi.mocked(recordingRepository.deleteVideoFile)
      .mockResolvedValueOnce({
        ok: false as const,
        error: 'delete-failed',
        message: '削除に失敗',
      })
      .mockResolvedValueOnce({ ok: true as const, value: undefined })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordingRepository}
        recordingApiRepository={recordingRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recording-page')
    fireEvent.click(screen.getByRole('button', { name: '録画中を編集' }))
    fireEvent.click(screen.getByText('Synthetic recording one'))
    fireEvent.click(screen.getByRole('button', { name: '選択項目を削除' }))
    fireEvent.click(await screen.findByRole('button', { name: '削除' }))

    await waitFor(() => {
      expect(recordingRepository.deleteVideoFile).toHaveBeenCalledTimes(2)
    })
    expect(recordingRepository.deleteVideoFile).toHaveBeenNthCalledWith(1, 201)
    expect(recordingRepository.deleteVideoFile).toHaveBeenNthCalledWith(2, 202)
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('一部番組の削除に失敗しました。')).toBeVisible()
    vi.useRealTimers()
  })

  it('[AC 1.2] [AC 1.11] [AC 1.30] clears route data on query changes and reports Socket.IO refetch failure while preserving rows', async () => {
    const recordingRepository = createRecordingRepository()
    const connection = new SyntheticRealtimeConnection()
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
    const emitDoneGetData = vi.spyOn(scrollHistory, 'emitDoneGetData')

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordingApiRepository={recordingRepository}
        scrollHistory={scrollHistory}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recording-page')
    vi.mocked(recordingRepository.fetchRecording).mockResolvedValueOnce({
      ok: false,
      error: 'recording-fetch-failed',
      message: '録画データ取得に失敗',
    })

    vi.useFakeTimers()
    act(() => {
      connection.emit('updateStatus')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByText('録画データ取得に失敗')).toBeVisible()
    expect(recordingRepository.fetchRecording).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Synthetic recording one')).toBeVisible()
    expect(emitDoneGetData).toHaveBeenCalledTimes(1)
    vi.useRealTimers()

    vi.mocked(recordingRepository.fetchRecording).mockImplementationOnce(
      () => new Promise(() => undefined),
    )
    act(() => {
      window.location.hash = '#/recording?page=4'
    })
    await waitFor(() => {
      expect(screen.queryByTestId('recording-page')).not.toBeInTheDocument()
    })
  })

  it('[AC 1.3] preserves visible edit selection across Socket.IO updateStatus refetch', async () => {
    const recordingRepository = createRecordingRepository()
    const connection = new SyntheticRealtimeConnection()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordingApiRepository={recordingRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recording-page')
    fireEvent.click(screen.getByRole('button', { name: '録画中を編集' }))
    fireEvent.click(screen.getByText('Synthetic recording one'))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')

    act(() => {
      connection.emit('updateStatus')
    })

    await waitFor(() => {
      expect(recordingRepository.fetchRecording).toHaveBeenCalledTimes(2)
    })
    expect(screen.getAllByTestId('recording-list-item')[0]).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
  })
})
