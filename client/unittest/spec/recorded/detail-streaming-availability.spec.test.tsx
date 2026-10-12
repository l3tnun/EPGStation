import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

function renderDetail(navigationConfig: ServerConfigNavigationState) {
  render(
    <App
      settings={new DefaultSettingsFactory().create()}
      apiRepository={createShellRepository()}
      recordedApiRepository={createRecordedRepository()}
      navigationConfig={navigationConfig}
      osPrefersDark={false}
      viewportWidth={1440}
      initialDrawerState="none"
    />,
  )
}

function baseNavigationConfig(): ServerConfigNavigationState {
  return {
    status: 'loaded',
    liveStreamEnabled: false,
    enabledBroadcastWaves: [],
  } as ServerConfigNavigationState
}

describe('Recorded detail streaming availability', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/detail/301')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 3.35] excludes encoded video files when recorded encoded stream config is absent', async () => {
    renderDetail({
      ...baseNavigationConfig(),
      streamConfig: { recorded: { ts: { hls: ['ts-hls'] } } },
    } as ServerConfigNavigationState)

    await screen.findByTestId('recorded-detail-page')
    fireEvent.click(screen.getByRole('button', { name: 'streaming' }))

    expect(screen.getByRole('button', { name: 'synthetic-original' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'synthetic-encoded' })).not.toBeInTheDocument()
  })

  it('[AC 3.35] excludes ts video files when recorded ts stream config is absent', async () => {
    renderDetail({
      ...baseNavigationConfig(),
      streamConfig: { recorded: { encoded: { hls: ['encoded-hls'] } } },
    } as ServerConfigNavigationState)

    await screen.findByTestId('recorded-detail-page')
    fireEvent.click(screen.getByRole('button', { name: 'streaming' }))

    expect(screen.getByRole('button', { name: 'synthetic-encoded' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'synthetic-original' })).not.toBeInTheDocument()
  })

  it('[AC 3.35] hides the streaming action when only live stream config is available', async () => {
    renderDetail({
      ...baseNavigationConfig(),
      streamConfig: { live: { ts: { m2ts: [{ name: 'live-m2ts' }] } } },
    } as ServerConfigNavigationState)

    await screen.findByTestId('recorded-detail-page')

    expect(screen.getByRole('button', { name: 'play' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'streaming' })).not.toBeInTheDocument()
  })

  it('[AC 3.35] hides the streaming action when the server exposes no stream config', async () => {
    renderDetail(baseNavigationConfig())

    await screen.findByTestId('recorded-detail-page')

    expect(screen.getByRole('button', { name: 'play' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'streaming' })).not.toBeInTheDocument()
  })
})
