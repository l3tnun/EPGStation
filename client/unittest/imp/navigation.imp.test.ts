import { describe, expect, it, vi } from 'vitest'
import {
  buildNavigationTarget,
  createNavigationRouteFromLocation,
  findSelectedNavigationItem,
  generateNavigationItems,
  shouldPushNavigation,
  type BroadcastWave,
  type NavigationConfigState,
} from '@/app/navigation'
import {
  NAVIGATION_REGENERATION_EVENT,
  requestNavigationRegeneration,
  subscribeToNavigationRegenerationRequests,
} from '@/app/navigation/regenerationRequest'

const loadedConfig = (enabledBroadcastWaves: readonly BroadcastWave[]): NavigationConfigState => ({
  status: 'loaded',
  liveStreamEnabled: false,
  enabledBroadcastWaves,
})

describe('Navigation model implementation edges', () => {
  it('builds generic and wave guide route targets with only navigation-owned query', () => {
    const items = generateNavigationItems({
      config: loadedConfig(['GR']),
      settings: {
        isEnableDisplayForEachBroadcastWave: true,
      },
    })
    const genericGuideItem = generateNavigationItems({
      config: loadedConfig(['GR']),
      settings: {
        isEnableDisplayForEachBroadcastWave: false,
      },
    }).find((item) => item.id === 'guide')
    const waveGuideItem = items.find((item) => item.id === 'guide-GR')

    expect(genericGuideItem).toBeDefined()
    expect(waveGuideItem).toBeDefined()
    expect(buildNavigationTarget(genericGuideItem!, () => '1000')).toStrictEqual({
      path: '/guide',
      query: {
        timestamp: '1000',
      },
    })
    expect(buildNavigationTarget(waveGuideItem!, () => '2000')).toStrictEqual({
      path: '/guide',
      query: {
        type: 'GR',
        timestamp: '2000',
      },
    })
  })

  it('pushes only when path or non-timestamp query changes', () => {
    expect(
      shouldPushNavigation(
        {
          path: '/guide',
          query: {
            type: 'GR',
            timestamp: 'old',
          },
        },
        {
          path: '/guide',
          query: {
            type: 'GR',
            timestamp: 'new',
          },
        },
      ),
    ).toBe(false)
    expect(
      shouldPushNavigation(
        {
          path: '/guide',
          query: {
            type: 'GR',
            timestamp: 'old',
          },
        },
        {
          path: '/guide',
          query: {
            type: 'BS',
            timestamp: 'new',
          },
        },
      ),
    ).toBe(true)
    expect(
      shouldPushNavigation(
        {
          path: '/recorded',
          query: {
            timestamp: 'old',
          },
        },
        {
          path: '/settings',
          query: {
            timestamp: 'new',
          },
        },
      ),
    ).toBe(true)
  })

  it('normalizes enabled broadcast waves to GR, BS, CS, SKY order without duplicates', () => {
    const items = generateNavigationItems({
      config: loadedConfig(['SKY', 'GR', 'BS', 'GR']),
      settings: {
        isEnableDisplayForEachBroadcastWave: true,
      },
    })

    expect(items.filter((item) => item.path === '/guide').map((item) => item.label)).toStrictEqual([
      '番組表GR',
      '番組表BS',
      '番組表SKY',
    ])
  })

  it('places BS4K last, after SKY, when it is an enabled broadcast wave', () => {
    const items = generateNavigationItems({
      config: loadedConfig(['BS4K', 'SKY', 'GR', 'BS', 'CS']),
      settings: {
        isEnableDisplayForEachBroadcastWave: true,
      },
    })

    expect(items.filter((item) => item.path === '/guide').map((item) => item.label)).toStrictEqual([
      '番組表GR',
      '番組表BS',
      '番組表CS',
      '番組表SKY',
      '番組表BS4K',
    ])
  })

  it('does not select reserves when the item-defined type query does not match', () => {
    const items = generateNavigationItems({
      config: loadedConfig(['GR']),
      settings: {
        isEnableDisplayForEachBroadcastWave: false,
      },
    })

    expect(
      findSelectedNavigationItem(items, {
        path: '/reserves',
        query: {
          type: 'manual',
          timestamp: '1',
        },
      }),
    ).toBeUndefined()
  })

  it('matches repeated current query values when one value satisfies the item-defined condition', () => {
    const items = generateNavigationItems({
      config: loadedConfig(['GR', 'BS']),
      settings: {
        isEnableDisplayForEachBroadcastWave: true,
      },
    })

    expect(
      findSelectedNavigationItem(items, {
        path: '/guide',
        query: {
          type: ['unexpected', 'GR'],
          timestamp: '1',
        },
      })?.id,
    ).toBe('guide-GR')
  })

  it('does not push for equal repeated query values and does push for length mismatches', () => {
    expect(
      shouldPushNavigation(
        {
          path: '/guide',
          query: {
            type: ['GR', 'BS'],
            timestamp: 'old',
          },
        },
        {
          path: '/guide',
          query: {
            type: ['GR', 'BS'],
            timestamp: 'new',
          },
        },
      ),
    ).toBe(false)
    expect(
      shouldPushNavigation(
        {
          path: '/guide',
          query: {
            type: ['GR', 'BS'],
          },
        },
        {
          path: '/guide',
          query: {
            type: ['GR'],
          },
        },
      ),
    ).toBe(true)
    expect(
      shouldPushNavigation(
        {
          path: '/guide',
          query: {
            type: undefined,
          },
        },
        {
          path: '/guide',
          query: {},
        },
      ),
    ).toBe(false)
    expect(
      shouldPushNavigation(
        {
          path: '/guide',
          query: {},
        },
        {
          path: '/guide',
          query: {
            type: 'GR',
          },
        },
      ),
    ).toBe(true)
  })

  it('creates navigation routes from single and repeated URL search parameters', () => {
    expect(
      createNavigationRouteFromLocation({
        pathname: '/guide',
        search: '?type=GR&type=BS&timestamp=1',
      }),
    ).toStrictEqual({
      path: '/guide',
      query: {
        type: ['GR', 'BS'],
        timestamp: '1',
      },
    })
    expect(
      createNavigationRouteFromLocation({
        pathname: '/settings',
        search: '',
      }),
    ).toStrictEqual({
      path: '/settings',
      query: {},
    })
  })
})

describe('Navigation regeneration request contract implementation edges', () => {
  it('uses a stable typed CustomEvent contract for settings save notifications', () => {
    const target = new EventTarget()
    const onRequest = vi.fn()
    const unsubscribe = subscribeToNavigationRegenerationRequests(target, onRequest)

    requestNavigationRegeneration(target)

    expect(NAVIGATION_REGENERATION_EVENT).toBe('epgstation:navigation-regeneration-request')
    expect(onRequest).toHaveBeenCalledTimes(1)
    expect(onRequest.mock.calls[0]?.[0]).toBeInstanceOf(CustomEvent)
    expect(onRequest.mock.calls[0]?.[0].type).toBe(NAVIGATION_REGENERATION_EVENT)

    unsubscribe()
    requestNavigationRegeneration(target)

    expect(onRequest).toHaveBeenCalledTimes(1)
  })
})
