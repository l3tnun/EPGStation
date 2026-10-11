import { describe, expect, it } from 'vitest'
import { generateNavigationItems } from '@/app/navigation/items'
import { findSelectedNavigationItem, shouldPushNavigation } from '@/app/navigation/routeMatching'
import {
  NAVIGATION_REGENERATION_EVENT,
  subscribeToNavigationRegenerationRequests,
} from '@/app/navigation/regenerationRequest'
import type { NavigationItem } from '@/app/navigation/types'

const dashboard = {
  id: 'dashboard',
  label: 'ダッシュボード',
  icon: 'mdi-view-dashboard',
  path: '/',
}

const onair = {
  id: 'onair',
  label: '放映中',
  icon: 'mdi-television-play',
  path: '/onair',
}

const genericGuide = {
  id: 'guide',
  label: '番組表',
  icon: 'mdi-television-guide',
  path: '/guide',
}

const afterGuide = [
  { id: 'recording', label: '録画中', icon: 'mdi-radiobox-marked', path: '/recording' },
  { id: 'recorded', label: '録画済み', icon: 'mdi-filmstrip-box-multiple', path: '/recorded' },
  { id: 'encode', label: 'エンコード', icon: 'mdi-sync', path: '/encode' },
  {
    id: 'reserves-normal',
    label: '予約',
    icon: 'mdi-clock-outline',
    path: '/reserves',
    queryCondition: { type: 'normal' },
  },
  {
    id: 'reserves-conflict',
    label: '競合',
    icon: 'mdi-clock-outline',
    path: '/reserves',
    queryCondition: { type: 'conflict' },
  },
  {
    id: 'reserves-overlap',
    label: '重複',
    icon: 'mdi-clock-outline',
    path: '/reserves',
    queryCondition: { type: 'overlap' },
  },
  { id: 'search', label: '検索', icon: 'mdi-magnify', path: '/search' },
  { id: 'rule', label: 'ルール', icon: 'mdi-calendar', path: '/rule' },
  { id: 'storages', label: 'ストレージ', icon: 'mdi-sd', path: '/storages' },
  { id: 'settings', label: '設定', icon: 'settings', path: '/settings' },
]

describe('navigation item list', () => {
  it('lists the fixed items with a generic guide while the server config is not loaded', () => {
    expect(
      generateNavigationItems({
        config: { status: 'unloaded' },
        settings: { isEnableDisplayForEachBroadcastWave: true },
      }),
    ).toStrictEqual([dashboard, genericGuide, ...afterGuide])
  })

  it('omits the guide when no broadcast wave is enabled and the on-air item when live streaming is off', () => {
    expect(
      generateNavigationItems({
        config: { status: 'loaded', liveStreamEnabled: false, enabledBroadcastWaves: [] },
        settings: { isEnableDisplayForEachBroadcastWave: false },
      }),
    ).toStrictEqual([dashboard, ...afterGuide])
  })

  it('adds the on-air item before a generic guide when live streaming is enabled', () => {
    expect(
      generateNavigationItems({
        config: { status: 'loaded', liveStreamEnabled: true, enabledBroadcastWaves: ['GR', 'BS'] },
        settings: { isEnableDisplayForEachBroadcastWave: false },
      }),
    ).toStrictEqual([dashboard, onair, genericGuide, ...afterGuide])
  })

  it('lists one guide item per enabled broadcast wave when the setting is on', () => {
    expect(
      generateNavigationItems({
        config: { status: 'loaded', liveStreamEnabled: false, enabledBroadcastWaves: ['BS', 'GR'] },
        settings: { isEnableDisplayForEachBroadcastWave: true },
      }),
    ).toStrictEqual([
      dashboard,
      {
        id: 'guide-GR',
        label: '番組表GR',
        icon: 'mdi-television-guide',
        path: '/guide',
        queryCondition: { type: 'GR' },
        guideWave: 'GR',
      },
      {
        id: 'guide-BS',
        label: '番組表BS',
        icon: 'mdi-television-guide',
        path: '/guide',
        queryCondition: { type: 'BS' },
        guideWave: 'BS',
      },
      ...afterGuide,
    ])
  })
})

describe('navigation route matching', () => {
  const reservesConflict: NavigationItem = {
    id: 'x',
    label: 'x',
    icon: 'x',
    path: '/reserves',
    queryCondition: { type: 'conflict' },
  }

  it('does not select an item whose query condition key is missing from the route', () => {
    expect(findSelectedNavigationItem([reservesConflict], { path: '/reserves', query: {} })).toBe(
      undefined,
    )
  })

  it('selects by exact value or by membership in a repeated query, never by substring', () => {
    expect(
      findSelectedNavigationItem([reservesConflict], {
        path: '/reserves',
        query: { type: 'conflict' },
      }),
    ).toBe(reservesConflict)
    expect(
      findSelectedNavigationItem([reservesConflict], {
        path: '/reserves',
        query: { type: ['normal', 'conflict'] },
      }),
    ).toBe(reservesConflict)
    expect(
      findSelectedNavigationItem([reservesConflict], {
        path: '/reserves',
        query: { type: 'conflicting' },
      }),
    ).toBe(undefined)
    expect(
      findSelectedNavigationItem([reservesConflict], {
        path: '/reserves',
        query: { type: ['conflicting'] },
      }),
    ).toBe(undefined)
  })

  it('requires every query condition of an item to match', () => {
    const item: NavigationItem = {
      id: 'y',
      label: 'y',
      icon: 'y',
      path: '/p',
      queryCondition: { a: '1', b: '2' },
    }
    expect(findSelectedNavigationItem([item], { path: '/p', query: { a: '1', b: '2' } })).toBe(item)
    expect(findSelectedNavigationItem([item], { path: '/p', query: { a: '1', b: '9' } })).toBe(
      undefined,
    )
    expect(findSelectedNavigationItem([item], { path: '/p', query: { a: '9', b: '2' } })).toBe(
      undefined,
    )
  })

  it('pushes when any value of a repeated query differs and not when they are all equal', () => {
    expect(
      shouldPushNavigation(
        { path: '/p', query: { k: ['a', 'b'], timestamp: '1' } },
        { path: '/p', query: { k: ['a', 'c'], timestamp: '2' } },
      ),
    ).toBe(true)
    expect(
      shouldPushNavigation(
        { path: '/p', query: { k: ['a', 'b'], timestamp: '1' } },
        { path: '/p', query: { k: ['a', 'b'], timestamp: '2' } },
      ),
    ).toBe(false)
  })

  it('pushes when a query key exists on only one side', () => {
    expect(shouldPushNavigation({ path: '/p', query: { k: 'a' } }, { path: '/p', query: {} })).toBe(
      true,
    )
    expect(
      shouldPushNavigation({ path: '/p', query: {} }, { path: '/p', query: { k: ['a', 'b'] } }),
    ).toBe(true)
  })
})

describe('navigation regeneration event', () => {
  it('delivers a request event with the published event name to subscribers', () => {
    expect(NAVIGATION_REGENERATION_EVENT).toBe('epgstation:navigation-regeneration-request')
    const target = new EventTarget()
    let count = 0
    subscribeToNavigationRegenerationRequests(target, () => {
      count += 1
    })
    target.dispatchEvent(new CustomEvent('epgstation:navigation-regeneration-request'))
    expect(count).toBe(1)
  })
})
