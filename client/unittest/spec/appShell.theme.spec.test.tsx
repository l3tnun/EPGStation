import { act, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { installDashboardFetchMock, renderFixedIOSShell } from './support/appShellSpecSupport'

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
  it('[AC 1.3] [AC 7.5] applies saved dark theme settings across the shell without reading global OS state', () => {
    window.history.replaceState(null, '', '/#/')

    render(
      <App
        settings={{
          shouldUseOSColorTheme: false,
          isForceDarkTheme: true,
        }}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'dark')
    expect(document.documentElement).toHaveAttribute('data-theme-mode', 'dark')
    expect(document.body).toHaveAttribute('data-theme-mode', 'dark')
  })

  it('[AC 7.5] restores a pre-existing theme-mode dataset value on unmount instead of deleting it', () => {
    document.body.dataset.themeMode = 'preexisting-body'
    document.documentElement.dataset.themeMode = 'preexisting-document'

    const { unmount } = render(
      <App osPrefersDark={false} viewportWidth={1440} initialDrawerState="none" />,
    )

    expect(document.body).toHaveAttribute('data-theme-mode', 'light')

    unmount()

    expect(document.body.dataset.themeMode).toBe('preexisting-body')
    expect(document.documentElement.dataset.themeMode).toBe('preexisting-document')

    delete document.body.dataset.themeMode
    delete document.documentElement.dataset.themeMode
  })

  it('[AC 6.19] [AC 6.20] [AC 6.21] [AC 7.4] keeps document overscroll background synchronized with shell dark mode', () => {
    const css = readFileSync('src/index.css', 'utf8')

    expect(css).toContain('--app-document-background: #f5f5f5;')
    expect(css).toMatch(
      /html,\s*body,\s*#root\s*\{[\s\S]*?background: var\(--app-document-background\);[\s\S]*?overscroll-behavior-y: none;/,
    )
    expect(css).toMatch(/html\.fix-address-bar\s*\{[\s\S]*?overflow: hidden !important;/)
    expect(css).toMatch(/html\.fix-address-bar2\s*\{[\s\S]*?overflow: hidden !important;/)
    const fixedIOSAddressBarRule = css.match(/html\.fix-address-bar2\s*\{(?<rule>[\s\S]*?)\}/)
    expect(fixedIOSAddressBarRule?.groups?.rule).not.toContain('position: fixed;')
    expect(fixedIOSAddressBarRule?.groups?.rule).not.toContain('inset: 0;')
    expect(css).toContain('height: var(--app-viewport-height, 100%);')
    expect(css).toMatch(
      /html\.fix-address-bar body,\s*html\.fix-address-bar #root,\s*html\.fix-address-bar2 body,\s*html\.fix-address-bar2 #root\s*\{[\s\S]*?height: var\(--app-viewport-height, 100%\);/,
    )
    expect(css).toMatch(
      /html\.fix-address-bar2 body,\s*html\.fix-address-bar2 #root,\s*html\.fix-address-bar2 \[data-testid='app-shell'\]\s*\{[\s\S]*?height: var\(--app-viewport-height, 100%\);[\s\S]*?min-height: 0;[\s\S]*?overflow: hidden;/,
    )
    expect(css).toMatch(
      /html\.fix-address-bar2 \[data-testid='shell-content'\]\s*\{[\s\S]*?height: var\(--app-viewport-height, 100%\);[\s\S]*?min-height: 0;[\s\S]*?overflow: hidden;/,
    )
    expect(css).toMatch(
      /html\.fix-address-bar2 \[data-testid='shell-main'\]\s*\{[\s\S]*?box-sizing: border-box;[\s\S]*?height: var\(--app-viewport-height, 100%\);[\s\S]*?max-height: var\(--app-viewport-height, 100%\);[\s\S]*?overscroll-behavior-y: contain;[\s\S]*?overflow-y: auto;[\s\S]*?padding-top: var\(--app-title-bar-height, 64px\);[\s\S]*?-webkit-overflow-scrolling: touch;/,
    )
    expect(css).toMatch(
      /html\.fix-address-bar2 \[data-testid='title-bar'\],\s*html\.fix-address-bar2 \[data-testid='edit-title-bar'\]\s*\{[\s\S]*?position: fixed !important;[\s\S]*?left: var\(--app-main-offset, 0px\);[\s\S]*?touch-action: none;/,
    )
    expect(css).toMatch(
      /html\[data-theme-mode='dark'\]\s*\{[\s\S]*?--app-document-background: #121212;/,
    )
  })

  it('[AC 8.30] allows Android Chrome to synthesize bold Japanese fallback glyphs for routed program titles', () => {
    const css = readFileSync('src/index.css', 'utf8')

    expect(css).toMatch(/:root\s*\{[\s\S]*?font-synthesis:\s*weight;/)
    expect(css).not.toMatch(/:root\s*\{[\s\S]*?font-synthesis:\s*none;/)
  })

  it('[AC 6.19] clamps outer document scroll when the fixed iOS shell viewport changes', async () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    let visualViewportResizeListener: (() => void) | undefined
    const visualViewportDescriptor = Object.getOwnPropertyDescriptor(window, 'visualViewport')
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        height: 640,
        addEventListener: vi.fn((eventName: string, listener: () => void) => {
          if (eventName === 'resize') {
            visualViewportResizeListener = listener
          }
        }),
        removeEventListener: vi.fn(),
      },
    })

    document.documentElement.scrollTop = 72
    document.body.scrollTop = 24
    renderFixedIOSShell(<div data-testid="fixed-shell-content">content</div>)

    document.documentElement.scrollTop = 72
    document.body.scrollTop = 24
    act(() => {
      visualViewportResizeListener?.()
    })

    await waitFor(() => {
      expect(scrollToSpy).toHaveBeenCalledWith({ left: 0, top: 0, behavior: 'auto' })
    })
    expect(document.documentElement.scrollTop).toBe(0)
    expect(document.body.scrollTop).toBe(0)

    if (visualViewportDescriptor !== undefined) {
      Object.defineProperty(window, 'visualViewport', visualViewportDescriptor)
    } else {
      Reflect.deleteProperty(window, 'visualViewport')
    }
  })

  it('[AC 6.20] prevents fixed controls from starting document rubber-band scroll', () => {
    renderFixedIOSShell(
      <>
        <div data-testid="title-bar">検索</div>
        <button type="button" style={{ position: 'fixed' }}>
          トップへ戻る
        </button>
      </>,
    )

    const fixedButton = screen.getByRole('button', { name: 'トップへ戻る' })
    const touchStart = new Event('touchstart', { bubbles: true, cancelable: true }) as TouchEvent
    Object.defineProperty(touchStart, 'touches', {
      configurable: true,
      value: [{ clientY: 180 }],
    })
    fixedButton.dispatchEvent(touchStart)

    const touchMove = new Event('touchmove', { bubbles: true, cancelable: true }) as TouchEvent
    Object.defineProperty(touchMove, 'touches', {
      configurable: true,
      value: [{ clientY: 220 }],
    })
    fixedButton.dispatchEvent(touchMove)

    expect(touchMove.defaultPrevented).toBe(true)
  })

  it('[AC 6.21] applies the legacy iOS address-bar class to iPad routes and removes it on non-iOS', async () => {
    const userAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent')
    const platformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'platform')
    const maxTouchPointsDescriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      'maxTouchPoints',
    )
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Synthetic iPad Safari',
    })
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'MacIntel',
    })
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      configurable: true,
      value: 5,
    })

    const { rerender, unmount } = render(
      <App osPrefersDark={false} viewportWidth={1279} initialDrawerState="none" />,
    )

    await screen.findByTestId('dashboard-page')
    expect(document.documentElement).toHaveClass('fix-address-bar2')
    expect(document.documentElement.style.overflow).toBe('')

    window.history.replaceState(null, '', '/#/recorded')
    rerender(<App osPrefersDark={false} viewportWidth={1022} initialDrawerState="none" />)
    await screen.findByText('録画済み')
    expect(document.documentElement).toHaveClass('fix-address-bar2')

    unmount()
    Object.defineProperty(window.navigator, 'maxTouchPoints', {
      configurable: true,
      value: 0,
    })
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Synthetic Desktop',
    })
    render(<App osPrefersDark={false} viewportWidth={1022} initialDrawerState="none" />)

    await waitFor(() => {
      expect(document.documentElement).not.toHaveClass('fix-address-bar2')
    })
    expect(document.documentElement.style.overflow).toBe('')

    if (userAgentDescriptor !== undefined) {
      Object.defineProperty(window.navigator, 'userAgent', userAgentDescriptor)
    } else {
      Reflect.deleteProperty(window.navigator, 'userAgent')
    }
    if (platformDescriptor !== undefined) {
      Object.defineProperty(window.navigator, 'platform', platformDescriptor)
    } else {
      Reflect.deleteProperty(window.navigator, 'platform')
    }
    if (maxTouchPointsDescriptor !== undefined) {
      Object.defineProperty(window.navigator, 'maxTouchPoints', maxTouchPointsDescriptor)
    } else {
      Reflect.deleteProperty(window.navigator, 'maxTouchPoints')
    }
  })

  it('[AC 7.2] keeps migrated CSS modules wired to shell dark mode overrides', () => {
    const cssFiles = [
      'src/app/AppShell.module.css',
      'src/features/dashboard/DashboardPage.module.css',
      'src/features/guide/GuidePage.module.css',
      'src/features/onair/OnAirPage.module.css',
      'src/features/recorded/RecordedPage.module.css',
      'src/features/storages/upload/RecordedUploadPage.module.css',
      'src/features/recording/RecordingPage.module.css',
      'src/features/reserves/ReservesPage.module.css',
      'src/features/search/rule/SearchRulePage.module.css',
      'src/features/settings/SettingsPage.module.css',
      'src/features/storages/StoragesPage.module.css',
      'src/features/video/playback/PlaybackPage.module.css',
      'src/shared/PaginationColors.module.css',
    ]

    cssFiles.forEach((path) => {
      expect(readFileSync(path, 'utf8'), path).toContain(":global([data-theme-mode='dark'])")
    })
  })

  it('[AS-7] [AC 8.48] paints the current page #1976d2 with white text in both themes, not with the theme primary token', () => {
    const css = readFileSync('src/shared/PaginationColors.module.css', 'utf8')
    const light = css.match(
      /(?:^|\n)\.pageButton\[aria-current='page'\],\s*:global\(\[data-theme-mode='dark'\]\) \.pageButton\[aria-current='page'\]\s*{([^}]*)}/,
    )

    expect(light?.[1]).toBeDefined()
    expect(light?.[1]).toMatch(/background:\s*#1976d2;/)
    expect(light?.[1]).toMatch(/color:\s*#fff;/)
    expect(css).not.toContain('--mui-palette-primary-main')
    // The current page rule comes after the dark rule for ordinary buttons, so it wins at equal specificity.
    expect(css.indexOf("[aria-current='page']")).toBeGreaterThan(
      css.indexOf(":global([data-theme-mode='dark']) .pageButton {"),
    )
  })
})
