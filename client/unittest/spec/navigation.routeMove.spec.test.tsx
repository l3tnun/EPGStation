import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import {
  findSelectedNavigationItem,
  generateNavigationItems,
  type NavigationConfigState,
} from '@/app/navigation'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

const fullConfig: NavigationConfigState = {
  status: 'loaded',
  liveStreamEnabled: true,
  enabledBroadcastWaves: ['GR', 'BS', 'CS', 'SKY'],
}

describe('Requirement 5.1-5.13 drawer click and route move', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 5.6] [AC 5.9] [AC 5.11] [AC 5.12] closes the mobile drawer before delaying a generic guide route move', () => {
    vi.useFakeTimers()

    render(
      <App
        osPrefersDark={false}
        viewportWidth={390}
        initialDrawerState="userOpen"
        navigationConfig={fullConfig}
        navigationSettings={{
          isEnableDisplayForEachBroadcastWave: false,
        }}
        navigationClickDelayMs={50}
        navigationTimestampProvider={() => '12345'}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '番組表' }))

    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'false')
    expect(window.location.hash).toBe('#/')

    act(() => {
      vi.advanceTimersByTime(49)
    })
    expect(window.location.hash).toBe('#/')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(window.location.hash).toBe('#/guide?timestamp=12345')
  })

  it('[AC 5.11] defaults the mobile navigation click delay to the legacy 200ms without an explicit override', () => {
    vi.useFakeTimers()

    render(
      <App
        osPrefersDark={false}
        viewportWidth={390}
        initialDrawerState="userOpen"
        navigationConfig={fullConfig}
        navigationSettings={{
          isEnableDisplayForEachBroadcastWave: false,
        }}
        navigationTimestampProvider={() => '99999'}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '番組表' }))

    expect(window.location.hash).toBe('#/')

    act(() => {
      vi.advanceTimersByTime(199)
    })
    expect(window.location.hash).toBe('#/')

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(window.location.hash).toBe('#/guide?timestamp=99999')
  })

  it('[AC 5.7] [AC 5.10] [AC 5.12] keeps the desktop drawer unchanged and moves wave guide routes immediately', () => {
    render(
      <App
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationConfig={fullConfig}
        navigationSettings={{
          isEnableDisplayForEachBroadcastWave: true,
        }}
        navigationTimestampProvider={() => '22222'}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '番組表BS' }))

    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')
    expect(window.location.hash).toBe('#/guide?type=BS&timestamp=22222')
  })

  it('[AC 5.13] does not push a route when only timestamp would change', () => {
    window.history.replaceState(null, '', '/#/guide?type=GR&timestamp=old')

    render(
      <App
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationConfig={fullConfig}
        navigationSettings={{
          isEnableDisplayForEachBroadcastWave: true,
        }}
        navigationTimestampProvider={() => 'new'}
      />,
    )
    const pushState = vi.spyOn(window.history, 'pushState')

    fireEvent.click(screen.getByRole('button', { name: '番組表GR' }))

    expect(pushState).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('#/guide?type=GR&timestamp=old')
  })
})

describe('Requirement 4.1-4.8 selected navigation judgement', () => {
  it('[AC 4.1] [AC 4.2] [AC 4.4] [AC 4.8] matches path and only item-defined query keys while ignoring guide-owned extra query', () => {
    const items = generateNavigationItems({
      config: fullConfig,
      settings: {
        isEnableDisplayForEachBroadcastWave: true,
      },
    })

    expect(
      findSelectedNavigationItem(items, {
        path: '/guide',
        query: {
          type: 'BS',
          time: '2026-05-05T00:00:00.000Z',
          channelId: 'synthetic-channel',
          timestamp: '1',
        },
      })?.label,
    ).toBe('番組表BS')
    expect(
      findSelectedNavigationItem(items, {
        path: '/reserves',
        query: {
          type: 'conflict',
          timestamp: '2',
          ignored: 'value',
        },
      })?.label,
    ).toBe('競合')
  })

  it('[AC 4.7] keeps generic guide selected when wave-specific guide navigation is disabled', () => {
    const items = generateNavigationItems({
      config: fullConfig,
      settings: {
        isEnableDisplayForEachBroadcastWave: false,
      },
    })

    expect(
      findSelectedNavigationItem(items, {
        path: '/guide',
        query: {
          type: 'SKY',
          time: '2026-05-05T00:00:00.000Z',
          channelId: 'synthetic-channel',
          timestamp: '3',
        },
      })?.label,
    ).toBe('番組表')
  })

  it('[AC 3.5] [AC 3.6] [AC 4.6] [AC 4.8] renders generated drawer labels and selected state in the synthetic shell', () => {
    window.history.replaceState(
      null,
      '',
      '/#/guide?type=CS&time=2026-05-05T00%3A00%3A00.000Z&channelId=synthetic-channel&timestamp=4',
    )

    render(
      <App
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationConfig={fullConfig}
        navigationSettings={{
          isEnableDisplayForEachBroadcastWave: true,
        }}
      />,
    )

    const navigation = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    expect(within(navigation).getByText('番組表GR')).toBeVisible()
    expect(within(navigation).getByText('番組表BS')).toBeVisible()
    expect(within(navigation).getByText('番組表CS')).toBeVisible()
    expect(within(navigation).queryByText('番組表')).not.toBeInTheDocument()
    expect(screen.getByTestId('navigation-item-guide-CS')).toHaveAttribute('data-selected', 'true')
    expect(screen.getByTestId('navigation-item-guide-BS')).toHaveAttribute('data-selected', 'false')
  })

  it('[AC 5.11] cancels a pending mobile route move when another navigation item is clicked first', () => {
    vi.useFakeTimers()

    render(
      <App
        osPrefersDark={false}
        viewportWidth={390}
        initialDrawerState="userOpen"
        navigationConfig={fullConfig}
        navigationSettings={{
          isEnableDisplayForEachBroadcastWave: false,
        }}
        navigationClickDelayMs={50}
        navigationTimestampProvider={() => 'guide-then-dashboard'}
      />,
    )

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: '番組表' }))
    })
    act(() => {
      fireEvent.click(screen.getByTestId('navigation-item-dashboard'))
    })

    act(() => {
      vi.advanceTimersByTime(50)
    })

    expect(window.location.hash).not.toContain('/guide')
  })

  it('[AC 5.11] cancels the pending mobile route move timer when the shell unmounts', () => {
    vi.useFakeTimers()

    const { unmount } = render(
      <App
        osPrefersDark={false}
        viewportWidth={390}
        initialDrawerState="userOpen"
        navigationConfig={fullConfig}
        navigationSettings={{
          isEnableDisplayForEachBroadcastWave: false,
        }}
        navigationClickDelayMs={50}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '番組表' }))

    const pendingTimerCount = vi.getTimerCount()
    unmount()

    expect(vi.getTimerCount()).toBeLessThan(pendingTimerCount)
  })

  it('[AC 3.5] [AC 4.6] uses the existing settings field when generating App drawer items', () => {
    window.history.replaceState(null, '', '/#/guide?type=GR&timestamp=5')

    render(
      <App
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationConfig={fullConfig}
        settings={{
          ...new DefaultSettingsFactory().create(),
          isEnableDisplayForEachBroadcastWave: true,
        }}
      />,
    )

    const navigation = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    expect(within(navigation).getByText('番組表GR')).toBeVisible()
    expect(within(navigation).queryByText('番組表')).not.toBeInTheDocument()
    expect(screen.getByTestId('navigation-item-guide-GR')).toHaveAttribute('data-selected', 'true')
  })
})
