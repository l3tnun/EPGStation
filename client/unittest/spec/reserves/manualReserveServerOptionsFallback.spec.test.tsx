import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { createScrollHistory } from '@/app/scrollHistory'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createManualOptionsFetch,
  createReservesRepository,
  createShellRepository,
} from './reservesTestKit'

const fetchManualServerOptions = vi.fn()

vi.mock('@/features/reserves/lib/manualReserveServerOptions', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/reserves/lib/manualReserveServerOptions')>()

  return {
    ...actual,
    fetchManualServerOptions: () => fetchManualServerOptions(),
  }
})

function createRejectingDeferred() {
  let reject!: (error: unknown) => void
  const promise = new Promise((_resolve, innerReject) => {
    reject = innerReject
  })

  return { promise, reject }
}

function createResolvingDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve
  })

  return { promise, resolve }
}

describe('Manual Reserve server option fetch fallback', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    vi.stubGlobal('fetch', createManualOptionsFetch())
    fetchManualServerOptions.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('[AC 4.29] falls back to empty server options without crashing when the fetch rejects before unmount', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual')
    const deferred = createRejectingDeferred()
    fetchManualServerOptions.mockReturnValueOnce(deferred.promise)

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

    expect(await screen.findByTestId('manual-reserve-page')).toBeInTheDocument()

    deferred.reject(new Error('synthetic server option failure'))

    await waitFor(() => {
      expect(screen.getByTestId('manual-reserve-page')).toBeInTheDocument()
    })
  })

  it('[AC 4.29] skips applying a rejected server option fetch after the page has already unmounted', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual')
    const deferred = createRejectingDeferred()
    fetchManualServerOptions.mockReturnValueOnce(deferred.promise)

    const { unmount } = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('manual-reserve-page')).toBeInTheDocument()

    unmount()
    deferred.reject(new Error('synthetic server option failure after unmount'))

    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('[AC 4.29] skips applying a successful server option fetch after the page has already unmounted', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual')
    const deferred = createResolvingDeferred<{
      channels: readonly never[]
      directories: readonly string[]
      encodeModes: readonly string[]
    }>()
    fetchManualServerOptions.mockReturnValueOnce(deferred.promise)

    const { unmount } = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('manual-reserve-page')).toBeInTheDocument()

    unmount()
    deferred.resolve({ channels: [], directories: ['/rec'], encodeModes: ['h264'] })

    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it('[AC 3.26] waits for the server option fetch before emitting scroll restoration done, since it gates whether the encode panels render', async () => {
    window.history.replaceState(null, '', '/#/reserves/manual')
    const deferred = createResolvingDeferred<{
      channels: readonly never[]
      directories: readonly string[]
      encodeModes: readonly string[]
    }>()
    fetchManualServerOptions.mockReturnValueOnce(deferred.promise)
    const scrollHistory = createScrollHistory({ shouldRestoreHistory: false })
    const emitDoneGetData = vi.spyOn(scrollHistory, 'emitDoneGetData')

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        reservesApiRepository={createReservesRepository()}
        scrollHistory={scrollHistory}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('manual-reserve-page')).toBeInTheDocument()
    // The add-mode loader itself settles synchronously, but the encode panels only know whether
    // to render once the server option fetch resolves -- emitting "done" before that let route
    // scroll restoration run against a page that was still about to grow (verified in a real
    // browser as a browser-back scroll-restore regression on `/reserves/manual`).
    expect(emitDoneGetData).not.toHaveBeenCalled()

    deferred.resolve({ channels: [], directories: [], encodeModes: ['h264'] })

    await waitFor(() => expect(emitDoneGetData).toHaveBeenCalled())
  })
})
