import {
  act,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { existsSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from '../hashRouteAssertions'
import {
  createDashboardRepository,
  createRecordedRepository,
  createReservesRepository,
  createShellRepository,
} from './dashboardTestKit'

describe('Dashboard item routes and thumbnails', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(
      null,
      '',
      '/#/?page=8&keyword=alpha&ruleId=12&channelId=34&genre=5&hasOriginalFile=true',
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('[AC 2.3] [AC 2.4] [AC 2.5] [AC 2.15] routes recorded and recording summary items to recorded detail and opens reserves-owned dialog from reserve cards', async () => {
    const dashboardRepository = createDashboardRepository()
    vi.mocked(dashboardRepository.fetchRecording).mockResolvedValue({
      ok: true,
      value: {
        records: [
          { id: 21, name: 'Recording detail target', videoFiles: [{ id: 210, size: 1024 }] },
        ],
        total: 1,
      },
    })
    vi.mocked(dashboardRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [
          {
            id: 22,
            name: 'Recorded detail target',
            description: 'Recorded description',
            dropLogFile: { id: 1, dropCnt: 2, errorCnt: 1, scramblingCnt: 0 },
            thumbnails: [2200],
            videoFiles: [{ id: 220, size: 1024 }],
          },
        ],
        total: 1,
      },
    })
    vi.mocked(dashboardRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: {
        reserves: [
          {
            id: 23,
            name: 'Reserve dialog target',
            channelId: 3,
            channelType: 'GR',
            channelName: 'Synthetic channel',
            startAt: Date.parse('2026-05-05T10:15:00+09:00'),
            endAt: Date.parse('2026-05-05T10:45:00+09:00'),
            description: 'Reserve dialog description',
            extended: 'https://example.invalid/info',
          },
        ],
        total: 1,
      },
    })

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isShowDropInfoInsteadOfDescription: true,
          isEnableDisplayForEachBroadcastWave: true,
        }}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        recordedApiRepository={createRecordedRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('dashboard-page')
    expect(screen.queryByTestId('dashboard-recording-no-image')).not.toBeInTheDocument()
    expect(screen.getByTestId('dashboard-recording-summary-item')).toHaveAttribute(
      'data-dashboard-recording-card',
      'true',
    )
    const recordingButton = screen.getByRole('button', { name: 'Recording detail target' })
    expect(screen.getByTestId('dashboard-recording-summary-item').contains(recordingButton)).toBe(
      true,
    )
    expect(recordingButton.tagName).toBe('BUTTON')
    expect(screen.getByTestId('dashboard-recorded-thumbnail')).toBeVisible()
    expect(screen.getByTestId('dashboard-recorded-summary-item')).toHaveAttribute(
      'data-dashboard-recorded-card',
      'true',
    )
    expect(screen.getByText('2/1/0 1024 bytes')).toBeVisible()
    expect(screen.queryByText('Recorded description')).not.toBeInTheDocument()

    fireEvent.click(recordingButton)
    expectHashRoute('#/recorded/detail/21')

    act(() => {
      window.location.hash = '#/'
    })
    await screen.findByTestId('dashboard-page')

    fireEvent.click(screen.getByRole('button', { name: 'Recorded detail target' }))
    expectHashRoute('#/recorded/detail/22')

    act(() => {
      window.location.hash = '#/'
    })
    await screen.findByTestId('dashboard-page')
    fireEvent.click(screen.getByRole('button', { name: 'Reserve dialog target' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reserve dialog target' })
    expect(dialog).toBeVisible()
    expect(within(dialog).getByText('Reserve dialog description')).toBeVisible()
    expect(screen.getByRole('link', { name: 'https://example.invalid/info' })).toHaveAttribute(
      'href',
      'https://example.invalid/info',
    )
    fireEvent.click(within(dialog).getByRole('button', { name: /05\/05\(火\) 10:15/ }))
    await waitFor(() => {
      expectHashRoute('#/guide?time=26050510&type=GR')
    })
  })

  it('[AC 2.3] exposes the recording summary item as a native button with an accessible name that keyboard Enter/Space can activate', async () => {
    const dashboardRepository = createDashboardRepository()
    vi.mocked(dashboardRepository.fetchRecording).mockResolvedValue({
      ok: true,
      value: {
        records: [
          { id: 41, name: 'Recording keyboard target', videoFiles: [{ id: 410, size: 1024 }] },
        ],
        total: 1,
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('dashboard-page')
    const button = screen.getByRole('button', { name: 'Recording keyboard target' })
    // A native <button type="button"> (unlike a <div onClick>) is guaranteed by the HTML
    // spec to activate its click handler on Enter/Space without any extra script. jsdom does
    // not simulate that browser-native keydown-to-click default action, so this test asserts
    // the two preconditions the browser relies on: the element is a real button (native
    // keyboard activation applies) and the component does not call preventDefault() on the
    // activation keys (which would otherwise block that native behavior).
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('type', 'button')

    const spaceEvent = createEvent.keyDown(button, { key: ' ' })
    const enterEvent = createEvent.keyDown(button, { key: 'Enter' })
    fireEvent(button, spaceEvent)
    fireEvent(button, enterEvent)

    expect(spaceEvent.defaultPrevented).toBe(false)
    expect(enterEvent.defaultPrevented).toBe(false)

    fireEvent.click(button)
    expectHashRoute('#/recorded/detail/41')
  })

  it('[AC 2.15] uses the legacy RecordedSmallCard no-image thumbnail proportions in Dashboard recorded summaries', async () => {
    const dashboardRepository = createDashboardRepository()
    vi.mocked(dashboardRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: {
        records: [
          {
            id: 220,
            name: 'Recorded no image target',
            thumbnails: [],
          },
        ],
        total: 1,
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(await screen.findByTestId('dashboard-recorded-no-image')).toHaveAttribute(
      'src',
      './img/noimg.png',
    )
    expect(existsSync('public/img/noimg.png')).toBe(true)
    const css = readFileSync('src/features/dashboard/DashboardPage.module.css', 'utf8')
    expect(css).toContain('flex-basis: 30%;')
    expect(css).toContain('max-width: 200px;')
    expect(css).not.toContain('.recordedThumbnail {\n  flex: 0 0 112px;')
  })
})
