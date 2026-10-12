import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded detail failure snackbars and handoff edge branches', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/detail/301')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.16] leaves drop log fetch a no-op when the log file has no id', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedDetail).mockResolvedValue({
      ok: true,
      value: {
        id: 301,
        name: 'No drop id target',
        dropLogFile: { dropCnt: 0, errorCnt: 0, scramblingCnt: 0 },
        videoFiles: [],
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

    await screen.findByTestId('recorded-detail-page')
    fireEvent.click(screen.getByRole('button', { name: 'drop: 0, error: 0, scrambling: 0 0.0B' }))
    expect(recordedRepository.fetchDropLog).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('[AC 3.16] shows a failure snackbar when the drop log request fails', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchDropLog).mockResolvedValue({
      ok: false,
      error: 'drop-log-fetch-failed',
      message: 'failed',
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

    await screen.findByTestId('recorded-detail-page')
    // The failure snackbar closes on a 1.5 second wall-clock timer. Drive the click under fake
    // timers and read the surface synchronously, so the assertion never races the host.
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: /drop: 2, error: 1, scrambling: 0/ }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('ログファイル取得に失敗しました')).toBeVisible()
  })

  it('[AC 2.20] leaves stop encode a no-op when the item has no recorded id', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedDetail).mockResolvedValue({
      ok: true,
      value: {
        name: 'Idless encoding target',
        isEncoding: true,
        videoFiles: [],
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

    await screen.findByTestId('recorded-detail-page')
    fireEvent.click(screen.getByRole('button', { name: 'stop' }))
    expect(recordedRepository.stopEncode).not.toHaveBeenCalled()
  })

  it('[AC 2.20] shows a failure snackbar when stop encode fails', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.stopEncode).mockResolvedValue({
      ok: false,
      error: 'stop-encode-failed',
      message: 'failed',
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

    await screen.findByTestId('recorded-detail-page')
    // The failure snackbar closes on a 1.5 second wall-clock timer. Drive the click under fake
    // timers and read the surface synchronously, so the assertion never races the host.
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'stop' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('エンコード停止に失敗')).toBeVisible()
  })

  it('[AC 4.9] shows an invalid id snackbar and a fallback anchor label for handoff edge files', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedDetail).mockResolvedValue({
      ok: true,
      value: {
        id: 301,
        name: 'Handoff edge target',
        videoFiles: [
          { id: 701, type: 'ts', size: 10 },
          { type: 'ts', name: 'idless-file', size: 10 },
        ],
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

    await screen.findByTestId('recorded-detail-page')
    fireEvent.click(screen.getByRole('button', { name: 'play' }))
    // The file without a name falls back to `#<id>` for its playlist link label.
    expect(await screen.findByRole('link', { name: '#701' })).toHaveAttribute(
      'href',
      './api/videos/701/playlist',
    )
    // The file without an id cannot resolve a href, so it renders as a button instead.
    // The failure snackbar closes on a 1.5 second wall-clock timer. Drive the click under fake
    // timers and read the surface synchronously, so the assertion never races the host.
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'idless-file' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('番組 ID が不正です')).toBeVisible()
  })

  it('[AC 3.2] shows the channel id when the channel name is missing, and blank when both are missing', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedDetail).mockResolvedValue({
      ok: true,
      value: {
        id: 301,
        name: 'No channel name target',
        channelId: 512,
        videoFiles: [],
      },
    })

    const view = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-detail-page')
    const hero = screen.getByTestId('recorded-detail-hero')
    expect(hero.querySelector('p')).toHaveTextContent('512')
    view.unmount()

    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/detail/301')
    vi.mocked(recordedRepository.fetchRecordedDetail).mockResolvedValue({
      ok: true,
      value: {
        id: 301,
        name: 'No channel info target',
        videoFiles: [],
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
    await screen.findByTestId('recorded-detail-page')
    const blankHero = screen.getByTestId('recorded-detail-hero')
    expect(blankHero.querySelector('p')).toHaveTextContent('')
  })
})
