import type { RoutedApiRepositories } from '../appProps'
import type { ShellSnackbarState } from '../AppShell'
import type { DrawerLayoutState } from '../drawerLayout'
import type { ActiveServerConfig } from '../lib/serverConfigSelectors'
import type { ShellThemeMode } from '../theme'
import type { SettingsConsumerValue, ThemeSettings } from '../../shared/settings'

export interface AppRouteProps extends RoutedApiRepositories {
  drawerLayout: DrawerLayoutState
  themeMode: ShellThemeMode
  activeServerConfig: ActiveServerConfig
  activeDashboardVersion: string | null
  dashboardSettings: SettingsConsumerValue
  viewportWidth: number
  osPrefersDark: boolean
  onNavigationClick: () => void
  showSnackbar: (snackbar: ShellSnackbarState) => void
  /**
   * Marks the next `count` route changes as not closing the currently shown snackbar (mirrors
   * the reconnect-restore use of `suppressedRouteSnackbarClosesRef` in `useRealtimeConnection`).
   * Screens that navigate right after showing a success snackbar (e.g. Recorded Upload's
   * post-upload `?timestamp=<number>` route refresh, requirement 3.13) call this first so the
   * route-change snackbar-close in `useRouteScrollRestoration` does not immediately dismiss it.
   */
  suppressRouteSnackbarClose: (count: number) => void
  onSettingsThemePreviewChange: (settings: ThemeSettings) => void
  onSettingsThemePreviewRestore: (settings: ThemeSettings) => void
  onSettingsSaved: (settings: SettingsConsumerValue) => void
}
