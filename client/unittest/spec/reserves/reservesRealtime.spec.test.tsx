import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createScrollHistory } from '@/app/scrollHistory'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  SyntheticRealtimeConnection,
  createShellRepository,
  createReservesRepository,
  findReserveRow,
  getReserveRow,
} from './reservesTestKit'

describe('Reserves list realtime refresh', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/reserves?type=conflict&page=3&timestamp=999')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 1.11] refetches without hiding current list or showing snackbar when Socket.IO updateStatus fetch fails', async () => {
    const reservesRepository = createReservesRepository()
    const connection = new SyntheticRealtimeConnection()
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
    const emitDoneGetData = vi.spyOn(scrollHistory, 'emitDoneGetData')

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        scrollHistory={scrollHistory}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await findReserveRow('Synthetic reserve one')
    vi.mocked(reservesRepository.fetchReserves).mockResolvedValueOnce({
      ok: false,
      error: 'reserves-fetch-failed',
      message: '予約データ取得に失敗',
    })

    act(() => {
      connection.emit('updateStatus')
    })

    expect(getReserveRow('Synthetic reserve one')).toBeVisible()
    await waitFor(() => {
      expect(reservesRepository.fetchReserves).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(emitDoneGetData).toHaveBeenCalledTimes(1)
  })

  it('[AC 1.10] refetches Socket.IO updateStatus with the current route options without clearing rows', async () => {
    window.history.replaceState(null, '', '/#/reserves?type=skip&page=2')
    const reservesRepository = createReservesRepository()
    const connection = new SyntheticRealtimeConnection()
    vi.mocked(reservesRepository.fetchReserves).mockResolvedValueOnce({
      ok: true,
      value: {
        reserves: [{ id: 104, name: 'Synthetic skip reserve', isSkip: true }],
        total: 40,
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await findReserveRow('Synthetic skip reserve')
    vi.mocked(reservesRepository.fetchReserves).mockResolvedValueOnce({
      ok: true,
      value: {
        reserves: [{ id: 204, name: 'Synthetic skip reserve refreshed', isSkip: true }],
        total: 40,
      },
    })

    act(() => {
      connection.emit('updateStatus')
    })

    expect(getReserveRow('Synthetic skip reserve')).toBeVisible()
    expect(screen.queryByTestId('reserves-loading')).not.toBeInTheDocument()
    expect(await findReserveRow('Synthetic skip reserve refreshed')).toBeVisible()
    expect(reservesRepository.fetchReserves).toHaveBeenLastCalledWith({
      type: 'skip',
      isHalfWidth: true,
      limit: 24,
      offset: 24,
      page: 2,
      routeType: 'skip',
    })
  })
})
