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
} from './recordingTestKit'

describe('Recording selection, pagination and fetch failures', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recording')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 1.3] [AC 1.6] [AC 1.15] drops selected ids that disappear on refetch and toggles a row off again', async () => {
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
    fireEvent.click(screen.getByText('Synthetic recording two'))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('2 件選択')
    fireEvent.click(screen.getByText('Synthetic recording two'))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
    fireEvent.click(screen.getByRole('button', { name: 'すべて選択' }))
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('2 件選択')

    vi.mocked(recordingRepository.fetchRecording).mockResolvedValueOnce({
      ok: true,
      value: {
        total: 1,
        records: [{ id: 102, name: 'Synthetic recording two', isRecording: true }],
      },
    })
    act(() => {
      connection.emit('updateStatus')
    })
    await waitFor(() => {
      expect(screen.getByTestId('recording-page')).toHaveAttribute('data-recording-total', '1')
    })
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
    expect(screen.getByTestId('recording-list-item')).toHaveAttribute('data-selected', 'true')

    vi.mocked(recordingRepository.fetchRecording).mockResolvedValueOnce({
      ok: true,
      value: {
        total: 2,
        records: [
          { id: 102, name: 'Synthetic recording two', isRecording: true },
          { id: 103, name: 'Synthetic recording three', isRecording: true },
        ],
      },
    })
    act(() => {
      connection.emit('updateStatus')
    })
    await waitFor(() => {
      expect(screen.getByTestId('recording-page')).toHaveAttribute('data-recording-total', '2')
    })
    expect(screen.getByTestId('edit-title-bar')).toHaveTextContent('1 件選択')
  })

  it('[AC 1.13] navigates to another page through the pagination and records the scroll position', async () => {
    const recordingRepository = createRecordingRepository()
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
    const updateHistoryPosition = vi.spyOn(scrollHistory, 'updateHistoryPosition')

    render(
      <App
        settings={{ ...new DefaultSettingsFactory().create(), recordingLength: 12 }}
        apiRepository={createShellRepository()}
        recordingApiRepository={recordingRepository}
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recording-page')
    fireEvent.click(screen.getByRole('button', { name: '2 ページ' }))
    await waitFor(() => {
      expectHashRoute('/recording?page=2')
    })
    expect(updateHistoryPosition).toHaveBeenCalled()
    await waitFor(() => {
      expect(recordingRepository.fetchRecording).toHaveBeenLastCalledWith({
        isHalfWidth: true,
        limit: 12,
        offset: 12,
        page: 2,
      })
    })
  })

  it('[AC 1.11] [AC 1.12] shows the error state and snackbar when the route fetch fails', async () => {
    const recordingRepository = createRecordingRepository()
    vi.mocked(recordingRepository.fetchRecording).mockResolvedValueOnce({
      ok: false,
      error: 'recording-fetch-failed',
      message: '録画データ取得に失敗',
    })

    vi.useFakeTimers()
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordingApiRepository={recordingRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('録画データ取得に失敗')).toBeVisible()
    expect(screen.queryByTestId('recording-page')).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    vi.useRealTimers()
  })
})
