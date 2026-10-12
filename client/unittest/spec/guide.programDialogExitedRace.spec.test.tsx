import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { createShellRepository, createGuideRepository } from './support/guideSpecHarness'

// GuidePage's onProgramDialogExited only clears the selected program id when the dialog is
// no longer open at the moment the exit transition finishes. Reaching that "still reopened"
// branch through the real MUI Dialog transition is not reliable (react-transition-group
// cancels a pending exit as soon as `open` flips back to true), so GuideProgramOverlays is
// replaced here with a stub that lets the test fire `onProgramDialogExited` at a precisely
// controlled moment instead of racing a real CSS transition.
vi.mock('@/features/guide/components/GuideProgramOverlays', () => ({
  GuideProgramOverlays: (props: {
    selectedProgramId: number | undefined
    programDialogOpen: boolean
    onProgramDialogExited: () => void
  }) => (
    <div data-testid="program-overlays-stub" data-selected-program-id={props.selectedProgramId}>
      <button
        type="button"
        onClick={props.onProgramDialogExited}
        data-testid="fire-program-dialog-exited"
      >
        fire onExited
      </button>
    </div>
  ),
}))

describe('GuidePage onProgramDialogExited race guard', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.classList.remove('fix-address-bar', 'guide-shell-scroll-lock')
    window.history.replaceState(null, '', '/#/guide?time=26050509')
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-05-05T09:00:00+09:00'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 4.20] keeps the selected program id when the dialog has already been reopened by the time the exit transition fires', async () => {
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')
    const guideRepository = createGuideRepository()
    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: { id: 301, name: 'Synthetic Channel', type: 0x01 },
          programs: [{ id: 700, name: 'P700', startAt, endAt: startAt + 30 * 60 * 1000 }],
        },
      ],
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={{
          status: 'loaded',
          liveStreamEnabled: false,
          enabledBroadcastWaves: ['GR', 'BS'],
        }}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    // Opens the program dialog, so `programDialogOpen` is true when onExited fires below.
    fireEvent.click(await screen.findByTestId('guide-program-700'))
    expect(screen.getByTestId('program-overlays-stub')).toHaveAttribute(
      'data-selected-program-id',
      '700',
    )

    fireEvent.click(screen.getByTestId('fire-program-dialog-exited'))

    // The alt branch is a no-op: the selected program id must survive because the dialog
    // is still (again) open at the moment the exit transition completed.
    expect(screen.getByTestId('program-overlays-stub')).toHaveAttribute(
      'data-selected-program-id',
      '700',
    )
  })
})
