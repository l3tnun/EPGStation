import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
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

  it('[AC 1.2] [AC 1.10] [AC 2.15] [AC 3.1] renders /guide with sanitized normal fetch options from route query and settings', async () => {
    const guideRepository = createGuideRepository()
    const settings = {
      ...new DefaultSettingsFactory().create(),
      isHalfWidthDisplayed: false,
      isShowOnlyFreePrograms: true,
      guideLength: 6,
    }

    render(
      <App
        settings={settings}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    expect(screen.getByTestId('title-bar')).toHaveTextContent('番組表BS')
    expect(screen.getByTestId('title-bar')).not.toHaveTextContent('05/05')
    expect(screen.getByTestId('guide-page')).toHaveAttribute('data-guide-visible', 'true')

    await waitForGuideVisible()
    expect(screen.getByTestId('title-bar')).toHaveTextContent('番組表BS 05/05')
    expect(screen.getByTestId('guide-program-grid')).toBeInTheDocument()
    expect(guideRepository.fetchSchedule).toHaveBeenCalledWith({
      mode: 'normal',
      startAt: Date.parse('2026-05-05T09:00:00+09:00'),
      endAt: Date.parse('2026-05-05T15:00:00+09:00'),
      isHalfWidth: false,
      isFree: true,
      GR: false,
      BS: true,
      CS: false,
      SKY: false,
      BS4K: false,
    })
    expect(guideRepository.fetchReserveIndex).toHaveBeenCalledWith({
      startAt: Date.parse('2026-05-05T09:00:00+09:00'),
      endAt: Date.parse('2026-05-05T15:00:00+09:00'),
    })
  })

  it('[AC 2.20] adds and removes the iOS address bar compensation class during Guide lifecycle', async () => {
    const userAgentDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent')
    const platformDescriptor = Object.getOwnPropertyDescriptor(window.navigator, 'platform')
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: 'Synthetic iPhone',
    })
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'iPhone',
    })
    const guideRepository = createGuideRepository()

    const { unmount } = render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={390}
        initialDrawerState="none"
      />,
    )

    await waitForGuideVisible()
    expect(document.documentElement).toHaveClass('fix-address-bar2')

    unmount()

    expect(document.documentElement).not.toHaveClass('fix-address-bar2')
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
  })

  it('[AC 2.1] [AC 2.2] [AC 2.3] [AC 2.4] [AC 2.11] [AC 2.15] [AC 2.16] [AC 3.22] renders the imperative guide grid with deterministic geometry, classes, and scroll synchronization', async () => {
    window.history.replaceState(null, '', '/#/guide?time=26050522')
    localStorage.setItem('GuideGenreSetting', JSON.stringify({ 1: false }))
    const guideRepository = createGuideRepository()
    const startAt = Date.parse('2026-05-05T22:00:00+09:00')

    vi.mocked(guideRepository.fetchSchedule).mockResolvedValue({
      ok: true,
      value: [
        {
          channel: {
            id: 10,
            name: 'Synthetic Video',
            type: 0x01,
          },
          programs: [
            {
              id: 100,
              name: 'Synthetic Program',
              startAt,
              endAt: startAt + 30 * 60 * 1000,
              genre1: 1,
              isFree: true,
            },
            {
              id: 101,
              name: 'Synthetic Paid Program',
              startAt: startAt + 70 * 60 * 1000,
              endAt: startAt + 130 * 60 * 1000,
              genre2: 6,
              isFree: false,
            },
          ],
        },
        {
          channel: {
            id: 11,
            name: 'Synthetic Data',
            type: 0xc0,
          },
          programs: [
            {
              id: 200,
              name: 'Synthetic Data Program',
              startAt,
              endAt: startAt + 60 * 60 * 1000,
            },
          ],
        },
      ],
    })
    vi.mocked(guideRepository.fetchReserveIndex).mockResolvedValue({
      ok: true,
      value: {
        100: {
          type: 'overlap',
          item: { id: 400, programId: 100 },
        },
      },
    })

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          guideLength: 4,
          guideMode: 'minimum',
        }}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitForGuideVisible()
    expect(screen.getByTestId('guide-channel-header')).toHaveTextContent('Synthetic Video')
    expect(screen.getByTestId('guide-channel-header')).not.toHaveTextContent('Synthetic Data')
    expect(screen.getByTestId('guide-time-scale')).toHaveTextContent('22')
    expect(screen.getByTestId('guide-time-scale')).toHaveTextContent('0')

    const programCell = screen.getByTestId('guide-program-100')
    expect(programCell).toHaveClass('guide-program-cell', 'ctg-1', 'is-free', 'hide', 'overlap')
    expect(programCell).toHaveStyle({
      left: 'calc(0 * var(--channel-width))',
      top: 'calc(0 * (var(--timescale-height) / 60))',
      height: 'calc(30 * (var(--timescale-height) / 60))',
    })

    const paidCell = screen.getByTestId('guide-program-101')
    expect(paidCell).toHaveClass('ctg-6', 'is-paid')
    expect(paidCell).toHaveTextContent('23:10')
    expect(paidCell).toHaveStyle({
      top: 'calc(70 * (var(--timescale-height) / 60))',
      height: 'calc(60 * (var(--timescale-height) / 60))',
    })
    expect(screen.queryByTestId('guide-program-200')).not.toBeInTheDocument()

    const programGrid = screen.getByTestId('guide-program-grid')
    programGrid.scrollLeft = 84
    programGrid.scrollTop = 126
    act(() => {
      programGrid.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    expect(screen.getByTestId('guide-channel-header')).toHaveProperty('scrollLeft', 84)
    expect(screen.getByTestId('guide-time-scale')).toHaveProperty('scrollTop', 126)

    act(() => {
      programGrid.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 }),
      )
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 70, clientY: 40 }),
      )
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    expect(programGrid).toHaveProperty('scrollLeft', 114)
    expect(programGrid).toHaveProperty('scrollTop', 186)
    expect(screen.getByTestId('guide-channel-header')).toHaveProperty('scrollLeft', 114)
    expect(screen.getByTestId('guide-time-scale')).toHaveProperty('scrollTop', 186)
  })
})
