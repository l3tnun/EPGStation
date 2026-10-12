import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { RecordedPage } from '@/features/recorded'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded list container-width layout', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 1.5] uses small-card layout when the real list container is narrower than 616px even though the viewport alone is wide enough for two cards', async () => {
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      >
        <RecordedPage
          isNavigationOpen={false}
          onNavigationClick={() => undefined}
          settings={new DefaultSettingsFactory().create()}
          viewportWidth={1440}
          containerWidth={500}
          apiRepository={createRecordedRepository()}
          onFetchFailure={() => undefined}
        />
      </App>,
    )

    expect(await screen.findByTestId('recorded-page')).toHaveAttribute(
      'data-recorded-layout',
      'small-card',
    )
  })

  it('[AC 1.5] uses large-card layout when the real list container still fits two cards even at a narrower viewport', async () => {
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        osPrefersDark={false}
        viewportWidth={360}
        initialDrawerState="none"
      >
        <RecordedPage
          isNavigationOpen={false}
          onNavigationClick={() => undefined}
          settings={new DefaultSettingsFactory().create()}
          viewportWidth={360}
          containerWidth={960}
          apiRepository={createRecordedRepository()}
          onFetchFailure={() => undefined}
        />
      </App>,
    )

    expect(await screen.findByTestId('recorded-page')).toHaveAttribute(
      'data-recorded-layout',
      'large-card',
    )
  })
})
