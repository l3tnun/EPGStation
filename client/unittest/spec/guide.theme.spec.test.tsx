import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { buildGuideFetchRequestSet, formatGuideRouteTime } from '@/features/guide/guideRequests'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createShellRepository,
  createGuideNavigationConfigWithEncodeModes,
  createGuideRepository,
  waitForGuideVisible,
} from './support/guideSpecHarness'

describe('Guide route and fetch lifecycle', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('fix-address-bar', 'guide-shell-scroll-lock')
    window.history.replaceState(null, '', '/#/guide?type=BS&time=26050509')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-05-05T09:00:00+09:00'))
  })

  afterEach(() => {
    document.documentElement.classList.remove('fix-address-bar', 'guide-shell-scroll-lock')
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 2.4] [AC 2.18] [AC 2.19] [AC 4.24a] keeps Guide dialogs and form chrome theme-aware for dark mode', () => {
    const css = readFileSync('src/features/guide/GuidePage.module.css', 'utf8')

    expect(css).toContain(
      ":global([data-theme-mode='dark']) .guidePage:not([data-guide-dark-colors='disabled'])",
    )
    expect(css).toContain('--guide-surface: #121212;')
    expect(css).toContain('--guide-surface-alt: #1e1e1e;')
    expect(css).toContain('color: inherit;')
    expect(css).toContain('color-mix(in srgb, currentColor 62%, transparent)')
    expect(css).toContain('background: var(--guide-surface-alt, #fff);')
    expect(css).toContain('padding: 2px 4px;')
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\)\s+\.guidePage:not\(\[data-guide-dark-colors='disabled'\]\)\s+:global\(\.ctg-0\)/,
    )
    expect(css).toContain('background: #40b6bd;')
    for (const color of [
      '#40b6bd',
      '#97a039',
      '#59b1c7',
      '#d88686',
      '#7fa534',
      '#cf56a1',
      '#d85b2a',
      '#eb8242',
      '#515585',
      '#83a993',
      '#2c7873',
      '#46b3e6',
      '#445165',
    ]) {
      expect(css).toContain(`background: ${color};`)
    }
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\)\s+\.guidePage:not\(\[data-guide-dark-colors='disabled'\]\)\s+:global\(\.guide-channel-header-item\)/,
    )
    expect(css).toContain('background: #393e46;')
    expect(css).toContain('border-left-color: #888888;')
    expect(css).toContain('border-right-color: #888888;')
    expect(css).toContain('border-color: #443737;')
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\)\s+\.guidePage:not\(\[data-guide-dark-colors='disabled'\]\)\s+:global\(\.guide-program-cell\.reserve\)\s*\{\s*border-color: red;/,
    )
    expect(css).toMatch(
      /:global\(\[data-theme-mode='dark'\]\)\s+\.guidePage:not\(\[data-guide-dark-colors='disabled'\]\)\s+:global\(\.guide-program-cell\.conflict\)\s*\{[\s\S]*?border-color: red;/,
    )
    expect(css).toContain('color: #f3f3f3;')
    expect(css).toContain('background: #272121;')
    expect(css).toContain('--guide-time-scale-text: #fff;')
    expect(css).toContain('.programDialogFooter {')
    expect(css).toContain('height: auto;')
    expect(css).toContain('.programOptionList {')
    expect(css).toContain('height: 52px;')
    expect(css).toContain('overflow-x: hidden;')
    expect(css).toContain('.programCheckbox :global(.MuiFormControlLabel-label)')
    expect(css).toContain('color: inherit;')
    expect(css).toContain('.programOptionList .settingField :global(.MuiInputBase-root)')
    expect(css).toContain('height: 48px;')
  })

  it('[AC 2.20] [AC 2.21] uses the App Shell viewport contract for Guide height instead of a page-local iOS fix', () => {
    const guideCss = readFileSync('src/features/guide/GuidePage.module.css', 'utf8')
    const guideSource = readFileSync('src/features/guide/GuidePage.tsx', 'utf8')

    expect(guideCss).not.toMatch(/height:\s*calc\(100vh\s*-/)
    expect(guideCss).toContain(
      'height: calc(var(--app-viewport-height, 100dvh) - var(--app-title-bar-height, 64px));',
    )
    expect(guideCss).toContain(
      'height: calc(var(--app-viewport-height, 100dvh) - var(--app-title-bar-height, 56px));',
    )
    expect(guideCss).toContain(':global(.guide-shell-scroll-lock) .guidePage')
    expect(guideSource).not.toContain("classList.add('fix-address-bar')")
    expect(guideSource).toContain("classList.add('guide-shell-scroll-lock')")
  })

  it('[AC 2.17] prevents iOS simulator Safari button font fallback from corrupting Guide program text', () => {
    const guideCss = readFileSync('src/features/guide/GuidePage.module.css', 'utf8')

    expect(guideCss).toMatch(
      /\.guidePage :global\(\.guide-program-cell\)\s*\{[\s\S]*?font-family:\s*inherit;/,
    )
  })

  it('[G-12] does not gate the size-setting select width behind an exact-match viewport media query', () => {
    const guideCss = readFileSync('src/features/guide/GuidePage.module.css', 'utf8')

    expect(guideCss).not.toMatch(/@media\s*\(\s*width:\s*600px\s*\)/)
  })

  it('[AC 32] does not add helper-text row padding to the ProgramDialog encode AppSelect', () => {
    // The helper-text row reservation (AC 32) is scoped to `/reserves/manual` add-mode
    // option-panel fields (`ReservesPage.module.css`), not applied theme-wide, so this
    // fixed-height dialog row needs no counter-rule: measured scrollHeight 55px against
    // clientHeight 53px, forcing scroll inside `.programOptionList`, does not reproduce
    // (`e2e/broadcast-guide-dialog-workflow.spec.ts` "keeps Guide ProgramDialog mobile controls
    // compact and operable").
    const guideCss = readFileSync('src/features/guide/GuidePage.module.css', 'utf8')

    expect(guideCss).not.toContain('.programOptionList .settingField :global(.MuiFormControl-root)')
  })

  it('[AC 2.7] [AC 2.18] disables only Guide grid dark palette when force-disable Guide dark theme is enabled', async () => {
    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isForceDarkTheme: true,
          isForceDisableDarkThemeForGuide: true,
          shouldUseOSColorTheme: false,
        }}
        apiRepository={createShellRepository()}
        guideApiRepository={createGuideRepository()}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const guidePage = await waitForGuideVisible()
    expect(screen.getByTestId('app-shell')).toHaveAttribute('data-theme-mode', 'dark')
    expect(document.body).toHaveAttribute('data-theme-mode', 'dark')
    expect(guidePage).toHaveAttribute('data-guide-dark-colors', 'disabled')
  })
})

describe('Guide timezone contract', () => {
  it('[AC 1.4] uses Japan time for route time and schedule request boundaries', () => {
    const utcTimestamp = Date.parse('2026-05-04T15:00:00.000Z')

    expect(formatGuideRouteTime(utcTimestamp)).toBe('26050500')

    const requestSet = buildGuideFetchRequestSet({
      search: '?time=26050500&type=GR',
      settings: {
        ...new DefaultSettingsFactory().create(),
        guideLength: 6,
        isHalfWidthDisplayed: false,
        isShowOnlyFreePrograms: true,
      },
      invalidChannelIds: new Set(),
      now: Date.parse('2026-05-04T12:00:00.000Z'),
    })

    expect(requestSet.guideQuery.startAt).toBe(utcTimestamp)
    expect(requestSet.schedule).toMatchObject({
      startAt: utcTimestamp,
      endAt: utcTimestamp + 6 * 60 * 60 * 1000,
      GR: true,
      BS: false,
      isFree: true,
    })
  })
})
