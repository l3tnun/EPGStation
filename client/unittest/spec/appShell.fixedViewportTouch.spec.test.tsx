import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '@/app/AppShell'
import { renderFixedIOSShell } from './support/appShellSpecSupport'

function createTouch(clientY: number): Touch {
  return { clientY } as Touch
}

function dispatchTouchEvent(
  target: EventTarget,
  type: 'touchstart' | 'touchmove' | 'touchend',
  touches: readonly Touch[],
): TouchEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent
  Object.defineProperty(event, 'touches', { configurable: true, value: touches })
  target.dispatchEvent(event)
  return event
}

describe('App Shell fixed iOS shell touch scroll bridge', () => {
  afterEach(() => {
    document.documentElement.classList.remove('fix-address-bar2')
  })

  it('[AC 6.20] ignores touch gestures when the fixed iOS shell is not active', () => {
    render(
      <AppShell
        drawerLayout={{
          drawerVariant: 'temporary',
          drawerWidth: 256,
          isDesktop: false,
          isDrawerOpen: false,
          mainContentOffset: 0,
        }}
        navigationItems={[]}
        themeMode="light"
      >
        <div data-testid="content">plain content</div>
      </AppShell>,
    )

    const content = screen.getByTestId('content')
    dispatchTouchEvent(content, 'touchstart', [createTouch(100)])
    const move = dispatchTouchEvent(content, 'touchmove', [createTouch(50)])

    expect(move.defaultPrevented).toBe(false)
  })

  it('[AC 6.20] bridges a touchmove on the title bar into shell-main scrolling', () => {
    renderFixedIOSShell(
      <>
        <div data-testid="title-bar">title</div>
        <div data-testid="content">scroll target content</div>
      </>,
    )

    const titleBar = screen.getByTestId('title-bar')
    const shellMain = screen.getByTestId('shell-main')
    shellMain.scrollTop = 100

    dispatchTouchEvent(titleBar, 'touchstart', [createTouch(200)])
    const move = dispatchTouchEvent(titleBar, 'touchmove', [createTouch(150)])

    // Dragging the title bar up by 50px (200 -> 150) should scroll shell-main down by 50px.
    expect(shellMain.scrollTop).toBe(150)
    expect(move.defaultPrevented).toBe(true)

    dispatchTouchEvent(titleBar, 'touchend', [])

    // After touchend, a further move should not affect shell-main anymore.
    const moveAfterEnd = dispatchTouchEvent(titleBar, 'touchmove', [createTouch(50)])
    expect(shellMain.scrollTop).toBe(150)
    expect(moveAfterEnd.defaultPrevented).toBe(false)
  })

  it('[AC 6.20] defaults the tracked touch position to 0 when a title-bar touchstart carries no touch point', () => {
    renderFixedIOSShell(
      <>
        <div data-testid="title-bar">title</div>
        <div data-testid="content">content</div>
      </>,
    )

    const titleBar = screen.getByTestId('title-bar')
    const shellMain = screen.getByTestId('shell-main')
    shellMain.scrollTop = 10

    dispatchTouchEvent(titleBar, 'touchstart', [])
    const move = dispatchTouchEvent(titleBar, 'touchmove', [createTouch(30)])

    // lastTouchY defaulted to 0, so the delta is 0 - 30 = -30.
    expect(shellMain.scrollTop).toBe(-20)
    expect(move.defaultPrevented).toBe(true)
  })

  it('[AC 6.20] does not scroll shell-main when a title-bar touchmove carries no touch point', () => {
    renderFixedIOSShell(
      <>
        <div data-testid="title-bar">title</div>
        <div data-testid="content">content</div>
      </>,
    )

    const titleBar = screen.getByTestId('title-bar')
    const shellMain = screen.getByTestId('shell-main')
    shellMain.scrollTop = 42

    dispatchTouchEvent(titleBar, 'touchstart', [createTouch(200)])
    const move = dispatchTouchEvent(titleBar, 'touchmove', [])

    expect(shellMain.scrollTop).toBe(42)
    expect(move.defaultPrevented).toBe(false)
  })

  it('[AC 6.20] ignores a touchstart whose target is not an Element even inside the fixed iOS shell', () => {
    renderFixedIOSShell(<div data-testid="content">content</div>)

    // Dispatching directly on `document` gives event.target === document, which is a Node but not
    // an Element, exercising the second half of the `!isFixedIOSShell() || !(target instanceof
    // Element)` guard while the fixed shell is still active.
    dispatchTouchEvent(document, 'touchstart', [createTouch(100)])
    const move = dispatchTouchEvent(document, 'touchmove', [createTouch(50)])

    expect(move.defaultPrevented).toBe(false)
  })

  it('[AC 6.20] does not treat a plain non-interactive touch target as a fixed control', () => {
    renderFixedIOSShell(<div data-testid="content">plain content</div>)

    const content = screen.getByTestId('content')
    dispatchTouchEvent(content, 'touchstart', [createTouch(100)])
    const move = dispatchTouchEvent(content, 'touchmove', [createTouch(50)])

    // Not the title bar and not a fixed control, so the shell leaves the touch untouched.
    expect(move.defaultPrevented).toBe(false)
  })

  it('[AC 6.20] does not treat an unfixed in-shell button as a fixed viewport control', () => {
    renderFixedIOSShell(
      <button type="button" data-testid="plain-button">
        通常ボタン
      </button>,
    )

    const plainButton = screen.getByTestId('plain-button')
    dispatchTouchEvent(plainButton, 'touchstart', [createTouch(100)])
    const move = dispatchTouchEvent(plainButton, 'touchmove', [createTouch(50)])

    // The button is inside shell-main and never reaches a `position: fixed` ancestor, so it is
    // not treated as a page-fixed control and the touch bridge leaves it alone.
    expect(move.defaultPrevented).toBe(false)
  })

  it('[AC 6.20] leaves touch drags that start on a navigation drawer item to the drawer scroll', () => {
    document.documentElement.classList.add('fix-address-bar2')

    render(
      <AppShell
        drawerLayout={{
          drawerVariant: 'temporary',
          drawerWidth: 256,
          isDesktop: false,
          isDrawerOpen: true,
          mainContentOffset: 0,
        }}
        navigationItems={[{ id: 'settings', label: '設定', icon: 'settings', path: '/settings' }]}
        themeMode="light"
      >
        <div data-testid="content">content</div>
      </AppShell>,
    )

    const item = screen.getByTestId('navigation-item-settings')
    dispatchTouchEvent(item, 'touchstart', [createTouch(300)])
    const move = dispatchTouchEvent(item, 'touchmove', [createTouch(200)])

    // The drawer content scrolls natively; cancelling the drag would make a menu taller than the
    // visible area unreachable.
    expect(move.defaultPrevented).toBe(false)
  })

  it('[AC 6.20] treats a fixed control outside shell-main as a fixed control by exhausting the ancestor chain', () => {
    renderFixedIOSShell(<div data-testid="content">content</div>)

    const outsideButton = document.createElement('button')
    outsideButton.type = 'button'
    outsideButton.textContent = 'outside shell-main'
    document.body.appendChild(outsideButton)

    try {
      dispatchTouchEvent(outsideButton, 'touchstart', [createTouch(100)])
      const move = dispatchTouchEvent(outsideButton, 'touchmove', [createTouch(50)])

      // No shell-main ancestor and no fixed-position ancestor: the loop exhausts to null and the
      // control is not treated as a page-fixed control.
      expect(move.defaultPrevented).toBe(false)
    } finally {
      outsideButton.remove()
    }
  })
})

describe('App Shell fixed viewport height variable edges', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    const visualViewportDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    if (visualViewportDescriptor === undefined) {
      Reflect.deleteProperty(window, 'visualViewport')
    }
  })

  it('[AC 6.19] clears the viewport height variable when the resolved height is not usable', () => {
    const innerHeightDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight')
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 0 })

    try {
      render(
        <AppShell
          drawerLayout={{
            drawerVariant: 'temporary',
            drawerWidth: 256,
            isDesktop: false,
            isDrawerOpen: false,
            mainContentOffset: 0,
          }}
          navigationItems={[]}
          themeMode="light"
        >
          <div>content</div>
        </AppShell>,
      )

      expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('')
    } finally {
      if (innerHeightDescriptor !== undefined) {
        Object.defineProperty(window, 'innerHeight', innerHeightDescriptor)
      }
    }
  })

  it('[AC 6.19] measures the title bar height through a real ResizeObserver when available', async () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    const ResizeObserverMock = vi.fn(function (this: unknown) {
      return { observe, disconnect, unobserve: vi.fn() }
    })
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)

    const { unmount } = renderFixedIOSShell(<div data-testid="title-bar">title</div>)

    await waitFor(() => {
      expect(observe).toHaveBeenCalledWith(screen.getByTestId('title-bar'))
    })

    unmount()

    expect(disconnect).toHaveBeenCalled()
  })
})
