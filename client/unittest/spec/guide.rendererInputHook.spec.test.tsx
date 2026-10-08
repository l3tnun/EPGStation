import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useGuideRendererInput } from '@/features/guide/hooks/useGuideRendererInput'

function createRouteData(guideQueryOverrides: Record<string, unknown> = {}) {
  return {
    requestSet: {
      guideQuery: {
        mode: 'normal' as const,
        startAt: 0,
        isTimeQueryValid: true,
        ...guideQueryOverrides,
      },
      schedule: {
        mode: 'normal' as const,
        startAt: 0,
        endAt: 3_600_000,
        isHalfWidth: false,
        isFree: false,
        GR: true,
        BS: false,
        CS: false,
        SKY: false,
        BS4K: false,
      },
      reserveIndex: { startAt: 0, endAt: 3_600_000 },
    },
    scheduleData: [{ channel: { id: 1 }, programs: [] }],
    reserveIndex: {},
    hasScheduleData: true,
  }
}

describe('useGuideRendererInput', () => {
  it('[AC 2.13] supplies a now() accessor that returns the provided fixed timestamp', () => {
    const { result } = renderHook(() =>
      useGuideRendererInput({
        routeData: createRouteData(),
        genreVisibility: {},
        guideMode: 'all',
        now: 12345,
        onProgramClick: vi.fn(),
        onChannelClick: vi.fn(),
      }),
    )

    expect(result.current?.now?.()).toBe(12345)
  })

  it('[AC 2.12] ignores a channel click when the channel has no id', () => {
    const onChannelClick = vi.fn()
    const { result } = renderHook(() =>
      useGuideRendererInput({
        routeData: createRouteData(),
        genreVisibility: {},
        guideMode: 'all',
        now: undefined,
        onProgramClick: vi.fn(),
        onChannelClick,
      }),
    )

    result.current?.onChannelClick?.({})

    expect(onChannelClick).not.toHaveBeenCalled()
  })

  it('[AC 2.12] ignores a channel click while a single channel is already selected by the route', () => {
    const onChannelClick = vi.fn()
    const { result } = renderHook(() =>
      useGuideRendererInput({
        routeData: createRouteData({ mode: 'singleChannel', channelId: 301 }),
        genreVisibility: {},
        guideMode: 'all',
        now: undefined,
        onProgramClick: vi.fn(),
        onChannelClick,
      }),
    )

    result.current?.onChannelClick?.({ id: 401, name: 'Synthetic' })

    expect(onChannelClick).not.toHaveBeenCalled()
  })
})
