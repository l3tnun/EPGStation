import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import {
  SyntheticRealtimeConnection,
  createShellRepository,
  createReservesRepository,
  createDeferred,
  createManualOptionsFetch,
} from './reservesTestKit'

describe('Manual Reserve edit flow', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.stubGlobal('fetch', createManualOptionsFetch())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('[AC 4.4] [AC 4.5] [AC 4.19] prefers reserveId over programId, disables target fields, and uses reserve programId only for supplemental detail', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual?reserveId=701&programId=999')
    const reservesRepository = createReservesRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('manual-reserve-page')).toHaveAttribute(
      'data-manual-mode',
      'edit',
    )
    expect(reservesRepository.fetchManualReserve).toHaveBeenCalledWith({
      reserveId: 701,
      isHalfWidth: true,
    })
    expect(reservesRepository.fetchManualProgram).toHaveBeenCalledWith({
      programId: 801,
      isHalfWidth: true,
    })
    expect(reservesRepository.fetchManualProgram).not.toHaveBeenCalledWith(
      expect.objectContaining({ programId: 999 }),
    )
    expect(screen.getByRole('switch', { name: '時刻指定' })).toBeDisabled()
    expect(screen.queryByText('番組名')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('channel')).not.toBeInTheDocument()
  })

  it('[AC 4.13] shows fetch failure snackbars for existing reserve and program detail requests', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual?reserveId=701')
    const reserveFailureRepository = createReservesRepository()
    vi.mocked(reserveFailureRepository.fetchManualReserve).mockResolvedValueOnce({
      ok: false,
      error: 'manual-reserve-fetch-failed',
      message: '予約情報取得に失敗',
    })

    vi.useFakeTimers()
    const firstView = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={reserveFailureRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('予約情報取得に失敗')
    firstView.unmount()
    vi.useRealTimers()

    window.history.replaceState(null, '', '/#/reserves/manual?programId=801')
    const programFailureRepository = createReservesRepository()
    vi.mocked(programFailureRepository.fetchManualProgram).mockResolvedValueOnce({
      ok: false,
      error: 'manual-program-fetch-failed',
      message: '番組情報取得に失敗',
    })

    vi.useFakeTimers()
    const secondView = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={programFailureRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('番組情報取得に失敗')
    secondView.unmount()
    vi.useRealTimers()

    window.history.replaceState(null, '', '/#/reserves/manual?reserveId=701')
    const supplementalFailureRepository = createReservesRepository()
    vi.mocked(supplementalFailureRepository.fetchManualProgram).mockResolvedValueOnce({
      ok: false,
      error: 'manual-program-fetch-failed',
      message: '番組情報取得に失敗',
    })

    vi.useFakeTimers()
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={supplementalFailureRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('番組情報取得に失敗')
  })

  it('[AC 4.9] [AC 4.15] saves edit payload without programId/timeSpecifiedOption and reports update failure', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual?reserveId=701')
    const reservesRepository = createReservesRepository()
    vi.mocked(reservesRepository.updateManualReserve).mockResolvedValueOnce({
      ok: false,
      error: 'manual-reserve-update-failed',
      message: '予約の更新に失敗しました。',
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('manual-reserve-page')
    // 保存 stays disabled until the program information finishes loading, so a click before then
    // does nothing. Wait for it under real timers: `waitFor` cannot advance a faked clock here.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    })

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('予約の更新に失敗しました。')
    expect(reservesRepository.updateManualReserve).toHaveBeenCalledWith(701, {
      allowEndLack: false,
      saveOption: {
        parentDirectoryName: 'default',
        directory: 'existing-dir',
        recordedFormat: 'existing-format',
      },
      encodeOption: {
        mode1: 'h264',
        directory1: 'encoded',
        isDeleteOriginalAfterEncode: true,
      },
    })
  })

  it('[AC 4.9] ignores a save submitted while the existing reserve is still loading', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual?reserveId=701')
    const reservesRepository = createReservesRepository()
    const loadReserve = createReservesRepository().fetchManualReserve
    const pendingReserve = createDeferred<Awaited<ReturnType<typeof loadReserve>>>()
    vi.mocked(reservesRepository.fetchManualReserve).mockReturnValueOnce(pendingReserve.promise)

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const form = await screen.findByTestId('manual-reserve-page')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

    // 読み込み中の保存は要求を出さない。button が無効な間に届いた submit も同じ扱いにする。
    // 有効化された直後の click はこの経路を通るため、button の状態だけでは防げない。
    fireEvent.submit(form)
    expect(reservesRepository.updateManualReserve).not.toHaveBeenCalled()

    await act(async () => {
      pendingReserve.resolve(await loadReserve({ reserveId: 701, isHalfWidth: true }))
    })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(reservesRepository.updateManualReserve).toHaveBeenCalledTimes(1)
    })
  })

  it('[AC 4.11] cancels without API calls and returns to the previous route', async () => {
    window.history.replaceState(null, '', '/#/reserves')
    window.history.pushState(null, '', '/#/reserves/manual?programId=801')
    const reservesRepository = createReservesRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('manual-reserve-page')
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(reservesRepository.addManualReserve).not.toHaveBeenCalled()
    expect(reservesRepository.updateManualReserve).not.toHaveBeenCalled()
    await waitFor(() => {
      expectHashRoute('#/reserves')
    })
  })

  it('[AC 4.7] keeps time-specified Manual Reserve Socket.IO updateStatus as a no-op', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual')
    const reservesRepository = createReservesRepository()
    const connection = new SyntheticRealtimeConnection()

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

    await screen.findByTestId('manual-reserve-page')
    fireEvent.click(screen.getByRole('switch', { name: '時刻指定' }))
    vi.mocked(reservesRepository.fetchManualProgram).mockClear()

    act(() => {
      connection.emit('updateStatus')
    })

    await waitFor(() => {
      expect(reservesRepository.fetchManualProgram).not.toHaveBeenCalled()
    })
  })
})
