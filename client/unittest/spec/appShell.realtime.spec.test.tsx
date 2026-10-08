import { act, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { expectHashRoute } from './hashRouteAssertions'
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
  it('[AC 6.13] shows Socket.IO initialization failure as a shell snackbar', async () => {
    const apiRepository = createSuccessfulApiRepository(['5.0.0'])

    render(
      <App
        apiRepository={apiRepository}
        realtimeConnectionFactory={() => null}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('SocketIO の初期設定に失敗しました')
  })

  it('[AC 6.13] creates the production realtime connection only after config provides the socket port', async () => {
    const apiRepository = createSuccessfulApiRepository(['5.1.0'])
    const connection = new SyntheticRealtimeConnection()
    const realtimeConnectionConnector = vi.fn(() => connection)

    render(
      <App
        apiRepository={apiRepository}
        realtimeConnectionConnector={realtimeConnectionConnector}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(realtimeConnectionConnector).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(realtimeConnectionConnector).toHaveBeenCalledWith({
        socketIOPort: 1234,
      })
    })
  })

  it('[AC 6.13] shows Socket.IO initialization failure when the production connector cannot create a socket', async () => {
    const apiRepository = createSuccessfulApiRepository(['5.2.0'])

    render(
      <App
        apiRepository={apiRepository}
        realtimeConnectionConnector={() => null}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('SocketIO の初期設定に失敗しました')
  })

  it('[AC 6.4] [AC 6.5] [AC 6.6] [AC 6.9] [AC 6.10] shows disconnect feedback and restores the previous full route through Dashboard on reconnect', async () => {
    window.history.replaceState(null, '', '/#/recorded?keyword=synthetic')
    const apiRepository = createSuccessfulApiRepository(['3.0.0'])
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

    await screen.findAllByText('EPGStation v3.0.0')

    act(() => {
      connection.emit('disconnect')
    })

    expect(screen.getByTestId('disconnected-overlay')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('接続が切断されました')

    act(() => {
      connection.emit('connect')
    })
    expect(window.location.hash).toBe('#/')

    await waitFor(() => {
      expectHashRoute('#/recorded?keyword=synthetic')
    })

    await screen.findByText('再接続されました')
    expect(
      screen.getByText('再接続されました').closest('[data-snackbar-severity]'),
    ).toHaveAttribute('data-snackbar-severity', 'default')
    expect(screen.queryByTestId('disconnected-overlay')).not.toBeInTheDocument()
  })

  it('[AC 6.5] [AC 6.6] keeps reconnect restore active after StrictMode effect replay', async () => {
    window.history.replaceState(null, '', '/#/recorded?keyword=synthetic')
    const apiRepository = createSuccessfulApiRepository(['3.0.0'])
    const connection = new SyntheticRealtimeConnection()

    render(
      <StrictMode>
        <App
          apiRepository={apiRepository}
          realtimeConnectionFactory={() => connection}
          osPrefersDark={false}
          viewportWidth={1440}
          initialDrawerState="none"
        />
      </StrictMode>,
    )

    await screen.findAllByText('EPGStation v3.0.0')

    act(() => {
      connection.emit('disconnect')
      connection.emit('connect')
    })

    expect(window.location.hash).toBe('#/')

    await waitFor(() => {
      expectHashRoute('#/recorded?keyword=synthetic')
    })
    await screen.findByText('再接続されました')
  })

  it('[AC 6.13] shows Socket.IO initialization failure when the connection factory throws synchronously', async () => {
    const apiRepository = createSuccessfulApiRepository(['5.3.0'])

    render(
      <App
        apiRepository={apiRepository}
        realtimeConnectionFactory={() => {
          throw new Error('synthetic factory failure')
        }}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent('SocketIO の初期設定に失敗しました')
  })

  it('[AC 6.13] does not show a stale initialization failure snackbar after the shell unmounts first', async () => {
    vi.useFakeTimers()
    const apiRepository = createSuccessfulApiRepository(['5.4.0'])

    const { unmount } = render(
      <App
        apiRepository={apiRepository}
        realtimeConnectionFactory={() => null}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    unmount()

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })
  })

  it('[AC 6.10] does not restore a route when a connect event fires without a prior disconnect', async () => {
    window.history.replaceState(null, '', '/#/recorded?keyword=synthetic')
    const apiRepository = createSuccessfulApiRepository(['5.5.0'])
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

    await screen.findAllByText('EPGStation v5.5.0')

    act(() => {
      connection.emit('connect')
    })

    expect(window.location.hash).toContain('/recorded')
    expect(window.location.hash).toContain('keyword=synthetic')
    expect(screen.queryByTestId('disconnected-overlay')).not.toBeInTheDocument()
  })

  it('[AC 6.5] cancels pending reconnect restore timers when the shell unmounts', async () => {
    vi.useFakeTimers()
    window.history.replaceState(null, '', '/#/recorded?keyword=synthetic')
    const apiRepository = createSuccessfulApiRepository(['3.1.0'])
    const connection = new SyntheticRealtimeConnection()

    const { unmount } = render(
      <App
        apiRepository={apiRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
    })

    act(() => {
      connection.emit('disconnect')
      connection.emit('connect')
    })

    const pendingTimerCount = vi.getTimerCount()
    unmount()

    expect(vi.getTimerCount()).toBeLessThan(pendingTimerCount)
  })
})
