import { readFileSync } from 'node:fs'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { StoragesApiRepository } from '@/features/storages/storagesApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

class SyntheticRealtimeConnection {
  private readonly listeners = new Map<string, Set<() => void>>()

  on(eventName: string, listener: () => void): void {
    const eventListeners = this.listeners.get(eventName) ?? new Set<() => void>()
    eventListeners.add(listener)
    this.listeners.set(eventName, eventListeners)
  }

  off(eventName: string, listener: () => void): void {
    this.listeners.get(eventName)?.delete(listener)
  }

  emit(eventName: string): void {
    this.listeners.get(eventName)?.forEach((listener) => {
      listener()
    })
  }
}

function createShellRepository(events?: string[]) {
  return {
    fetchVersion: vi.fn(async () => {
      events?.push('version')

      return {
        ok: true as const,
        value: {
          version: '9.9.9',
        },
      }
    }),
    fetchServerConfig: vi.fn(async () => {
      events?.push('config')

      return {
        ok: true as const,
        value: {
          status: 'loaded' as const,
          liveStreamEnabled: false,
          enabledBroadcastWaves: [] as const,
        },
      }
    }),
    fetchBootstrapChannels: vi.fn(async () => {
      events?.push('channels')

      return {
        ok: true as const,
        value: [{ id: 101, name: 'Bootstrap channel' }],
      }
    }),
  }
}

type TestStoragesRepository = StoragesApiRepository & {
  fetchStorages: ReturnType<typeof vi.fn>
}

function createStoragesRepository(events?: string[]): TestStoragesRepository {
  return {
    fetchStorages: vi.fn(async () => {
      events?.push('storages')

      return {
        ok: true as const,
        value: {
          items: [
            {
              name: 'Synthetic primary storage',
              available: 1_024,
              used: 1_572_864,
              total: 2_097_152,
            },
            {
              name: 'Synthetic empty storage',
              available: 0,
              used: 0,
              total: 0,
            },
          ],
        },
      }
    }),
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })

  return { promise, resolve }
}

describe('Storages route lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/storages')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 1.1] [AC 1.2] [AC 1.4] [AC 1.5] [AC 1.6] [AC 1.7] renders the storage title, fetches without request input, and displays usage rows', async () => {
    const storagesRepository = createStoragesRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        storagesApiRepository={storagesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(screen.queryByTestId('storages-page')).not.toBeInTheDocument()

    expect(await screen.findByTestId('title-bar')).toHaveTextContent('ストレージ')
    const page = await screen.findByTestId('storages-page')
    expect(page).toHaveAttribute('data-storages-count', '2')
    expect(storagesRepository.fetchStorages).toHaveBeenCalledWith()

    const rows = within(page).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Synthetic primary storage - 2.0MB')
    expect(within(rows[0]).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '75')
    expect(rows[0]).toHaveTextContent('1.5MB 使用済み')
    expect(rows[0]).toHaveTextContent('1.0KB 空き')
    expect(rows[1]).toHaveTextContent('Synthetic empty storage - 0.0B')
    expect(within(rows[1]).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })

  it('[AC 1.2] keeps Vue bootstrap request order before loading the storages route data', async () => {
    const events: string[] = []
    const shellRepository = createShellRepository(events)
    const storagesRepository = createStoragesRepository(events)

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={shellRepository}
        storagesApiRepository={storagesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('storages-page')

    expect(events).toStrictEqual(['config', 'channels', 'version', 'storages'])
  })

  it('[AC 1.1] [AC 1.8] shows the shell title, snackbar, and cleared-list error text when the route fetch fails', async () => {
    const storagesRepository = createStoragesRepository()
    vi.mocked(storagesRepository.fetchStorages).mockResolvedValueOnce({
      ok: false,
      error: 'storages-fetch-failed',
      message: 'ストレージ情報取得に失敗',
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        storagesApiRepository={storagesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('title-bar')).toHaveTextContent('ストレージ')
    // The failure snackbar closes on a wall-clock timer. Once the shell has bootstrapped, flush
    // the trailing storages-fetch failure under fake timers and read the surface synchronously,
    // so the assertion never races the host.
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('ストレージ情報取得に失敗')
    expect(screen.queryByTestId('storages-page')).not.toBeInTheDocument()
    // v2 Storages.vue reports a route fetch failure through the snackbar only; it renders no
    // dedicated error copy in the page body (see requirements.md AC 1.9 / design.md "専用 empty
    // copy を追加しない"). The route stays on a blank, title-only presentation.
    expect(screen.queryByTestId('storages-error')).not.toBeInTheDocument()
    vi.useRealTimers()
  })

  it('[AC 1.2] [AC 1.8] keeps the current list and shows no snackbar when Socket.IO updateStatus refetch fails', async () => {
    const storagesRepository = createStoragesRepository()
    const connection = new SyntheticRealtimeConnection()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        storagesApiRepository={storagesRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByText('Synthetic primary storage - 2.0MB')
    vi.mocked(storagesRepository.fetchStorages).mockResolvedValueOnce({
      ok: false,
      error: 'storages-fetch-failed',
      message: 'ストレージ情報取得に失敗',
    })

    act(() => {
      connection.emit('updateStatus')
    })

    expect(screen.getByText('Synthetic primary storage - 2.0MB')).toBeVisible()
    await waitFor(() => {
      expect(storagesRepository.fetchStorages).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Synthetic primary storage - 2.0MB')).toBeVisible()
  })

  it('[AC 1.2] updates the visible list without a route change when Socket.IO updateStatus refetch succeeds', async () => {
    const storagesRepository = createStoragesRepository()
    const connection = new SyntheticRealtimeConnection()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        storagesApiRepository={storagesRepository}
        realtimeConnectionFactory={() => connection}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByText('Synthetic primary storage - 2.0MB')
    vi.mocked(storagesRepository.fetchStorages).mockResolvedValueOnce({
      ok: true,
      value: {
        items: [
          {
            name: 'Synthetic realtime storage',
            available: 256,
            used: 768,
            total: 1_024,
          },
        ],
      },
    })

    act(() => {
      connection.emit('updateStatus')
    })

    expect(await screen.findByText('Synthetic realtime storage - 1.0KB')).toBeVisible()
    expect(screen.queryByText('Synthetic primary storage - 2.0MB')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('[AC 1.3] clears the visible list before a route-driven refetch resolves', async () => {
    const storagesRepository = createStoragesRepository()
    const deferred = createDeferred<Awaited<ReturnType<StoragesApiRepository['fetchStorages']>>>()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        storagesApiRepository={storagesRepository}
        osPrefersDark={false}
        viewportWidth={390}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('storages-page')
    vi.mocked(storagesRepository.fetchStorages).mockReturnValueOnce(deferred.promise)

    act(() => {
      window.location.hash = '#/storages?timestamp=route-change'
    })

    await waitFor(() => {
      expect(screen.queryByText('Synthetic primary storage - 2.0MB')).not.toBeInTheDocument()
    })

    deferred.resolve({
      ok: true,
      value: {
        items: [
          {
            name: 'Synthetic refreshed storage',
            available: 512,
            used: 512,
            total: 1_024,
          },
        ],
      },
    })

    expect(await screen.findByText('Synthetic refreshed storage - 1.0KB')).toBeVisible()
  })

  it('carries the Vuetify v-container 3-tier max-width instead of stretching to the full viewport', () => {
    // Source: v2 5cf2ea383 client/src/views/Storages.vue:6 wraps the list in a bare
    // <v-container>. Vuetify's container CSS (vuetify, a v2 dependency: dist/vuetify.css) sets:
    // .container{width:100%;margin-right:auto;margin-left:auto} (no cap below 960px)
    // @media(min-width:960px){.container{max-width:900px}}
    // @media(min-width:1264px){.container{max-width:1185px}}
    // @media(min-width:1904px){.container{max-width:1785px}}
    const css = readFileSync('src/features/storages/StoragesPage.module.css', 'utf8')

    expect(css).toMatch(/\.storagesPage\s*\{[^}]*margin: 0 auto;/)
    expect(css).not.toMatch(/^\.storagesPage\s*\{[^}]*max-width/m)
    expect(css).toMatch(
      /@media \(min-width: 960px\)\s*\{\s*\.storagesPage\s*\{\s*max-width: 900px;\s*\}\s*\}/,
    )
    expect(css).toMatch(
      /@media \(min-width: 1264px\)\s*\{\s*\.storagesPage\s*\{\s*max-width: 1185px;\s*\}\s*\}/,
    )
    expect(css).toMatch(
      /@media \(min-width: 1904px\)\s*\{\s*\.storagesPage\s*\{\s*max-width: 1785px;\s*\}\s*\}/,
    )
  })

  it('renders the usage bar at the v2 v-progress-linear height instead of a thinner bar', async () => {
    // Source: v2 5cf2ea383 client/src/views/Storages.vue:9 —
    // <v-progress-linear :value="info.useRate" height="25"></v-progress-linear>
    const storagesRepository = createStoragesRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        storagesApiRepository={storagesRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const page = await screen.findByTestId('storages-page')
    const bar = within(page).getAllByRole('progressbar')[0]

    expect(bar).toHaveStyle({ height: '25px' })
  })
})
