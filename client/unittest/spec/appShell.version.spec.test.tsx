import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useQuery } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import {
  REALTIME_RECONNECT_QUERY_KEYS,
  REALTIME_UPDATE_STATUS_QUERY_KEYS,
} from '@/app/realtimeInvalidation'
import {
  SyntheticRealtimeConnection,
  createSuccessfulApiRepository,
  installDashboardFetchMock,
} from './support/appShellSpecSupport'

describe('Requirement 6.1-6.16 version, connection, and scroll history contracts', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/')
    installDashboardFetchMock()
  })

  afterEach(() => {
    window.history.replaceState(null, '', '/#/')
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  it('[AC 6.1] [AC 6.8] loads config/version through the shell API repository and refreshes version on route changes', async () => {
    const apiRepository = createSuccessfulApiRepository(['1.0.0', '1.0.1'])

    render(
      <App
        apiRepository={apiRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationTimestampProvider={() => 'route-refresh'}
      />,
    )

    await screen.findAllByText('EPGStation v1.0.0')
    expect(apiRepository.fetchServerConfig).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: '放映中' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '録画済み' }))

    await screen.findAllByText('EPGStation v1.0.1')
    await waitFor(() => {
      expect(apiRepository.fetchVersion).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('[AC 6.2] [AC 6.8] invalidates and refetches the displayed version when Socket.IO updateStatus is received', async () => {
    const apiRepository = createSuccessfulApiRepository(['2.0.0', '2.0.1'])
    const connection = new SyntheticRealtimeConnection()

    render(
      <App
        apiRepository={apiRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findAllByText('EPGStation v2.0.0')

    act(() => {
      connection.emit('updateStatus')
    })

    await screen.findAllByText('EPGStation v2.0.1')
    expect(apiRepository.fetchVersion).toHaveBeenCalledTimes(2)
  })

  it('[AC 6.2] invalidates all realtime updateStatus query targets when Socket.IO updateStatus is received', async () => {
    const apiRepository = createSuccessfulApiRepository(['2.1.0', '2.1.1'])
    const connection = new SyntheticRealtimeConnection()
    const queryFns = REALTIME_UPDATE_STATUS_QUERY_KEYS.map((queryKey) => ({
      queryKey,
      queryFn: vi.fn(async () => queryKey.join('/')),
    }))

    function RealtimeQueryProbeEntry({
      queryKey,
      queryFn,
    }: {
      queryKey: readonly unknown[]
      queryFn: () => Promise<string>
    }) {
      useQuery({
        queryKey,
        queryFn,
      })

      return null
    }

    function RealtimeQueryProbe() {
      return (
        <>
          {queryFns.map(({ queryKey, queryFn }) => (
            <RealtimeQueryProbeEntry
              key={queryKey.join('/')}
              queryFn={queryFn}
              queryKey={queryKey}
            />
          ))}
          <p>realtime query probe</p>
        </>
      )
    }

    render(
      <App
        apiRepository={apiRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      >
        <RealtimeQueryProbe />
      </App>,
    )

    await screen.findByText('realtime query probe')
    await waitFor(() => {
      queryFns.forEach(({ queryFn }) => expect(queryFn).toHaveBeenCalledTimes(1))
    })

    act(() => {
      connection.emit('updateStatus')
    })

    await waitFor(() => {
      queryFns.forEach(({ queryFn }) => expect(queryFn).toHaveBeenCalledTimes(2))
    })
  })

  it('[AC 6.22] invalidates all routed server state query targets when Socket.IO reconnects after disconnect', async () => {
    const apiRepository = createSuccessfulApiRepository(['2.2.0'])
    const connection = new SyntheticRealtimeConnection()
    const queryFns = REALTIME_RECONNECT_QUERY_KEYS.map((queryKey) => ({
      queryKey,
      queryFn: vi.fn(async () => queryKey.join('/')),
    }))

    function ReconnectQueryProbeEntry({
      queryKey,
      queryFn,
    }: {
      queryKey: readonly unknown[]
      queryFn: () => Promise<string>
    }) {
      useQuery({
        queryKey,
        queryFn,
      })

      return null
    }

    function ReconnectQueryProbe() {
      return (
        <>
          {queryFns.map(({ queryKey, queryFn }) => (
            <ReconnectQueryProbeEntry
              key={queryKey.join('/')}
              queryFn={queryFn}
              queryKey={queryKey}
            />
          ))}
          <p>reconnect query probe</p>
        </>
      )
    }

    render(
      <App
        apiRepository={apiRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      >
        <ReconnectQueryProbe />
      </App>,
    )

    await screen.findByText('reconnect query probe')
    await waitFor(() => {
      queryFns.forEach(({ queryFn }) => expect(queryFn).toHaveBeenCalledTimes(1))
    })

    act(() => {
      connection.emit('disconnect')
      connection.emit('connect')
    })

    await waitFor(() => {
      queryFns.forEach(({ queryFn }) => expect(queryFn).toHaveBeenCalledTimes(2))
    })
  })

  it('[AC 6.3] [AC 6.12] shows version and config failures as shell snackbars', async () => {
    const versionFailureRepository = {
      fetchVersion: vi.fn(async () => ({
        ok: false as const,
        error: 'version-fetch-failed' as const,
        message: 'バージョン情報取得に失敗',
      })),
      fetchServerConfig: vi.fn(async () => ({
        ok: true as const,
        value: {
          status: 'loaded' as const,
          liveStreamEnabled: false,
          enabledBroadcastWaves: [] as const,
        },
      })),
    }
    const { unmount } = render(
      <App
        apiRepository={versionFailureRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('バージョン情報取得に失敗')

    unmount()
    window.history.replaceState(null, '', '/#/')

    const configFailureRepository = {
      fetchVersion: vi.fn(async () => ({
        ok: true as const,
        value: {
          version: '4.0.0',
        },
      })),
      fetchServerConfig: vi.fn(async () => ({
        ok: false as const,
        error: 'config-fetch-failed' as const,
        message: '設定ダウンロードに失敗しました',
      })),
    }

    render(
      <App
        apiRepository={configFailureRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('設定ダウンロードに失敗しました')
  })

  it('[AC 6.2] ignores a realtime updateStatus event when there is no API repository to refresh from', async () => {
    const connection = new SyntheticRealtimeConnection()

    render(
      <App
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('app-shell')

    expect(() => {
      act(() => {
        connection.emit('updateStatus')
      })
    }).not.toThrow()
  })

  it('[AC 6.2] [AC 6.3] does not show a snackbar for a version refresh failure triggered by a realtime update', async () => {
    const connection = new SyntheticRealtimeConnection()
    const apiRepository = {
      fetchVersion: vi.fn(async () => ({
        ok: false as const,
        error: 'version-fetch-failed' as const,
        message: 'バージョン情報取得に失敗',
      })),
      fetchServerConfig: vi.fn(async () => ({
        ok: true as const,
        value: {
          status: 'loaded' as const,
          liveStreamEnabled: false,
          enabledBroadcastWaves: [] as const,
          socketIOPort: 1234,
        },
      })),
    }

    render(
      <App
        apiRepository={apiRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByRole('alert')
    expect(screen.getAllByRole('alert')).toHaveLength(1)

    // The bootstrap failure snackbar closes on a real wall-clock timer. Drive the
    // realtime-triggered refetch under fake timers and read the alert count synchronously, so
    // the assertion never races the host.
    vi.useFakeTimers()
    act(() => {
      connection.emit('updateStatus')
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    expect(apiRepository.fetchVersion).toHaveBeenCalledTimes(2)
    // The realtime-triggered refresh uses notifyOnFailure: false, so the failure does not queue a
    // second snackbar on top of the one already shown from the initial bootstrap failure.
    expect(screen.getAllByRole('alert')).toHaveLength(1)
  })

  it('[AC 6.23] logs a bootstrap channels failure without blocking the initial server config resolution', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const apiRepository = {
      fetchVersion: vi.fn(async () => ({ ok: true as const, value: { version: '7.0.0' } })),
      fetchServerConfig: vi.fn(async () => ({
        ok: true as const,
        value: {
          status: 'loaded' as const,
          liveStreamEnabled: false,
          enabledBroadcastWaves: [] as const,
        },
      })),
      fetchBootstrapChannels: vi.fn(async () => ({
        ok: false as const,
        error: 'channels-fetch-failed' as const,
        message: 'チャンネル情報取得に失敗',
      })),
    }

    render(
      <App
        apiRepository={apiRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findAllByText('EPGStation v7.0.0')
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('チャンネル情報取得に失敗')
    })

    consoleErrorSpy.mockRestore()
  })
})
