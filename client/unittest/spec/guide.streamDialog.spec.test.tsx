import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { expectHashRoute } from './hashRouteAssertions'
import {
  createShellRepository,
  createLiveNavigationConfig,
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

  it('[AC 5.1] [AC 5.2] opens the shared live stream dialog from a channel header and shows the Guide button', async () => {
    window.history.replaceState(null, '', '/#/guide?type=GR&time=26050509')
    const guideRepository = createGuideRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createLiveNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitForGuideVisible()
    fireEvent.click(screen.getByText('Synthetic Channel'))

    const dialog = await screen.findByRole('dialog', { name: 'ストリーム選択' })
    expect(dialog).toHaveTextContent('Synthetic Channel')
    expect(within(dialog).getByRole('button', { name: '番組表' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toBeVisible()
    expect(within(dialog).getByRole('button', { name: '視聴' })).toBeVisible()
  })

  it('[AC 5.2] [AC 5.5] [AC 5.7] keeps only channel and time when the shared stream dialog returns to a single-channel guide', async () => {
    window.history.replaceState(null, '', '/#/guide?type=GR&time=26050509')
    const guideRepository = createGuideRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createLiveNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitForGuideVisible()
    fireEvent.click(screen.getByText('Synthetic Channel'))

    const dialog = await screen.findByRole('dialog', { name: 'ストリーム選択' })
    vi.useFakeTimers()

    fireEvent.click(within(dialog).getByRole('button', { name: '番組表' }))

    expect(screen.queryByRole('dialog', { name: 'ストリーム選択' })).not.toBeInTheDocument()
    expectHashRoute('#/guide?type=GR&time=26050509')

    await act(async () => {
      vi.advanceTimersByTime(299)
    })

    expectHashRoute('#/guide?type=GR&time=26050509')

    await act(async () => {
      vi.advanceTimersByTime(1)
    })

    expectHashRoute('#/guide?channelId=301&time=26050509')
  })

  it('[AC 5.7] drops invalid time when the shared stream dialog returns to a single-channel guide', async () => {
    window.history.replaceState(null, '', '/#/guide?type=GR&time=bad')
    const guideRepository = createGuideRepository()

    render(
      <App
        settings={new DefaultSettingsFactory().create()}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createLiveNavigationConfig()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await waitForGuideVisible()
    fireEvent.click(screen.getByText('Synthetic Channel'))

    const dialog = await screen.findByRole('dialog', { name: 'ストリーム選択' })
    vi.useFakeTimers()

    fireEvent.click(within(dialog).getByRole('button', { name: '番組表' }))

    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expectHashRoute('#/guide?channelId=301')
  })

  it('[AC 1.6] [AC 1.7] [AC 1.8] uses normal guide behavior for invalid query without snackbar noise', async () => {
    window.history.replaceState(null, '', '/#/guide?type=INVALID&time=bad&channelId=-1')
    const guideRepository = createGuideRepository()

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

    await screen.findByTestId('guide-page')

    expect(guideRepository.fetchSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'normal',
        GR: true,
        BS: true,
        CS: true,
        SKY: true,
      }),
    )
    expect(screen.getByTestId('title-bar')).not.toHaveTextContent('INVALID')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('[AC 1.8] silently falls back to normal guide when a positive channelId is rejected as unavailable', async () => {
    window.history.replaceState(null, '', '/#/guide?channelId=999999&time=26050509')
    const guideRepository = createGuideRepository()

    vi.mocked(guideRepository.fetchSchedule)
      .mockResolvedValueOnce({
        ok: false,
        error: 'guide-channel-not-found',
        message: '番組表情報の取得に失敗しました',
      })
      .mockResolvedValueOnce({
        ok: true,
        value: [
          {
            channel: {
              id: 101,
              name: 'Synthetic Fallback Channel',
            },
            programs: [],
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        value: [
          {
            channel: {
              id: 999999,
              name: 'Synthetic Rechecked Channel',
            },
            programs: [],
          },
        ],
      })

    render(
      <App
        settings={{
          ...new DefaultSettingsFactory().create(),
          guideLength: 6,
        }}
        apiRepository={createShellRepository()}
        guideApiRepository={guideRepository}
        navigationConfig={createGuideNavigationConfigWithEncodeModes()}
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
      />,
    )

    await screen.findByTestId('guide-page')

    expect(guideRepository.fetchSchedule).toHaveBeenNthCalledWith(1, {
      mode: 'singleChannel',
      channelId: 999999,
      startAt: Date.parse('2026-05-05T09:00:00+09:00'),
      days: 8,
      isHalfWidth: true,
      isFree: false,
    })
    await waitFor(() => {
      expect(guideRepository.fetchSchedule).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          mode: 'normal',
          startAt: Date.parse('2026-05-05T09:00:00+09:00'),
          endAt: Date.parse('2026-05-05T15:00:00+09:00'),
          GR: true,
          BS: true,
          CS: true,
          SKY: true,
        }),
      )
    })
    expect(screen.getByTestId('title-bar')).toHaveTextContent('番組表 05/05')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await act(async () => {
      window.location.hash = '#/guide?channelId=999999&time=26050609'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    await waitFor(() => {
      expect(guideRepository.fetchSchedule).toHaveBeenNthCalledWith(3, {
        mode: 'singleChannel',
        channelId: 999999,
        startAt: Date.parse('2026-05-06T09:00:00+09:00'),
        days: 8,
        isHalfWidth: true,
        isFree: false,
      })
    })
  })
})
