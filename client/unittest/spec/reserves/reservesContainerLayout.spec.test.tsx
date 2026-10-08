import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { ReservesPage } from '@/features/reserves'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createReservesRepository, createShellRepository } from './reservesTestKit'

describe('Reserves list container-width layout', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/reserves')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.22] uses card layout when the real list container is narrower than 916px even though the viewport alone is wide enough for a table', async () => {
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      >
        <ReservesPage
          isNavigationOpen={false}
          onNavigationClick={() => undefined}
          settings={new DefaultSettingsFactory().create()}
          viewportWidth={1440}
          containerWidth={640}
          apiRepository={createReservesRepository()}
          onFetchFailure={() => undefined}
        />
      </App>,
    )

    expect(await screen.findByTestId('reserves-page')).toHaveAttribute(
      'data-reserves-layout',
      'card',
    )
  })

  it('[AC 2.22] uses table layout when the real list container is still 916px or more even at a narrower viewport', async () => {
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        osPrefersDark={false}
        viewportWidth={390}
        initialDrawerState="none"
      >
        <ReservesPage
          isNavigationOpen={false}
          onNavigationClick={() => undefined}
          settings={new DefaultSettingsFactory().create()}
          viewportWidth={390}
          containerWidth={960}
          apiRepository={createReservesRepository()}
          onFetchFailure={() => undefined}
        />
      </App>,
    )

    expect(await screen.findByTestId('reserves-page')).toHaveAttribute(
      'data-reserves-layout',
      'table',
    )
  })
})
