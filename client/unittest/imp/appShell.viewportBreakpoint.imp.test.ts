import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isDesktopViewport } from '@/app/browserAdapters'
import { APP_SHELL_DESKTOP_BREAKPOINT, resolveDrawerLayout } from '@/app/drawerLayout'
import { useIsDesktopViewport } from '@/app/hooks/useIsDesktopViewport'

interface FakeMediaQueryList {
  matches: boolean
  media: string
  addEventListener: (type: 'change', listener: () => void) => void
  removeEventListener: (type: 'change', listener: () => void) => void
  dispatchChange: (matches: boolean) => void
}

// A minimal, spec-accurate MediaQueryList double: it holds exactly the state `matchMedia` would
// hold in a real browser for a single query (`matches`, plus its own `change` listeners), and
// nothing else -- in particular no cross-call module state such as an adopted stale viewport or a
// previously published viewport width, which the breakpoint decision must not keep. Each `it()`
// below constructs a fresh one, so no test can observe another test's prior matches value or
// listeners.
function createFakeMediaQueryList(initialMatches: boolean): FakeMediaQueryList {
  const listeners = new Set<() => void>()
  const mediaQueryList: FakeMediaQueryList = {
    matches: initialMatches,
    media: `(min-width: ${APP_SHELL_DESKTOP_BREAKPOINT}px)`,
    addEventListener: (_type, listener) => {
      listeners.add(listener)
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener)
    },
    dispatchChange: (matches) => {
      mediaQueryList.matches = matches
      for (const listener of listeners) {
        listener()
      }
    },
  }

  return mediaQueryList
}

function stubMatchMedia(mediaQueryList: FakeMediaQueryList): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn().mockReturnValue(mediaQueryList),
  })

  return () => {
    if (descriptor !== undefined) {
      Object.defineProperty(window, 'matchMedia', descriptor)
    } else {
      Reflect.deleteProperty(window, 'matchMedia')
    }
  }
}

describe('App Shell desktop/mobile viewport breakpoint', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Real-hardware case: Linux + Chrome, 1272px browser window with a classic
  // (non-overlay) scrollbar (~15px gutter) -- innerWidth 1272, clientWidth 1257 -- must keep the
  // permanent desktop drawer open; a scrollbar-narrowed measurement (1257, < 1264) closing it
  // is the bug this guards against. A `min-width` media feature is evaluated against the same viewport CSS lays
  // content out against, i.e. the one INCLUDING the scrollbar gutter on desktop, so it reports
  // desktop here independent of any JS-measured `clientWidth`/`innerWidth` value.
  it('reports desktop at 1272px with a 15px classic scrollbar gutter (clientWidth 1257)', () => {
    const restore = stubMatchMedia(createFakeMediaQueryList(true))

    try {
      expect(isDesktopViewport()).toBe(true)
    } finally {
      restore()
    }
  })

  it('reports mobile one pixel below the breakpoint (1263px)', () => {
    const restore = stubMatchMedia(createFakeMediaQueryList(false))

    try {
      expect(isDesktopViewport()).toBe(false)
    } finally {
      restore()
    }
  })

  it('falls back to mobile when matchMedia is unavailable', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    // @ts-expect-error -- simulate an environment without matchMedia support
    delete window.matchMedia

    try {
      expect(isDesktopViewport()).toBe(false)
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(window, 'matchMedia', descriptor)
      }
    }
  })

  it('falls back to mobile without a window', () => {
    vi.stubGlobal('window', undefined)

    expect(isDesktopViewport()).toBe(false)
  })
})

describe('useIsDesktopViewport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('subscribes to the live matchMedia change event and updates without re-reading any width', () => {
    const mediaQueryList = createFakeMediaQueryList(true)
    const restore = stubMatchMedia(mediaQueryList)

    try {
      const { result } = renderHook(() => useIsDesktopViewport(undefined))

      expect(result.current).toBe(true)

      act(() => {
        mediaQueryList.dispatchChange(false)
      })

      expect(result.current).toBe(false)

      act(() => {
        mediaQueryList.dispatchChange(true)
      })

      expect(result.current).toBe(true)
    } finally {
      restore()
    }
  })

  it('never touches matchMedia for an explicit test viewport width and stays static across renders', () => {
    const matchMedia = vi.fn()
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia })

    const { result, rerender } = renderHook(
      ({ width }: { width: number }) => useIsDesktopViewport(width),
      { initialProps: { width: 1263 } },
    )

    expect(result.current).toBe(false)
    expect(matchMedia).not.toHaveBeenCalled()

    rerender({ width: APP_SHELL_DESKTOP_BREAKPOINT })

    expect(result.current).toBe(true)
    expect(matchMedia).not.toHaveBeenCalled()
  })
})

describe('resolveDrawerLayout with an isDesktop flag (decoupled from any numeric width)', () => {
  it('opens the desktop drawer by default and offsets main content by the drawer width', () => {
    expect(
      resolveDrawerLayout({
        isDesktop: true,
        userDrawerState: 'none',
      }),
    ).toStrictEqual({
      isDesktop: true,
      isDrawerOpen: true,
      drawerVariant: 'permanent',
      drawerWidth: 256,
      mainContentOffset: 256,
    })
  })

  it('defaults the mobile/tablet drawer closed with overlay geometry', () => {
    expect(
      resolveDrawerLayout({
        isDesktop: false,
        userDrawerState: 'none',
      }),
    ).toStrictEqual({
      isDesktop: false,
      isDrawerOpen: false,
      drawerVariant: 'temporary',
      drawerWidth: 256,
      mainContentOffset: 0,
    })
  })
})
