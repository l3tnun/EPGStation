import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from '@/App'
import type { ServerConfigNavigationState } from '@/app/serverApi'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository } from '../recorded/recordedSpecHelpers'
import { createRecordedRepository } from '../recorded/recordedSpecRepository'

vi.mock('react-hook-form', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-hook-form')>()

  return {
    ...actual,
    useWatch: () => ({}),
  }
})

describe('Recorded upload form watch fallback', () => {
  it('[AC 2.2] falls back to the route-init video blocks when the watched form state has none yet', async () => {
    window.history.replaceState(null, '', '/#/recorded/upload')
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={
          {
            status: 'loaded',
            liveStreamEnabled: false,
            enabledBroadcastWaves: [],
            recordedDirectories: ['archive-root'],
          } as ServerConfigNavigationState
        }
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    const page = await screen.findByTestId('recorded-upload-page')
    expect(page).toHaveAttribute('data-video-block-count', '1')
    expect(screen.getByTestId('recorded-upload-video-block-0')).toBeVisible()
  })
})
