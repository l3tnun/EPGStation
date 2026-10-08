import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DashboardReservesSection } from '@/features/dashboard/components/DashboardReservesSection'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import {
  createDashboardRepository,
  createRecordingRepository,
  createReservesRepository,
  createShellRepository,
} from './dashboardTestKit'

describe('Dashboard more actions and time labels', () => {
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

  it('[AC 2.1] [AC 2.2] [AC 2.7] renders dashboard more actions only when totals exceed the loaded rows and routes to page two', async () => {
    const dashboardRepository = createDashboardRepository()
    vi.mocked(dashboardRepository.fetchReserveCounts).mockResolvedValue({
      ok: true,
      value: { normal: 3, conflicts: 2, skips: 0, overlaps: 0 },
    })
    vi.mocked(dashboardRepository.fetchRecording).mockResolvedValue({
      ok: true,
      value: { records: [{ id: 11, name: 'Recording one' }], total: 2 },
    })
    vi.mocked(dashboardRepository.fetchRecorded).mockResolvedValue({
      ok: true,
      value: { records: [{ id: 12, name: 'Recorded one' }], total: 1 },
    })
    vi.mocked(dashboardRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: { reserves: [{ id: 13, name: 'Reserve one' }], total: 3 },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        dashboardApiRepository={dashboardRepository}
        recordingApiRepository={createRecordingRepository()}
        reservesApiRepository={createReservesRepository()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('dashboard-page')
    expect(
      within(screen.getByTestId('dashboard-section-recording')).getByRole('button', {
        name: 'MORE',
      }),
    ).toBeVisible()
    expect(
      within(screen.getByTestId('dashboard-section-recorded')).queryByRole('button', {
        name: 'MORE',
      }),
    ).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId('dashboard-section-reserves')).getByRole('button', {
        name: 'MORE',
      }),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: '競合 2 件' })).toBeVisible()

    fireEvent.click(
      within(screen.getByTestId('dashboard-section-recording')).getByRole('button', {
        name: 'MORE',
      }),
    )
    expect(window.location.hash).toMatch(/^#\/recording\?page=2&timestamp=\d+$/)

    act(() => {
      window.location.hash = '#/'
    })
    await screen.findByTestId('dashboard-page')

    fireEvent.click(
      within(screen.getByTestId('dashboard-section-reserves')).getByRole('button', {
        name: 'MORE',
      }),
    )
    expect(window.location.hash).toMatch(/^#\/reserves\?page=2&timestamp=\d+$/)

    act(() => {
      window.location.hash = '#/'
    })
    await screen.findByTestId('dashboard-page')

    fireEvent.click(screen.getByRole('button', { name: '競合 2 件' }))
    expect(window.location.hash).toMatch(/^#\/reserves\?type=conflict&timestamp=\d+$/)
  })

  it('[AC7] routes to the conflict reserves list when the reserve section title label text is clicked directly', async () => {
    const dashboardRepository = createDashboardRepository()
    vi.mocked(dashboardRepository.fetchReserveCounts).mockResolvedValue({
      ok: true,
      value: { normal: 3, conflicts: 2, skips: 0, overlaps: 0 },
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

    const reserveSection = await screen.findByTestId('dashboard-section-reserves')
    await within(reserveSection).findByRole('button', { name: '競合 2 件' })
    const heading = within(reserveSection).getByRole('heading', { level: 2 })
    const labelButton = within(heading).getByRole('button', { name: '予約 1/1' })

    fireEvent.click(labelButton)
    expect(window.location.hash).toMatch(/^#\/reserves\?type=conflict&timestamp=\d+$/)
  })

  it('[AC7] calls the conflict handler exactly once (not doubled by event bubbling) when the conflict badge is clicked', () => {
    const onConflictClick = vi.fn()

    render(
      <DashboardReservesSection
        label="予約"
        items={[]}
        total={0}
        conflictCount={2}
        testId="dashboard-section-reserves"
        listRef={{ current: null }}
        apiRepository={createReservesRepository()}
        onDialogOpen={() => undefined}
        onConflictClick={onConflictClick}
        onMoreClick={() => undefined}
        onDeleteRequest={() => undefined}
        onSnackbar={() => undefined}
        onRefetchRequested={() => undefined}
        onScroll={() => undefined}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '競合 2 件' }))

    // The badge button must not be nested inside an <h2 onClick=...>: clicking it would bubble the
    // click event up to the heading, invoking the same handler a second time. The label text
    // and the badge are sibling <button> elements, so a single click fires the handler once.
    expect(onConflictClick).toHaveBeenCalledTimes(1)
  })

  it('[AC7] exposes the reserve section title label and conflict badge as sibling native buttons reachable by keyboard', async () => {
    const dashboardRepository = createDashboardRepository()
    vi.mocked(dashboardRepository.fetchReserveCounts).mockResolvedValue({
      ok: true,
      value: { normal: 3, conflicts: 2, skips: 0, overlaps: 0 },
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

    const reserveSection = await screen.findByTestId('dashboard-section-reserves')
    const heading = within(reserveSection).getByRole('heading', { level: 2 })
    const labelButton = within(heading).getByRole('button', { name: '予約 1/1' })
    const badgeButton = within(heading).getByRole('button', { name: '競合 2 件' })

    // Neither button is nested inside the other: activating one cannot bubble into the other.
    expect(labelButton.contains(badgeButton)).toBe(false)
    expect(badgeButton.contains(labelButton)).toBe(false)

    for (const button of [labelButton, badgeButton]) {
      // A native <button type="button"> (unlike a <h2 onClick>) is guaranteed by the HTML spec
      // to activate its click handler on Enter/Space without any extra script. jsdom does not
      // simulate that browser-native keydown-to-click default action, so this asserts the two
      // preconditions the browser relies on: the element is a real button (native keyboard
      // activation applies), and the component does not call preventDefault() on the activation
      // keys (which would otherwise block that native behavior).
      expect(button.tagName).toBe('BUTTON')
      expect(button).toHaveAttribute('type', 'button')

      const spaceEvent = createEvent.keyDown(button, { key: ' ' })
      const enterEvent = createEvent.keyDown(button, { key: 'Enter' })
      fireEvent(button, spaceEvent)
      fireEvent(button, enterEvent)

      expect(spaceEvent.defaultPrevented).toBe(false)
      expect(enterEvent.defaultPrevented).toBe(false)
    }
  })

  it('[AC7] does not navigate and creates no press region in the section title when there is no conflict', async () => {
    const dashboardRepository = createDashboardRepository()

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

    const reserveSection = await screen.findByTestId('dashboard-section-reserves')
    const heading = await within(reserveSection).findByRole('heading', { level: 2 })
    expect(within(heading).queryAllByRole('button')).toHaveLength(0)

    expect(() => fireEvent.click(heading)).not.toThrow()
    expect(window.location.hash).not.toMatch(/type=conflict/)
  })

  it('[AC 2.16] formats dashboard reserve time ranges with the Vue ReservesCard minute label', async () => {
    const dashboardRepository = createDashboardRepository()
    vi.mocked(dashboardRepository.fetchReserves).mockResolvedValue({
      ok: true,
      value: {
        reserves: [
          {
            id: 14,
            name: 'Reserve minute label target',
            channelName: 'Synthetic reserve channel',
            startAt: Date.parse('2026-05-05T10:15:00+09:00'),
            endAt: Date.parse('2026-05-05T10:45:00+09:00'),
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

    const reserveSection = await screen.findByTestId('dashboard-section-reserves')

    expect(within(reserveSection).getByText('05/05(火) 10:15 ~ 10:45 (30分)')).toBeVisible()
    expect(
      within(reserveSection).queryByText('05/05(火) 10:15 ~ 10:45 (30 m)'),
    ).not.toBeInTheDocument()
  })
})
