import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import {
  createPlaybackNavigationConfig,
  createShellRepository,
  defineNavigatorPlatformForTest,
  expectMuiSelectText,
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

  it.each(['not-a-number', '1e2', '0x10'])(
    '[AC 3.1] keeps the legacy blank detail body for non-decimal detail id %s without requesting detail data',
    async (routeId) => {
      window.history.replaceState(null, '', `/#/recorded/detail/${routeId}`)
      const recordedRepository = createRecordedRepository()

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

      expect(screen.getByTestId('title-bar')).toHaveTextContent('録画詳細')
      expect(screen.queryByText('録画データがありません')).not.toBeInTheDocument()
      expect(screen.queryByTestId('recorded-detail-page')).not.toBeInTheDocument()
      expect(recordedRepository.fetchRecordedDetail).not.toHaveBeenCalled()
    },
  )

  it('[AC 3.32] keeps the legacy blank detail body while loading detail data', async () => {
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecordedDetail).mockReturnValue(new Promise(() => undefined))

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

    expect(screen.getByTestId('title-bar')).toHaveTextContent('録画詳細')
    await waitFor(() => {
      expect(recordedRepository.fetchRecordedDetail).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByText('読み込み中')).not.toBeInTheDocument()
    expect(screen.queryByTestId('recorded-detail-page')).not.toBeInTheDocument()
  })

  it('[AC 4.2] [AC 4.5] [AC 4.6] [AC 4.10] hands off encoded detail playback to web watch and original playback to external URL scheme', async () => {
    const recordedRepository = createRecordedRepository()
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isPreferredPlayingOnWeb: true,
      shouldUseRecordedViewURLScheme: true,
      recordedViewURLScheme: 'synthetic://PROTOCOL/ADDRESS/FILENAME',
    }

    render(
      <App
        settings={settings}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-detail-page')
    fireEvent.click(screen.getByRole('button', { name: 'play' }))
    expect(screen.getByRole('link', { name: 'synthetic-original' })).toHaveAttribute(
      'href',
      'synthetic://http/localhost:3000/api/videos/701/synthetic-original.ts',
    )
    fireEvent.click(screen.getByRole('button', { name: 'synthetic-encoded' }))
    await waitFor(() => {
      expectHashRoute('#/recorded/watch?videoId=702&recordedId=301')
    })
    expect(screen.getByTestId('title-bar')).toHaveTextContent('視聴')
  })

  it('[AC 4.6] uses the playlist API fallback when recorded view URL scheme is not resolved', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isPreferredPlayingOnWeb: false,
          shouldUseRecordedViewURLScheme: true,
          recordedViewURLScheme: null,
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
    fireEvent.click(screen.getByRole('button', { name: 'play' }))
    expect(screen.getByRole('link', { name: 'synthetic-original' })).toHaveAttribute(
      'href',
      './api/videos/701/playlist',
    )
  })

  it('[AC 4.6] uses iPadOS server config view URL scheme fallback when saved view scheme is empty', async () => {
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
            isPreferredPlayingOnWeb: false,
            shouldUseRecordedViewURLScheme: true,
            recordedViewURLScheme: '   ',
          }}
          apiRepository={createShellRepository()}
          recordedApiRepository={recordedRepository}
          navigationConfig={
            {
              ...createPlaybackNavigationConfig(),
              urlscheme: {
                video: {
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
      fireEvent.click(screen.getByRole('button', { name: 'play' }))
      expect(screen.getByRole('link', { name: 'synthetic-original' })).toHaveAttribute(
        'href',
        'synthetic://http/localhost:3000/api/videos/701/synthetic-original.ts',
      )
    } finally {
      restoreNavigator()
    }
  })

  it('[AC 4.3] [AC 4.7] restores saved streaming selection and navigates to the Video Playback owner route', async () => {
    const recordedRepository = createRecordedRepository()
    localStorage.setItem('RecordedSelectStreamSetting', JSON.stringify({ type: 'HLS', mode: 0 }))
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-detail-page')
    fireEvent.click(screen.getByRole('button', { name: 'streaming' }))
    fireEvent.click(await screen.findByRole('button', { name: 'synthetic-encoded' }))
    const dialog = await screen.findByRole('dialog', { name: 'ストリーム選択' })
    expect(dialog).toBeVisible()
    expect(dialog).toHaveAttribute('data-recorded-stream-select-dialog', 'legacy')
    expect(screen.queryByRole('heading', { name: 'ストリーム選択' })).not.toBeInTheDocument()
    expect(dialog).toHaveTextContent('synthetic-encoded')
    expect(dialog).not.toHaveTextContent('配信方式')
    expect(dialog).not.toHaveTextContent('画質')
    expect(screen.getByRole('combobox', { name: '配信方式' })).toHaveAttribute(
      'data-recorded-stream-select-field',
      'type',
    )
    expectMuiSelectText('配信方式', 'HLS')
    expect(screen.getByRole('combobox', { name: '画質' })).toHaveAttribute(
      'data-recorded-stream-select-field',
      'mode',
    )
    fireEvent.click(await screen.findByRole('button', { name: '視聴' }))
    await waitFor(() => {
      expectHashRoute(
        '#/recorded/streaming/702?recordedId=301&streamingType=hls&mode=0&fileType=encoded',
      )
    })
  })
})
