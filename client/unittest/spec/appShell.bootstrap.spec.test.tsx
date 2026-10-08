import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { StrictMode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  appendHeadElement,
  createSuccessfulApiRepository,
  installDashboardFetchMock,
} from './support/appShellSpecSupport'

describe('Requirement 1.1-1.5 common App Shell bootstrap', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/')
    installDashboardFetchMock()
  })

  afterEach(() => {
    document.documentElement.classList.remove('fix-address-bar', 'fix-address-bar2')
    document.documentElement.style.overflow = ''
    vi.useRealTimers()
    vi.restoreAllMocks()
  })
  it('[AC 1.1] renders routed content inside a shared shell with drawer and snackbar hosts', async () => {
    window.history.replaceState(null, '', '/#/recorded')

    render(
      <App
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        initialSnackbar={{
          text: 'synthetic snackbar',
          severity: 'info',
        }}
      />,
    )

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'light')
    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')
    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'permanent')
    expect(screen.getByRole('main')).toHaveAttribute('data-main-offset', '256')
    expect(screen.getByRole('main')).toHaveTextContent('録画済み')
    expect(screen.queryByTestId('query-provider-probe')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('synthetic snackbar')
    expect(screen.getByRole('alert')).toHaveStyle({
      borderRadius: '4px',
      padding: '0px',
      boxSizing: 'border-box',
      maxWidth: '680px',
      minHeight: '48px',
      minWidth: '300px',
      width: 'max-content',
    })
    expect(screen.getByRole('button', { name: '閉じる' })).toBeVisible()
    expect(screen.getByRole('button', { name: '閉じる' })).toHaveStyle({
      fontSize: '12px',
      height: '28px',
      padding: '0px 12.4444px',
    })
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(195)
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('[AS-4] uses the legacy Vuetify grey darken-3 (#424242) background for the default severity snackbar', () => {
    window.history.replaceState(null, '', '/#/recorded')

    render(
      <App
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        initialSnackbar={{
          text: 'default severity snackbar',
        }}
      />,
    )

    expect(screen.getByRole('alert')).toHaveStyle({
      backgroundColor: 'rgb(66, 66, 66)',
    })
  })

  it('[AC 3.1] [AC 3.2] [AC 3.4] [AC 3.11] renders the desktop drawer navigation in the legacy Vue order without extra entries', async () => {
    render(
      <App
        apiRepository={createSuccessfulApiRepository(['2.10.0'])}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByRole('button', { name: '放映中' })
    await screen.findAllByText('EPGStation v2.10.0')

    const drawer = screen.getByTestId('shell-drawer')

    expect(drawer).toHaveTextContent('EPGStation v2.10.0')
    expect(
      within(drawer)
        .getAllByRole('button')
        .map((button) => button.querySelector('[class*="navigationLabel"]')?.textContent),
    ).toEqual([
      'ダッシュボード',
      '放映中',
      '番組表',
      '録画中',
      '録画済み',
      'エンコード',
      '予約',
      '競合',
      '重複',
      '検索',
      'ルール',
      'ストレージ',
      '設定',
    ])
  })

  it('[AC 1.1] [AC 1.2] leaves unknown hash routes as a blank legacy shell without synthetic content', async () => {
    window.history.replaceState(null, '', '/#/definitely-missing-route')

    render(
      <App
        apiRepository={createSuccessfulApiRepository(['2.10.0'])}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findAllByText('EPGStation v2.10.0')

    await waitFor(() => {
      expect(document.title).toBe('epgstation')
    })
    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')
    expect(screen.getByTestId('shell-drawer')).toHaveTextContent('ダッシュボード')
    expect(screen.getByRole('main')).toBeEmptyDOMElement()
    expect(screen.queryByTestId('title-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('screen-body')).not.toBeInTheDocument()
    expect(screen.queryByText(/Synthetic route/)).not.toBeInTheDocument()
    expect(screen.queryByText('EPGStation React')).not.toBeInTheDocument()
  })

  it('[AC 5.21] matches the legacy drawer keyboard contract by ignoring Space activation', async () => {
    render(
      <App
        apiRepository={createSuccessfulApiRepository(['2.10.0'])}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const onAirItem = await screen.findByRole('button', { name: '放映中' })
    const spaceEvent = createEvent.keyDown(onAirItem, { key: ' ' })
    const enterEvent = createEvent.keyDown(onAirItem, { key: 'Enter' })

    fireEvent(onAirItem, spaceEvent)
    fireEvent(onAirItem, enterEvent)

    expect(spaceEvent.defaultPrevented).toBe(true)
    expect(enterEvent.defaultPrevented).toBe(false)
  })

  it('[AC 1.6] provides TanStack Query to non-visible routed children without production probe UI', () => {
    function QueryClientConsumer() {
      useQueryClient()

      return null
    }

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      >
        <QueryClientConsumer />
        <p>slotted routed child</p>
      </App>,
    )

    expect(screen.getByRole('main')).toHaveTextContent('slotted routed child')
    expect(screen.queryByTestId('query-provider-probe')).not.toBeInTheDocument()
  })

  it('[AC frontend-settings-storage 1.5] does not write repaired settings to localStorage during StrictMode render', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')

    render(
      <StrictMode>
        <App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />
      </StrictMode>,
    )

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'light')
    expect(setItem).not.toHaveBeenCalledWith('settings', expect.any(String))
  })

  it('[AC 3.15] consumes saved isEnablePWA=false on startup and disables PWA browser setup', () => {
    const register = vi.fn()
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register,
      },
    })
    const manifest = appendHeadElement(document.createElement('link'))
    manifest.setAttribute('rel', 'manifest')
    manifest.setAttribute('href', '/manifest.webmanifest')
    appendHeadElement(document.createElement('meta')).setAttribute(
      'name',
      'apple-mobile-web-app-title',
    )
    appendHeadElement(document.createElement('meta')).setAttribute(
      'name',
      'apple-mobile-web-app-capable',
    )
    appendHeadElement(document.createElement('meta')).setAttribute(
      'name',
      'apple-mobile-web-app-status-bar-style',
    )
    appendHeadElement(document.createElement('meta')).setAttribute('name', 'mobile-web-app-capable')
    const appleTouchIcon = appendHeadElement(document.createElement('link'))
    appleTouchIcon.setAttribute('rel', 'apple-touch-icon-precomposed')
    appleTouchIcon.setAttribute('href', './icon/ios.png')
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnablePWA: false,
      }),
    )

    render(<App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />)

    expect(document.querySelector('link[rel="manifest"]')).not.toBeInTheDocument()
    expect(
      document.querySelector('meta[name="apple-mobile-web-app-title"]'),
    ).not.toBeInTheDocument()
    expect(
      document.querySelector('meta[name="apple-mobile-web-app-capable"]'),
    ).not.toBeInTheDocument()
    expect(
      document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]'),
    ).not.toBeInTheDocument()
    expect(document.querySelector('meta[name="mobile-web-app-capable"]')).not.toBeInTheDocument()
    expect(
      document.querySelector('link[rel="apple-touch-icon-precomposed"]'),
    ).not.toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
  })

  it('[AC 3.15] registers the service worker on startup when PWA is enabled', async () => {
    const update = vi.fn()
    const register = vi.fn(async () => ({ update }))
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register,
      },
    })

    render(<App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />)

    expect(register).toHaveBeenCalledWith('./serviceWorker.js')
    await waitFor(() => {
      expect(update).toHaveBeenCalled()
    })
  })

  it('[AC 1.2] [AC 2.7] keeps the shell mounted while hash routes change to the settings screen', () => {
    window.history.replaceState(null, '', '/#/settings')

    render(<App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />)

    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    expect(screen.getByTestId('title-bar')).toHaveTextContent('設定')
    expect(screen.getByTestId('settings-card')).toBeVisible()
  })
})
