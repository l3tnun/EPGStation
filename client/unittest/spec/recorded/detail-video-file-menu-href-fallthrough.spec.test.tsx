import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import { createPlaybackNavigationConfig, createShellRepository } from './recordedSpecHelpers'
import { createRecordedRepository } from './recordedSpecRepository'

// RecordedDetailVideoFileMenu never calls onSelect for a file whose href resolves (it renders
// a plain <a href> instead), so playVideoFile's onSelect callback only ever runs for files that
// resolved to a 'route' target in real usage. This mock bypasses that UI gate to invoke
// onSelect directly for every file, proving the (target.kind !== 'route') fallthrough is a
// deliberate no-op rather than a broken handler.
vi.mock('@/features/recorded/components/RecordedDetailVideoFileMenu', () => ({
  RecordedDetailVideoFileMenu: (props: {
    title: string
    files: readonly { id?: number; name?: string }[]
    onSelect: (file: { id?: number; name?: string }) => void
  }) => (
    <div>
      {props.files.map((file) => (
        <button key={file.id} type="button" onClick={() => props.onSelect(file)}>
          {`${props.title}-force-select-${file.id}`}
        </button>
      ))}
    </div>
  ),
}))

describe('Recorded detail route, data, and actions', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/recorded/detail/301')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 4.6] does not navigate when a forced onSelect resolves to a non-route (href) playback target', async () => {
    const recordedRepository = createRecordedRepository()

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isPreferredPlayingOnWeb: false,
        }}
        apiRepository={createShellRepository()}
        recordedApiRepository={recordedRepository}
        navigationConfig={createPlaybackNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('recorded-detail-page')
    // Under isPreferredPlayingOnWeb: false, every video file resolves to an href target, so
    // this forced onSelect call reaches playVideoFile's non-route fallthrough.
    fireEvent.click(screen.getByText('play-force-select-701'))

    expectHashRoute('#/recorded/detail/301')
    expect(screen.getByTestId('title-bar')).toHaveTextContent('録画詳細')
  })
})
