import {
  BROADCAST_WAVE_ORDER,
  type BroadcastWave,
  type NavigationGenerationInput,
  type NavigationItem,
} from './types'

const baseBeforeConfigItems: readonly NavigationItem[] = [
  {
    id: 'dashboard',
    label: 'ダッシュボード',
    icon: 'mdi-view-dashboard',
    path: '/',
  },
]

const baseAfterGuideItems: readonly NavigationItem[] = [
  {
    id: 'recording',
    label: '録画中',
    icon: 'mdi-radiobox-marked',
    path: '/recording',
  },
  {
    id: 'recorded',
    label: '録画済み',
    icon: 'mdi-filmstrip-box-multiple',
    path: '/recorded',
  },
  {
    id: 'encode',
    label: 'エンコード',
    icon: 'mdi-sync',
    path: '/encode',
  },
  {
    id: 'reserves-normal',
    label: '予約',
    icon: 'mdi-clock-outline',
    path: '/reserves',
    queryCondition: {
      type: 'normal',
    },
  },
  {
    id: 'reserves-conflict',
    label: '競合',
    icon: 'mdi-clock-outline',
    path: '/reserves',
    queryCondition: {
      type: 'conflict',
    },
  },
  {
    id: 'reserves-overlap',
    label: '重複',
    icon: 'mdi-clock-outline',
    path: '/reserves',
    queryCondition: {
      type: 'overlap',
    },
  },
  {
    id: 'search',
    label: '検索',
    icon: 'mdi-magnify',
    path: '/search',
  },
  {
    id: 'rule',
    label: 'ルール',
    icon: 'mdi-calendar',
    path: '/rule',
  },
  {
    id: 'storages',
    label: 'ストレージ',
    icon: 'mdi-sd',
    path: '/storages',
  },
  {
    id: 'settings',
    label: '設定',
    icon: 'settings',
    path: '/settings',
  },
]

function createOnAirItem(): NavigationItem {
  return {
    id: 'onair',
    label: '放映中',
    icon: 'mdi-television-play',
    path: '/onair',
  }
}

function createGenericGuideItem(): NavigationItem {
  return {
    id: 'guide',
    label: '番組表',
    icon: 'mdi-television-guide',
    path: '/guide',
  }
}

function createBroadcastWaveGuideItem(wave: BroadcastWave): NavigationItem {
  return {
    id: `guide-${wave}`,
    label: `番組表${wave}`,
    icon: 'mdi-television-guide',
    path: '/guide',
    queryCondition: {
      type: wave,
    },
    guideWave: wave,
  }
}

function normalizeEnabledBroadcastWaves(waves: readonly BroadcastWave[]): BroadcastWave[] {
  const enabledWaves = new Set(waves)

  return BROADCAST_WAVE_ORDER.filter((wave) => enabledWaves.has(wave))
}

function generateGuideItems(input: NavigationGenerationInput): NavigationItem[] {
  if (input.config.status === 'unloaded') {
    return [createGenericGuideItem()]
  }

  const enabledBroadcastWaves = normalizeEnabledBroadcastWaves(input.config.enabledBroadcastWaves)

  if (enabledBroadcastWaves.length === 0) {
    return []
  }

  if (!input.settings.isEnableDisplayForEachBroadcastWave) {
    return [createGenericGuideItem()]
  }

  return enabledBroadcastWaves.map(createBroadcastWaveGuideItem)
}

export function generateNavigationItems(input: NavigationGenerationInput): NavigationItem[] {
  const items: NavigationItem[] = [...baseBeforeConfigItems]

  if (input.config.status === 'loaded' && input.config.liveStreamEnabled) {
    items.push(createOnAirItem())
  }

  items.push(...generateGuideItems(input), ...baseAfterGuideItems)

  return items
}
