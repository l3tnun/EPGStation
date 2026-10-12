import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createScrollHistory } from '@/app/scrollHistory'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  SyntheticRealtimeConnection,
  changeSettingsSelect,
  createShellRepository,
} from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded list route lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(
      null,
      '',
      '/#/recorded?page=3&keyword=alpha&ruleId=0&channelId=34&genre=5&hasOriginalFile=true&timestamp=999',
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 1.6] updates only the page query while preserving filters', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [
          {
            id: 101,
            name: 'Synthetic recorded one',
            description: 'Synthetic description',
          },
        ],
        total: 100,
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

    await screen.findByRole('button', { name: '次のページ' })
    fireEvent.click(screen.getByRole('button', { name: '次のページ' }))

    await waitFor(() => {
      expect(window.location.hash).toContain('keyword=alpha')
      expect(window.location.hash).toContain('ruleId=0')
      expect(window.location.hash).not.toContain('timestamp=999')
      expect(recordedRepository.fetchRecorded).toHaveBeenCalledWith(
        expect.objectContaining({ page: 4, offset: 72 }),
      )
    })
  })

  it('[AC 1.11] renders no list content or empty copy for zero items and emits scroll restoration done', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [],
        total: 0,
      },
    })
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
    const emitDoneGetData = vi.spyOn(scrollHistory, 'emitDoneGetData')

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitFor(() => {
      expect(emitDoneGetData).toHaveBeenCalled()
    })
    expect(screen.getByTestId('recorded-page')).toHaveAttribute('data-recorded-total', '0')
    expect(screen.queryAllByTestId('recorded-list-item')).toHaveLength(0)
    expect(screen.queryByText(/empty/i)).not.toBeInTheDocument()
  })

  it('[AC 1.12] uses timestamp as a route refresh trigger without exposing it to the request', async () => {
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

    act(() => {
      window.location.hash =
        '#/recorded?page=3&keyword=alpha&ruleId=0&channelId=34&genre=5&hasOriginalFile=true&timestamp=1000'
    })

    await waitFor(() => {
      expect(recordedRepository.fetchRecorded).toHaveBeenCalledTimes(2)
    })
    expect(recordedRepository.fetchRecorded).toHaveBeenLastCalledWith({
      isHalfWidth: true,
      limit: 24,
      offset: 48,
      page: 3,
      keyword: 'alpha',
      ruleId: 0,
      channelId: 34,
      genre: 5,
      hasOriginalFile: true,
    })
  })

  it('[AC 1.10] shows snackbar for route-driven fetch failure but not Socket.IO refetch failure', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValueOnce({
      ok: false,
      error: 'recorded-fetch-failed',
      message: '録画データ取得に失敗',
    })

    vi.useFakeTimers()
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('録画データ取得に失敗')
    expect(screen.queryByTestId('recorded-list-item')).not.toBeInTheDocument()
    expect(screen.getByTestId('recorded-error')).toHaveTextContent('録画データ取得に失敗')
  })

  it('[AC 1.10] shows snackbar when a route-driven refetch fails after returning to a cached page', async () => {
    window.history.replaceState(
      null,
      '',
      '/#/recorded?page=2&keyword=alpha&ruleId=0&channelId=34&genre=5&hasOriginalFile=true',
    )
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

    fireEvent.click(await screen.findByRole('button', { name: '次のページ' }))

    await waitFor(() => {
      expect(recordedRepository.fetchRecorded).toHaveBeenCalledWith(
        expect.objectContaining({ page: 3 }),
      )
    })
    await screen.findByRole('button', { name: '前のページ' })
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValueOnce({
      ok: false,
      error: 'recorded-fetch-failed',
      message: '録画データ取得に失敗',
    })
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '前のページ' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('録画データ取得に失敗')
  })

  it('[AC 3.21] refetches without snackbar when Socket.IO updateStatus fetch fails', async () => {
    const recordedRepository = createRecordedRepository()
    const connection = new SyntheticRealtimeConnection()
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
    const emitDoneGetData = vi.spyOn(scrollHistory, 'emitDoneGetData')

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        scrollHistory={scrollHistory}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-page')
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValueOnce({
      ok: false,
      error: 'recorded-fetch-failed',
      message: '録画データ取得に失敗',
    })

    act(() => {
      connection.emit('updateStatus')
    })

    await waitFor(() => {
      expect(recordedRepository.fetchRecorded).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByTestId('recorded-list-item')).not.toBeInTheDocument()
    expect(screen.getByTestId('recorded-error')).toHaveTextContent('録画データ取得に失敗')
    expect(screen.queryByText('rule failed')).not.toBeInTheDocument()
    expect(emitDoneGetData).toHaveBeenCalledTimes(1)
  })

  it('[AC 1.2] [AC 1.7] uses settings saved in the same app session for Recorded list limit', async () => {
    window.history.replaceState(null, '', '/#/settings')
    const recordedRepository = createRecordedRepository()

    render(
      <App
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await changeSettingsSelect('録画 表示件数', '7件')
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    fireEvent.click(screen.getByRole('button', { name: '録画済み' }))

    await screen.findByTestId('recorded-page')
    await waitFor(() => {
      expect(recordedRepository.fetchRecorded).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 7 }),
      )
    })
  })
})
