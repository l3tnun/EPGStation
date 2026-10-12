import { CssBaseline, ThemeProvider } from '@mui/material'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { HashRouter } from 'react-router-dom'
import { MOBILE_NAVIGATION_CLICK_DELAY_MS, type AppProps } from './appProps'
import { AppShellContent } from './AppShellContent'
import { getBrowserOSPrefersDark } from './browserAdapters'
import { useDefaultRepositories } from './hooks/useDefaultRepositories'
import { useDrawerUserState } from './hooks/useDrawerUserState'
import { useIsDesktopViewport } from './hooks/useIsDesktopViewport'
import { useResolvedViewportWidth } from './hooks/useResolvedViewportWidth'
import { useShellSettings } from './hooks/useShellSettings'
import { applyBrowserPwaStartupSettings } from './lib/shellSettingsSnapshots'
import { UNLOADED_NAVIGATION_CONFIG, createNavigationTimestamp } from './navigation'
import { createShellTheme, resolveShellThemeMode } from './theme'

export function AppRoot(props: AppProps) {
  const {
    settings,
    osPrefersDark = getBrowserOSPrefersDark(),
    viewportWidth,
    initialDrawerState = 'none',
    initialSnackbar,
    navigationConfig = UNLOADED_NAVIGATION_CONFIG,
    navigationSettings,
    navigationClickDelayMs = MOBILE_NAVIGATION_CLICK_DELAY_MS,
    navigationTimestampProvider = createNavigationTimestamp,
    dashboardVersion = null,
    realtimeConnectionFactory,
    realtimeConnectionConnector,
    children,
  } = props
  const [queryClient] = useState(() => new QueryClient())
  const repositories = useDefaultRepositories(props)
  const shellSettings = useShellSettings({ settings, navigationSettings })
  const resolvedViewportWidth = useResolvedViewportWidth(viewportWidth)
  const isDesktop = useIsDesktopViewport(viewportWidth)
  const { drawerLayout, setDrawerUserState, toggleDrawer } = useDrawerUserState(
    initialDrawerState,
    isDesktop,
  )
  const themeMode = resolveShellThemeMode({
    settings: shellSettings.activeThemeSettings,
    osPrefersDark,
  })
  const theme = useMemo(() => createShellTheme(themeMode), [themeMode])

  useEffect(() => {
    applyBrowserPwaStartupSettings()
  }, [])

  return (
    <HashRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <AppShellContent
            {...repositories}
            drawerLayout={drawerLayout}
            themeMode={themeMode}
            initialSnackbar={initialSnackbar}
            navigationConfig={navigationConfig}
            navigationSettings={shellSettings.activeNavigationSettings}
            dashboardVersion={dashboardVersion}
            onNavigationClick={toggleDrawer}
            onDrawerUserStateChange={setDrawerUserState}
            navigationClickDelayMs={navigationClickDelayMs}
            navigationTimestampProvider={navigationTimestampProvider}
            dashboardSettings={shellSettings.activeDashboardSettings}
            viewportWidth={resolvedViewportWidth}
            realtimeConnectionFactory={realtimeConnectionFactory}
            realtimeConnectionConnector={realtimeConnectionConnector}
            osPrefersDark={osPrefersDark}
            onSettingsThemePreviewChange={shellSettings.onSettingsThemePreviewChange}
            onSettingsThemePreviewRestore={shellSettings.onSettingsThemePreviewRestore}
            onSettingsSaved={shellSettings.onSettingsSaved}
          >
            {children}
          </AppShellContent>
        </ThemeProvider>
      </QueryClientProvider>
    </HashRouter>
  )
}
