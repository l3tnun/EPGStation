import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ReservesApiRepository } from '@/features/reserves/reservesApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { MANUAL_RESERVE_SUCCESS_BACK_DELAY_MS } from '@/features/reserves/lib/manualReserveTypes'
import { expectHashRoute } from '../hashRouteAssertions'
import {
  createShellRepository,
  createReservesRepository,
  createDeferred,
  createManualOptionsFetch,
} from './reservesTestKit'

describe('Manual Reserve add submit flow', () => {
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

  it('[AC 4.3] [AC 4.10] [AC 4.14] uses programId add mode to fetch program detail, copy target fields, save payload, and go back after the existing delay', async () => {
    window.history.replaceState(null, '', '/#/reserves')
    window.history.pushState(null, '', '/#/reserves/manual?programId=801')
    const reservesRepository = createReservesRepository()
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
    }

    render(
      <App
        settings={settings}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByText('Synthetic program detail')).toBeVisible()
    expect(reservesRepository.fetchManualProgram).toHaveBeenCalledWith({
      programId: 801,
      isHalfWidth: false,
    })

    // 保存 stays disabled until the program information finishes loading, so a click before
    // then does nothing. Wait for it to be enabled instead of assuming it already is.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    })
    // The success snackbar closes on its own timer and the return navigation is deferred by
    // `MANUAL_RESERVE_SUCCESS_BACK_DELAY_MS`, so drive both under a clock this test advances.
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    for (let step = 0; step < 200 && screen.queryAllByRole('alert').length === 0; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
    }

    expect(screen.getByRole('alert')).toHaveTextContent('予約を追加しました。')
    expect(reservesRepository.addManualReserve).toHaveBeenCalledWith({
      allowEndLack: true,
      programId: 801,
    })

    for (let step = 0; step < 20 && window.location.hash !== '#/reserves'; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MANUAL_RESERVE_SUCCESS_BACK_DELAY_MS)
      })
    }

    expectHashRoute('#/reserves')
    vi.useRealTimers()
  })

  it('[AC 4.14] sends allowEndLack: false in the add payload after unchecking the option', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual?programId=801')
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

    expect(await screen.findByText('Synthetic program detail')).toBeVisible()
    fireEvent.click(screen.getByRole('checkbox', { name: '状況に応じて末尾がかけることを許可' }))
    // 保存 stays disabled until the program information finishes loading, so a click before
    // then does nothing. Wait for it to be enabled instead of assuming it already is.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('予約を追加しました。')
    expect(reservesRepository.addManualReserve).toHaveBeenCalledWith({
      allowEndLack: false,
      programId: 801,
    })
  })

  it('[AC 4.12] [AC 4.23] replaces program information with time-specified target fields when the time switch is enabled', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual?programId=801')
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

    expect(await screen.findByText('Synthetic program detail')).toBeVisible()
    expect(screen.queryByRole('region', { name: '時刻指定予約' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('switch', { name: '時刻指定' }))

    expect(screen.queryByText('Synthetic program detail')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: '時刻指定予約' })).toBeVisible()
    expect(screen.getByLabelText('開始')).toHaveValue('2026-05-05 12:00')
    expect(screen.getByLabelText('終了')).toHaveValue('2026-05-05 12:30')

    fireEvent.click(screen.getByRole('switch', { name: '時刻指定' }))

    expect(screen.getByText('Synthetic program detail')).toBeVisible()
    expect(screen.queryByRole('region', { name: '時刻指定予約' })).not.toBeInTheDocument()
  })

  it('[AC 4.27] submits program add only once on double click and disables save while submitting', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual?programId=801')
    const reservesRepository = createReservesRepository()
    const addResult =
      createDeferred<Awaited<ReturnType<ReservesApiRepository['addManualReserve']>>>()
    vi.mocked(reservesRepository.addManualReserve).mockReturnValue(addResult.promise)

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

    await screen.findByText('Synthetic program detail')
    // 保存 stays disabled until the program information finishes loading, so grabbing and clicking
    // it before then does nothing. Wait for it to be enabled first.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    })
    const saveButton = screen.getByRole('button', { name: '保存' })
    fireEvent.click(saveButton)
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(reservesRepository.addManualReserve).toHaveBeenCalledTimes(1)
    })
    expect(saveButton).toBeDisabled()

    // Success schedules a real timer (`MANUAL_RESERVE_SUCCESS_BACK_DELAY_MS`) that calls
    // `goBack()`. Resolving this promise outside `act()` under the real clock left that timer
    // racing this test's own teardown: under heavy CPU load the timer could fire (and navigate)
    // after this test had already returned, landing in whichever test ran next. Drive it under a
    // clock this test advances instead, so the follow-up work is fully flushed before the test
    // ends.
    vi.useFakeTimers()
    await act(async () => {
      addResult.resolve({
        ok: true,
        value: { reserveId: 901 },
      })
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(MANUAL_RESERVE_SUCCESS_BACK_DELAY_MS)
    })
    vi.useRealTimers()
  })

  it('[AC 4.28] ignores a stale submit success after the manual reserve query changes', async () => {
    window.history.replaceState(null, '', '/#/reserves')
    window.history.pushState(null, '', '/#/reserves/manual?programId=801')
    const reservesRepository = createReservesRepository()
    const addResult =
      createDeferred<Awaited<ReturnType<ReservesApiRepository['addManualReserve']>>>()
    vi.mocked(reservesRepository.addManualReserve).mockReturnValue(addResult.promise)
    vi.mocked(reservesRepository.fetchManualProgram).mockImplementation(async ({ programId }) => ({
      ok: true as const,
      value: {
        id: programId,
        name: `Synthetic program ${programId}`,
        channelId: 400 + programId,
        startAt: Date.parse('2026-05-05T12:00:00+09:00'),
        endAt: Date.parse('2026-05-05T12:30:00+09:00'),
      },
    }))

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

    await screen.findByText('Synthetic program 801')
    // 保存 stays disabled until the program information finishes loading, so a click before
    // then does nothing. Wait for it to be enabled instead of assuming it already is.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => {
      expect(reservesRepository.addManualReserve).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      window.location.hash = '#/reserves/manual?programId=802'
      await Promise.resolve()
    })
    expect(await screen.findByText('Synthetic program 802')).toBeVisible()

    vi.useFakeTimers()
    await act(async () => {
      addResult.resolve({
        ok: true,
        value: { reserveId: 901 },
      })
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expectHashRoute('#/reserves/manual?programId=802')
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    vi.useRealTimers()
  })

  it('[AC 4.28] cleans up a pending success back timer after unmount', async () => {
    window.history.replaceState(null, '', '/#/reserves')
    window.history.pushState(null, '', '/#/reserves/manual?programId=801')
    const reservesRepository = createReservesRepository()

    const view = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={reservesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByText('Synthetic program detail')
    // 保存 stays disabled until the program information finishes loading, so a click before then
    // does nothing. Wait for it under real timers: `waitFor` cannot advance a faked clock here.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
    })

    vi.useFakeTimers()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
      await Promise.resolve()
    })

    expect(reservesRepository.addManualReserve).toHaveBeenCalledTimes(1)
    view.unmount()
    window.history.pushState(null, '', '/#/settings')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800)
    })

    expect(window.location.hash).toBe('#/settings')
    vi.useRealTimers()
  })
})
