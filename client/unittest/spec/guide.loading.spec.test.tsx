import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'
import { DEFAULT_DELAY_MS, DEFAULT_MIN_DURATION_MS } from '@/shared/useDeferredLoading'
import {
  createGuideNavigationConfigWithEncodeModes,
  createGuideRepository,
  createShellRepository,
} from './support/guideSpecHarness'

type ScheduleResult = Awaited<ReturnType<ReturnType<typeof createGuideRepository>['fetchSchedule']>>

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function renderGuide(guideRepository: ReturnType<typeof createGuideRepository>) {
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
}

describe('Guide loading overlay', () => {
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

  function holdSchedule(guideRepository: ReturnType<typeof createGuideRepository>) {
    let resolveSchedule: (result: ScheduleResult) => void = () => undefined
    vi.mocked(guideRepository.fetchSchedule).mockImplementationOnce(
      () =>
        new Promise<ScheduleResult>((resolve) => {
          resolveSchedule = resolve
        }),
    )

    return (result: ScheduleResult) => resolveSchedule(result)
  }

  it('[AC 6.1] shows a scrim and a circular progress over the guide while fetching and removes them once the grid is ready', async () => {
    vi.useFakeTimers()
    const guideRepository = createGuideRepository()
    const resolveSchedule = holdSchedule(guideRepository)

    renderGuide(guideRepository)

    // The overlay is deferred: it is absent right after the first render and until the fetch has
    // been pending for DEFAULT_DELAY_MS.
    expect(screen.queryByTestId('guide-loading')).not.toBeInTheDocument()
    await advance(DEFAULT_DELAY_MS - 1)
    expect(screen.queryByTestId('guide-loading')).not.toBeInTheDocument()
    await advance(1)

    const guidePage = screen.getByTestId('guide-page')
    const loading = within(guidePage).getByTestId('guide-loading')
    expect(within(loading).getByRole('progressbar')).toBeInTheDocument()
    expect(screen.queryByTestId('guide-program-grid')).not.toBeInTheDocument()

    resolveSchedule({
      ok: true,
      value: [{ channel: { id: 301, name: 'Synthetic Channel' }, programs: [] }],
    })
    await advance(DEFAULT_MIN_DURATION_MS)

    expect(screen.queryByTestId('guide-loading')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByTestId('guide-program-grid')).toBeInTheDocument()
    expect(guidePage).toHaveAttribute('data-guide-visible', 'true')
  })

  it('[AC 6.1] never paints the loading overlay when the fetch resolves faster than the deferral delay', async () => {
    vi.useFakeTimers()
    const guideRepository = createGuideRepository()

    renderGuide(guideRepository)
    expect(screen.queryByTestId('guide-loading')).not.toBeInTheDocument()
    await advance(0)

    expect(screen.queryByTestId('guide-loading')).not.toBeInTheDocument()
    await advance(DEFAULT_DELAY_MS + DEFAULT_MIN_DURATION_MS + 100)
    expect(screen.queryByTestId('guide-loading')).not.toBeInTheDocument()
    expect(screen.getByTestId('guide-program-grid')).toBeInTheDocument()
  })

  it('[AC 6.1] removes the loading overlay without a grid when the fetch fails', async () => {
    vi.useFakeTimers()
    const guideRepository = createGuideRepository()
    const resolveSchedule = holdSchedule(guideRepository)

    renderGuide(guideRepository)
    await advance(DEFAULT_DELAY_MS)
    expect(screen.getByTestId('guide-loading')).toBeInTheDocument()

    resolveSchedule({
      ok: false,
      error: 'guide-schedule-fetch-failed',
      message: '番組表情報の取得に失敗しました',
    })
    await advance(DEFAULT_MIN_DURATION_MS)

    expect(screen.getByText('番組表情報の取得に失敗しました')).toBeInTheDocument()
    expect(screen.queryByTestId('guide-loading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('guide-program-grid')).not.toBeInTheDocument()
  })

  it('[AC 6.1] [AC 6.3] removes the loading overlay for an empty schedule once it is resolved', async () => {
    vi.useFakeTimers()
    const guideRepository = createGuideRepository()
    const resolveSchedule = holdSchedule(guideRepository)

    renderGuide(guideRepository)
    await advance(DEFAULT_DELAY_MS)
    expect(screen.getByTestId('guide-loading')).toBeInTheDocument()

    resolveSchedule({ ok: true, value: [] })
    await advance(DEFAULT_MIN_DURATION_MS)

    expect(screen.queryByTestId('guide-loading')).not.toBeInTheDocument()
    expect(screen.queryByTestId('guide-program-grid')).not.toBeInTheDocument()
  })
})
