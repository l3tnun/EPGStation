import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ReservesApiRepository } from '@/features/reserves/reservesApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createShellRepository,
  createReservesRepository,
  createDeferred,
  createManualOptionsFetch,
  selectManualOption,
} from './reservesTestKit'

describe('Manual Reserve add form', () => {
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

  it('[AC 4.1] [AC 4.2] [AC 4.8] renders no-query add mode with time specification off and guards save without an API call', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual')
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

    expect(screen.getByTestId('title-bar')).toHaveTextContent('番組詳細予約')
    expect(await screen.findByTestId('manual-reserve-page')).toHaveAttribute(
      'data-manual-mode',
      'add',
    )
    expect(screen.getByRole('switch', { name: '時刻指定' })).not.toBeChecked()
    expect(screen.queryByTestId('manual-reserve-guidance')).not.toBeInTheDocument()

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('予約の追加に失敗しました。')
    expect(reservesRepository.addManualReserve).not.toHaveBeenCalled()
  })

  it('[AC 4.26] keeps save disabled while loading manual program detail', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual?programId=801')
    const reservesRepository = createReservesRepository()
    const programDetail =
      createDeferred<Awaited<ReturnType<ReservesApiRepository['fetchManualProgram']>>>()
    vi.mocked(reservesRepository.fetchManualProgram).mockReturnValueOnce(programDetail.promise)

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
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(reservesRepository.addManualReserve).not.toHaveBeenCalled()

    programDetail.resolve({
      ok: true,
      value: {
        id: 801,
        name: 'Synthetic program detail',
        channelId: 401,
        startAt: Date.parse('2026-05-05T12:00:00+09:00'),
        endAt: Date.parse('2026-05-05T12:30:00+09:00'),
      },
    })
  })

  it('[AC 4.6] rejects invalid time-specified input through the generic snackbar without API calls', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual')
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
    fireEvent.click(screen.getByRole('switch', { name: '時刻指定' }))
    fireEvent.change(screen.getByLabelText('name'), { target: { value: '   ' } })
    fireEvent.change(screen.getByLabelText('開始'), { target: { value: '2000' } })
    fireEvent.change(screen.getByLabelText('終了'), { target: { value: '1000' } })

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('予約の追加に失敗しました。')
    expect(reservesRepository.addManualReserve).not.toHaveBeenCalled()
  })

  it('[AC 4.6] [AC 4.23] blocks save on an incomplete time-specified start value without ever showing a UNIX-ms display', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual')
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
    fireEvent.click(screen.getByRole('switch', { name: '時刻指定' }))
    fireEvent.change(screen.getByLabelText('name'), {
      target: { value: 'Synthetic incomplete start reserve' },
    })
    await selectManualOption('channel', 'Synthetic channel option')
    fireEvent.change(screen.getByLabelText('終了'), {
      target: { value: '2026-05-07 10:30' },
    })

    const startInput = screen.getByLabelText('開始')
    // Type the target value one character at a time, but stop one character short of a complete
    // "yyyy-MM-dd HH:mm" string.
    const incomplete = '2026-05-07 10:0'
    for (let index = 1; index <= incomplete.length; index += 1) {
      fireEvent.change(startInput, { target: { value: incomplete.slice(0, index) } })
    }
    expect(startInput).toHaveValue(incomplete)

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('予約の追加に失敗しました。')
    expect(reservesRepository.addManualReserve).not.toHaveBeenCalled()
  })

  it('[AC 4.6] [AC 4.23] blocks save when one more character is appended after a fully valid start value', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual')
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
    fireEvent.click(screen.getByRole('switch', { name: '時刻指定' }))
    fireEvent.change(screen.getByLabelText('name'), {
      target: { value: 'Synthetic overtyped start reserve' },
    })
    await selectManualOption('channel', 'Synthetic channel option')
    fireEvent.change(screen.getByLabelText('終了'), {
      target: { value: '2026-05-07 10:30' },
    })

    const startInput = screen.getByLabelText('開始')
    fireEvent.change(startInput, { target: { value: '2026-05-07 10:00' } })
    expect(startInput).toHaveValue('2026-05-07 10:00')

    // One more character appended after a fully valid value must immediately invalidate the
    // committed start value again -- it must not keep silently sending the previously valid
    // milliseconds while the field visibly shows something else.
    fireEvent.change(startInput, { target: { value: '2026-05-07 10:001' } })
    expect(startInput).toHaveValue('2026-05-07 10:001')

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('予約の追加に失敗しました。')
    expect(reservesRepository.addManualReserve).not.toHaveBeenCalled()
  })

  it('[AC 4.21] toggles manual reserve option panels without blocking header clicks', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual')

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('manual-reserve-page')
    const directoryPanel = screen.getByRole('button', { name: 'ディレクトリ' })
    expect(directoryPanel).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('directory')).toBeInTheDocument()

    fireEvent.click(directoryPanel)
    expect(directoryPanel).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => {
      expect(screen.queryByLabelText('directory')).not.toBeInTheDocument()
    })

    fireEvent.click(directoryPanel)
    expect(directoryPanel).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByLabelText('directory')).toBeInTheDocument()
  })

  it('[AC 4.8] [AC 4.14] [AC 4.20] saves valid time-specified add mode with target, save, and encode payload fields', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual')
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
    fireEvent.click(screen.getByRole('switch', { name: '時刻指定' }))
    fireEvent.change(screen.getByLabelText('name'), {
      target: { value: 'Synthetic time specified reserve' },
    })
    await selectManualOption('channel', 'Synthetic channel option')
    fireEvent.change(screen.getByLabelText('開始'), {
      target: { value: '2026-05-07 10:00' },
    })
    fireEvent.change(screen.getByLabelText('終了'), {
      target: { value: '2026-05-07 10:30' },
    })
    await selectManualOption('directory', 'synthetic-parent')
    fireEvent.change(screen.getByLabelText('sub directory'), {
      target: { value: 'synthetic-directory' },
    })
    await selectManualOption('mode1', 'synthetic-encode')
    fireEvent.change(screen.getByLabelText('sub directory1'), {
      target: { value: 'synthetic-encoded-directory' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: '元ファイルの自動削除' }))

    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('予約を追加しました。')
    expect(reservesRepository.addManualReserve).toHaveBeenCalledWith({
      allowEndLack: true,
      timeSpecifiedOption: {
        name: 'Synthetic time specified reserve',
        channelId: 501,
        startAt: Date.parse('2026-05-07T10:00:00+09:00'),
        endAt: Date.parse('2026-05-07T10:30:00+09:00'),
      },
      saveOption: {
        parentDirectoryName: 'synthetic-parent',
        directory: 'synthetic-directory',
      },
      encodeOption: {
        mode1: 'synthetic-encode',
        directory1: 'synthetic-encoded-directory',
        isDeleteOriginalAfterEncode: true,
      },
    })
  })
})
