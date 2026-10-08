import type { ReactNode } from 'react'
import type { ShellSnackbarState } from './AppShell'
import type { DrawerUserState } from './drawerLayout'
import type {
  NavigationConfigState,
  NavigationSettings,
  NavigationTimestampProvider,
} from './navigation'
import type { RealtimeConnectionConnector, RealtimeConnectionFactory } from './realtime'
import type { ScrollHistoryState } from './scrollHistory'
import type { ServerApiRepository } from './serverApi'
import type { DashboardApiRepository } from '../features/dashboard/dashboardApi'
import type { EncodeApiRepository } from '../features/encode'
import type { GuideApiRepository } from '../features/guide/guideApi'
import type { OnAirApiRepository } from '../features/onair'
import type { RecordedApiRepository } from '../features/recorded/recordedApi'
import type { RecordingApiRepository } from '../features/recording'
import type { ReservesApiRepository } from '../features/reserves/reservesApi'
import type { SearchRuleApiRepository } from '../features/search/rule'
import type { StoragesApiRepository } from '../features/storages/storagesApi'
import type { SettingsConsumerValue } from '../shared/settings'

export interface AppProps {
  settings?: Partial<SettingsConsumerValue>
  osPrefersDark?: boolean
  viewportWidth?: number
  initialDrawerState?: DrawerUserState
  initialSnackbar?: ShellSnackbarState
  navigationConfig?: NavigationConfigState
  navigationSettings?: NavigationSettings
  navigationClickDelayMs?: number
  navigationTimestampProvider?: NavigationTimestampProvider
  dashboardVersion?: string | null
  apiRepository?: ServerApiRepository
  dashboardApiRepository?: DashboardApiRepository
  guideApiRepository?: GuideApiRepository
  onAirApiRepository?: OnAirApiRepository
  recordedApiRepository?: RecordedApiRepository
  recordingApiRepository?: RecordingApiRepository
  encodeApiRepository?: EncodeApiRepository
  reservesApiRepository?: ReservesApiRepository
  searchRuleApiRepository?: SearchRuleApiRepository
  storagesApiRepository?: StoragesApiRepository
  realtimeConnectionFactory?: RealtimeConnectionFactory
  realtimeConnectionConnector?: RealtimeConnectionConnector
  scrollHistory?: ScrollHistoryState
  children?: ReactNode
}

/** Feature API repositories every routed screen receives from the shell. */
export interface RoutedApiRepositories {
  apiRepository?: ServerApiRepository
  dashboardApiRepository: DashboardApiRepository
  guideApiRepository: GuideApiRepository
  onAirApiRepository: OnAirApiRepository
  recordedApiRepository: RecordedApiRepository
  recordingApiRepository: RecordingApiRepository
  encodeApiRepository: EncodeApiRepository
  reservesApiRepository: ReservesApiRepository
  searchRuleApiRepository: SearchRuleApiRepository
  storagesApiRepository: StoragesApiRepository
}

export const MOBILE_NAVIGATION_CLICK_DELAY_MS = 200
