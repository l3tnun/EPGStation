import type { ShellSnackbarState } from '@/app/AppShell'
import type { LiveStreamConfig } from '@/app/serverApi'
import type { SettingsConsumerValue } from '@/shared/settings'
import type { RecordedApiRepository } from './recordedApi'

export interface RecordedPageProps {
  isNavigationOpen: boolean
  onNavigationClick: () => void
  settings: SettingsConsumerValue
  viewportWidth: number
  /**
   * Overrides the measured list container width used for the card/table layout decision
   * (`resolveRecordedLayout`). Real usage measures the actual rendered container via
   * `ResizeObserver`, matching v2 `RecordedItems.vue`'s `this.$el.clientWidth`; this prop exists
   * so tests can inject a container width directly, since jsdom never fires `ResizeObserver`.
   */
  containerWidth?: number
  apiRepository: RecordedApiRepository
  onFetchFailure: (snackbar: ShellSnackbarState) => void
  isEncodeEnabled?: boolean
  encodeModes?: readonly string[]
  recordedDirectories?: readonly string[]
  kodiHosts?: readonly string[]
  streamConfig?: LiveStreamConfig
  recordedViewUrlScheme?: string | null
  recordedDownloadUrlScheme?: string | null
}
