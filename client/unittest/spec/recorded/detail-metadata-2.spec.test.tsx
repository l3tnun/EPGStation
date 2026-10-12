import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import styles from '@/features/recorded/RecordedPage.module.css'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createPlaybackNavigationConfig, createShellRepository } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

describe('Recorded detail route, data, and actions', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/detail/301')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.2] marks recorded detail primary actions as legacy filled buttons', async () => {
    const recordedRepository = createRecordedRepository()
    const navigationConfig = {
      ...createPlaybackNavigationConfig(),
      encodeModes: ['detail-mode'],
      isEncodeEnabled: true,
      recordedDirectories: ['archive-root'],
    } as ServerConfigNavigationState

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={navigationConfig}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-detail-page')
    expect(screen.getByRole('button', { name: 'play' })).toHaveAttribute(
      'data-recorded-detail-action',
      'play',
    )
    expect(screen.getByRole('button', { name: 'streaming' })).toHaveAttribute(
      'data-recorded-detail-action',
      'streaming',
    )
    expect(screen.getByRole('button', { name: 'encode' })).toHaveAttribute(
      'data-recorded-detail-action',
      'encode',
    )
  })

  // Rendered, not grepped: client/unittest/spec/recorded/list-styles.spec.test.tsx only greps
  // RecordedPage.module.css source text for the `.detailActionIcon` property strings, so it never
  // caught encode's icon `<span>` missing the `detailActionIcon` class in
  // src/features/recorded/RecordedDetailPage.tsx (the class carries `margin-left: -4px` and the
  // 18x18 box from requirement 3.22 — a rule that exists in the CSS regardless of whether any
  // given button's icon actually references it). This asserts the class on the rendered DOM node
  // for all four detail action buttons, so a future button that forgets the class fails here.
  it('[AC 3.22] gives every detail action button a leading icon with the detailActionIcon class', async () => {
    const recordedRepository = createRecordedRepository()
    const navigationConfig = {
      ...createPlaybackNavigationConfig(),
      encodeModes: ['detail-mode'],
      isEncodeEnabled: true,
      recordedDirectories: ['archive-root'],
      kodiHosts: ['kodi-one'],
    } as ServerConfigNavigationState

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={navigationConfig}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-detail-page')

    // MDI glyph codepoints (client/node_modules/@mdi/font/css/materialdesignicons.css):
    // .mdi-play -> \F040A, .mdi-play-circle -> \F040C,
    // .mdi-plus-circle-outline -> \F0419, .mdi-cast -> \F0118.
    const expectedIconGlyphs: Record<string, string> = {
      play: '\u{F040A}',
      streaming: '\u{F040C}',
      encode: '\u{F0419}',
      kodi: '\u{F0118}',
    }

    for (const name of ['play', 'streaming', 'encode', 'kodi']) {
      const button = screen.getByRole('button', { name })
      const icon = button.querySelector('span[aria-hidden="true"]')

      expect(icon, `${name} icon`).not.toBeNull()
      expect(icon?.className, `${name} icon class`).toContain(styles.detailActionIcon)
      expect(icon?.textContent, `${name} icon glyph`).toBe(expectedIconGlyphs[name])
    }
  })
})
