import { act, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { generateNavigationItems, type NavigationConfigState } from '@/app/navigation'
import { requestNavigationRegeneration } from '@/app/navigation/regenerationRequest'
import { DefaultSettingsFactory } from '@/shared/settings/defaultSettings'

const fullConfig: NavigationConfigState = {
  status: 'loaded',
  liveStreamEnabled: true,
  enabledBroadcastWaves: ['GR', 'BS', 'CS', 'SKY'],
}

describe('Requirement 3.1-3.16 navigation item generation', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/#/')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('[AC 3.1] [AC 3.2] [AC 3.5] [AC 3.7] [AC 3.11] [AC 3.14] generates labels, icons, route targets, and wave guide items in design order', () => {
    const items = generateNavigationItems({
      config: fullConfig,
      settings: {
        isEnableDisplayForEachBroadcastWave: true,
      },
    })

    expect(items.map((item) => item.label)).toStrictEqual([
      'ダッシュボード',
      '放映中',
      '番組表GR',
      '番組表BS',
      '番組表CS',
      '番組表SKY',
      '録画中',
      '録画済み',
      'エンコード',
      '予約',
      '競合',
      '重複',
      '検索',
      'ルール',
      'ストレージ',
      '設定',
    ])
    expect(items.map((item) => item.icon)).toStrictEqual([
      'mdi-view-dashboard',
      'mdi-television-play',
      'mdi-television-guide',
      'mdi-television-guide',
      'mdi-television-guide',
      'mdi-television-guide',
      'mdi-radiobox-marked',
      'mdi-filmstrip-box-multiple',
      'mdi-sync',
      'mdi-clock-outline',
      'mdi-clock-outline',
      'mdi-clock-outline',
      'mdi-magnify',
      'mdi-calendar',
      'mdi-sd',
      'settings',
    ])
    expect(items.find((item) => item.label === '番組表BS')).toMatchObject({
      path: '/guide',
      queryCondition: {
        type: 'BS',
      },
      guideWave: 'BS',
    })
    expect(items.find((item) => item.label === '競合')).toMatchObject({
      path: '/reserves',
      queryCondition: {
        type: 'conflict',
      },
    })
  })

  it('[AC 3.8] [AC 3.9] [AC 3.12] [AC 3.13] distinguishes unloaded placeholder guide from loaded zero-wave intentional fix', () => {
    const unloadedItems = generateNavigationItems({
      config: {
        status: 'unloaded',
      },
      settings: {
        isEnableDisplayForEachBroadcastWave: true,
      },
    })
    const zeroWaveItems = generateNavigationItems({
      config: {
        status: 'loaded',
        liveStreamEnabled: true,
        enabledBroadcastWaves: [],
      },
      settings: {
        isEnableDisplayForEachBroadcastWave: false,
      },
    })

    expect(unloadedItems.map((item) => item.label)).toContain('番組表')
    expect(unloadedItems.map((item) => item.label)).not.toContain('放映中')
    expect(unloadedItems.some((item) => item.guideWave !== undefined)).toBe(false)
    expect(zeroWaveItems.map((item) => item.label)).not.toContain('番組表')
    expect(zeroWaveItems.some((item) => item.path === '/guide')).toBe(false)
  })

  it('[AC 3.10] regenerates App drawer items from saved settings after a Settings save request without reload', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnableDisplayForEachBroadcastWave: false,
      }),
    )

    render(
      <App
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationConfig={fullConfig}
      />,
    )

    const navigation = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    expect(within(navigation).getByText('番組表')).toBeVisible()
    expect(within(navigation).queryByText('番組表GR')).not.toBeInTheDocument()

    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnableDisplayForEachBroadcastWave: true,
      }),
    )
    act(() => {
      requestNavigationRegeneration(window)
    })

    expect(within(navigation).queryByText('番組表')).not.toBeInTheDocument()
    expect(within(navigation).getByText('番組表GR')).toBeVisible()
    expect(within(navigation).getByText('番組表BS')).toBeVisible()
    expect(within(navigation).getByText('番組表CS')).toBeVisible()
    expect(within(navigation).getByText('番組表SKY')).toBeVisible()
  })

  it('[AC 3.10] keeps explicitly provided navigation settings controlled during regeneration requests', () => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        ...new DefaultSettingsFactory().create(),
        isEnableDisplayForEachBroadcastWave: true,
      }),
    )

    render(
      <App
        osPrefersDark={false}
        viewportWidth={1440}
        initialDrawerState="none"
        navigationConfig={fullConfig}
        navigationSettings={{
          isEnableDisplayForEachBroadcastWave: false,
        }}
      />,
    )

    const navigation = screen.getByRole('navigation', { name: 'メインナビゲーション' })
    expect(within(navigation).getByText('番組表')).toBeVisible()

    act(() => {
      requestNavigationRegeneration(window)
    })

    expect(within(navigation).getByText('番組表')).toBeVisible()
    expect(within(navigation).queryByText('番組表GR')).not.toBeInTheDocument()
  })
})
