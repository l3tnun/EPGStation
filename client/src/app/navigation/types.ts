import type { SettingsConsumerValue } from '@/shared/settings'

export const BROADCAST_WAVE_ORDER = ['GR', 'BS', 'CS', 'SKY', 'BS4K'] as const

export type BroadcastWave = (typeof BROADCAST_WAVE_ORDER)[number]

/**
 * config が未ロードの間だけ使う fallback。`BS4K` 追加前の旧 4 波のままにする。
 * server config が BS4K を持たない旧 server と同じ見た目にするため、この配列自体は
 * `BROADCAST_WAVE_ORDER` の更新に追随させない（意図的な固定値）。
 */
export const LEGACY_BROADCAST_WAVE_ORDER: readonly BroadcastWave[] = ['GR', 'BS', 'CS', 'SKY']

export function isBroadcastWave(value: unknown): value is BroadcastWave {
  return (BROADCAST_WAVE_ORDER as readonly unknown[]).includes(value)
}

export interface NavigationUnloadedConfigState {
  status: 'unloaded'
}

export interface NavigationLoadedConfigState {
  status: 'loaded'
  liveStreamEnabled: boolean
  enabledBroadcastWaves: readonly BroadcastWave[]
}

export type NavigationConfigState = NavigationUnloadedConfigState | NavigationLoadedConfigState

export type NavigationSettings = Pick<SettingsConsumerValue, 'isEnableDisplayForEachBroadcastWave'>

export interface NavigationItem {
  id: string
  label: string
  icon: string
  path: string
  queryCondition?: Readonly<Record<string, string>>
  guideWave?: BroadcastWave
}

export interface NavigationGenerationInput {
  config: NavigationConfigState
  settings: NavigationSettings
}

export type NavigationRouteQueryValue = string | readonly string[]
export type NavigationRouteQuery = Readonly<Record<string, NavigationRouteQueryValue | undefined>>

export interface NavigationRoute {
  path: string
  query: NavigationRouteQuery
}

export type NavigationTimestampProvider = () => string

export const UNLOADED_NAVIGATION_CONFIG: NavigationConfigState = {
  status: 'unloaded',
}
