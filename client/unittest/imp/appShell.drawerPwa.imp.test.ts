import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  APP_SHELL_DESKTOP_BREAKPOINT,
  APP_SHELL_DRAWER_WIDTH,
  resolveDrawerLayout,
} from '@/app/drawerLayout'
import {
  applyPwaStartupSettings,
  readPwaSettingsSnapshot,
  type PwaStartupDocument,
} from '@/app/pwa'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

describe('App Shell drawer layout implementation edges', () => {
  it('keeps the visual contract constants stable', () => {
    expect(APP_SHELL_DESKTOP_BREAKPOINT).toBe(1264)
    expect(APP_SHELL_DRAWER_WIDTH).toBe(256)
  })

  it('keeps the permanent navigation drawer vertically scrollable without horizontal scroll', () => {
    const css = readFileSync(`${process.cwd()}/src/app/AppShell.module.css`, 'utf8')
    const source = readFileSync(`${process.cwd()}/src/app/components/DrawerHost.tsx`, 'utf8')

    expect(css).toMatch(/\.drawerContent\s*\{[\s\S]*?width: 100%;/)
    expect(css).toMatch(/\.drawerContent\s*\{[\s\S]*?overflow-x: hidden;/)
    expect(css).toMatch(/\.drawerContent\s*\{[\s\S]*?overflow-y: auto;/)
    expect(css).toMatch(/\.navigationItem\s*\{[\s\S]*?box-sizing: border-box;/)
    expect(css).toMatch(/\.navigationLabel\s*\{[\s\S]*?overflow: hidden;/)
    expect(css).toMatch(/\.navigationLabel\s*\{[\s\S]*?text-overflow: ellipsis;/)
    expect(css).toMatch(/\.navigationLabel\s*\{[\s\S]*?white-space: nowrap;/)
    expect(source).toContain('data-testid="shell-drawer-content"')
    expect(source).toContain("overflowX: 'hidden'")
    expect(source).toContain("overflowY: 'hidden'")
  })

  it('defaults desktop drawer open and offsets main content by drawer width', () => {
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

  it('defaults tablet and mobile drawer closed with overlay geometry', () => {
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

  it('does not offset main content for a user-opened mobile overlay drawer', () => {
    expect(
      resolveDrawerLayout({
        isDesktop: false,
        userDrawerState: 'userOpen',
      }),
    ).toMatchObject({
      isDesktop: false,
      isDrawerOpen: true,
      drawerVariant: 'temporary',
      mainContentOffset: 0,
    })
  })

  it('honors user-closed state on desktop without reserving drawer space', () => {
    expect(
      resolveDrawerLayout({
        isDesktop: true,
        userDrawerState: 'userClosed',
      }),
    ).toMatchObject({
      isDesktop: true,
      isDrawerOpen: false,
      drawerVariant: 'persistent',
      mainContentOffset: 0,
    })
  })
})

describe('App Shell PWA startup consumer implementation edges', () => {
  it('reads the saved PWA flag without taking ownership of settings defaults', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnablePWA: false,
      }),
    )

    expect(readPwaSettingsSnapshot(localStorage)).toStrictEqual({
      isEnablePWA: false,
    })
  })

  it('removes PWA install hints and skips service worker setup when disabled', () => {
    document.head.innerHTML = `
      <link rel="manifest" href="/manifest.webmanifest">
      <meta name="apple-mobile-web-app-title" content="EPGStation">
      <meta name="apple-mobile-web-app-capable" content="yes">
      <meta name="apple-mobile-web-app-status-bar-style" content="black">
      <meta name="mobile-web-app-capable" content="yes">
      <meta name="theme-color" content="#000000">
      <link rel="apple-touch-icon-precomposed" href="./icon/ios.png" sizes="180x180">
    `
    const register = vi.fn()

    applyPwaStartupSettings(
      {
        isEnablePWA: false,
      },
      {
        document,
        serviceWorker: {
          register,
        },
      } satisfies PwaStartupDocument,
    )

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
    expect(document.querySelector('meta[name="theme-color"]')).toBeInTheDocument()
    expect(
      document.querySelector('link[rel="apple-touch-icon-precomposed"]'),
    ).not.toBeInTheDocument()
    expect(register).not.toHaveBeenCalled()
  })

  it('registers and updates the original service worker when PWA is enabled', async () => {
    const update = vi.fn()
    const register = vi.fn(async () => ({ update }) as unknown as ServiceWorkerRegistration)

    applyPwaStartupSettings(
      {
        isEnablePWA: true,
      },
      {
        document,
        serviceWorker: {
          register,
        },
      } satisfies PwaStartupDocument,
    )

    expect(register).toHaveBeenCalledWith('./serviceWorker.js')
    await vi.waitFor(() => {
      expect(update).toHaveBeenCalled()
    })
  })

  it('registers the service worker without calling update when the registration has none', async () => {
    const register = vi.fn(async () => ({}) as unknown as ServiceWorkerRegistration)

    applyPwaStartupSettings(
      {
        isEnablePWA: true,
      },
      {
        document,
        serviceWorker: {
          register,
        },
      } satisfies PwaStartupDocument,
    )

    await vi.waitFor(() => {
      expect(register).toHaveBeenCalledWith('./serviceWorker.js')
    })
  })

  it('logs and swallows a service worker registration failure instead of throwing', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const register = vi.fn(async () => {
      throw new Error('registration denied')
    })

    applyPwaStartupSettings(
      {
        isEnablePWA: true,
      },
      {
        document,
        serviceWorker: {
          register,
        },
      } satisfies PwaStartupDocument,
    )

    await vi.waitFor(() => {
      expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('registration denied'))
    })

    consoleLogSpy.mockRestore()
  })

  it('falls back to a default PWA snapshot when reading settings throws', () => {
    const throwingStorage: Storage = {
      ...localStorage,
      getItem: () => {
        throw new Error('storage unavailable')
      },
    }

    expect(readPwaSettingsSnapshot(throwingStorage)).toStrictEqual({
      isEnablePWA: new DefaultSettingsFactory().create().isEnablePWA,
    })
  })
})

// Regression guard: the desktop navigation drawer must animate on open/close. Root cause: DrawerHost.tsx forwarded
// `drawerLayout.drawerVariant` ('permanent' | 'persistent' | 'temporary') directly as MUI Drawer's
// `variant` prop, and MUI's `variant="permanent"` never wraps children in a Slide transition
// regardless of `open` (it structurally ignores `open`); combined with the closed desktop drawer
// being unmounted outright, there was nothing to animate in either direction. These are static
// source checks (the same class of check `appShell.drawerPwa.imp.test.ts` already uses above for
// the permanent drawer's overflow contract) guarding against the same class of regression
// resurfacing here, or being introduced at any other conditionally-mounted/variant-switched
// transition in the App Shell.
describe('App Shell drawer animation implementation edges', () => {
  it('never forwards the semantic drawerVariant label directly as the MUI Drawer variant prop', () => {
    const source = readFileSync(`${process.cwd()}/src/app/components/DrawerHost.tsx`, 'utf8')

    expect(source).not.toMatch(/<Drawer[\s\S]*?variant=\{drawerLayout\.drawerVariant\}/)
    expect(source).toContain('variant={muiDrawerVariant}')
    expect(source).toContain('function resolveMuiDrawerVariant')
    // The MUI-facing variant must never resolve to 'permanent' -- that branch is exactly what
    // cannot animate. Only the mobile overlay case should render as MUI 'temporary'; every other
    // case must render as the animatable, always-docked 'persistent'.
    expect(source).toMatch(
      /function resolveMuiDrawerVariant\([\s\S]*?\{\s*return drawerLayout\.isDesktop \? 'persistent' : 'temporary'\s*\}/,
    )
  })

  it('always mounts the navigation drawer regardless of open/closed desktop state', () => {
    const source = readFileSync(`${process.cwd()}/src/app/components/DrawerHost.tsx`, 'utf8')

    // The closed desktop drawer must not be removed from the DOM outright
    // (`shouldMountDrawer ? (<Drawer ...>) : undefined`), which leaves nothing for a Slide transition
    // to animate in either direction. The <Drawer> must always render unconditionally, exactly
    // like the always-mounted mobile (temporary, keepMounted) drawer already does.
    expect(source).toContain('data-drawer-mounted="true"')
    expect(source).not.toMatch(/\?\s*\(\s*<Drawer/)
  })

  it('shifts main content in step with the drawer using the same shared transition duration and easing', () => {
    const source = readFileSync(`${process.cwd()}/src/app/AppShell.tsx`, 'utf8')

    // Matches the legacy Vuetify shell, where `.v-main` carried the same duration/easing as
    // `.v-navigation-drawer` (see drawerLayout.ts). Without this, the drawer would slide smoothly
    // while the main content it displaces jumped in one frame -- the same missed-transition defect
    // in a second place.
    expect(source).toContain('APP_SHELL_DRAWER_TRANSITION_DURATION_MS')
    expect(source).toContain('APP_SHELL_DRAWER_TRANSITION_EASING')
    expect(source).toMatch(
      /transition:\s*`margin-left \$\{APP_SHELL_DRAWER_TRANSITION_DURATION_MS\}ms \$\{APP_SHELL_DRAWER_TRANSITION_EASING\}`/,
    )
  })
})

// Background: computing `mainContentWidth = viewportWidth - drawerLayout.mainContentOffset` in JS and
// pinning the shell-content box to that value via `width`/`maxWidth: var(--app-main-width)` creates a
// feedback loop. On mobile, when that box is wider than the layout viewport, the visual viewport
// widens, which widens the next JS-measured `innerWidth`, which feeds back into the same box's width
// on the next render. These are static source checks pinning that the shell-content box
// does not set an explicit width/maxWidth, so it is sized by the browser's own block layout
// (parent width minus `margin-left`) instead, matching the legacy Vuetify `.v-main` (padding/margin
// only, no measured or set pixel width).
describe('App Shell content width (JS-measured content width feedback loop)', () => {
  it('never pins the shell-content box to a JS-measured width or maxWidth', () => {
    const source = readFileSync(`${process.cwd()}/src/app/AppShell.tsx`, 'utf8')

    expect(source).not.toMatch(/--app-main-width/)
    expect(source).not.toMatch(/\bmaxWidth:/)
    expect(source).not.toMatch(/\bwidth:\s*'var\(--app-main-width\)'/)
    expect(source).not.toContain('contentWidth')
    expect(source).toContain('marginLeft: `${drawerLayout.mainContentOffset}px`')
  })

  it('does not accept a contentWidth prop any more', () => {
    const source = readFileSync(`${process.cwd()}/src/app/AppShell.tsx`, 'utf8')

    expect(source).not.toMatch(/contentWidth:\s*number/)
  })
})
