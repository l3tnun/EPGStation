import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, type ReactNode } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { RoutedApiRepositories } from './appProps'
import { AppShell, type ShellSnackbarState } from './AppShell'
import type { DrawerLayoutState, DrawerUserState } from './drawerLayout'
import { useIOSAddressBarFix } from './hooks/useIOSAddressBarFix'
import { useNavigationItemClick } from './hooks/useNavigationItemClick'
import { useRealtimeConnection } from './hooks/useRealtimeConnection'
import { useRouteScrollRestoration } from './hooks/useRouteScrollRestoration'
import { useServerConfigState } from './hooks/useServerConfigState'
import { useShellSnackbar } from './hooks/useShellSnackbar'
import { createTimestampNormalizedRoutePath, parseRoutePath } from './lib/routePath'
import type { ActiveServerConfig } from './lib/serverConfigSelectors'
import {
  createNavigationRouteFromLocation,
  findSelectedNavigationItem,
  generateNavigationItems,
  type NavigationConfigState,
  type NavigationSettings,
  type NavigationTimestampProvider,
} from './navigation'
import type { RealtimeConnectionConnector, RealtimeConnectionFactory } from './realtime'
import { AppRoutes } from './routes/AppRoutes'
import { ScrollHistoryProvider, type ScrollHistoryState } from './scrollHistory'
import type { ShellThemeMode } from './theme'
import { resolveDashboardTitle } from './titleBar'
import type { SettingsConsumerValue, ThemeSettings } from '../shared/settings'

export interface AppShellContentProps extends RoutedApiRepositories {
  drawerLayout: DrawerLayoutState
  themeMode: ShellThemeMode
  initialSnackbar?: ShellSnackbarState
  navigationConfig: NavigationConfigState
  navigationSettings: NavigationSettings
  dashboardVersion: string | null
  children?: ReactNode
  onNavigationClick: () => void
  onDrawerUserStateChange: (state: DrawerUserState) => void
  navigationClickDelayMs: number
  navigationTimestampProvider: NavigationTimestampProvider
  dashboardSettings: SettingsConsumerValue
  viewportWidth: number
  realtimeConnectionFactory?: RealtimeConnectionFactory
  realtimeConnectionConnector?: RealtimeConnectionConnector
  scrollHistory: ScrollHistoryState
  osPrefersDark: boolean
  onSettingsThemePreviewChange: (settings: ThemeSettings) => void
  onSettingsThemePreviewRestore: (settings: ThemeSettings) => void
  onSettingsSaved: (settings: SettingsConsumerValue) => void
}

export function AppShellContent(props: AppShellContentProps) {
  const {
    drawerLayout,
    themeMode,
    initialSnackbar,
    navigationConfig,
    navigationSettings,
    dashboardVersion,
    children,
    onNavigationClick,
    onDrawerUserStateChange,
    navigationClickDelayMs,
    navigationTimestampProvider,
    apiRepository,
    dashboardApiRepository,
    recordedApiRepository,
    reservesApiRepository,
    searchRuleApiRepository,
    viewportWidth,
    realtimeConnectionFactory,
    realtimeConnectionConnector,
    scrollHistory,
    osPrefersDark,
    onSettingsThemePreviewChange,
    onSettingsThemePreviewRestore,
    onSettingsSaved,
  } = props
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { activeSnackbar, showSnackbar, closeSnackbar, suppressedRouteSnackbarClosesRef } =
    useShellSnackbar(initialSnackbar)
  const suppressRouteSnackbarClose = useCallback(
    (count: number) => {
      suppressedRouteSnackbarClosesRef.current = count
    },
    [suppressedRouteSnackbarClosesRef],
  )
  const {
    activeDashboardVersion,
    apiNavigationConfig,
    isInitialServerConfigResolved,
    refreshVersion,
  } = useServerConfigState({
    apiRepository,
    navigationConfig,
    dashboardVersion,
    dashboardApiRepository,
    recordedApiRepository,
    reservesApiRepository,
    searchRuleApiRepository,
    showSnackbar,
  })
  const activeNavigationConfig =
    navigationConfig.status === 'unloaded' ? apiNavigationConfig : navigationConfig
  const activeServerConfig: ActiveServerConfig = activeNavigationConfig
  const navigationItems = generateNavigationItems({
    config: activeNavigationConfig,
    settings: navigationSettings,
  })
  const currentRoute = createNavigationRouteFromLocation(location)
  const selectedNavigationItem = findSelectedNavigationItem(navigationItems, currentRoute)
  const shouldDelayInitialRouteRender =
    apiRepository?.fetchBootstrapChannels !== undefined &&
    navigationConfig.status === 'unloaded' &&
    !isInitialServerConfigResolved
  const { pathname: routePathname, search: routeSearch } = location
  const timestampNormalizedRoutePath = useMemo(
    () =>
      createTimestampNormalizedRoutePath(
        { pathname: routePathname, search: routeSearch },
        navigationTimestampProvider,
      ),
    [navigationTimestampProvider, routePathname, routeSearch],
  )
  const { latestFullRouteRef, saveCurrentRouteScrollPosition } = useRouteScrollRestoration({
    location,
    timestampNormalizedRoutePath,
    scrollHistory,
    apiRepository,
    isInitialServerConfigResolved,
    refreshVersion,
    closeSnackbar,
    suppressedRouteSnackbarClosesRef,
  })
  const handleNavigationItemClick = useNavigationItemClick({
    drawerLayout,
    currentRoute,
    navigate,
    navigationClickDelayMs,
    navigationTimestampProvider,
    onDrawerUserStateChange,
    saveCurrentRouteScrollPosition,
  })
  const isDisconnected = useRealtimeConnection({
    realtimeConnectionFactory,
    realtimeConnectionConnector,
    activeServerConfig,
    location,
    queryClient,
    navigate,
    showSnackbar,
    refreshVersion,
    latestFullRouteRef,
    suppressedRouteSnackbarClosesRef,
  })

  useIOSAddressBarFix(location, viewportWidth)

  // The route boundary normalizes any non-root routed URL that lacks `timestamp` by replacing it
  // in place (Requirement 5.16-5.18 of frontend-app-shell). The actual browser/router location is
  // corrected via `navigate(..., { replace: true })` from an effect, but routed screens (and, in
  // tests, an `AppShellContent`/`App` `children` override standing in for them) are never allowed
  // to observe the uncorrected, `timestamp`-less location in between: an outer `<Routes location>`
  // wrapping whichever of `children` or `<AppRoutes>` is rendered below is given an
  // already-corrected location object for the one or two renders where the real router location
  // has not caught up yet (react-router re-provides `useLocation()` for that whole subtree from
  // this override, per `useRoutesImpl`). Two earlier approaches were tried and rejected:
  // - Rendering a `<Navigate replace>` element in place of `<AppRoutes>` while uncorrected (the
  //   original implementation) swaps the element type React reconciles at that JSX position,
  //   which unmounts and remounts everything under it on every correction. Pagination, filter, and
  //   dialog navigations (e.g. `RecordedPage`/`ReservesPage` `goToPage`, `RecordedSearchDialog`
  //   `onNavigate`) routinely produce a `timestamp`-less URL, so this reset screen-local state
  //   (recorded/reserves edit mode and selection) on every such navigation.
  // - Always rendering `<AppRoutes>` (or `children`) against the real (temporarily uncorrected)
  //   location avoids the unmount, but every routed screen that keys its data query off raw
  //   `location.search` (e.g. `StoragesPage`, `RecordedPage` via `createRecordedQueryKey`) observed
  //   two different `search` values one commit apart — once without `timestamp` and once with it —
  //   and issued a second, redundant fetch for the second value.
  //   `unittest/spec/storages.spec.test.tsx` (AC 1.3) and equivalent Recorded/Reserves/Recording
  //   route-lifecycle specs caught this as a genuine regression (an extra fetch lands where a
  //   test's `mockReturnValueOnce` expects exactly one).
  // - Passing the corrected location only to `<AppRoutes>` via a prop (leaving `children` exposed
  //   to the real, uncorrected location) fixed routed screens but left the `children` test seam
  //   (used by tests that mount a single feature page directly, e.g.
  //   `searchRule.timeSpecified.spec.test.tsx`) unprotected — and also reintroduced this same
  //   render-then-correct sequence one level up, since gating `children` behind
  //   `shouldDelayInitialRouteRender` alone (as the very first attempt did, via `<Navigate>`) is
  //   what had prevented it from ever mounting against the uncorrected location before. Wrapping
  //   both arms of `children ?? <AppRoutes>` in one shared, unconditional `<Routes location>`
  //   fixes both uniformly.
  const locationState = location.state as unknown
  const locationHash = location.hash
  const locationKey = location.key
  useEffect(() => {
    if (shouldDelayInitialRouteRender || timestampNormalizedRoutePath === null) {
      return
    }

    navigate(timestampNormalizedRoutePath, { replace: true, state: locationState })
  }, [navigate, shouldDelayInitialRouteRender, timestampNormalizedRoutePath, locationState])
  const routeLocationOverride = useMemo(() => {
    const correctedSearch =
      timestampNormalizedRoutePath === null
        ? routeSearch
        : parseRoutePath(timestampNormalizedRoutePath).search

    return {
      pathname: routePathname,
      search: correctedSearch,
      hash: locationHash,
      state: locationState,
      key: locationKey,
    }
  }, [
    timestampNormalizedRoutePath,
    routePathname,
    routeSearch,
    locationHash,
    locationState,
    locationKey,
  ])

  if (
    location.pathname === '/onair/watch' &&
    apiRepository !== undefined &&
    navigationConfig.status === 'unloaded' &&
    !isInitialServerConfigResolved
  ) {
    return null
  }

  return (
    <ScrollHistoryProvider scrollHistory={scrollHistory}>
      <AppShell
        drawerLayout={drawerLayout}
        navigationItems={navigationItems}
        selectedNavigationItemId={selectedNavigationItem?.id}
        onNavigationItemClick={handleNavigationItemClick}
        onNavigationClose={() => {
          onDrawerUserStateChange('userClosed')
        }}
        themeMode={themeMode}
        drawerHeaderTitle={resolveDashboardTitle({ version: activeDashboardVersion })}
        snackbar={activeSnackbar}
        onSnackbarClose={closeSnackbar}
        isDisconnected={isDisconnected}
      >
        <Routes location={routeLocationOverride}>
          <Route
            path="*"
            element={
              shouldDelayInitialRouteRender
                ? null
                : (children ?? (
                    <AppRoutes
                      {...props}
                      activeServerConfig={activeServerConfig}
                      activeDashboardVersion={activeDashboardVersion}
                      onNavigationClick={onNavigationClick}
                      showSnackbar={showSnackbar}
                      suppressRouteSnackbarClose={suppressRouteSnackbarClose}
                      onSettingsThemePreviewChange={onSettingsThemePreviewChange}
                      onSettingsThemePreviewRestore={onSettingsThemePreviewRestore}
                      onSettingsSaved={onSettingsSaved}
                      osPrefersDark={osPrefersDark}
                    />
                  ))
            }
          />
        </Routes>
      </AppShell>
    </ScrollHistoryProvider>
  )
}
