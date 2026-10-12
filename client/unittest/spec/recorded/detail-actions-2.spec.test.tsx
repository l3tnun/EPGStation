import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import {
  createPlaybackNavigationConfig,
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

  it('[AC 3.14] uses iPadOS server config download URL scheme fallback when saved download scheme is empty', async () => {
    const recordedRepository = createRecordedRepository()
    const restoreNavigator = defineNavigatorPlatformForTest({
      userAgent: 'Synthetic Macintosh Safari',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })

    try {
      render(
        <App
          settings={{
            ...new DefaultSettingsFactory().create(),
            shouldUseRecordedDownloadURLScheme: true,
            recordedDownloadURLScheme: '   ',
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
                  ios: 'synthetic://PROTOCOL/ADDRESS/FILENAME',
                },
              },
            } as ServerConfigNavigationState
          }
          osPrefersDark={false}
          viewportWidth={1024}
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
        'synthetic://http/localhost:3000/api/videos/701?isDownload=true/synthetic-original.ts',
      )
    } finally {
      restoreNavigator()
    }
  })

  it('[AC 3.14] uses raw download fallback when saved download scheme is whitespace and server config has no fallback', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          shouldUseRecordedDownloadURLScheme: true,
          recordedDownloadURLScheme: '   ',
        }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
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
      './api/videos/701?isDownload=true',
    )
  })

  it('[AC 3.7] [AC 3.8] [AC 3.10] [AC 3.11] navigates back after full detail delete and avoids API calls for zero selection', async () => {
    window.history.replaceState(null, '', '/#/recorded')
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          deleteRecordedDefaultValue: false,
        }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-page')
    act(() => {
      window.location.hash = '#/recorded/detail/301'
    })
    await screen.findByTestId('recorded-detail-page')
    fireEvent.click(
      screen.getByRole('button', { name: '録画詳細メニュー: Synthetic detail target' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }))
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(recordedRepository.deleteRecorded).not.toHaveBeenCalled()
    expect(recordedRepository.deleteVideoFile).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    fireEvent.click(
      screen.getByRole('button', { name: '録画詳細メニュー: Synthetic detail target' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'delete' }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'synthetic-original (1.0KB)' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'synthetic-encoded (2.0KB)' }))
    // The success snackbar closes on a 1.5 second wall-clock timer. Drive the click under fake
    // timers and read the surface synchronously, so the assertion never races the host.
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('Synthetic detail target を削除')).toBeVisible()
    expect(recordedRepository.deleteRecorded).toHaveBeenCalledWith(301)
    // The post-delete navigate(-1) traverses jsdom session history through two nested 0ms
    // window.setTimeout calls (jsdom's SessionHistory#traverseByDelta/traverseHistory), each
    // queued only once the previous one runs; drain all of them before switching back.
    await act(async () => {
      await vi.runAllTimersAsync()
    })
    vi.useRealTimers()
    expectHashRoute('#/recorded')
  })

  it('[AC 3.5] [AC 3.15] [AC 3.16] fetches drop log only when present and sends Kodi with restored host storage', async () => {
    const recordedRepository = createRecordedRepository()
    localStorage.setItem('SendVideoFileSelectHostSetting', JSON.stringify({ hostName: 'kodi-two' }))

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            kodiHosts: ['kodi-one', 'kodi-two'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-detail-page')
    fireEvent.click(screen.getByText('drop: 2, error: 1, scrambling: 0 3.0KB'))
    expect(
      await screen.findByRole('dialog', { name: 'Synthetic detail target' }),
    ).toHaveTextContent('synthetic drop log content')
    expect(recordedRepository.fetchDropLog).toHaveBeenCalledWith({
      dropLogFileId: 601,
      maxsize: 512,
    })
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'kodi' }))
    const kodiDialog = await screen.findByRole('dialog', { name: 'Kodi 送信' })
    expect(kodiDialog).toHaveAttribute('data-recorded-kodi-dialog', 'legacy')
    expect(screen.queryByRole('heading', { name: 'Kodi 送信' })).not.toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'kodi host' })).toHaveTextContent('kodi-two')
    // The success snackbar closes on a 1.5 second wall-clock timer. Drive the click under fake
    // timers and read the surface synchronously, so the assertion never races the host.
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: 'synthetic-original' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('送信しました')).toBeVisible()
    vi.useRealTimers()
    expect(recordedRepository.sendVideoFileToKodi).toHaveBeenCalledWith({
      videoFileId: 701,
      kodiName: 'kodi-two',
    })
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(
      JSON.parse(localStorage.getItem('SendVideoFileSelectHostSetting') ?? '{}'),
    ).toStrictEqual({
      hostName: 'kodi-two',
    })
  })
})
