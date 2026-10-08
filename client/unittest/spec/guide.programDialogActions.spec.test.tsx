import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from './hashRouteAssertions'
import {
  createShellRepository,
  createGuideNavigationConfigWithEncodeModes,
  chooseMuiSelectOption,
  createGuideRepository,
  navigateHashRoute,
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

  // Chaining nine sequential ProgramDialog interactions (encode select, checkbox, double-click
  // reserve, search, edit, delete, rule, skip-unlock, overlap-unlock) across five synthetic programs
  // in one `it` would take long enough in real-clock time (~2.4s unloaded, 4.0-4.5s under CPU
  // contention) to sit close to vitest's default per-test timeout, so contention from concurrent
  // test files could tip it over. Each action is independent of the others (they operate on
  // different synthetic programs and only share fixture shape), so the coverage below is split one
  // action-group per `it` with its own render; each AC tag maps onto the specific test that
  // exercises it.

  it('[AC 4.11] [AC 4.15] [AC 7.1] adds a reserve with encode options and reflects it in the grid', async () => {
    window.history.replaceState(null, '', '/#/guide?time=26050509')
    const guideRepository = createGuideRepository()
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')

    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: {
            id: 301,
            name: 'Synthetic Channel',
            type: 0x01,
          },
          programs: [
            {
              id: 710,
              name: 'Synthetic Add Target',
              startAt,
              endAt: startAt + 30 * 60 * 1000,
              genre1: 7,
              subGenre1: 3,
            },
          ],
        },
      ],
    })
    vi.mocked(guideRepository.fetchReserveIndex).mockResolvedValueOnce({
      ok: true,
      value: {},
    })
    vi.mocked(guideRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        710: {
          type: 'reserve',
          item: { id: 810, programId: 710 },
        },
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await screen.findByTestId('guide-program-710'))
    await chooseMuiSelectOption('エンコード', 'H.264')
    fireEvent.click(screen.getByLabelText('元ファイル削除'))
    const reserveButton = screen.getByRole('button', { name: '予約' })
    fireEvent.click(reserveButton)
    fireEvent.click(reserveButton)

    expect(guideRepository.addProgramReserve).toHaveBeenCalledWith({
      programId: 710,
      allowEndLack: true,
      encodeOption: {
        mode1: 'H.264',
        isDeleteOriginalAfterEncode: true,
      },
    })
    expect(guideRepository.addProgramReserve).toHaveBeenCalledTimes(1)

    // The action snackbar closes on a 5 second wall-clock timer, and closing ProgramDialog after
    // the action runs its own exit transition (MUI default 195ms) that gates when ModalManager
    // restores aria-hidden on the rest of the shell, where the snackbar lives. Drive both under
    // fake timers and read the alert synchronously instead of polling.
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic Add Target 予約')
    vi.useRealTimers()

    await waitFor(() => {
      expect(guideRepository.fetchReserveIndex).toHaveBeenCalledTimes(2)
    })
    expect(await screen.findByTestId('guide-program-710')).toHaveClass('reserve')
  })

  it('[AC 4.3] [AC 4.10] shows 検索 for a manual reserve and generates a search route', async () => {
    window.history.replaceState(null, '', '/#/guide?time=26050509')
    const guideRepository = createGuideRepository()
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')

    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: {
            id: 301,
            name: 'Synthetic Channel',
            type: 0x01,
          },
          programs: [
            {
              id: 710,
              name: 'Synthetic Add Target',
              startAt,
              endAt: startAt + 30 * 60 * 1000,
              genre1: 7,
              subGenre1: 3,
            },
          ],
        },
      ],
    })
    vi.mocked(guideRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        710: {
          type: 'reserve',
          item: { id: 810, programId: 710 },
        },
      },
    })

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          isIncludeChannelIdWhenSearching: true,
          isIncludeGenreWhenSearching: true,
        }}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await screen.findByTestId('guide-program-710'))
    const dialog = await screen.findByRole('dialog', { name: 'Synthetic Add Target' })
    expect(within(dialog).getByRole('button', { name: '編集' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '検索' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '削除' })).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: '検索' }))
    expectHashRoute('#/guide?time=26050509')
    await waitFor(() => {
      expectHashRoute('#/search?keyword=Synthetic+Add+Target&channelId=301&genre=7&subGenre=3')
    })
  })

  it('[AC 4.8] [AC 4.12] [AC 4.15] edits and cancels a manual reserve', async () => {
    window.history.replaceState(null, '', '/#/guide?time=26050509')
    const guideRepository = createGuideRepository()
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')

    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: {
            id: 301,
            name: 'Synthetic Channel',
            type: 0x01,
          },
          programs: [
            {
              id: 711,
              name: 'Synthetic Manual Target',
              startAt,
              endAt: startAt + 30 * 60 * 1000,
            },
          ],
        },
      ],
    })
    vi.mocked(guideRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        711: {
          type: 'reserve',
          item: { id: 811, programId: 711 },
        },
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await screen.findByTestId('guide-program-711'))
    fireEvent.click(screen.getByRole('button', { name: '編集' }))
    await waitFor(() => {
      expectHashRoute('#/reserves/manual?reserveId=811')
    })

    await navigateHashRoute('#/guide?time=26050509')
    fireEvent.click(await screen.findByTestId('guide-program-711'))
    fireEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(guideRepository.deleteReserve).toHaveBeenCalledWith(811)

    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic Manual Target キャンセル')
    vi.useRealTimers()
  })

  it('[AC 4.4] [AC 4.9] [AC 4.15] [AC 4.19] navigates to the rule and cancels a conflicting rule reserve', async () => {
    window.history.replaceState(null, '', '/#/guide?time=26050509')
    const guideRepository = createGuideRepository()
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')

    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: {
            id: 301,
            name: 'Synthetic Channel',
            type: 0x01,
          },
          programs: [
            {
              id: 712,
              name: 'Synthetic Rule Target',
              startAt,
              endAt: startAt + 30 * 60 * 1000,
            },
          ],
        },
      ],
    })
    vi.mocked(guideRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        712: {
          type: 'conflict',
          item: { id: 812, programId: 712, ruleId: 501 },
        },
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await screen.findByTestId('guide-program-712'))
    fireEvent.click(screen.getByRole('button', { name: 'ルール' }))
    await waitFor(() => {
      expectHashRoute('#/search?rule=501')
    })

    await navigateHashRoute('#/guide?time=26050509')
    fireEvent.click(await screen.findByTestId('guide-program-712'))
    fireEvent.click(screen.getByRole('button', { name: '除外' }))
    expect(guideRepository.deleteReserve).toHaveBeenCalledWith(812)

    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic Rule Target キャンセル')
    vi.useRealTimers()
  })

  it('[AC 4.5] [AC 4.13] [AC 4.15] unlocks a skipped rule reserve', async () => {
    window.history.replaceState(null, '', '/#/guide?time=26050509')
    const guideRepository = createGuideRepository()
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')

    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: {
            id: 301,
            name: 'Synthetic Channel',
            type: 0x01,
          },
          programs: [
            {
              id: 713,
              name: 'Synthetic Skip Target',
              startAt,
              endAt: startAt + 30 * 60 * 1000,
            },
          ],
        },
      ],
    })
    vi.mocked(guideRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        713: {
          type: 'skip',
          item: { id: 813, programId: 713, ruleId: 501 },
        },
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await screen.findByTestId('guide-program-713'))
    fireEvent.click(screen.getByRole('button', { name: '除外解除' }))
    expect(guideRepository.unlockSkipReserve).toHaveBeenCalledWith(813)

    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic Skip Target 除外解除')
    vi.useRealTimers()
  })

  it('[AC 4.6] [AC 4.14] [AC 4.15] unlocks an overlapping rule reserve', async () => {
    window.history.replaceState(null, '', '/#/guide?time=26050509')
    const guideRepository = createGuideRepository()
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')

    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: {
            id: 301,
            name: 'Synthetic Channel',
            type: 0x01,
          },
          programs: [
            {
              id: 714,
              name: 'Synthetic Overlap Target',
              startAt,
              endAt: startAt + 30 * 60 * 1000,
            },
          ],
        },
      ],
    })
    vi.mocked(guideRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        714: {
          type: 'overlap',
          item: { id: 814, programId: 714, ruleId: 501 },
        },
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await screen.findByTestId('guide-program-714'))
    fireEvent.click(screen.getByRole('button', { name: '重複解除' }))
    expect(guideRepository.unlockOverlapReserve).toHaveBeenCalledWith(814)

    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(screen.getByRole('alert')).toHaveTextContent('Synthetic Overlap Target 重複解除')
    vi.useRealTimers()
  })

  it('[AC 4.3] [AC 4.8] shows 編集/検索/削除 for a manual reserve in conflict state and edits it', async () => {
    window.history.replaceState(null, '', '/#/guide?time=26050509')
    const guideRepository = createGuideRepository()
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')

    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: {
            id: 301,
            name: 'Synthetic Channel',
            type: 0x01,
          },
          programs: [
            {
              id: 720,
              name: 'Synthetic Manual Conflict Target',
              startAt,
              endAt: startAt + 30 * 60 * 1000,
            },
          ],
        },
      ],
    })
    vi.mocked(guideRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        720: {
          type: 'conflict',
          item: { id: 820, programId: 720 },
        },
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await screen.findByTestId('guide-program-720'))
    const dialog = await screen.findByRole('dialog', {
      name: 'Synthetic Manual Conflict Target',
    })
    expect(within(dialog).getByRole('button', { name: '編集' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '検索' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '削除' })).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: '編集' }))
    await waitFor(() => {
      expectHashRoute('#/reserves/manual?reserveId=820')
    })
  })

  it('[AC 4.3] [AC 4.8] shows 編集/検索/重複解除 for a manual reserve in overlap state and edits it', async () => {
    window.history.replaceState(null, '', '/#/guide?time=26050509')
    const guideRepository = createGuideRepository()
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')

    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: {
            id: 301,
            name: 'Synthetic Channel',
            type: 0x01,
          },
          programs: [
            {
              id: 721,
              name: 'Synthetic Manual Overlap Target',
              startAt,
              endAt: startAt + 30 * 60 * 1000,
            },
          ],
        },
      ],
    })
    vi.mocked(guideRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        721: {
          type: 'overlap',
          item: { id: 821, programId: 721 },
        },
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await screen.findByTestId('guide-program-721'))
    const dialog = await screen.findByRole('dialog', {
      name: 'Synthetic Manual Overlap Target',
    })
    expect(within(dialog).getByRole('button', { name: '編集' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '検索' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '重複解除' })).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: '編集' }))
    await waitFor(() => {
      expectHashRoute('#/reserves/manual?reserveId=821')
    })
  })

  it('[AC 4.3] [AC 4.8] shows 編集/検索/除外解除 for a manual reserve in skip state and edits it', async () => {
    window.history.replaceState(null, '', '/#/guide?time=26050509')
    const guideRepository = createGuideRepository()
    const startAt = Date.parse('2026-05-05T09:00:00+09:00')

    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: {
            id: 301,
            name: 'Synthetic Channel',
            type: 0x01,
          },
          programs: [
            {
              id: 722,
              name: 'Synthetic Manual Skip Target',
              startAt,
              endAt: startAt + 30 * 60 * 1000,
            },
          ],
        },
      ],
    })
    vi.mocked(guideRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        722: {
          type: 'skip',
          item: { id: 822, programId: 722 },
        },
      },
    })

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    fireEvent.click(await screen.findByTestId('guide-program-722'))
    const dialog = await screen.findByRole('dialog', {
      name: 'Synthetic Manual Skip Target',
    })
    expect(within(dialog).getByRole('button', { name: '編集' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '検索' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '除外解除' })).toBeVisible()

    fireEvent.click(within(dialog).getByRole('button', { name: '編集' }))
    await waitFor(() => {
      expectHashRoute('#/reserves/manual?reserveId=822')
    })
  })
})
