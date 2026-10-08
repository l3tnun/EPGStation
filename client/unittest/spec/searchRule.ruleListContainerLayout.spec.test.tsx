import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { RuleListPage } from '@/features/search/rule'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository, createSearchRuleRepository } from './searchRuleSupport'

describe('Rule list container-width layout', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/rule')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.26] uses list layout when the real container is narrower than 780px', async () => {
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      >
        <RuleListPage
          isNavigationOpen={false}
          onNavigationClick={() => undefined}
          settings={new DefaultSettingsFactory().create()}
          containerWidth={779}
          apiRepository={createSearchRuleRepository()}
          onSnackbar={() => undefined}
        />
      </App>,
    )

    expect(await screen.findByTestId('rule-page')).toHaveAttribute('data-rule-layout', 'list')
  })

  it('[AC 3.26] uses table layout when the real container is 780px or more', async () => {
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      >
        <RuleListPage
          isNavigationOpen={false}
          onNavigationClick={() => undefined}
          settings={new DefaultSettingsFactory().create()}
          containerWidth={780}
          apiRepository={createSearchRuleRepository()}
          onSnackbar={() => undefined}
        />
      </App>,
    )

    expect(await screen.findByTestId('rule-page')).toHaveAttribute('data-rule-layout', 'table')
  })

  it('[AC 3.26] uses list layout on the very first mount when the real viewport is narrow, without assuming a desktop width', async () => {
    // `useMeasuredContainerWidth` starts at `undefined` on every mount - including the very first one
    // - because its `ResizeObserver` only delivers a first measurement asynchronously. The page
    // takes `viewportWidth` as a prop (mirroring `ReservesPage`/`RecordedPage`) because, if that gap
    // fell back to a hardcoded desktop width, a narrow-viewport first visit would pick the 'table' layout,
    // squeezed its wide columns into the real (narrow) container, wrapped their text, and rendered
    // measurably taller than the 'list' layout that immediately replaced it once the real measurement
    // arrived. Measured directly (Playwright, Android Chrome/Pixel 5): 'table' 275px vs 'list' 188px -
    // that transient extra content is what let the browser's own scroll-anchoring displace an
    // already-restored scroll position (see e2e/app-shell-scroll-workflow.spec.ts, "restores the rule
    // list scroll position immediately after browser back"). No `containerWidth` override and no
    // `ResizeObserver` stub here: this asserts on the very first render, before any measurement could
    // possibly land, so only the `viewportWidth` fallback can make it read 'list'.
    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        osPrefersDark={false}
        viewportWidth={393}
        initialDrawerState="none"
      >
        <RuleListPage
          isNavigationOpen={false}
          onNavigationClick={() => undefined}
          settings={new DefaultSettingsFactory().create()}
          viewportWidth={393}
          apiRepository={createSearchRuleRepository()}
          onSnackbar={() => undefined}
        />
      </App>,
    )

    expect(screen.getByTestId('rule-page')).toHaveAttribute('data-rule-layout', 'list')
  })
})
