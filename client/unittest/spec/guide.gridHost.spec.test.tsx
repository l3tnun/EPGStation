import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GuideGridHost } from '@/features/guide/components/GuideGridHost'
import type { GuideGridRenderer, GuideGridRendererInput } from '@/features/guide/GuideGridRenderer'

describe('GuideGridHost mount-cancellation guard', () => {
  it('[AC 2.22] does not touch the renderer once unmounted before mount() resolves', async () => {
    let resolveMount: () => void = () => undefined
    const renderer = {
      mount: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveMount = resolve
          }),
      ),
      destroy: vi.fn(),
      updateReserveIndex: vi.fn(),
      updateGenreVisibility: vi.fn(),
    } as unknown as GuideGridRenderer
    const rendererInput = {
      schedules: [],
      mode: 'normal',
      startAt: 0,
      hours: 24,
      reserveIndex: {},
      genreVisibility: {},
      guideMode: 'normal',
    } as unknown as GuideGridRendererInput
    const onReady = vi.fn()

    const { unmount } = render(
      <GuideGridHost
        visible
        isLoading={false}
        hasGrid
        isGuideDarkColorDisabled={false}
        renderer={renderer}
        rendererInput={rendererInput}
        routeKey="route-1"
        sizeStyle={{}}
        onReady={onReady}
      />,
    )

    expect(renderer.mount).toHaveBeenCalledTimes(1)
    onReady.mockClear()
    vi.mocked(renderer.updateReserveIndex).mockClear()
    unmount()

    resolveMount()
    await Promise.resolve()
    await Promise.resolve()

    expect(onReady).not.toHaveBeenCalled()
    expect(renderer.updateReserveIndex).not.toHaveBeenCalled()
  })
})
