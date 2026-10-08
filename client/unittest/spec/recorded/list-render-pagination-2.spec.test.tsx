import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded list route lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(
      null,
      '',
      '/#/recorded?page=3&keyword=alpha&ruleId=0&channelId=34&genre=5&hasOriginalFile=true&timestamp=999',
    )
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 1.15] derives the desktop pagination cluster from the measured element width at 568px/569px, not window.innerWidth', async () => {
    // See list-render-pagination.spec.test.tsx for the full rationale: v2 Vuetify `VPagination`
    // keys its ellipsis cluster off the measured element width, not viewport width.
    for (const width of [568, 569]) {
      Object.defineProperty(window, 'innerWidth', {
        configurable: true,
        value: width,
      })
      const recordedRepository = createRecordedRepository()
      vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
        ok: true,
        value: {
          records: [{ id: 101, name: 'Synthetic recorded one' }],
          total: 480,
        },
      })

      const { unmount } = render(
        <App
          settings={new DefaultSettingsFactory().create()}
          apiRepository={createShellRepository()}
          recordedApiRepository={recordedRepository}
          osPrefersDark={false}
          viewportWidth={width}
          initialDrawerState="none"
        />,
      )

      await screen.findByText('Synthetic recorded one')
      expect(screen.getByRole('button', { name: '1 ページ' })).toBeVisible()
      expect(screen.getByRole('button', { name: '6 ページ' })).toBeVisible()
      expect(screen.queryByRole('button', { name: '7 ページ' })).not.toBeInTheDocument()
      expect(screen.getByText('...')).toBeVisible()
      expect(screen.getByRole('button', { name: '16 ページ' })).toBeVisible()
      expect(screen.getByRole('button', { name: '20 ページ' })).toBeVisible()

      unmount()
    }
  })

  it('[AC 1.15] matches the legacy recorded pagination page clusters at 501px and 500px', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 501,
    })
    const recordedRepository = createRecordedRepository()
    vi.mocked(recordedRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [{ id: 101, name: 'Synthetic recorded one' }],
        total: 480,
      },
    })

    const { rerender } = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={501}
        initialDrawerState="none"
      />,
    )

    // Above the 500px mobile/desktop threshold, the desktop cluster derives from the measured
    // element width (see the test above), not viewport width alone, so an un-measured jsdom
    // container stays at v2's unconstrained totalVisible=12 six-first/five-last split.
    await screen.findByText('Synthetic recorded one')
    expect(screen.getByRole('button', { name: '1 ページ' })).toBeVisible()
    expect(screen.getByRole('button', { name: '6 ページ' })).toBeVisible()
    expect(screen.queryByRole('button', { name: '7 ページ' })).not.toBeInTheDocument()
    expect(screen.getByText('...')).toBeVisible()
    expect(screen.getByRole('button', { name: '16 ページ' })).toBeVisible()
    expect(screen.getByRole('button', { name: '20 ページ' })).toBeVisible()

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 500,
    })
    rerender(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        osPrefersDark={false}
        viewportWidth={500}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByText('Synthetic recorded one')).toBeVisible()
    expect(screen.getByRole('button', { name: '1 ページ' })).toBeVisible()
    expect(screen.getByRole('button', { name: '5 ページ' })).toBeVisible()
    expect(screen.queryByText('...')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '16 ページ' })).not.toBeInTheDocument()
  })
})
