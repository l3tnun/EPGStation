import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import {
  SyntheticRealtimeConnection,
  createShellRepository,
  defineNavigatorPlatformForTest,
} from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded detail route, data, and actions', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/detail/301')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.21] shows route fetch failure snackbar but suppresses Socket.IO detail refetch failure snackbar', async () => {
    const routeFailureRepository = createRecordedRepository()
    vi.mocked(routeFailureRepository.fetchRecordedDetail).mockResolvedValueOnce({
      ok: false,
      error: 'recorded-fetch-failed',
      message: '録画データ取得に失敗',
    })

    // The failure snackbar closes on a 1.5 second wall-clock timer (default showSnackbar
    // timeout). Mount under fake timers and read the surface synchronously, so the assertion
    // never races the host.
    vi.useFakeTimers()
    const routeFailureView = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={routeFailureRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(screen.getByRole('alert')).toHaveTextContent('録画データ取得に失敗')
    expect(screen.queryByTestId('recorded-detail-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recorded-detail-page')).not.toBeInTheDocument()
    routeFailureView.unmount()
    vi.useRealTimers()

    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/detail/301')
    const realtimeFailureRepository = createRecordedRepository()
    const connection = new SyntheticRealtimeConnection()
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={realtimeFailureRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-detail-page')
    vi.mocked(realtimeFailureRepository.fetchRecordedDetail).mockResolvedValueOnce({
      ok: false,
      error: 'recorded-fetch-failed',
      message: '録画データ取得に失敗',
    })
    act(() => {
      connection.emit('updateStatus')
    })
    await waitFor(() => {
      expect(realtimeFailureRepository.fetchRecordedDetail).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('[AC 3.3] [AC 3.6] [AC 3.9] [AC 3.10] [AC 3.13] [AC 3.14] [AC 5.1] [AC 5.2] uses shared detail menu contracts for delete, search, protect, and download handoff', async () => {
    const recordedRepository = createRecordedRepository()
    const connection = new SyntheticRealtimeConnection()

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          deleteRecordedDefaultValue: false,
          shouldUseRecordedDownloadURLScheme: false,
        }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-detail-page')
    fireEvent.click(
      screen.getByRole('button', { name: '録画詳細メニュー: Synthetic detail target' }),
    )
    expect(document.querySelector('[data-recorded-detail-menu-anchor="legacy-overlap"]')).toBe(
      screen.getByRole('menu'),
    )
    expect(screen.getByRole('menuitem', { name: 'download' })).toContainElement(
      document.querySelector('[data-recorded-menu-icon="download"]'),
    )
    expect(screen.getByRole('menuitem', { name: 'download' }).firstElementChild).toBe(
      document.querySelector('[data-recorded-menu-icon="download"]'),
    )
    expect(screen.getByRole('menuitem', { name: 'delete' })).toContainElement(
      document.querySelector('[data-recorded-menu-icon="delete"]'),
    )
    expect(screen.getByRole('menuitem', { name: 'delete' }).firstElementChild).toBe(
      document.querySelector('[data-recorded-menu-icon="delete"]'),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'download' }))
    const downloadDialog = await screen.findByRole('dialog', { name: '録画ダウンロード' })
    expect(downloadDialog).toHaveAttribute('data-recorded-download-dialog', 'legacy')
    expect(screen.queryByRole('heading', { name: '録画ダウンロード' })).not.toBeInTheDocument()
    expect(downloadDialog).toHaveTextContent('Synthetic detail target')
    expect(screen.getByRole('link', { name: 'synthetic-original (1.0KB)' })).toHaveAttribute(
      'href',
      './api/videos/701?isDownload=true',
    )
    expect(screen.getByRole('link', { name: 'synthetic-original' })).toHaveAttribute(
      'href',
      './api/videos/701/playlist',
    )
    const backdrop = document.querySelector('.MuiBackdrop-root')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '録画ダウンロード' })).not.toBeInTheDocument()
    })

    fireEvent.click(
      screen.getByRole('button', { name: '録画詳細メニュー: Synthetic detail target' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'rule' }))
    await waitFor(() => {
      expectHashRoute('#/search?rule=55')
    })

    act(() => {
      window.location.hash = '#/recorded/detail/301'
    })
    await screen.findByTestId('recorded-detail-page')
    fireEvent.click(
      screen.getByRole('button', { name: '録画詳細メニュー: Synthetic detail target' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'search' }))
    await waitFor(() => {
      expectHashRoute('#/recorded?ruleId=55')
    })

    act(() => {
      window.location.hash = '#/recorded/detail/301'
    })
    await screen.findByTestId('recorded-detail-page')
    fireEvent.click(
      screen.getByRole('button', { name: '録画詳細メニュー: Synthetic detail target' }),
    )
    const fetchDetailCallsBeforeProtect = vi.mocked(recordedRepository.fetchRecordedDetail).mock
      .calls.length
    // The success snackbar closes on a 1.5 second wall-clock timer. Drive the click under fake
    // timers and read the surface synchronously, so the assertion never races the host.
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('menuitem', { name: 'protect' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('保護に成功')).toBeVisible()
    vi.useRealTimers()
    expect(recordedRepository.protectRecorded).toHaveBeenCalledWith(301)
    // The detail page does not issue its own follow-up fetch after protect/unprotect
    // (matching the recorded list, which never did). It relies on the server's Socket.IO
    // `updateStatus` broadcast to invalidate and refetch the recorded detail query (see
    // REALTIME_UPDATE_STATUS_QUERY_KEYS in realtimeInvalidation.ts), so no extra fetch has
    // happened yet at this point.
    expect(recordedRepository.fetchRecordedDetail).toHaveBeenCalledTimes(
      fetchDetailCallsBeforeProtect,
    )
    act(() => {
      connection.emit('updateStatus')
    })
    await waitFor(() => {
      expect(recordedRepository.fetchRecordedDetail).toHaveBeenCalledTimes(
        fetchDetailCallsBeforeProtect + 1,
      )
    })

    fireEvent.click(
      screen.getByRole('button', { name: '録画詳細メニュー: Synthetic detail target' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'synthetic-original (1.0KB)' }))
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Synthetic detail target を削除')).toBeVisible()
    vi.useRealTimers()
    expect(recordedRepository.deleteVideoFile).toHaveBeenCalledWith(701)
  })

  it('[AC 3.14] uses server config download URL scheme fallback when saved download scheme is empty', async () => {
    const recordedRepository = createRecordedRepository()
    const restoreNavigator = defineNavigatorPlatformForTest({
      platform: 'Win32',
    })

    try {
      render(
        <App
          settings={{
            ...new DefaultSettingsFactory().create(),
            shouldUseRecordedDownloadURLScheme: true,
            recordedDownloadURLScheme: '',
          }}
          apiRepository={createShellRepository()}
          recordedApiRepository={recordedRepository}
          navigationConfig={
            {
              status: 'loaded',
              liveStreamEnabled: false,
              enabledBroadcastWaves: [],
              urlscheme: {
                download: {
                  win: 'synthetic://ADDRESS',
                },
              },
            } as ServerConfigNavigationState
          }
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />,
      )

      await screen.findByTestId('recorded-detail-page')
      fireEvent.click(
        screen.getByRole('button', { name: '録画詳細メニュー: Synthetic detail target' }),
      )
      fireEvent.click(screen.getByRole('menuitem', { name: 'download' }))
      expect(await screen.findByRole('dialog', { name: '録画ダウンロード' })).toBeVisible()
      expect(screen.getByRole('link', { name: 'synthetic-original (1.0KB)' })).toHaveAttribute(
        'href',
        'synthetic://localhost:3000/api/videos/701?isDownload=true',
      )
    } finally {
      restoreNavigator()
    }
  })
})
