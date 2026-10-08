import { afterEach, describe, expect, it, vi } from 'vitest'
import { getBrowserOSPrefersDark, getBrowserViewportWidth } from '@/app/browserAdapters'
import {
  createBrowserLocationHref,
  createFullRoutePathFromBrowserHash,
  createNavigationPath,
  parseRoutePath,
} from '@/app/lib/routePath'
import { createBrowserScrollPosition, scrollActiveRouteTo } from '@/app/lib/routeScroll'
import {
  applyBrowserPwaStartupSettings,
  loadDashboardSettingsSnapshot,
  loadNavigationSettingsSnapshot,
  loadThemeSettingsSnapshot,
} from '@/app/lib/shellSettingsSnapshots'
import {
  getRecordedDownloadUrlScheme,
  getRecordedViewUrlScheme,
  isIOSAddressBarFixTarget,
} from '@/app/lib/serverConfigSelectors'
import { createSocketIoRealtimeConnector } from '@/app/realtime'
import { createFetchServerApiRepository } from '@/app/serverApi'
import { readThemeSettingsSnapshot } from '@/app/settingsStorageAdapter'
import { detectNavigatorUrlSchemePlatform } from '@/shared/settings/urlSchemePlatform'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('App Shell browser adapters without a window', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.classList.remove('fix-address-bar2')
  })

  it('[AC 1.1] falls back to no OS dark preference without a window', () => {
    vi.stubGlobal('window', undefined)

    expect(getBrowserOSPrefersDark()).toBe(false)
  })

  it('reports no OS dark preference when matchMedia is unavailable', () => {
    const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    // @ts-expect-error -- simulate an environment without matchMedia support
    delete window.matchMedia

    try {
      expect(getBrowserOSPrefersDark()).toBe(false)
    } finally {
      if (matchMediaDescriptor !== undefined) {
        Object.defineProperty(window, 'matchMedia', matchMediaDescriptor)
      }
    }
  })

  it('reads the real OS dark color scheme preference through matchMedia', () => {
    const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia')
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: true }),
    })

    try {
      expect(getBrowserOSPrefersDark()).toBe(true)
    } finally {
      if (matchMediaDescriptor !== undefined) {
        Object.defineProperty(window, 'matchMedia', matchMediaDescriptor)
      } else {
        Reflect.deleteProperty(window, 'matchMedia')
      }
    }
  })

  it('ignores document.documentElement.clientWidth without a document', () => {
    const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    vi.stubGlobal('document', undefined)

    try {
      expect(getBrowserViewportWidth()).toBe(800)
    } finally {
      vi.unstubAllGlobals()
      if (innerWidthDescriptor !== undefined) {
        Object.defineProperty(window, 'innerWidth', innerWidthDescriptor)
      }
    }
  })

  it('[AC 1.1] falls back to the legacy default viewport width without a window', () => {
    vi.stubGlobal('window', undefined)

    expect(getBrowserViewportWidth()).toBe(1440)
  })

  it('uses visualViewport when innerWidth is unusable and ignores a missing document', () => {
    const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    const visualViewportDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 0 })
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { width: 900 },
    })
    vi.stubGlobal('document', undefined)

    try {
      expect(getBrowserViewportWidth()).toBe(900)
    } finally {
      vi.unstubAllGlobals()
      if (innerWidthDescriptor !== undefined) {
        Object.defineProperty(window, 'innerWidth', innerWidthDescriptor)
      }
      if (visualViewportDescriptor !== undefined) {
        Object.defineProperty(window, 'visualViewport', visualViewportDescriptor)
      } else {
        Reflect.deleteProperty(window, 'visualViewport')
      }
    }
  })

  it('falls back to the legacy default viewport width when no width source resolves', () => {
    const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    const documentDescriptor = Object.getOwnPropertyDescriptor(
      window.document.documentElement,
      'clientWidth',
    )
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 0 })
    Object.defineProperty(window.document.documentElement, 'clientWidth', {
      configurable: true,
      value: 0,
    })

    try {
      expect(getBrowserViewportWidth()).toBe(1440)
    } finally {
      if (innerWidthDescriptor !== undefined) {
        Object.defineProperty(window, 'innerWidth', innerWidthDescriptor)
      }
      if (documentDescriptor !== undefined) {
        Object.defineProperty(window.document.documentElement, 'clientWidth', documentDescriptor)
      }
    }
  })

  // At a real browser width of 1272px -- just above
  // APP_SHELL_DESKTOP_BREAKPOINT (1264px, drawerLayout.ts) -- the navigation drawer must not close
  // itself on route navigation, while dialogs are open, or while operating dropdowns, and the hamburger
  // toggle must keep opening it. Cause to guard against: returning
  // `Math.min(innerWidth, visualViewport.width, documentElement.clientWidth)`. On real desktop
  // Chrome with a classic (non-overlay) scrollbar -- the Linux default -- `visualViewport.width`
  // and `documentElement.clientWidth` both exclude the scrollbar's gutter (commonly 15-17px) while
  // `window.innerWidth` does not, so any routed page tall enough to need a vertical scrollbar (or
  // any MUI Modal locking/unlocking body scroll) silently narrows the *computed* viewport width
  // below the 1264px breakpoint even though the physical browser window never changed size. This
  // pins the exact reported numbers: at innerWidth=1272 with a plausible 15px scrollbar gutter
  // reflected in visualViewport/clientWidth, the resolved width must stay 1272, not fall to 1257.
  //
  // This numeric width does not decide the App Shell's own desktop/mobile drawer
  // breakpoint (see appShell.viewportBreakpoint.imp.test.ts for that, now backed by
  // `isDesktopViewport()`/`matchMedia`), but it is still the value fed to feature layouts that
  // need an actual pixel width (Recorded two-card layout, playback narrow controls, etc.), so the
  // same scrollbar-gutter bug would still apply to those if this regressed.
  it("prefers window.innerWidth over a narrower visualViewport/clientWidth caused by the page's own scrollbar gutter", () => {
    const innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth')
    const visualViewportDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    const documentDescriptor = Object.getOwnPropertyDescriptor(
      window.document.documentElement,
      'clientWidth',
    )
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1272 })
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { width: 1257 },
    })
    Object.defineProperty(window.document.documentElement, 'clientWidth', {
      configurable: true,
      value: 1257,
    })

    try {
      expect(getBrowserViewportWidth()).toBe(1272)
    } finally {
      if (innerWidthDescriptor !== undefined) {
        Object.defineProperty(window, 'innerWidth', innerWidthDescriptor)
      }
      if (visualViewportDescriptor !== undefined) {
        Object.defineProperty(window, 'visualViewport', visualViewportDescriptor)
      } else {
        Reflect.deleteProperty(window, 'visualViewport')
      }
      if (documentDescriptor !== undefined) {
        Object.defineProperty(window.document.documentElement, 'clientWidth', documentDescriptor)
      }
    }
  })
})

describe('App Shell route path browser accessors without a window', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves no hash route and no href without a window', () => {
    vi.stubGlobal('window', undefined)

    expect(createFullRoutePathFromBrowserHash()).toBeNull()
    expect(createBrowserLocationHref()).toBeUndefined()
  })

  it('reads the real hash route and href when a window exists', () => {
    window.history.replaceState(null, '', '/#/recorded')

    expect(createFullRoutePathFromBrowserHash()).toBe('/recorded')
    expect(createBrowserLocationHref()).toBe(window.location.href)
  })

  it('treats an empty hash as the root route', () => {
    window.history.replaceState(null, '', '/#')

    expect(createFullRoutePathFromBrowserHash()).toBe('/')
  })

  it('parses a route path without a query string to an empty search', () => {
    expect(parseRoutePath('/recorded')).toStrictEqual({ pathname: '/recorded', search: '' })
  })

  it('drops undefined query entries when building a navigation path', () => {
    expect(
      createNavigationPath({
        path: '/guide',
        query: { type: undefined },
      }),
    ).toBe('/guide')
  })

  it('appends each entry of an array query value when building a navigation path', () => {
    expect(
      createNavigationPath({
        path: '/search',
        query: { keyword: ['drama', 'anime'] },
      }),
    ).toBe('/search?keyword=drama&keyword=anime')
  })

  it('returns the bare path when the navigation route has no query at all', () => {
    expect(createNavigationPath({ path: '/', query: {} })).toBe('/')
  })
})

describe('App Shell route scroll position accessors', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.documentElement.classList.remove('fix-address-bar2')
  })

  it('reads the window scroll position when there is no document', () => {
    vi.stubGlobal('document', undefined)

    expect(createBrowserScrollPosition()).toStrictEqual({ x: window.scrollX, y: window.scrollY })
  })

  it('reads (0, 0) scroll position without a window', () => {
    vi.stubGlobal('window', undefined)

    expect(createBrowserScrollPosition()).toStrictEqual({ x: 0, y: 0 })
  })

  it('does nothing when scrolling without a window', () => {
    vi.stubGlobal('window', undefined)

    expect(() => scrollActiveRouteTo({ x: 10, y: 20 })).not.toThrow()
  })

  it('does nothing when window.scrollTo is unavailable', () => {
    const scrollToDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollTo')
    // @ts-expect-error -- simulate an environment without window.scrollTo support
    delete window.scrollTo

    try {
      expect(() => scrollActiveRouteTo({ x: 10, y: 20 })).not.toThrow()
    } finally {
      if (scrollToDescriptor !== undefined) {
        Object.defineProperty(window, 'scrollTo', scrollToDescriptor)
      }
    }
  })

  it('reads the fixed iOS shell scroll container position over the window scroll position', () => {
    document.documentElement.classList.add('fix-address-bar2')
    document.body.innerHTML = '<main data-testid="shell-main"></main>'
    const shellMain = document.querySelector<HTMLElement>("[data-testid='shell-main']")!
    Object.defineProperty(shellMain, 'scrollLeft', { configurable: true, value: 12 })
    Object.defineProperty(shellMain, 'scrollTop', { configurable: true, value: 34 })

    expect(createBrowserScrollPosition()).toStrictEqual({ x: 12, y: 34 })

    document.body.innerHTML = ''
  })

  it('assigns scrollLeft/scrollTop directly on the fixed shell container without a scrollTo method', () => {
    document.documentElement.classList.add('fix-address-bar2')
    document.body.innerHTML = '<main data-testid="shell-main"></main>'
    const shellMain = document.querySelector<HTMLElement>("[data-testid='shell-main']")!
    // @ts-expect-error -- simulate a container without a scrollTo method
    delete shellMain.scrollTo

    scrollActiveRouteTo({ x: 5, y: 6 })

    expect(shellMain.scrollLeft).toBe(5)
    expect(shellMain.scrollTop).toBe(6)

    document.body.innerHTML = ''
  })

  it('calls scrollTo on the fixed shell container when available', () => {
    document.documentElement.classList.add('fix-address-bar2')
    document.body.innerHTML = '<main data-testid="shell-main"></main>'
    const shellMain = document.querySelector<HTMLElement>("[data-testid='shell-main']")!
    const scrollTo = vi.fn()
    shellMain.scrollTo = scrollTo

    scrollActiveRouteTo({ x: 7, y: 8 })

    expect(scrollTo).toHaveBeenCalledWith({ left: 7, top: 8, behavior: 'auto' })

    document.body.innerHTML = ''
  })
})

describe('App Shell startup settings snapshots without a window', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('[AC 1.1] falls back to the default theme and navigation settings without a window', () => {
    vi.stubGlobal('window', undefined)

    expect(loadThemeSettingsSnapshot()).toStrictEqual({
      shouldUseOSColorTheme: true,
      isForceDarkTheme: false,
    })
    expect(loadNavigationSettingsSnapshot()).toStrictEqual({
      isEnableDisplayForEachBroadcastWave: false,
    })
  })

  it('[AC 1.1] falls back to factory dashboard settings without a window', () => {
    vi.stubGlobal('window', undefined)

    expect(loadDashboardSettingsSnapshot().isEnablePWA).toBeDefined()
  })

  it('falls back to factory dashboard settings when reading storage throws', () => {
    const getItemSpy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })

    try {
      expect(loadDashboardSettingsSnapshot().isEnablePWA).toBeDefined()
    } finally {
      getItemSpy.mockRestore()
    }
  })

  it('does nothing to PWA startup wiring without a window or document', () => {
    vi.stubGlobal('window', undefined)

    expect(() => applyBrowserPwaStartupSettings()).not.toThrow()
  })
})

describe('App Shell startup when the localStorage accessor is refused', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const refuseStorage = () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    })
  }

  it('loads default theme settings when the accessor throws', () => {
    refuseStorage()
    const defaults = new DefaultSettingsFactory().create()

    expect(loadThemeSettingsSnapshot()).toStrictEqual({
      shouldUseOSColorTheme: defaults.shouldUseOSColorTheme,
      isForceDarkTheme: defaults.isForceDarkTheme,
    })
  })

  it('loads default navigation settings when the accessor throws', () => {
    refuseStorage()
    const defaults = new DefaultSettingsFactory().create()

    expect(loadNavigationSettingsSnapshot()).toStrictEqual({
      isEnableDisplayForEachBroadcastWave: defaults.isEnableDisplayForEachBroadcastWave,
    })
  })

  it('loads default dashboard settings when the accessor throws', () => {
    refuseStorage()

    expect(loadDashboardSettingsSnapshot()).toMatchObject({
      isEnablePWA: new DefaultSettingsFactory().create().isEnablePWA,
      isEnableDisplayForEachBroadcastWave: false,
    })
  })

  it('starts PWA service worker setup with defaults when the accessor throws', () => {
    const register = vi.fn().mockResolvedValue({ update: vi.fn() })
    vi.spyOn(window, 'navigator', 'get').mockReturnValue({
      serviceWorker: { register },
    } as unknown as Navigator)
    refuseStorage()

    expect(() => applyBrowserPwaStartupSettings()).not.toThrow()
    expect(register).toHaveBeenCalledExactlyOnceWith('./serviceWorker.js')
  })
})

describe('App Shell API repository navigator implementation edges', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves no default url scheme platform and no default iPadOS flag without a navigator', async () => {
    vi.stubGlobal('navigator', undefined)
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ isEnableTSLiveStream: true })))

    const repository = createFetchServerApiRepository({ fetcher, basePath: './api' })

    await expect(repository.fetchServerConfig()).resolves.toStrictEqual({
      ok: true,
      value: {
        status: 'loaded',
        liveStreamEnabled: true,
        enabledBroadcastWaves: [],
      },
    })
  })

  it('detects the default iPadOS flag from the real navigator user agent', async () => {
    const userAgentDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
    const touchPointsDescriptor = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints')
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })

    try {
      const fetcher = vi.fn(async () => new Response(JSON.stringify({})))
      const repository = createFetchServerApiRepository({
        fetcher,
        basePath: './api',
        platform: 'ios',
      })

      await expect(repository.fetchServerConfig()).resolves.toMatchObject({
        ok: true,
        value: { status: 'loaded' },
      })
    } finally {
      if (userAgentDescriptor !== undefined) {
        Object.defineProperty(navigator, 'userAgent', userAgentDescriptor)
      }
      if (touchPointsDescriptor !== undefined) {
        Object.defineProperty(navigator, 'maxTouchPoints', touchPointsDescriptor)
      }
    }
  })

  it('does not treat a desktop Mac without multi-touch as iPadOS', async () => {
    const userAgentDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
    const touchPointsDescriptor = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints')
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 })

    try {
      const fetcher = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              streamConfig: { live: { ts: { m2tsll: ['ll-low'] } } },
            }),
          ),
      )
      const repository = createFetchServerApiRepository({
        fetcher,
        basePath: './api',
        platform: 'ios',
      })

      await expect(repository.fetchServerConfig()).resolves.toStrictEqual({
        ok: true,
        value: {
          status: 'loaded',
          liveStreamEnabled: false,
          enabledBroadcastWaves: [],
        },
      })
    } finally {
      if (userAgentDescriptor !== undefined) {
        Object.defineProperty(navigator, 'userAgent', userAgentDescriptor)
      }
      if (touchPointsDescriptor !== undefined) {
        Object.defineProperty(navigator, 'maxTouchPoints', touchPointsDescriptor)
      }
    }
  })
})

describe('App Shell settings storage adapter error handling', () => {
  it('falls back to default theme settings when reading storage throws', () => {
    const throwingStorage: Storage = {
      ...localStorage,
      getItem: () => {
        throw new Error('storage unavailable')
      },
    }

    const defaults = new DefaultSettingsFactory().create()

    expect(readThemeSettingsSnapshot(throwingStorage)).toStrictEqual({
      shouldUseOSColorTheme: defaults.shouldUseOSColorTheme,
      isForceDarkTheme: defaults.isForceDarkTheme,
    })
  })
})

describe('App Shell server config selectors without a navigator', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('is never an iOS address bar fix target without a navigator', () => {
    vi.stubGlobal('navigator', undefined)

    expect(isIOSAddressBarFixTarget()).toBe(false)
  })

  it('resolves the recorded download and view URL scheme for the detected platform', () => {
    const userAgentDescriptor = Object.getOwnPropertyDescriptor(navigator, 'userAgent')
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })

    try {
      expect(
        getRecordedDownloadUrlScheme({
          status: 'loaded',
          liveStreamEnabled: false,
          enabledBroadcastWaves: [],
          urlscheme: { download: { win: 'epgstation://download' } },
        }),
      ).toBe('epgstation://download')
      expect(
        getRecordedViewUrlScheme({
          status: 'loaded',
          liveStreamEnabled: false,
          enabledBroadcastWaves: [],
          urlscheme: { video: { win: 'epgstation://view' } },
        }),
      ).toBe('epgstation://view')
    } finally {
      if (userAgentDescriptor !== undefined) {
        Object.defineProperty(navigator, 'userAgent', userAgentDescriptor)
      }
    }
  })

  it('resolves no download or view URL scheme without a navigator', () => {
    vi.stubGlobal('navigator', undefined)

    expect(
      getRecordedDownloadUrlScheme({
        status: 'loaded',
        liveStreamEnabled: false,
        enabledBroadcastWaves: [],
        urlscheme: { download: { win: 'epgstation://download' } },
      }),
    ).toBeNull()
    expect(
      getRecordedViewUrlScheme({
        status: 'loaded',
        liveStreamEnabled: false,
        enabledBroadcastWaves: [],
        urlscheme: { video: { win: 'epgstation://view' } },
      }),
    ).toBeNull()
  })
})

describe('URL scheme platform detection without a navigator', () => {
  it('resolves no platform when no navigator-like value is provided', () => {
    expect(detectNavigatorUrlSchemePlatform(undefined)).toBeNull()
  })
})

describe('Socket.IO realtime connector defaults', () => {
  it('resolves the default socket.io client and the real browser location without options', () => {
    expect(() => createSocketIoRealtimeConnector()).not.toThrow()
  })
})
