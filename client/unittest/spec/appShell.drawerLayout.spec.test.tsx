import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { installDashboardFetchMock } from './support/appShellSpecSupport'

describe('Requirement 1.1-1.5 common App Shell bootstrap', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/')
    installDashboardFetchMock()
  })

  afterEach(() => {
    document.documentElement.classList.remove('fix-address-bar', 'fix-address-bar2')
    document.documentElement.style.overflow = ''
    vi.restoreAllMocks()
  })
  it('[AC 1.5] does not reserve drawer width for mobile overlay layout', () => {
    window.history.replaceState(null, '', '/#/guide')

    render(<App osPrefersDark={true} viewportWidth={390} initialDrawerState="userOpen" />)

    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')
    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'temporary')
    expect(screen.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '0')
  })

  it('[AC 1.5] uses the legacy temporary drawer scrim on mobile and tablet', () => {
    render(<App osPrefersDark={false} viewportWidth={390} initialDrawerState="userOpen" />)

    expect(document.querySelector('.MuiBackdrop-root')).toHaveStyle({
      backgroundColor: 'rgba(0, 0, 0, 0.46)',
    })
  })

  it('[AC 1.5] [AC 5.2] keeps the closed mobile drawer mounted with the legacy slide transition contract', () => {
    render(<App osPrefersDark={false} viewportWidth={390} initialDrawerState="none" />)

    const drawer = screen.getByTestId('shell-drawer')

    expect(drawer).toHaveAttribute('data-drawer-open', 'false')
    expect(drawer).toHaveAttribute('data-drawer-mounted', 'true')
    expect(drawer).toHaveAttribute('data-drawer-transition-duration-ms', '200')
    expect(drawer).toHaveAttribute('data-drawer-transition-easing', 'cubic-bezier(0.4, 0, 0.2, 1)')
  })

  it('[AC 5.19] closes the temporary drawer when the backdrop is clicked', () => {
    render(<App osPrefersDark={false} viewportWidth={390} initialDrawerState="userOpen" />)

    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')

    const backdrop = document.querySelector<HTMLElement>('.MuiBackdrop-root')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)

    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'false')
  })

  it('[AC 5.20] keeps the temporary drawer open on Escape to match the legacy Vue drawer', () => {
    render(<App osPrefersDark={false} viewportWidth={900} initialDrawerState="userOpen" />)

    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')

    const modalRoot = document.querySelector<HTMLElement>('.MuiModal-root')
    expect(modalRoot).not.toBeNull()
    fireEvent.keyDown(modalRoot!, { key: 'Escape' })

    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-open', 'true')
  })

  it('[AC 5.1] [AC 5.2] updates the default drawer layout when the viewport crosses the desktop breakpoint', () => {
    window.history.replaceState(null, '', '/#/')
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1263,
    })

    render(<App osPrefersDark={false} initialDrawerState="none" />)

    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'temporary')
    expect(screen.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '0')

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1264,
    })
    fireEvent.resize(window)

    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'permanent')
    expect(screen.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '256')
  })

  it('[AC 5.1] [AC 5.2] keeps explicit viewport width deterministic across browser resize events', () => {
    window.history.replaceState(null, '', '/#/')
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1263,
    })

    render(<App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />)

    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'permanent')
    expect(screen.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '256')

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 390,
    })
    fireEvent.resize(window)

    expect(screen.getByTestId('shell-drawer')).toHaveAttribute('data-drawer-variant', 'permanent')
    expect(screen.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '256')
  })

  it('[AC 5.1] [AC 5.2] observes documentElement resize through ResizeObserver when the viewport is not explicit', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    const ResizeObserverMock = vi.fn(function (this: unknown) {
      return { observe, disconnect, unobserve: vi.fn() }
    })
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)

    const { unmount } = render(<App osPrefersDark={false} initialDrawerState="none" />)

    expect(ResizeObserverMock).toHaveBeenCalled()
    expect(observe).toHaveBeenCalledWith(document.documentElement)

    unmount()

    expect(disconnect).toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  // This test must not assert `data-drawer-mounted="false"` here, i.e. that the closed desktop drawer was removed
  // from the DOM outright. That was the root cause of the missing open/close animation at desktop
  // widths -- an element that has already been unmounted has nothing left to animate, and the
  // *opening* transition never got the chance to play either because it landed on
  // `variant="permanent"`, which MUI never wraps in a Slide transition regardless of `open`
  // (see DrawerHost.tsx's `resolveMuiDrawerVariant` comment). The corrected contract keeps the
  // closed desktop drawer mounted, exactly like the closed mobile (temporary) drawer already is,
  // and hides it only visually via the Slide transition's own `visibility: hidden` (the same
  // contract the legacy Vuetify shell used: `.v-navigation-drawer--close { visibility: hidden }`).
  it('[AC 1.4] [AC 5.8] keeps the closed desktop drawer mounted off-screen instead of removing it', () => {
    render(<App osPrefersDark={false} viewportWidth={1440} initialDrawerState="userClosed" />)

    const drawer = screen.getByTestId('shell-drawer')
    expect(drawer).toHaveAttribute('data-drawer-open', 'false')
    expect(drawer).toHaveAttribute('data-drawer-variant', 'persistent')
    expect(drawer).toHaveAttribute('data-drawer-mounted', 'true')
    expect(screen.getByTestId('shell-main')).toHaveAttribute('data-main-offset', '0')

    const drawerContent = screen.getByTestId('shell-drawer-content')
    expect(drawerContent).toBeInTheDocument()
    expect(drawerContent).not.toBeVisible()
  })
})
